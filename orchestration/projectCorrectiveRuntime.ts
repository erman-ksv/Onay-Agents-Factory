import {createHash} from 'node:crypto';
import {existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {assertProjectCheckpointArchive,type createProjectCheckpointArchive} from '../github/projectCheckpointArchive.js';
import {verifyProjectStateProtection,type ProjectStateProtection} from '../github/projectStateProtection.js';
import {createProjectModelBudgetGitHubStore} from '../github/projectModelBudgetStore.js';
import {parseProjectModelBudgetState,type ProjectModelBudgetStore} from './projectModelBudget.js';
import {inspectProjectCorrectionCheckpointFile,restoreProjectCorrectionCheckpoint,writeProjectHostEnvelope,type ProjectCorrectionRecoveryKey} from './projectCorrectionCheckpoint.js';
import {inspectProjectCorrection,type PreparedProjectCorrection} from './projectModelContext.js';
import {prepareProjectCorrectiveTaskPermit,assertProjectCorrectiveTaskPermit,assertProjectCorrectiveAuthorization,type ProjectCorrectiveAuthorization} from './projectCorrectiveAuthorization.js';
import type {AuthorizedProjectBudgetController} from './projectBudgetAuthorization.js';
import type {PreparedProjectPlan} from './projectPlan.js';
import type {ProjectSourceSnapshot} from '../github/projectSourceSnapshot.js';

const refuse=():never=>{throw Error('Corrective checkpoint/claim is unverified or spent. Preserve all evidence and charges; no HTTP replay, second correction or budget reset is authorized.');};
type Archive=ReturnType<typeof createProjectCheckpointArchive>;
type Options=Readonly<{plan:PreparedProjectPlan;controller:AuthorizedProjectBudgetController;authorization:ProjectCorrectiveAuthorization;archive:Archive;key:ProjectCorrectionRecoveryKey;directory:string;stateProtection?:ProjectStateProtection;token:string}>;
export type ProjectCorrectiveOptions=Readonly<{authorization:ProjectCorrectiveAuthorization;archive:Archive}>;
/** Four initial roles plus at most four corrective roles per approved task. */
export function projectCorrectiveBudgetRequirement(plan:PreparedProjectPlan){return Object.freeze({requests:plan.tasks.length*8,requestBytes:plan.tasks.length*8*12000,reservedTokens:plan.tasks.length*8*6000});}
function pendingMode(o:Options,mode:'native'|'simulated'){
 assertProjectCheckpointArchive(o.archive,o.controller,mode);
 return async()=>{await assertProjectCorrectiveAuthorization(o.authorization,o.plan,o.controller,mode);if(mode==='native'||o.stateProtection)await verifyProjectStateProtection(o.stateProtection,o.controller,mode);};
}
async function pending(o:Options,taskId:string,expectedSha256:string,mode:'native'|'simulated'){
 const protect=pendingMode(o,mode);await protect();const history=await o.archive.history(),event=history.at(-1);
 if(!event||event.kind!=='correction-ready'||event.taskId!==taskId||event.sha256!==expectedSha256||history.some(e=>e.kind==='correction-claim'&&e.taskId===taskId))return refuse();
 const path=join(o.directory,event.name);if(!existsSync(path))writeFileSync(path,Buffer.from(event.ciphertextBase64,'base64'),{mode:0o600,flag:'wx'});
 const metadata=inspectProjectCorrectionCheckpointFile(o.key,path,event.sha256);if(mode==='native'&&metadata.provenance!=='native-host')return refuse();if(metadata.taskId!==taskId||metadata.repository!==o.plan.repository||metadata.planFingerprint!==o.plan.fingerprint)return refuse();await protect();
 if(JSON.stringify(await o.archive.history())!==JSON.stringify(history))return refuse();return {path,event,history,metadata,protect};
}
export function createProjectCorrectiveRuntime(o:Options){if(Object.keys(o).some(k=>!['plan','controller','authorization','archive','key','directory','stateProtection','token'].includes(k)))return refuse();return runtime(o,createProjectModelBudgetGitHubStore({projectKey:o.controller.projectKey,token:o.token}),'native');}
export function createProjectCorrectiveRuntimeForTests(o:Options,reader:Pick<ProjectModelBudgetStore,'read'>){return runtime(o,reader,'simulated');}
function runtime(o:Options,reader:Pick<ProjectModelBudgetStore,'read'>,mode:'native'|'simulated'){
 let claimed=false;
 return Object.freeze({
  /** Only BEFORE-admission recovery. A claim or any corrective reservation stops. */
  async inspectPending(taskId:string,sha256:string){const p=await pending(o,taskId,sha256,mode);return Object.freeze({baseSha:p.metadata.baseSha,firstExecutionId:p.metadata.firstExecutionId??'project-run-'+createHash('sha256').update(JSON.stringify([o.plan.fingerprint,taskId])).digest('hex').slice(0,32)});},
  async restore(taskId:string,sha256:string,snapshot:ProjectSourceSnapshot){const p=await pending(o,taskId,sha256,mode);return restoreProjectCorrectionCheckpoint(o.plan,taskId,snapshot,o.controller,o.key,p.path,p.event.sha256,mode);},
  async claim(ticket:PreparedProjectCorrection,sha256:string){
   if(claimed)return refuse();claimed=true;const evidence=await inspectProjectCorrection(ticket,o.plan),p=await pending(o,evidence.taskId,sha256,mode),saved=await reader.read();if(!saved)return refuse();
   const before=parseProjectModelBudgetState(saved.data),state=await o.controller.inspect();if(before.grantSha256!==o.controller.grantSha256||state.remaining.requests<4||state.remaining.requestBytes<48000||state.remaining.reservedTokens<24000||(await o.controller.inspectExecution(evidence.taskId,evidence.executionId)).requests!==0)return refuse();
   const permit=await prepareProjectCorrectiveTaskPermit(o.authorization,o.plan,o.controller,ticket,mode);await p.protect();const again=await reader.read();if(!again||again.revision!==saved.revision||JSON.stringify(parseProjectModelBudgetState(again.data))!==JSON.stringify(before))return refuse();
   const path=join(o.directory,evidence.taskId+'-correction-claim.json'),sealed=writeProjectHostEnvelope('onay-runtime-correction-claim-v1',JSON.stringify({version:1,repository:o.plan.repository,planFingerprint:o.plan.fingerprint,taskId:evidence.taskId,baseSha:p.metadata.baseSha,firstExecutionId:evidence.firstExecutionId,executionId:evidence.executionId,correctionId:ticket.id,checkpointSha256:sha256,priorBudgetStateSha256:createHash('sha256').update(JSON.stringify(before)).digest('hex'),executionAuthorized:false,replayAuthorized:false}),o.key,path);
   // CAS over the exact protected archive pin is the cross-process claim.
   // A lost acknowledgement throws; this method and HTTP are never retried.
   await o.archive.persist({kind:'correction-claim',taskId:evidence.taskId,path,sha256:sealed.sha256});
   const assertCurrent=async()=>{
    await p.protect();await assertProjectCorrectiveTaskPermit(permit,o.plan,o.controller,ticket,mode);const live=await reader.read();if(!live)return refuse();const data=parseProjectModelBudgetState(live.data),extra=data.reservations.slice(before.reservations.length);
    if(data.grantSha256!==before.grantSha256||JSON.stringify(data.reservations.slice(0,before.reservations.length))!==JSON.stringify(before.reservations)||extra.length>4||extra.some((r,i)=>r.taskId!==evidence.taskId||r.reservationId!==evidence.executionId+':r'+(i+1)))return refuse();
    await o.controller.inspect();const history=await o.archive.history();if(p.history.some((e,i)=>history[i]?.sha256!==e.sha256)||history[p.history.length]?.sha256!==sealed.sha256||history.filter(e=>e.kind==='correction-claim'&&e.taskId===evidence.taskId).length!==1)return refuse();
   };
   await assertCurrent();return Object.freeze({permit,assertCurrent,executionId:evidence.executionId});
  },
 });
}
