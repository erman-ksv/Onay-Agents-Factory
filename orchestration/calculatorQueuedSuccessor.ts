/** One host-authorized queued successor. Old receipts stay untouched. A JSON
 * copy is never a permit; durable execution admission precedes the task claim. */
import {calculatorCiDeliveryKey,parseCalculatorCiDeliveryRecord,type CalculatorCiDeliveryRecord} from './calculatorCiDelivery.js';
import {calculatorWorkspacePlan,assertCalculatorWorkspaceCurrent,type CalculatorWorkspace} from './calculatorWorkspace.js';
import type {CalculatorPlanStore} from './calculatorPlanStore.js';
export type CalculatorQueuedPermit=Readonly<{kind:'verified-ci-queued-successor'}>;
const permits=new WeakMap<CalculatorQueuedPermit,{workspace:CalculatorWorkspace;store:CalculatorPlanStore;record:CalculatorCiDeliveryRecord;assertRemote:()=>Promise<void>;used:boolean}>();
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
 const receipt=host.store.taskReceipt(plan,task);
 try{if(receipt.inspectExisting()||receipt.inspectExistingLock()||receipt.claim()!=='claimed')return refuse();receipt.recordStage('consume_verified_ci_inbox','running');await host.assertRemote();await assertCalculatorWorkspaceCurrent(workspace);receipt.recordStage('consume_verified_ci_inbox','passed');return {selection:{status:'ready' as const,reasonCode:'verified_queued_successor_admitted',task,verifiedTaskIds:plan.tasks.slice(0,3).map(t=>t.id),wholeAppCompleted:false as const,publicationAuthorized:false as const},store:receipt};}catch{receipt.close();return refuse();}
}
