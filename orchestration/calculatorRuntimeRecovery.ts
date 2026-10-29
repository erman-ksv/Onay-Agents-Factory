import {createHash} from 'node:crypto';
import {prepareCalculatorRejectedProposalRecovery} from './calculatorRejectedProposalRecovery.js';
import {parseCalculatorExecutionCheckpointBytes,type CalculatorExecutionCheckpointIdentity} from './calculatorExecutionCheckpoint.js';
import {calculatorPlanDigest} from './calculatorPlan.js';
import {TeamTaskStore,parseTeamTaskSnapshotBytes} from './teamTaskStore.js';
import {calculatorWorkspacePlan,assertCalculatorWorkspaceCurrent,loadCalculatorWorkspaceTask,verifyCalculatorWorkspaceDependency,type CalculatorWorkspace,type CalculatorCheckRunner} from './calculatorWorkspace.js';
import type {CalculatorPlanStore} from './calculatorPlanStore.js';
import {isAuthorizedProjectBudgetController,consumeAuthorizedProjectTaskScope,type AuthorizedProjectBudgetController} from './projectBudgetAuthorization.js';
import type {CalculatorExecutionTeam,CalculatorExecutionTools} from './calculatorExecution.js';
import type {CalculatorPlan} from './calculatorPlan.js';
import type {CalculatorSnapshot} from '../github/calculatorSnapshot.js';
export const CALCULATOR_RUNTIME_RECOVERY_ERROR='Runtime correction admission refused. Preserve original receipts, remote barriers and charges; no replay.';
const refuse=():never=>{throw Error(CALCULATOR_RUNTIME_RECOVERY_ERROR);};
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
type Evidence=Readonly<{bytes:Buffer;expectedSha256:string;identity:CalculatorExecutionCheckpointIdentity;receipt:Buffer;receiptSha256:string}>;
type Binding=Readonly<{checkpointSha256:string;receiptSha256:string;taskId:string;baseSha:string;executionId:string}>;
export type CalculatorRuntimeRecoveryHost=Evidence&Readonly<{
 verifyDependencies:CalculatorCheckRunner;
 assertSourceRemote:(binding:Binding)=>Promise<void>;
 claimRecovery:(binding:Binding)=>Promise<void>;
 assertRecovery:(binding:Binding)=>Promise<void>;
}>;
type HostState={source:Evidence;verify:CalculatorCheckRunner;assertSource:CalculatorRuntimeRecoveryHost['assertSourceRemote'];claim:CalculatorRuntimeRecoveryHost['claimRecovery'];assertClaim:CalculatorRuntimeRecoveryHost['assertRecovery'];attempted:boolean};
const hosts=new WeakMap<object,HostState>();
/** Function-bearing host input, never environment/model JSON. Expected digest
 * authentication and durable compare/create are supplied by trusted host tools. */
export function prepareCalculatorRuntimeRecoveryHost(value:unknown):CalculatorRuntimeRecoveryHost|undefined{
 if(value===undefined)return undefined;
 try{
  const keys=['bytes','expectedSha256','identity','receipt','receiptSha256','verifyDependencies','assertSourceRemote','claimRecovery','assertRecovery'];
  if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length)return refuse();
  const d=Object.getOwnPropertyDescriptors(value);if(keys.some(k=>!d[k]||!Object.hasOwn(d[k],'value')))return refuse();
  if(['verifyDependencies','assertSourceRemote','claimRecovery','assertRecovery'].some(k=>typeof d[k]!.value!=='function'))return refuse();
  if(!Buffer.isBuffer(d.bytes!.value)||!Buffer.isBuffer(d.receipt!.value)||d.bytes!.value.length>524288||d.receipt!.value.length>262144||
   typeof d.expectedSha256!.value!=='string'||!/^[a-f0-9]{64}$/.test(d.expectedSha256!.value)||typeof d.receiptSha256!.value!=='string'||!/^[a-f0-9]{64}$/.test(d.receiptSha256!.value))return refuse();
  const bytes=Buffer.from(d.bytes!.value),receipt=Buffer.from(d.receipt!.value);
  const rawIdentity=d.identity!.value;
  if(!rawIdentity||typeof rawIdentity!=='object'||Object.getPrototypeOf(rawIdentity)!==Object.prototype||Reflect.ownKeys(rawIdentity).length!==9||
   Object.values(Object.getOwnPropertyDescriptors(rawIdentity)).some(p=>!Object.hasOwn(p,'value')||typeof p.value!=='string'))return refuse();
  const parsed=parseCalculatorExecutionCheckpointBytes(bytes,d.identity!.value,d.expectedSha256!.value);
  if(hash(receipt)!==d.receiptSha256!.value)return refuse();
  const source=Object.freeze({bytes,expectedSha256:d.expectedSha256!.value,identity:Object.freeze({...parsed.data.identity}),receipt,receiptSha256:d.receiptSha256!.value});
  // Public copies are DATA; admission reads a separate private copy.
  const cap=Object.freeze({...source,bytes:Buffer.from(bytes),receipt:Buffer.from(receipt),verifyDependencies:d.verifyDependencies!.value,assertSourceRemote:d.assertSourceRemote!.value,claimRecovery:d.claimRecovery!.value,assertRecovery:d.assertRecovery!.value}) as CalculatorRuntimeRecoveryHost;
  hosts.set(cap,{source,verify:cap.verifyDependencies,assertSource:cap.assertSourceRemote,claim:cap.claimRecovery,assertClaim:cap.assertRecovery,attempted:false});return cap;
 }catch{return refuse();}
}
export type CalculatorRuntimeRecoveryPermit=Readonly<{kind:'project-rejected-proposal-correction';executionId:string}>;
type Permit={workspace:CalculatorWorkspace;store:CalculatorPlanStore;directory:string;source:Evidence;originalReceipt:string;binding:Binding;host:HostState;controller:AuthorizedProjectBudgetController;used:boolean;claimed:boolean;failed:boolean};
const permits=new WeakMap<object,Permit>();
function unchanged(p:Permit){
 const plan=p.store.inspect(),task=plan?.tasks.find(t=>t.id===p.binding.taskId);if(!plan||!task)return refuse();const receipt=p.store.taskReceipt(plan,task);
 try{if(receipt.inspectExistingLock()||JSON.stringify(receipt.inspectExisting())!==p.originalReceipt)return refuse();}finally{receipt.close();}
}
export async function assertCalculatorRuntimeRecovery(permit:CalculatorRuntimeRecoveryPermit){
 const p=permits.get(permit);if(!p||!p.claimed||p.failed)return refuse();
 try{unchanged(p);await p.controller.assertAuthorized();await p.host.assertSource(p.binding);await p.host.assertClaim(p.binding);unchanged(p);}catch{p.failed=true;return refuse();}
}
export async function admitCalculatorRuntimeRecovery(workspace:CalculatorWorkspace,store:CalculatorPlanStore,host:CalculatorRuntimeRecoveryHost,
 controller:AuthorizedProjectBudgetController,directory:string,model:string):Promise<CalculatorRuntimeRecoveryPermit>{
 const h=hosts.get(host);if(!h||h.attempted||!isAuthorizedProjectBudgetController(controller))return refuse();h.attempted=true;
 try{
  const plan=await calculatorWorkspacePlan(workspace),source=h.source,index=plan.tasks.findIndex(t=>t.id===source.identity.taskId),task=plan.tasks[index];
  if(!task||store.inspect()?.fingerprint!==plan.fingerprint||controller.identity.planFingerprint!==plan.fingerprint||controller.identity.ownerFingerprint!==plan.owner.ownerFingerprint||
   source.identity.baseSha!==workspace.sha||source.identity.bootstrapSha!==plan.owner.baseSha||workspace.ref!==plan.branch)return refuse();
  const snapshot=await loadCalculatorWorkspaceTask(workspace,task.id),prepared=prepareCalculatorRejectedProposalRecovery({...source,plan,taskId:task.id,snapshot,model});
  const original=parseTeamTaskSnapshotBytes(source.receipt,{id:'calc-'+task.id,fingerprint:calculatorPlanDigest({planFingerprint:plan.fingerprint,taskId:task.id})});
  if(original.status!=='blocked'||original.reasonCode!=='execution_failed_no_replay'||original.publication||!original.stages.some(s=>s.stage==='generate_1'&&s.status==='blocked'))return refuse();
  const binding=Object.freeze({checkpointSha256:source.expectedSha256,receiptSha256:source.receiptSha256,taskId:task.id,baseSha:workspace.sha,executionId:prepared.metadata.executionId});
  const probe=await controller.taskScope(task.id,'admit-'+hash(binding.executionId).slice(0,64));
  if(consumeAuthorizedProjectTaskScope(probe,{projectId:plan.owner.id,repository:plan.owner.repository,ownerFingerprint:plan.owner.ownerFingerprint}).operationMode!=='development')return refuse();
  const p:Permit={workspace,store,directory,source,originalReceipt:JSON.stringify(original),binding,host:h,controller,used:false,claimed:false,failed:false};unchanged(p);
  // Verify every predecessor through the ordinary ancestry/blob/host checks.
  for(const previous of plan.tasks.slice(0,index))await verifyCalculatorWorkspaceDependency(workspace,previous.id,h.verify);
  for(const later of plan.tasks.slice(index+1)){const r=store.taskReceipt(plan,later);try{if(r.inspectExisting()||r.inspectExistingLock())return refuse();}finally{r.close();}}
  await controller.assertAuthorized();await controller.inspect();await h.assertSource(binding);await assertCalculatorWorkspaceCurrent(workspace);unchanged(p);
  await h.claim(binding);p.claimed=true;await h.assertClaim(binding);await assertCalculatorWorkspaceCurrent(workspace);unchanged(p);
  const permit=Object.freeze({kind:'project-rejected-proposal-correction' as const,executionId:binding.executionId});permits.set(permit,p);return permit;
 }catch{return refuse();}
}
export async function claimCalculatorRuntimeRecovery(workspace:CalculatorWorkspace,permit:CalculatorRuntimeRecoveryPermit){
 const p=permits.get(permit);if(!p||p.used||p.workspace!==workspace)return refuse();p.used=true;
 await assertCalculatorRuntimeRecovery(permit);await assertCalculatorWorkspaceCurrent(workspace);
 const plan=await calculatorWorkspacePlan(workspace),task=plan.tasks.find(t=>t.id===p.binding.taskId);if(!task)return refuse();
 const fingerprint=hash(permit.executionId),receipt=new TeamTaskStore(p.directory,{id:'calc-recovery-'+fingerprint.slice(0,40),fingerprint});
 try{
  if(receipt.inspectExisting()||receipt.inspectExistingLock()||receipt.claim()!=='claimed')return refuse();
  receipt.recordStage('admit_project_correction','running');await assertCalculatorRuntimeRecovery(permit);receipt.recordStage('admit_project_correction','passed');
  return {selection:{status:'ready' as const,reasonCode:'project_correction_admitted',task,verifiedTaskIds:plan.tasks.slice(0,plan.tasks.indexOf(task)).map(t=>t.id),wholeAppCompleted:false as const,publicationAuthorized:false as const},store:receipt};
 }catch{receipt.close();return refuse();}
}
export function calculatorRuntimeRecoveryEvidence(permit:CalculatorRuntimeRecoveryPermit){
 const p=permits.get(permit);if(!p||!p.used)return refuse();
 return {bytes:Buffer.from(p.source.bytes),expectedSha256:p.source.expectedSha256,identity:p.source.identity};
}
export function calculatorRuntimeRecoverySource(host:CalculatorRuntimeRecoveryHost){
 const h=hosts.get(host);if(!h)return refuse();return {...h.source,bytes:Buffer.from(h.source.bytes),receipt:Buffer.from(h.source.receipt)};
}
/** Shared by the main runtime and host integration tests. Ordinary generation
 * is replaced only for a genuinely admitted permit, without changing the rest
 * of the executor's role/tool/CI sequence. */
export function routeCalculatorRuntimeRecovery(team:CalculatorExecutionTeam&{
 generateFromRejectedCheckpoint:(plan:CalculatorPlan,id:string,snapshot:CalculatorSnapshot,evidence:ReturnType<typeof calculatorRuntimeRecoveryEvidence>)=>ReturnType<CalculatorExecutionTeam['generate']>;
},tools:CalculatorExecutionTools,permit:CalculatorRuntimeRecoveryPermit){
 if(!permits.has(permit))return refuse();
 const generate=team.generateFromRejectedCheckpoint.bind(team);
 const guard=async<T>(operation:()=>Promise<T>)=>{await assertCalculatorRuntimeRecovery(permit);return operation();};
 return {
  team:{...team,generate:(plan:CalculatorPlan,id:string,snapshot:CalculatorSnapshot)=>guard(()=>generate(plan,id,snapshot,calculatorRuntimeRecoveryEvidence(permit)))},
  tools:{checkProposal:(a:Parameters<CalculatorExecutionTools['checkProposal']>[0])=>guard(()=>tools.checkProposal(a)),publish:(a:Parameters<CalculatorExecutionTools['publish']>[0])=>guard(()=>tools.publish(a)),ci:(a:Parameters<CalculatorExecutionTools['ci']>[0])=>guard(()=>tools.ci(a))},
 };
}
