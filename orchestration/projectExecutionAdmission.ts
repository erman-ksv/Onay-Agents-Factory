import {createHash} from 'node:crypto';
import {projectPlanTarget,projectPlanBudgetIdentity,type PreparedProjectPlan,type ProjectPlanTask} from './projectPlan.js';
import {projectTargetProfile,assertProjectTargetScope} from './projectTargetRegistry.js';
import {isAuthorizedProjectBudgetController,consumeAuthorizedProjectTaskScope,type AuthorizedProjectBudgetController,type AuthorizedProjectTaskScope} from './projectBudgetAuthorization.js';

export const PROJECT_EXECUTION_ADMISSION_ERROR='Project task admission stopped. Preserve state; no model call, retry, publication or budget reset is authorized.';
const refuse=():never=>{throw Error(PROJECT_EXECUTION_ADMISSION_ERROR);};
type Guards=Readonly<{assertSource:(plan:PreparedProjectPlan,task:ProjectPlanTask)=>Promise<void>;assertDependencies:(plan:PreparedProjectPlan,task:ProjectPlanTask)=>Promise<void>}>;
declare const admissionBrand:unique symbol;
export type ProjectExecutionAdmission=Readonly<{[admissionBrand]:true}>;
type RecordAdmission={plan:PreparedProjectPlan;taskId:string;scope:AuthorizedProjectTaskScope;assertCurrent:()=>Promise<void>;consumed:boolean};
const admissions=new WeakMap<ProjectExecutionAdmission,RecordAdmission>();
/** HOST ONLY. The host must provide real provenance/dependency assertions; no
 * model JSON supplies callbacks. This binds the plan to a native budget scope,
 * not to a completed model/review/test/publication run. */
export function createProjectExecutionAdmission(plan:PreparedProjectPlan,controller:AuthorizedProjectBudgetController,guards:Guards){
 try{
  const target=projectPlanTarget(plan),identity=projectPlanBudgetIdentity(plan),profile=projectTargetProfile(target,plan.repository);
  if(plan.status!=='planned'||!plan.tasks.length||!isAuthorizedProjectBudgetController(controller)||controller.operationMode!=='development'||controller.identity.projectId!==identity.projectId||controller.identity.repository!==identity.repository||controller.identity.planFingerprint!==identity.planFingerprint||controller.identity.ownerFingerprint!==identity.ownerFingerprint||JSON.stringify(controller.identity.taskIds)!==JSON.stringify(identity.taskIds)||controller.targetProfileSha256!==profile.sha256||projectTargetProfile(controller.targetProfile,identity.repository).sha256!==profile.sha256||typeof guards?.assertSource!=='function'||typeof guards?.assertDependencies!=='function')return refuse();
  const assertSource=guards.assertSource,assertDependencies=guards.assertDependencies;let stopped=false,busy=false;
  const active=()=>{if(stopped)return refuse();};
  async function current(task:ProjectPlanTask){try{active();await controller.assertAuthorized();active();if(await assertDependencies(plan,task)!==undefined)return refuse();active();if(await assertSource(plan,task)!==undefined)return refuse();active();await controller.assertAuthorized();active();}catch{stopped=true;return refuse();}}
  return Object.freeze({
   async prepare(taskId:string):Promise<ProjectExecutionAdmission>{
    try{active();if(busy)return refuse();busy=true;const task=plan.tasks.find(t=>t.id===taskId);if(!task)return refuse();assertProjectTargetScope(target,{repository:plan.repository,branch:plan.branch,changePaths:task.paths});await current(task);
     const budget=await controller.inspect();active();if(budget.remaining.requests<4||budget.remaining.requestBytes<1||budget.remaining.reservedTokens<1)return refuse();
     const executionId='project-task-'+createHash('sha256').update(JSON.stringify([plan.fingerprint,taskId])).digest('hex').slice(0,32),scope=await controller.taskScope(taskId,executionId);await current(task);active();
     const admission=Object.freeze({}) as ProjectExecutionAdmission;admissions.set(admission,{plan,taskId,scope,assertCurrent:()=>current(task),consumed:false});return admission;
    }catch{stopped=true;return refuse();}finally{busy=false;}
   },
   snapshot:()=>Object.freeze({stopped,executionAuthorized:false as const,modelCalls:0 as const,publicationAuthorized:false as const}),
  });
 }catch{return refuse();}
}
/** Future executors must keep assertCurrent before every request/tool and use
 * the ordinary reserve-before-HTTP budget router plus all independent gates.
 * Consuming this capability itself never performs HTTP or writes. */
export function consumeProjectExecutionAdmission(value:unknown,plan:PreparedProjectPlan,taskId:string){
 try{const record=admissions.get(value as ProjectExecutionAdmission);if(!record||record.consumed||record.plan!==plan||record.taskId!==taskId)return refuse();record.consumed=true;
  const identity=projectPlanBudgetIdentity(plan),target=projectPlanTarget(plan),host=consumeAuthorizedProjectTaskScope(record.scope,identity);if(projectTargetProfile(host.targetProfile,plan.repository).sha256!==plan.targetProfileSha256)return refuse();
  return Object.freeze({plan,taskId,target,host,assertCurrent:record.assertCurrent,executionAuthorized:false as const,publicationAuthorized:false as const});
 }catch{return refuse();}
}
