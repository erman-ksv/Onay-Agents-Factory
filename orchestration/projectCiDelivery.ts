import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,lstatSync,realpathSync,readdirSync,unlinkSync,fsyncSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {projectPlanBudgetIdentity,type PreparedProjectPlan} from './projectPlan.js';
import {isAuthorizedProjectBudgetController,type AuthorizedProjectBudgetController} from './projectBudgetAuthorization.js';
import {readProjectHostEnvelopeFile,writeProjectHostEnvelope,type ProjectCorrectionRecoveryKey} from './projectCorrectionCheckpoint.js';
import {projectCandidateCiConfirmationBinding,consumeProjectCandidateCiConfirmation,type ProjectCandidateCiConfirmation} from '../github/projectPublisher.js';

export const PROJECT_CI_DELIVERY_ERROR='Durable CI delivery refused or uncertain. Preserve the journal and lock; no duplicate dispatch, model replay, budget reset or publication is authorized.';
const refuse=():never=>{throw Error(PROJECT_CI_DELIVERY_ERROR);};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const kind='onay-ci-delivery-v1';
type Charge=Readonly<{requests:number;requestBytes:number;reservedTokens:number}>;
type Entry=Readonly<{version:1;sequence:number;previousSha256:string|null;planFingerprint:string;ownerFingerprint:string;targetProfileSha256:string;projectKey:string;grantSha256:string;used:Charge;taskId:string;parentSha:string;candidateSha:string;policySha256:string;provenance:'native-github'|'simulated';nextTaskId:string|null;dispatch:'claimed'|'budget-blocked'|'complete';executionAuthorized:false}>;
type Options=Readonly<{plan:PreparedProjectPlan;controller:AuthorizedProjectBudgetController;directory:string;key:ProjectCorrectionRecoveryKey}>;
export type ProjectCiDispatchNotice=Readonly<{taskId:string;completedTaskId:string;parentSha:string;planFingerprint:string;requiresFreshSource:true;requiresFreshAdmission:true;requiresCooldown:true;executionAuthorized:false;publicationAuthorized:false}>;
type Dispatch=(notice:ProjectCiDispatchNotice)=>Promise<void>;

/** Production accepts only native publication + CI capabilities. This is an
 * at-most-once scheduler notification, NOT an execution/admission capability.
 * A fixed host worker must separately load fresh source, check dependencies,
 * obtain a budget admission and enforce cooldown before any model request. */
export function createProjectCiDelivery(options:Options){return delivery(options,'native');}
/** Test injection cannot upgrade simulated publication/CI to native authority. */
export function createProjectCiDeliveryForTests(options:Options){return delivery(options,'simulated');}

function delivery(options:Options,mode:'native'|'simulated'){
 const {plan,controller,directory,key}=options,identity=projectPlanBudgetIdentity(plan);
 if(Object.keys(options).some(k=>!['plan','controller','directory','key'].includes(k))||plan.status!=='planned'||!isAuthorizedProjectBudgetController(controller)||controller.operationMode!=='development'||controller.identity.projectId!==identity.projectId||controller.identity.repository!==identity.repository||controller.identity.planFingerprint!==identity.planFingerprint||controller.identity.ownerFingerprint!==identity.ownerFingerprint||JSON.stringify(controller.identity.taskIds)!==JSON.stringify(identity.taskIds)||controller.targetProfileSha256!==plan.targetProfileSha256||!isAbsolute(directory)||resolve(directory)!==directory)return refuse();
 function openDirectory(){
  if(realpathSync(directory)!==directory)return refuse();
  const fd=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{const stat=fstatSync(fd);if(!stat.isDirectory()||(stat.mode&0o777)!==0o700||process.getuid&&stat.uid!==process.getuid())return refuse();
   const check=()=>{const now=lstatSync(directory);if(!now.isDirectory()||now.ino!==stat.ino||now.dev!==stat.dev||(now.mode&0o777)!==0o700)return refuse();};check();return{fd,check};
  }catch{closeSync(fd);return refuse();}
 }
 async function budget(){await controller.assertAuthorized();return controller.inspect();}
 async function entries(){
  const state=await budget(),p=openDirectory();try{
   const names=readdirSync(directory).filter(n=>n!=='.delivery.lock').sort();if(names.length>plan.tasks.length||names.some((n,i)=>n!==String(i+1).padStart(4,'0')+'.json'))return refuse();
   const records:Array<{value:Entry;sha256:string}>=[],done=new Set<string>();let parent=plan.request.baseSha;
   for(const name of names){
    const sealed=readProjectHostEnvelopeFile(kind,key,join(directory,name)),v=JSON.parse(sealed.payload) as Entry;
    if(!v||JSON.stringify(Object.keys(v).sort())!==JSON.stringify(['version','sequence','previousSha256','planFingerprint','ownerFingerprint','targetProfileSha256','projectKey','grantSha256','used','taskId','parentSha','candidateSha','policySha256','provenance','nextTaskId','dispatch','executionAuthorized'].sort())||v.version!==1||v.sequence!==records.length+1||v.previousSha256!==(records.at(-1)?.sha256??null)||v.planFingerprint!==plan.fingerprint||v.ownerFingerprint!==plan.ownerFingerprint||v.targetProfileSha256!==plan.targetProfileSha256||v.projectKey!==controller.projectKey||v.grantSha256!==state.grantSha256||!v.used||JSON.stringify(Object.keys(v.used).sort())!==JSON.stringify(['requestBytes','requests','reservedTokens'])||(['requests','requestBytes','reservedTokens'] as const).some(k=>!Number.isSafeInteger(v.used[k])||v.used[k]<0||v.used[k]>state.used[k]||v.used[k]<(records.at(-1)?.value.used[k]??0))||!['native-github','simulated'].includes(v.provenance)||mode==='native'&&v.provenance!=='native-github'||!['claimed','budget-blocked','complete'].includes(v.dispatch)||v.executionAuthorized!==false||!/^([a-f0-9]{40})$/.test(v.candidateSha)||!/^[a-f0-9]{64}$/.test(v.policySha256)||v.parentSha!==parent||done.has(v.taskId))return refuse();
    const task=plan.tasks.find(t=>t.id===v.taskId);if(!task||task.dependsOn.some(id=>!done.has(id)))return refuse();
    if(records.length&&records.at(-1)!.value.nextTaskId!==v.taskId)return refuse();
    done.add(v.taskId);const next=plan.tasks.find(t=>!done.has(t.id)&&t.dependsOn.every(id=>done.has(id)));
    if(v.nextTaskId!==(next?.id??null)||(v.dispatch==='complete')!==!next||!next&&v.dispatch!=='complete')return refuse();
    parent=v.candidateSha;records.push({value:v,sha256:sealed.sha256});
   }
   p.check();return records;
  }finally{closeSync(p.fd);}
 }
 return Object.freeze({
  /** Authenticated host metadata only; no capability restoration or writes. */
  async inspect(){try{return Object.freeze((await entries()).map(r=>Object.freeze({...r.value,used:Object.freeze({...r.value.used}),sha256:r.sha256})));}catch{return refuse();}},
  async deliver(confirmation:ProjectCandidateCiConfirmation,dispatch:Dispatch){
   let lock:number|undefined,p:ReturnType<typeof openDirectory>|undefined,lockIdentity:ReturnType<typeof fstatSync>|undefined;
   try{
    if(typeof dispatch!=='function')return refuse();
    const bound=projectCandidateCiConfirmationBinding(confirmation),candidate=bound.candidate;
    if(bound.plan!==plan||bound.controller!==controller||!confirmation.ciVerified||confirmation.ciStatus!=='passed'||mode==='native'&&candidate.provenance!=='native-github')return refuse();
    const previous=await entries(),duplicate=previous.find(r=>r.value.taskId===candidate.taskId);
    if(duplicate){if(duplicate.value.candidateSha!==candidate.candidateSha||duplicate.value.policySha256!==bound.evidence.policySha256)return refuse();return Object.freeze({status:'already-recorded' as const,taskId:candidate.taskId,dispatch:duplicate.value.dispatch,executionAuthorized:false as const});}
    p=openDirectory();lock=openSync(join(directory,'.delivery.lock'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);lockIdentity=fstatSync(lock);fsyncSync(lock);fsyncSync(p.fd);p.check();
    // Re-read under the exclusive lock. A competing delivery never retries.
    const saved=await entries();if(saved.length!==previous.length||saved.at(-1)?.sha256!==previous.at(-1)?.sha256)return refuse();
    const done=new Set(saved.map(r=>r.value.taskId)),task=plan.tasks.find(t=>t.id===candidate.taskId);
    if(!task||task.dependsOn.some(id=>!done.has(id))||candidate.parentSha!==(saved.at(-1)?.value.candidateSha??plan.request.baseSha)||saved.length&&saved.at(-1)!.value.nextTaskId!==task.id)return refuse();
    await consumeProjectCandidateCiConfirmation(confirmation,mode);
    const state=await budget();done.add(task.id);const next=plan.tasks.find(t=>!done.has(t.id)&&t.dependsOn.every(id=>done.has(id))),enough=state.remaining.requests>=4&&state.remaining.requestBytes>=48000&&state.remaining.reservedTokens>=24000;
    const record:Entry={version:1,sequence:saved.length+1,previousSha256:saved.at(-1)?.sha256??null,planFingerprint:plan.fingerprint,ownerFingerprint:plan.ownerFingerprint,targetProfileSha256:plan.targetProfileSha256,projectKey:controller.projectKey,grantSha256:state.grantSha256,used:state.used,taskId:task.id,parentSha:candidate.parentSha,candidateSha:candidate.candidateSha,policySha256:bound.evidence.policySha256,provenance:candidate.provenance,nextTaskId:next?.id??null,dispatch:!next?'complete':enough?'claimed':'budget-blocked',executionAuthorized:false};
    p.check();writeProjectHostEnvelope(kind,JSON.stringify(record),key,join(directory,String(record.sequence).padStart(4,'0')+'.json'));p.check();
    // The durable claim precedes the callback. Unknown callback outcome is
    // never retried, even by a new worker or another CI event/run attempt.
    if(record.dispatch!=='claimed')return Object.freeze({status:record.dispatch,taskId:task.id,executionAuthorized:false as const});
    try{await dispatch(Object.freeze({taskId:next!.id,completedTaskId:task.id,parentSha:candidate.candidateSha,planFingerprint:plan.fingerprint,requiresFreshSource:true,requiresFreshAdmission:true,requiresCooldown:true,executionAuthorized:false,publicationAuthorized:false}));return Object.freeze({status:'notified' as const,taskId:task.id,nextTaskId:next!.id,executionAuthorized:false as const});}
    catch{return Object.freeze({status:'dispatch-uncertain' as const,taskId:task.id,nextTaskId:next!.id,executionAuthorized:false as const});}
   }catch{return refuse();}finally{
    if(lock!==undefined){try{const path=join(directory,'.delivery.lock'),now=lstatSync(path);if(now.ino===lockIdentity?.ino&&now.dev===lockIdentity.dev&&now.isFile()){unlinkSync(path);if(p)fsyncSync(p.fd);}}finally{closeSync(lock);}}
    if(p)closeSync(p.fd);
   }
  },
 });
}
