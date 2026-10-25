import {createHash} from 'node:crypto';
import {TeamTaskStore,parseTeamTaskSnapshotBytes} from './teamTaskStore.js';
import {parseCalculatorExecutionCheckpointBytes,type CalculatorExecutionCheckpointIdentity} from './calculatorExecutionCheckpoint.js';
import {calculatorPlanDigest} from './calculatorPlan.js';
/** One host-authorized queued successor. Old receipts stay untouched. A JSON
 * copy is never a permit; durable execution admission precedes the task claim. */
import {calculatorCiDeliveryKey,parseCalculatorCiDeliveryRecord,type CalculatorCiDeliveryRecord} from './calculatorCiDelivery.js';
import {calculatorWorkspacePlan,assertCalculatorWorkspaceCurrent,type CalculatorWorkspace} from './calculatorWorkspace.js';
import type {CalculatorPlanStore} from './calculatorPlanStore.js';
export type CalculatorQueuedPermit=Readonly<{kind:'verified-ci-queued-successor'}>;
const permits=new WeakMap<CalculatorQueuedPermit,{workspace:CalculatorWorkspace;store:CalculatorPlanStore;record:CalculatorCiDeliveryRecord;assertRemote:()=>Promise<void>;used:boolean;correction?:{directory:string;fingerprint:string;originalReceipt:string}}> ();
const refuse=():never=>{throw Error('Queued successor refused; preserve inbox, charges and execution barrier. No replay.');};
export async function admitCalculatorQueuedSuccessor(workspace:CalculatorWorkspace,store:CalculatorPlanStore,input:unknown,host:Readonly<{
 grant:Readonly<{id:string;eventKey:string;taskId:string;maxRequests:8;maxReservedTokens:48000;freeTierConfirmed:true}>;
 verify:()=>Promise<readonly string[]>;persistRemote:()=>Promise<void>;assertRemote:()=>Promise<void>;
}>):Promise<CalculatorQueuedPermit>{
 const record=parseCalculatorCiDeliveryRecord(input),plan=await calculatorWorkspacePlan(workspace),key=calculatorCiDeliveryKey({version:1,repository:record.repository,planFingerprint:record.planFingerprint,taskId:record.previousTaskId,candidateSha:record.candidateSha,ciRunId:record.ciRunId});
 if(store.inspect()?.fingerprint!==plan.fingerprint||record.planFingerprint!==plan.fingerprint||workspace.sha!==record.candidateSha||workspace.ref!==plan.branch||!host?.grant||host.grant.id!=='owner-t04-eight-free-calls-48000-20261024'||host.grant.taskId!==record.nextTaskId||host.grant.eventKey!==key||host.grant.maxRequests!==8||host.grant.maxReservedTokens!==48000||host.grant.freeTierConfirmed!==true)return refuse();
 const index=plan.tasks.findIndex(t=>t.id===record.nextTaskId),task=plan.tasks[index];
 if(index!==3||task?.id!=='calculator-pilot-step7-v1-34ee03-t04'||plan.tasks[index-1]?.id!==record.previousTaskId||record.modelRequestsAuthorized!==0)return refuse();
 const expected=plan.tasks.slice(0,index).map(t=>t.id),proof=await host.verify();if(JSON.stringify(proof)!==JSON.stringify(expected))return refuse();
 if(task.dependsOn.some(id=>!proof.includes(id)))return refuse();
 const receipt=store.taskReceipt(plan,task);try{if(receipt.inspectExisting()||receipt.inspectExistingLock())return refuse();}finally{receipt.close();}
 await assertCalculatorWorkspaceCurrent(workspace);await host.persistRemote();await host.assertRemote();await assertCalculatorWorkspaceCurrent(workspace);
 const permit=Object.freeze({kind:'verified-ci-queued-successor' as const});permits.set(permit,{workspace,store,record,assertRemote:host.assertRemote,used:false});return permit;
}
export async function claimCalculatorQueuedSuccessor(workspace:CalculatorWorkspace,permit:CalculatorQueuedPermit){
 const host=permits.get(permit);if(!host||host.used||host.workspace!==workspace)return refuse();host.used=true;
 const plan=await calculatorWorkspacePlan(workspace),task=plan.tasks.find(t=>t.id===host.record.nextTaskId);if(!task||host.record.candidateSha!==workspace.sha)return refuse();
 await host.assertRemote();await assertCalculatorWorkspaceCurrent(workspace);
 if(host.correction){const old=host.store.taskReceipt(plan,task);try{if(JSON.stringify(old.inspectExisting())!==host.correction.originalReceipt||old.inspectExistingLock())return refuse();}finally{old.close();}}
 const receipt=host.correction?new TeamTaskStore(host.correction.directory,{id:'calc-t04-correction-'+host.correction.fingerprint.slice(0,40),fingerprint:host.correction.fingerprint}):host.store.taskReceipt(plan,task);
 try{if(receipt.inspectExisting()||receipt.inspectExistingLock()||receipt.claim()!=='claimed')return refuse();receipt.recordStage('consume_verified_ci_inbox','running');await host.assertRemote();await assertCalculatorWorkspaceCurrent(workspace);receipt.recordStage('consume_verified_ci_inbox','passed');return {selection:{status:'ready' as const,reasonCode:'verified_queued_successor_admitted',task,verifiedTaskIds:plan.tasks.slice(0,3).map(t=>t.id),wholeAppCompleted:false as const,publicationAuthorized:false as const},store:receipt};}catch{receipt.close();return refuse();}
}

/** Continue only the saved first-generation schema failure, consuming the single
 * already-authorized correction. This never restarts the original task claim. */
export async function admitCalculatorQueuedDraftCorrection(workspace:CalculatorWorkspace,store:CalculatorPlanStore,input:unknown,
 source:Readonly<{capsule:Uint8Array;receipt:Uint8Array;identity:CalculatorExecutionCheckpointIdentity;directory:string}>,
 host:Readonly<{verify:()=>Promise<readonly string[]>;persistRemote:()=>Promise<void>;assertRemote:()=>Promise<void>}>):Promise<CalculatorQueuedPermit>{
 const record=parseCalculatorCiDeliveryRecord(input),plan=await calculatorWorkspacePlan(workspace),task=plan.tasks[3],hash=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
 if(record.nextTaskId!==task?.id||task.id!=='calculator-pilot-step7-v1-34ee03-t04'||record.previousTaskId!==plan.tasks[2]?.id||record.planFingerprint!==plan.fingerprint||workspace.sha!==record.candidateSha||source.identity.taskId!==task.id||source.identity.baseSha!==workspace.sha||source.identity.planFingerprint!==plan.fingerprint||source.identity.ownerFingerprint!==plan.owner.ownerFingerprint||source.identity.repository!==plan.owner.repository||source.identity.branch!==plan.branch||source.identity.bootstrapSha!==plan.owner.baseSha||source.identity.goalId!==plan.owner.id)return refuse();
 const data=parseCalculatorExecutionCheckpointBytes(source.capsule,source.identity,hash(source.capsule)).data,p=data.payload;
 if(p.stage!=='generate_1'||p.status!=='blocked'||p.attempt!==1||p.httpInFlight||p.publicationStarted||p.proposal||p.assessments.length||p.modelState.attemptedRequests!==1||p.modelState.reservedRunTokens!==4795)return refuse();
 const saved=parseTeamTaskSnapshotBytes(source.receipt,{id:'calc-'+task.id,fingerprint:calculatorPlanDigest({planFingerprint:plan.fingerprint,taskId:task.id})});
 if(saved.status!=='blocked'||saved.reasonCode!=='execution_failed_no_replay'||saved.publication||!saved.stages.some(s=>s.stage==='generate_1'&&s.status==='blocked'))return refuse();
 const prior=store.taskReceipt(plan,task);try{if(JSON.stringify(prior.inspectExisting())!==JSON.stringify(saved)||prior.inspectExistingLock())return refuse();}finally{prior.close();}
 if(JSON.stringify(await host.verify())!==JSON.stringify(plan.tasks.slice(0,3).map(t=>t.id)))return refuse();
 await assertCalculatorWorkspaceCurrent(workspace);await host.persistRemote();await host.assertRemote();await assertCalculatorWorkspaceCurrent(workspace);
 const permit=Object.freeze({kind:'verified-ci-queued-successor' as const}),fingerprint=hash(JSON.stringify({plan:plan.fingerprint,task:task.id,source:hash(source.capsule),phase:'one-rejected-generation-correction'}));
 permits.set(permit,{workspace,store,record,assertRemote:host.assertRemote,used:false,correction:{directory:source.directory,fingerprint,originalReceipt:JSON.stringify(saved)}});return permit;
}
