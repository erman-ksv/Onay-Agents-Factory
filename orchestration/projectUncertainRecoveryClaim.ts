import {createHash} from 'node:crypto';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createProjectModelBudgetGitHubStore} from '../github/projectModelBudgetStore.js';
import {assertProjectCheckpointArchive,type createProjectCheckpointArchive} from '../github/projectCheckpointArchive.js';
import {assertProjectStateProtection,verifyProjectStateProtection,type ProjectStateProtection} from '../github/projectStateProtection.js';
import {consumeProjectUncertainRecoveryApproval,type ProjectUncertainRecoveryApproval} from './projectUncertainRecoveryApproval.js';
import {projectBudgetStateDigest} from './projectBudgetExtensionAuthorization.js';
import {assertProjectGrantLineageFloor,type ProjectGrantLineage} from './projectGrantLineage.js';
import {readProjectHostEnvelope,writeProjectHostEnvelope,type ProjectCorrectionRecoveryKey} from './projectCorrectionCheckpoint.js';
import type {AuthorizedProjectBudgetController} from './projectBudgetAuthorization.js';
import type {ProjectModelBudgetStore} from './projectModelBudget.js';
type Binding=Parameters<typeof consumeProjectUncertainRecoveryApproval>[2];
type Options={controller:AuthorizedProjectBudgetController;approval:ProjectUncertainRecoveryApproval;binding:Binding;archive:ReturnType<typeof createProjectCheckpointArchive>;key:ProjectCorrectionRecoveryKey;stateProtection?:ProjectStateProtection;lineage?:ProjectGrantLineage};
const refuse=():never=>{throw Error('Uncertain recovery claim refused or uncertain. Preserve original and recovery claims and all charges; no retry or original replay is authorized.');};
declare const brand:unique symbol;export type ProjectUncertainRecoveryTicket=Readonly<{[brand]:true}>;
const tickets=new WeakMap<object,{controller:AuthorizedProjectBudgetController;taskId:string;executionId:string;baseSha:string;native:boolean;used:boolean;current:()=>Promise<void>}>();
export function prepareProjectUncertainRecoveryClaim(o:Options&{token:string}){
 if(Object.keys(o).some(k=>!['controller','approval','binding','archive','key','stateProtection','lineage','token'].includes(k)))return Promise.reject(Error('Unverified recovery options'));
 return prepare(o,createProjectModelBudgetGitHubStore({projectKey:o.controller.projectKey,token:o.token}),true);
}
export function prepareProjectUncertainRecoveryClaimForTests(o:Options,store:Pick<ProjectModelBudgetStore,'read'>){return prepare(o,store,false);}
async function prepare(o:Options,store:Pick<ProjectModelBudgetStore,'read'>,native:boolean):Promise<ProjectUncertainRecoveryTicket>{let directory:string|undefined;try{
 const {controller,archive,key}=o,b=Object.freeze({...o.binding}),mode=native?'native':'simulated';
 assertProjectCheckpointArchive(archive,controller,mode);if(native||o.stateProtection)assertProjectStateProtection(o.stateProtection,controller,mode);
 const protect=async()=>{if(native||o.stateProtection)await verifyProjectStateProtection(o.stateProtection,controller,mode);await controller.assertAuthorized();};await protect();
 const saved=await store.read(),state=await controller.inspect();if(!saved||saved.data===undefined||projectBudgetStateDigest(saved.data)!==b.budgetStateSha256||state.remaining.requests<8||state.remaining.requestBytes<96000||state.remaining.reservedTokens<48000)return refuse();
 const raw=JSON.parse(JSON.stringify(saved.data)) as {grantSha256:string;reservations:Array<{reservationId:string;taskId:string;requestSha256:string;requestBytes:number}>};if(raw.grantSha256!==controller.grantSha256||raw.reservations.length!==1)return refuse();
 const originalId='project-run-'+createHash('sha256').update(JSON.stringify([controller.identity.planFingerprint,b.taskId])).digest('hex').slice(0,32),reservation=raw.reservations[0]!;
 if(reservation.reservationId!==originalId+':r1'||reservation.taskId!==b.taskId||reservation.requestSha256!==b.originalRequestSha256)return refuse();
 const pin=archive.snapshot().pin;if(!pin||pin.head!==b.archiveHead||pin.sequence!==2||b.archiveSequence!==2)return refuse();
 const history=await archive.history();if(history.length!==2||history[0]?.kind!=='task-start'||history[1]?.kind!=='before-http'||history.some(e=>e.taskId!==b.taskId))return refuse();
 directory=mkdtempSync(join(tmpdir(),'onay-recovery-claim-'));const decode=(event:typeof history[number],kind:string)=>{const path=join(directory!,event.name);writeFileSync(path,Buffer.from(event.ciphertextBase64,'base64'),{mode:0o600,flag:'wx'});return JSON.parse(readProjectHostEnvelope(kind,key,path,event.sha256));};
 const start=decode(history[0]!,'onay-task-start-v1'),http=decode(history[1]!,'onay-runtime-http-v1');
 if(start.taskId!==b.taskId||start.planFingerprint!==controller.identity.planFingerprint||start.repository!==controller.identity.repository||!/^([a-f0-9]{40})$/.test(start.baseSha)||start.executionAuthorized!==false||http.taskId!==b.taskId||http.stage!=='before-http'||http.executionId!==originalId||http.requestSha256!==reservation.requestSha256||http.requestBytes!==reservation.requestBytes||http.attemptedRequests!==1||http.providerCallsSent!==0||http.httpInFlight!==true)return refuse();
 const floor=start.budget;if(!floor||floor.projectKey!==controller.projectKey||!floor.used)return refuse();
 if(floor.grantSha256!==state.grantSha256){if(!o.lineage)return refuse();await assertProjectGrantLineageFloor(o.lineage,controller,floor,mode);}
 if((['requests','requestBytes','reservedTokens'] as const).some(k=>!Number.isSafeInteger(floor.used[k])||floor.used[k]<0||floor.used[k]>state.used[k]))return refuse();
 const approval=await consumeProjectUncertainRecoveryApproval(o.approval,controller,b,mode);
 if((await controller.inspectExecution(b.taskId,originalId)).requests!==1||(await controller.inspectExecution(b.taskId,approval.recoveryExecutionId)).requests!==0)return refuse();
 await protect();await approval.assertAuthorized();const before=await store.read();if(!before||before.revision!==saved.revision||projectBudgetStateDigest(before.data)!==b.budgetStateSha256)return refuse();
 const path=join(directory,b.taskId+'-uncertain-1-start.json'),sealed=writeProjectHostEnvelope('onay-task-start-v1',JSON.stringify({version:1,taskId:b.taskId,planFingerprint:controller.identity.planFingerprint,repository:controller.identity.repository,baseSha:start.baseSha,executionId:approval.recoveryExecutionId,recoveryOf:{archiveHead:b.archiveHead,requestSha256:b.originalRequestSha256,originalExecutionId:originalId},budget:{projectKey:controller.projectKey,grantSha256:state.grantSha256,used:state.used},executionAuthorized:false,replayOriginal:false}),key,path);
 await archive.persist({kind:'task-start',taskId:b.taskId,path,sha256:sealed.sha256});
 const current=async()=>{await protect();await approval.assertAuthorized();const live=await store.read();if(!live)return refuse();projectBudgetStateDigest(live.data);const data=live.data as typeof raw;if(data.grantSha256!==controller.grantSha256||JSON.stringify(data.reservations[0])!==JSON.stringify(reservation)||data.reservations.length>5||data.reservations.slice(1).some((r,i)=>r.taskId!==b.taskId||r.reservationId!==approval.recoveryExecutionId+':r'+(i+1)))return refuse();await controller.inspect();const events=await archive.history(),claims=events.filter(e=>e.kind==='task-start');if(events[0]?.sha256!==history[0]!.sha256||events[1]?.sha256!==history[1]!.sha256||events[2]?.sha256!==sealed.sha256||claims.length!==2||events.some(e=>e.taskId!==b.taskId))return refuse();};await current();
 const cap=Object.freeze({}) as ProjectUncertainRecoveryTicket;tickets.set(cap,{controller,taskId:b.taskId,executionId:approval.recoveryExecutionId,baseSha:start.baseSha,native,used:false,current});return cap;
}catch{return refuse();}finally{if(directory)rmSync(directory,{recursive:true,force:true});}}
/** A ticket is host-only and single-use. A later ordinary execution-admission
 * gate must still issue a scoped budget capability; this does not send HTTP. */
export async function consumeProjectUncertainRecoveryTicket(cap:ProjectUncertainRecoveryTicket,controller:AuthorizedProjectBudgetController,taskId:string,mode:'native'|'simulated'){
 const r=tickets.get(cap);if(!r||r.used||r.controller!==controller||r.taskId!==taskId||mode==='native'&&!r.native)return refuse();r.used=true;await r.current();return Object.freeze({executionId:r.executionId,parentSha:r.baseSha,assertCurrent:r.current,requiresCooldown:true as const,executionAuthorized:false as const,replayOriginal:false as const});
}
