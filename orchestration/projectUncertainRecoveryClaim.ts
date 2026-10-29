import {createHash} from 'node:crypto';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createProjectModelBudgetGitHubStore} from '../github/projectModelBudgetStore.js';
import {assertProjectCheckpointArchive,type createProjectCheckpointArchive} from '../github/projectCheckpointArchive.js';
import {assertProjectStateProtection,verifyProjectStateProtection,type ProjectStateProtection} from '../github/projectStateProtection.js';
import {consumeProjectUncertainRecoveryApproval,type ProjectUncertainRecoveryApproval} from './projectUncertainRecoveryApproval.js';
import {consumeProjectReplacementRecoveryApproval,type ProjectReplacementRecoveryApproval} from './projectReplacementRecoveryApproval.js';
import {parseProjectModelBudgetState} from './projectModelBudget.js';
import {projectBudgetStateDigest} from './projectBudgetExtensionAuthorization.js';
import {assertProjectGrantLineageFloor,type ProjectGrantLineage} from './projectGrantLineage.js';
import {readProjectHostEnvelope,writeProjectHostEnvelope,type ProjectCorrectionRecoveryKey} from './projectCorrectionCheckpoint.js';
import type {AuthorizedProjectBudgetController} from './projectBudgetAuthorization.js';
import type {ProjectModelBudgetStore} from './projectModelBudget.js';
type Binding=Parameters<typeof consumeProjectUncertainRecoveryApproval>[2];
type Options={controller:AuthorizedProjectBudgetController;approval:ProjectUncertainRecoveryApproval;binding:Binding;archive:ReturnType<typeof createProjectCheckpointArchive>;key:ProjectCorrectionRecoveryKey;stateProtection?:ProjectStateProtection;lineage?:ProjectGrantLineage};
type InspectionOptions=Omit<Options,'approval'>;
const refuse=():never=>{throw Error('Uncertain recovery claim refused or uncertain. Preserve original and recovery claims and all charges; no retry or original replay is authorized.');};
declare const brand:unique symbol;export type ProjectUncertainRecoveryTicket=Readonly<{[brand]:true}>;
const tickets=new WeakMap<object,{controller:AuthorizedProjectBudgetController;taskId:string;executionId:string;baseSha:string;checkpointSuffix:'uncertain-1'|'uncertain-2'|'uncertain-3'|'uncertain-4';model?:string;native:boolean;used:boolean;current:()=>Promise<void>}>();
export function prepareProjectUncertainRecoveryClaim(o:Options&{token:string}){
 if(Object.keys(o).some(k=>!['controller','approval','binding','archive','key','stateProtection','lineage','token'].includes(k)))return Promise.reject(Error('Unverified recovery options'));
 return prepare(o,createProjectModelBudgetGitHubStore({projectKey:o.controller.projectKey,token:o.token}),true);
}
export function prepareProjectUncertainRecoveryClaimForTests(o:Options,store:Pick<ProjectModelBudgetStore,'read'>){return prepare(o,store,false);}
/** A preflight report is DATA only: no approval is consumed, no claim is
 * appended and no task scope is created, including when the budget is enough. */
export function inspectProjectUncertainRecovery(o:InspectionOptions&{token:string}){
 if(Object.keys(o).some(k=>!['controller','binding','archive','key','stateProtection','lineage','token'].includes(k)))return Promise.reject(Error('Unverified recovery inspection options'));
 return report(o,createProjectModelBudgetGitHubStore({projectKey:o.controller.projectKey,token:o.token}),true);
}
export function inspectProjectUncertainRecoveryForTests(o:InspectionOptions,store:Pick<ProjectModelBudgetStore,'read'>){return report(o,store,false);}
const required=Object.freeze({requests:8,requestBytes:96000,reservedTokens:48000});
async function report(o:InspectionOptions,store:Pick<ProjectModelBudgetStore,'read'>,native:boolean){
 const r=await inspect(o,store,native),shortfall=Object.freeze({requests:Math.max(0,required.requests-r.state.remaining.requests),requestBytes:Math.max(0,required.requestBytes-r.state.remaining.requestBytes),reservedTokens:Math.max(0,required.reservedTokens-r.state.remaining.reservedTokens)});
 return Object.freeze({status:'uncertain-recovery-inspected' as const,binding:r.b,budgetRevision:r.saved.revision,baseSha:r.baseSha,used:r.state.used,remaining:r.state.remaining,required,shortfall,budgetSufficient:Object.values(shortfall).every(n=>n===0),originalOutcome:'unverified' as const,executionAuthorized:false as const,replayOriginal:false as const,providerCalls:0 as const,budgetWrites:0 as const,archiveWrites:0 as const});
}
async function inspect(o:InspectionOptions,store:Pick<ProjectModelBudgetStore,'read'>,native:boolean){let directory:string|undefined;try{
 const {controller,archive,key}=o,b=Object.freeze({...o.binding}),mode=native?'native':'simulated';
 if(Object.keys(b).sort().join(',')!=='archiveHead,archiveSequence,budgetStateSha256,originalRequestSha256,taskId'||b.taskId!==controller.identity.taskIds[0]||!/^([a-f0-9]{40})$/.test(b.archiveHead)||b.archiveSequence!==2||!/^([a-f0-9]{64})$/.test(b.budgetStateSha256)||!/^([a-f0-9]{64})$/.test(b.originalRequestSha256))return refuse();
 assertProjectCheckpointArchive(archive,controller,mode);if(native||o.stateProtection)assertProjectStateProtection(o.stateProtection,controller,mode);
 const protect=async()=>{if(native||o.stateProtection)await verifyProjectStateProtection(o.stateProtection,controller,mode);await controller.assertAuthorized();};await protect();
 const saved=await store.read(),state=await controller.inspect();if(!saved||saved.data===undefined||projectBudgetStateDigest(saved.data)!==b.budgetStateSha256)return refuse();
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
 await protect();const after=await store.read();if(!after||after.revision!==saved.revision||projectBudgetStateDigest(after.data)!==b.budgetStateSha256)return refuse();
 await archive.history();if(archive.snapshot().pin?.head!==b.archiveHead)return refuse();
 return {b,saved,state,raw,reservation,originalId,baseSha:start.baseSha as string,history,protect};
}catch{return refuse();}finally{if(directory)rmSync(directory,{recursive:true,force:true});}}
async function prepare(o:Options,store:Pick<ProjectModelBudgetStore,'read'>,native:boolean):Promise<ProjectUncertainRecoveryTicket>{let directory:string|undefined;try{
 const {controller,archive,key}=o,mode=native?'native':'simulated',r=await inspect(o,store,native),{b,saved,state,raw,reservation,originalId,baseSha,history,protect}=r;
 if((['requests','requestBytes','reservedTokens'] as const).some(k=>state.remaining[k]<required[k]))return refuse();
 const approval=await consumeProjectUncertainRecoveryApproval(o.approval,controller,b,mode);
 if((await controller.inspectExecution(b.taskId,originalId)).requests!==1||(await controller.inspectExecution(b.taskId,approval.recoveryExecutionId)).requests!==0)return refuse();
 await protect();await approval.assertAuthorized();const before=await store.read();if(!before||before.revision!==saved.revision||projectBudgetStateDigest(before.data)!==b.budgetStateSha256)return refuse();
 directory=mkdtempSync(join(tmpdir(),'onay-recovery-claim-'));const path=join(directory,b.taskId+'-uncertain-1-start.json'),sealed=writeProjectHostEnvelope('onay-task-start-v1',JSON.stringify({version:1,taskId:b.taskId,planFingerprint:controller.identity.planFingerprint,repository:controller.identity.repository,baseSha,executionId:approval.recoveryExecutionId,recoveryOf:{archiveHead:b.archiveHead,requestSha256:b.originalRequestSha256,originalExecutionId:originalId},budget:{projectKey:controller.projectKey,grantSha256:state.grantSha256,used:state.used},executionAuthorized:false,replayOriginal:false}),key,path);
 await archive.persist({kind:'task-start',taskId:b.taskId,path,sha256:sealed.sha256});
 const current=async()=>{await protect();await approval.assertAuthorized();const live=await store.read();if(!live)return refuse();projectBudgetStateDigest(live.data);const data=live.data as typeof raw;if(data.grantSha256!==controller.grantSha256||JSON.stringify(data.reservations[0])!==JSON.stringify(reservation)||data.reservations.length>5||data.reservations.slice(1).some((r,i)=>r.taskId!==b.taskId||r.reservationId!==approval.recoveryExecutionId+':r'+(i+1)))return refuse();await controller.inspect();const events=await archive.history(),claims=events.filter(e=>e.kind==='task-start');if(events[0]?.sha256!==history[0]!.sha256||events[1]?.sha256!==history[1]!.sha256||events[2]?.sha256!==sealed.sha256||claims.length!==2||events.some(e=>e.taskId!==b.taskId))return refuse();};await current();
 const cap=Object.freeze({}) as ProjectUncertainRecoveryTicket;tickets.set(cap,{controller,taskId:b.taskId,executionId:approval.recoveryExecutionId,baseSha,checkpointSuffix:'uncertain-1',native,used:false,current});return cap;
}catch{return refuse();}finally{if(directory)rmSync(directory,{recursive:true,force:true});}}
/** A ticket is host-only and single-use. A later ordinary execution-admission
 * gate must still issue a scoped budget capability; this does not send HTTP. */
export async function consumeProjectUncertainRecoveryTicket(cap:ProjectUncertainRecoveryTicket,controller:AuthorizedProjectBudgetController,taskId:string,mode:'native'|'simulated'){
 const r=tickets.get(cap);if(!r||r.used||r.controller!==controller||r.taskId!==taskId||mode==='native'&&!r.native)return refuse();r.used=true;await r.current();return Object.freeze({executionId:r.executionId,parentSha:r.baseSha,checkpointSuffix:r.checkpointSuffix,...(r.model?{model:r.model}:{}),assertCurrent:r.current,requiresCooldown:true as const,executionAuthorized:false as const,replayOriginal:false as const});
}

/** Read-only in-memory binding. JSON cannot inspect or reconstruct a ticket. */
export async function projectUncertainRecoveryTicketBinding(cap:ProjectUncertainRecoveryTicket,controller:AuthorizedProjectBudgetController,taskId:string,mode:'native'|'simulated'){
 const r=tickets.get(cap);if(!r||r.used||r.controller!==controller||r.taskId!==taskId||mode==='native'&&!r.native)return refuse();await r.current();return Object.freeze({executionId:r.executionId,parentSha:r.baseSha,checkpointSuffix:r.checkpointSuffix,...(r.model?{model:r.model}:{}),assertCurrent:r.current,executionAuthorized:false as const});
}
type ReplacementBinding=Parameters<typeof consumeProjectReplacementRecoveryApproval>[2];
type ReplacementOptions=Omit<Options,'approval'|'binding'>&{approval:ProjectReplacementRecoveryApproval;binding:ReplacementBinding};
type ReplacementInspection=Omit<ReplacementOptions,'approval'>;
export function prepareProjectReplacementRecoveryClaim(o:ReplacementOptions&{token:string}){
 if(Object.keys(o).some(k=>!['controller','approval','binding','archive','key','stateProtection','lineage','token'].includes(k)))return Promise.reject(Error('Unverified replacement claim options'));
 return prepareReplacement(o,createProjectModelBudgetGitHubStore({projectKey:o.controller.projectKey,token:o.token}),true);
}
export function prepareProjectReplacementRecoveryClaimForTests(o:ReplacementOptions,store:Pick<ProjectModelBudgetStore,'read'>){return prepareReplacement(o,store,false);}
export function inspectProjectReplacementRecovery(o:ReplacementInspection&{token:string}){
 if(Object.keys(o).some(k=>!['controller','binding','archive','key','stateProtection','lineage','token'].includes(k)))return Promise.reject(Error('Unverified replacement inspection options'));
 return replacementReport(o,createProjectModelBudgetGitHubStore({projectKey:o.controller.projectKey,token:o.token}),true);
}
export function inspectProjectReplacementRecoveryForTests(o:ReplacementInspection,store:Pick<ProjectModelBudgetStore,'read'>){return replacementReport(o,store,false);}
async function replacementReport(o:ReplacementInspection,store:Pick<ProjectModelBudgetStore,'read'>,native:boolean){const r=await inspectReplacement(o,store,native),shortfall=Object.freeze({requests:Math.max(0,required.requests-r.state.remaining.requests),requestBytes:Math.max(0,required.requestBytes-r.state.remaining.requestBytes),reservedTokens:Math.max(0,required.reservedTokens-r.state.remaining.reservedTokens)});return Object.freeze({status:'replacement-recovery-inspected',binding:r.b,budgetRevision:r.saved.revision,baseSha:r.baseSha,used:r.state.used,remaining:r.state.remaining,required,shortfall,budgetSufficient:Object.values(shortfall).every(n=>n===0),originalOutcome:'unverified',previousRecoveryOutcome:'unverified',executionAuthorized:false,replayOriginal:false,replayPreviousRecovery:false,modelGenerationRequests:0,budgetWrites:0,archiveWrites:0});}
async function inspectReplacement(o:ReplacementInspection,store:Pick<ProjectModelBudgetStore,'read'>,native:boolean){let directory:string|undefined;try{
 const {controller,archive,key}=o,b=Object.freeze({...o.binding}),mode=native?'native':'simulated';
 if(Object.keys(b).sort().join(',')!=='archiveHead,archiveSequence,budgetStateSha256,failedRunId,failedRunSha,model,originalRequestSha256,taskId'||b.taskId!==controller.identity.taskIds[0]||!/^([a-f0-9]{40})$/.test(b.archiveHead)||![4,6,8].includes(b.archiveSequence)||!/^([a-f0-9]{64})$/.test(b.budgetStateSha256)||!/^([a-f0-9]{64})$/.test(b.originalRequestSha256)||b.model!=='openai/gpt-oss-120b'||!Number.isSafeInteger(b.failedRunId)||b.failedRunId<1||!/^([a-f0-9]{40})$/.test(b.failedRunSha))return refuse();
 assertProjectCheckpointArchive(archive,controller,mode);if(native||o.stateProtection)assertProjectStateProtection(o.stateProtection,controller,mode);
 const protect=async()=>{if(native||o.stateProtection)await verifyProjectStateProtection(o.stateProtection,controller,mode);await controller.assertAuthorized();};await protect();
 const saved=await store.read(),state=await controller.inspect();if(!saved||projectBudgetStateDigest(saved.data)!==b.budgetStateSha256)return refuse();const raw=parseProjectModelBudgetState(saved.data);
 const id=(suffix?:string)=>'project-run-'+createHash('sha256').update(JSON.stringify([controller.identity.planFingerprint,b.taskId,...(suffix?[suffix]:[])])).digest('hex').slice(0,32),originalId=id(),priorCount=b.archiveSequence/2,priorIds=[originalId,...Array.from({length:priorCount-1},(_,i)=>id('uncertain-'+(i+1)))],previousId=priorIds.at(-1)!;
 if(raw.grantSha256!==controller.grantSha256||raw.reservations.length!==priorCount||raw.reservations.some((r,i)=>r.taskId!==b.taskId||r.reservationId!==priorIds[i]+':r1')||raw.reservations[0]!.requestSha256!==b.originalRequestSha256)return refuse();
 const pin=archive.snapshot().pin;if(!pin||pin.head!==b.archiveHead||pin.sequence!==b.archiveSequence)return refuse();const history=await archive.history();if(history.length!==b.archiveSequence||history.some((e,i)=>e.taskId!==b.taskId||e.kind!==(i%2===0?'task-start':'before-http')))return refuse();
 directory=mkdtempSync(join(tmpdir(),'onay-replacement-inspect-'));const decode=(index:number,kind:string)=>{const e=history[index]!,path=join(directory!,e.name);writeFileSync(path,Buffer.from(e.ciphertextBase64,'base64'),{mode:0o600,flag:'wx'});return JSON.parse(readProjectHostEnvelope(kind,key,path,e.sha256));};
 const start=decode(0,'onay-task-start-v1'),http=decode(1,'onay-runtime-http-v1'),prior=decode(2,'onay-task-start-v1'),priorHttp=decode(3,'onay-runtime-http-v1');
 if(!/^([a-f0-9]{40})$/.test(start.baseSha))return refuse();
 const starts=[start,prior,...Array.from({length:priorCount-2},(_,i)=>decode(4+i*2,'onay-task-start-v1'))],https=[http,priorHttp,...Array.from({length:priorCount-2},(_,i)=>decode(5+i*2,'onay-runtime-http-v1'))];
 for(const s of starts)if(s.taskId!==b.taskId||s.planFingerprint!==controller.identity.planFingerprint||s.repository!==controller.identity.repository||s.baseSha!==start.baseSha||s.executionAuthorized!==false)return refuse();
 if(prior.executionId!==priorIds[1]||prior.replayOriginal!==false||prior.recoveryOf?.archiveHead!==history[2]!.previousHead||prior.recoveryOf?.originalExecutionId!==originalId||prior.recoveryOf?.requestSha256!==b.originalRequestSha256)return refuse();
 for(let i=2;i<priorCount;i++){const s=starts[i];if(s.executionId!==priorIds[i]||s.model!==b.model||s.replayOriginal!==false||s.replayPreviousRecovery!==false||s.recoveryOf?.archiveHead!==history[i*2]!.previousHead||s.recoveryOf?.originalExecutionId!==originalId||s.recoveryOf?.previousExecutionId!==priorIds[i-1]||!Number.isSafeInteger(s.recoveryOf?.failedRunId)||s.recoveryOf.failedRunId<1||!/^([a-f0-9]{40})$/.test(s.recoveryOf?.failedRunSha))return refuse();}
 for(const [i,h]of https.entries()){const r=raw.reservations[i]!;if(h.taskId!==b.taskId||h.stage!=='before-http'||h.executionId!==priorIds[i]||h.requestSha256!==r.requestSha256||h.requestBytes!==r.requestBytes||h.attemptedRequests!==1||h.providerCallsSent!==0||h.httpInFlight!==true)return refuse();}
 const floorUsed={...controller.grant.historical};for(const [i,s]of starts.entries()){
  const floor=s.budget;if(!floor||floor.projectKey!==controller.projectKey||!floor.used||JSON.stringify(floor.used)!==JSON.stringify(floorUsed))return refuse();
  if(floor.grantSha256!==state.grantSha256){if(!o.lineage)return refuse();await assertProjectGrantLineageFloor(o.lineage,controller,floor,mode);}
  if(i<priorCount-1){const r=raw.reservations[i]!;floorUsed.requests++;floorUsed.requestBytes+=r.requestBytes;floorUsed.reservedTokens+=r.reservedTokens;}
 }
 await protect();const again=await store.read();if(!again||again.revision!==saved.revision||projectBudgetStateDigest(again.data)!==b.budgetStateSha256)return refuse();if(JSON.stringify(await archive.history())!==JSON.stringify(history)||archive.snapshot().pin?.head!==b.archiveHead)return refuse();
 return {b,saved,state,raw,originalId,previousId,priorCount,priorIds,baseSha:start.baseSha as string,history,protect};
}catch{return refuse();}finally{if(directory)rmSync(directory,{recursive:true,force:true});}}
async function prepareReplacement(o:ReplacementOptions,store:Pick<ProjectModelBudgetStore,'read'>,native:boolean):Promise<ProjectUncertainRecoveryTicket>{let directory:string|undefined;try{
 const {controller,archive,key}=o,mode=native?'native':'simulated',{b,saved,state,raw,originalId,previousId,priorCount,priorIds,baseSha,history,protect}=await inspectReplacement(o,store,native);
 if((['requests','requestBytes','reservedTokens'] as const).some(k=>state.remaining[k]<required[k]))return refuse();const approval=await consumeProjectReplacementRecoveryApproval(o.approval,controller,b,mode);
 if(approval.previousExecutionId!==previousId||(await Promise.all(priorIds.map(async id=>(await controller.inspectExecution(b.taskId,id)).requests))).some(n=>n!==1)||(await controller.inspectExecution(b.taskId,approval.executionId)).requests!==0)return refuse();
 await protect();await approval.assertAuthorized();const before=await store.read();if(!before||before.revision!==saved.revision||projectBudgetStateDigest(before.data)!==b.budgetStateSha256)return refuse();
 directory=mkdtempSync(join(tmpdir(),'onay-replacement-claim-'));const path=join(directory,b.taskId+'-'+approval.checkpointSuffix+'-start.json'),sealed=writeProjectHostEnvelope('onay-task-start-v1',JSON.stringify({version:1,taskId:b.taskId,planFingerprint:controller.identity.planFingerprint,repository:controller.identity.repository,baseSha,executionId:approval.executionId,model:b.model,recoveryOf:{archiveHead:b.archiveHead,originalExecutionId:originalId,previousExecutionId:previousId,failedRunId:b.failedRunId,failedRunSha:b.failedRunSha},budget:{projectKey:controller.projectKey,grantSha256:state.grantSha256,used:state.used},executionAuthorized:false,replayOriginal:false,replayPreviousRecovery:false}),key,path);await archive.persist({kind:'task-start',taskId:b.taskId,path,sha256:sealed.sha256});
 const current=async()=>{await protect();await approval.assertAuthorized();const live=await store.read();if(!live)return refuse();const data=parseProjectModelBudgetState(live.data);if(data.grantSha256!==controller.grantSha256||JSON.stringify(data.reservations.slice(0,priorCount))!==JSON.stringify(raw.reservations)||data.reservations.length<priorCount||data.reservations.length>priorCount+4||data.reservations.slice(priorCount).some((r,i)=>r.taskId!==b.taskId||r.reservationId!==approval.executionId+':r'+(i+1)))return refuse();await controller.inspect();const events=await archive.history();if(history.some((e,i)=>events[i]?.sha256!==e.sha256)||events[b.archiveSequence]?.sha256!==sealed.sha256||events.filter(e=>e.kind==='task-start').length!==priorCount+1||events.some(e=>e.taskId!==b.taskId))return refuse();};await current();
 const cap=Object.freeze({}) as ProjectUncertainRecoveryTicket;tickets.set(cap,{controller,taskId:b.taskId,executionId:approval.executionId,baseSha,checkpointSuffix:approval.checkpointSuffix,model:b.model,native,used:false,current});return cap;
}catch{return refuse();}finally{if(directory)rmSync(directory,{recursive:true,force:true});}}
