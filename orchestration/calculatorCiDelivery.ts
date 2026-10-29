/** Host-only CI inbox. It queues a successor; it never executes a model/task,
 * rewrites historical receipts, or treats a model verdict as CI evidence. */
import { createHash } from 'node:crypto';
import { createCalculatorPlan, type CalculatorPlan } from './calculatorPlan.js';
export type CalculatorCiCompletion = Readonly<{version:1;repository:string;planFingerprint:string;taskId:string;candidateSha:string;ciRunId:number}>;
export type CalculatorCiDeliveryRecord = Readonly<{version:1;repository:string;planFingerprint:string;previousTaskId:string;candidateSha:string;ciRunId:number;nextTaskId:string;evidenceSha256:string;status:'awaiting-owner-budget';modelRequestsAuthorized:0}>;
export type CalculatorCiDeliveryStore = Readonly<{read:(key:string)=>Promise<unknown|undefined>;create:(key:string,record:CalculatorCiDeliveryRecord)=>Promise<void>}>;
export type CalculatorCiDeliveryProof = Readonly<{repository:string;planFingerprint:string;taskId:string;candidateSha:string;ciRunId:number;verifiedTaskIds:readonly string[];evidenceSha256:string}>;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const digest=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const sha=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const id=(s:unknown):s is string=>typeof s==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(s);
function exact(v:unknown,keys:string[]):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');}
function refuse():never{throw Error('CI delivery unverified; preserve prior receipts and remote state. No task/model replay.');}
function request(v:unknown):CalculatorCiCompletion{
 if(!exact(v,['version','repository','planFingerprint','taskId','candidateSha','ciRunId'])||v.version!==1||v.repository!=='erman-ksv/Onay-Factory-Calculator'||!digest(v.planFingerprint)||!id(v.taskId)||!sha(v.candidateSha)||!Number.isSafeInteger(v.ciRunId)||Number(v.ciRunId)<1)return refuse();
 return Object.freeze({...v}) as CalculatorCiCompletion;
}
export function calculatorCiDeliveryKey(v:unknown):string{const r=request(v);return hash({repository:r.repository,planFingerprint:r.planFingerprint,previousTaskId:r.taskId,candidateSha:r.candidateSha});}
export function parseCalculatorCiDeliveryRecord(v:unknown):CalculatorCiDeliveryRecord{
 if(!exact(v,['version','repository','planFingerprint','previousTaskId','candidateSha','ciRunId','nextTaskId','evidenceSha256','status','modelRequestsAuthorized'])||!id(v.nextTaskId)||!digest(v.evidenceSha256)||v.status!=='awaiting-owner-budget'||v.modelRequestsAuthorized!==0)return refuse();
 request({version:v.version,repository:v.repository,planFingerprint:v.planFingerprint,taskId:v.previousTaskId,candidateSha:v.candidateSha,ciRunId:v.ciRunId});
 if(v.nextTaskId===v.previousTaskId)return refuse();return Object.freeze({...v}) as CalculatorCiDeliveryRecord;
}
export async function deliverCalculatorCompletedCi(saved:CalculatorPlan,input:unknown,host:Readonly<{
 store:CalculatorCiDeliveryStore;
 /** Trusted execution adapter authenticates archives, exact bytes, all role
  * verdicts, dependency history, pinned workflow, fresh CI and branch head.
  * Neither caller/model JSON nor the saved ready flags replace this callback. */
 verify:(request:CalculatorCiCompletion)=>Promise<CalculatorCiDeliveryProof|undefined>;
 getCurrentHead:(branch:string)=>Promise<string>;
}>){
 try{
  const r=request(input),plan=createCalculatorPlan(saved.request,saved.proposal),key=calculatorCiDeliveryKey(r);
  if(plan.fingerprint!==r.planFingerprint||plan.owner.repository!==r.repository||!host||typeof host.verify!=='function'||typeof host.getCurrentHead!=='function')return refuse();
  const index=plan.tasks.findIndex(t=>t.id===r.taskId);if(index<0||index===plan.tasks.length-1)return refuse();
  const expected=plan.tasks.slice(0,index+1).map(t=>t.id),next=plan.tasks[index+1]!;
  if(next.dependsOn.some(d=>!expected.includes(d)))return refuse();
  const prior=await host.store.read(key);
  if(prior!==undefined){const record=parseCalculatorCiDeliveryRecord(prior);if(calculatorCiDeliveryKey({version:1,repository:record.repository,planFingerprint:record.planFingerprint,taskId:record.previousTaskId,candidateSha:record.candidateSha,ciRunId:record.ciRunId})!==key||record.nextTaskId!==next.id)return refuse();return {status:'duplicate' as const,key,record,taskStarted:false as const};}
  if(await host.getCurrentHead(plan.branch)!==r.candidateSha)return refuse();
  const proof=await host.verify(r);
  if(!proof||!exact(proof,['repository','planFingerprint','taskId','candidateSha','ciRunId','verifiedTaskIds','evidenceSha256'])||!digest(proof.evidenceSha256)||proof.repository!==r.repository||proof.planFingerprint!==r.planFingerprint||proof.taskId!==r.taskId||proof.candidateSha!==r.candidateSha||proof.ciRunId!==r.ciRunId||JSON.stringify(proof.verifiedTaskIds)!==JSON.stringify(expected))return refuse();
  if(await host.getCurrentHead(plan.branch)!==r.candidateSha)return refuse();
  const record=parseCalculatorCiDeliveryRecord({version:1,repository:r.repository,planFingerprint:r.planFingerprint,previousTaskId:r.taskId,candidateSha:r.candidateSha,ciRunId:r.ciRunId,nextTaskId:next.id,evidenceSha256:proof.evidenceSha256,status:'awaiting-owner-budget',modelRequestsAuthorized:0});
  await host.store.create(key,record);
  const persisted=parseCalculatorCiDeliveryRecord(await host.store.read(key));if(JSON.stringify(persisted)!==JSON.stringify(record))return refuse();
  return {status:'queued' as const,key,record,taskStarted:false as const};
 }catch{return {status:'blocked' as const,reason:'ci_delivery_unverified_no_replay',taskStarted:false as const};}
}
