/** Fixed authenticated repair_2 continuation. No old receipt/lock is edited. */
import { createHash } from 'node:crypto';
import { parseCalculatorExecutionCheckpointBytes } from './calculatorExecutionCheckpoint.js';
import { parseTeamTaskSnapshotBytes, TeamTaskStore } from './teamTaskStore.js';
import { calculatorPlanDigest, type CalculatorPlan } from './calculatorPlan.js';
import { assertCalculatorT02InspectedSuccessorPreview, type CalculatorT02ReadOnlyPreselection } from './calculatorT02SuccessorPreview.js';
import { assertCalculatorWorkspaceCurrent, calculatorWorkspacePlan, type CalculatorWorkspace } from './calculatorWorkspace.js';
import type { CalculatorPlanStore } from './calculatorPlanStore.js';
const TASK='calculator-pilot-step7-v1-34ee03-t03', BASE='949a0bf874722fd8cbd886c2cb0af8f2b502ac05';
export const T03_REPAIR_CAPSULE_SHA='0f99168fbc2dfa98aad2b378ee4b36a5440e51ac5721d14c2cd8d930707ebbf7';
export const T03_REPAIR_CHARGE=Object.freeze({attemptedRequests:4,totalRequestBytes:32576,reservedRunTokens:11841,elapsedMs:207312});
const ERROR='Stopped t03 repair refused; preserve source receipts, remote claims and charges. No replay.';
const refuse=():never=>{throw Error(ERROR);};
const identity=Object.freeze({repository:'erman-ksv/Onay-Factory-Calculator',goalId:'calculator-pilot-step7-v1',ownerFingerprint:'34ee0369da08ad7b0c83551481d9e87baa6dcd8b9d68021f0b18ac6c6533fdd8',planFingerprint:'1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2',taskId:TASK,branch:'feat/calculator-agent/calculator-pilot-step7-v1',baseSha:BASE,bootstrapSha:'2c1218f2b020962ad93adf68d902a847271a7e72',runtimeConfigDigest:'a50b305916c8aae104b48677cc152fae740b2dfa6dc4d23ce5359f56e071028a'});
export type CalculatorT03StoppedRepair=Readonly<{kind:'authenticated-t03-stopped-repair';capsuleSha256:string}>;
type Private={payload:ReturnType<typeof parseCalculatorExecutionCheckpointBytes>['data']['payload'];receipt:string;used:boolean};
const sources=new WeakMap<CalculatorT03StoppedRepair,Private>();
export function inspectCalculatorT03StoppedRepair(capsule:Uint8Array,receipt:Uint8Array):CalculatorT03StoppedRepair {
 try {
  const data=parseCalculatorExecutionCheckpointBytes(capsule,identity,T03_REPAIR_CAPSULE_SHA).data,p=data.payload;
  if(p.attempt!==2||p.stage!=='repair_2'||p.status!=='blocked'||p.httpInFlight||p.publicationStarted||!p.proposal||!data.proposalDigest||p.assessments.length!==3||!p.assessments.some(a=>!a.ready))return refuse();
  if(p.modelState.attemptedRequests!==4||p.modelState.totalRequestBytes!==32576||p.modelState.reservedRunTokens!==11841||p.modelState.elapsedMs!==207302)return refuse();
  const saved=parseTeamTaskSnapshotBytes(receipt,{id:'calc-'+TASK,fingerprint:calculatorPlanDigest({planFingerprint:identity.planFingerprint,taskId:TASK})});
  if(saved.status!=='blocked'||saved.publication||!saved.stages.some(s=>s.stage==='repair_2'&&s.status==='blocked')||!saved.stages.some(s=>s.stage==='checks_failed_1'&&s.status==='blocked'))return refuse();
  const cap=Object.freeze({kind:'authenticated-t03-stopped-repair' as const,capsuleSha256:T03_REPAIR_CAPSULE_SHA});
  sources.set(cap,{payload:p,receipt:JSON.stringify(saved),used:false});return cap;
 }catch{return refuse();}
}
export function calculatorT03RepairFailure(cap:CalculatorT03StoppedRepair) {
 const state=sources.get(cap);if(!state)return refuse();
 return {proposal:structuredClone(state.payload.proposal),assessments:structuredClone(state.payload.assessments),priorCharge:T03_REPAIR_CHARGE};
}
export type CalculatorT03RepairPermit=Readonly<{kind:'continue-original-t03-repair'}>;
const permits=new WeakMap<CalculatorT03RepairPermit,{workspace:CalculatorWorkspace;source:CalculatorT03StoppedRepair;store:CalculatorPlanStore;directory:string;assertRemote:()=>Promise<void>;used:boolean}>();
function unchanged(store:CalculatorPlanStore,plan:CalculatorPlan,state:Private) {
 const task=plan.tasks.find(t=>t.id===TASK);if(!task)return refuse();const receipt=store.taskReceipt(plan,task);
 try{if(receipt.inspectExistingLock()||JSON.stringify(receipt.inspectExisting())!==state.receipt)return refuse();}finally{receipt.close();}
}
/** Runtime owns the source artifact provenance, predecessor preview and remote
 * persistence functions. No JSON capability or success report is accepted. */
export async function admitCalculatorT03RepairContinuation(workspace:CalculatorWorkspace,store:CalculatorPlanStore,
 source:CalculatorT03StoppedRepair,preview:CalculatorT02ReadOnlyPreselection,directory:string,
 persistRemote:()=>Promise<void>,assertRemote:()=>Promise<void>):Promise<CalculatorT03RepairPermit> {
 const state=sources.get(source);if(!state||state.used||typeof persistRemote!=='function'||typeof assertRemote!=='function')return refuse();state.used=true;
 assertCalculatorT02InspectedSuccessorPreview(preview);const plan=await calculatorWorkspacePlan(workspace);
 if(workspace.sha!==BASE||plan.fingerprint!==identity.planFingerprint||preview.nextTaskId!==TASK||preview.candidateSha!==BASE)return refuse();
 unchanged(store,plan,state);await assertCalculatorWorkspaceCurrent(workspace);
 await persistRemote();await assertRemote();await assertCalculatorWorkspaceCurrent(workspace);unchanged(store,plan,state);
 const permit=Object.freeze({kind:'continue-original-t03-repair' as const});permits.set(permit,{workspace,source,store,directory,assertRemote,used:false});return permit;
}
export async function claimCalculatorT03RepairContinuation(workspace:CalculatorWorkspace,permit:CalculatorT03RepairPermit) {
 const p=permits.get(permit);if(!p||p.used||p.workspace!==workspace)return refuse();p.used=true;
 const state=sources.get(p.source);if(!state)return refuse();const plan=await calculatorWorkspacePlan(workspace);unchanged(p.store,plan,state);
 await p.assertRemote();await assertCalculatorWorkspaceCurrent(workspace);
 const task=plan.tasks.find(t=>t.id===TASK);if(!task)return refuse();
 const fingerprint=createHash('sha256').update(JSON.stringify({plan:plan.fingerprint,task:TASK,source:T03_REPAIR_CAPSULE_SHA})).digest('hex');
 const receipt=new TeamTaskStore(p.directory,{id:'calc-t03-repair-'+fingerprint.slice(0,40),fingerprint});
 try{if(receipt.inspectExisting()||receipt.inspectExistingLock()||receipt.claim()!=='claimed')return refuse();
 receipt.recordStage('continue_original_repair_2','running');await p.assertRemote();unchanged(p.store,plan,state);receipt.recordStage('continue_original_repair_2','passed');
 return {selection:{status:'ready' as const,reasonCode:'authenticated_original_repair_selected',task,verifiedTaskIds:[previewTask(1),previewTask(2)],wholeAppCompleted:false as const,publicationAuthorized:false as const},store:receipt};
 }catch{receipt.close();return refuse();}
}
function previewTask(index:number){return 'calculator-pilot-step7-v1-34ee03-t0'+index;}
