import {createHash} from 'node:crypto';import {join} from 'node:path';
import {projectPlanTarget,projectPlanBudgetIdentity,type PreparedProjectPlan} from './projectPlan.js';
import {isAuthorizedProjectBudgetController,type AuthorizedProjectBudgetController} from './projectBudgetAuthorization.js';
import {writeProjectHostEnvelope,type ProjectCorrectionRecoveryKey} from './projectCorrectionCheckpoint.js';
import {assertProjectCheckpointArchive,type createProjectCheckpointArchive} from '../github/projectCheckpointArchive.js';
import {projectCiEvidenceBinding,type ProjectCiEvidence,type ProjectCiPolicy} from '../github/projectCi.js';
import {assertProjectStateProtection,verifyProjectStateProtection,type ProjectStateProtection} from '../github/projectStateProtection.js';
export const PROJECT_INITIAL_TASK_ERROR='First-task start refused or uncertain. Preserve the initial claim and spent history; no replay, ledger initialization or new allowance is authorized.';
const refuse=():never=>{throw Error(PROJECT_INITIAL_TASK_ERROR);};
type Options=Readonly<{plan:PreparedProjectPlan;controller:AuthorizedProjectBudgetController;archive:ReturnType<typeof createProjectCheckpointArchive>;key:ProjectCorrectionRecoveryKey;directory:string;ciPolicy:ProjectCiPolicy;stateProtection?:ProjectStateProtection}>;
declare const startBrand:unique symbol;
export type ProjectInitialTaskTicket=Readonly<{[startBrand]:true}>;
const starts=new WeakMap<ProjectInitialTaskTicket,{plan:PreparedProjectPlan;controller:AuthorizedProjectBudgetController;mode:'native'|'simulated';baseCi:ProjectCiEvidence;current:()=>Promise<void>;used:boolean}>();
export function prepareProjectInitialTask(options:Options,baseCi:ProjectCiEvidence){return prepare(options,baseCi,'native');}
export function prepareProjectInitialTaskForTests(options:Options,baseCi:ProjectCiEvidence){return prepare(options,baseCi,'simulated');}
async function prepare(options:Options,baseCi:ProjectCiEvidence,mode:'native'|'simulated'):Promise<ProjectInitialTaskTicket>{try{
 if(Object.keys(options).some(k=>!['plan','controller','archive','key','directory','ciPolicy','stateProtection'].includes(k)))return refuse();
 const {plan,controller,archive}=options,identity=projectPlanBudgetIdentity(plan),task=plan.tasks[0];
 if(!task||task.dependsOn.length||plan.status!=='planned'||!isAuthorizedProjectBudgetController(controller)||controller.operationMode!=='development'||controller.identity.projectId!==identity.projectId||controller.identity.repository!==identity.repository||controller.identity.planFingerprint!==identity.planFingerprint||controller.identity.ownerFingerprint!==identity.ownerFingerprint||JSON.stringify(controller.identity.taskIds)!==JSON.stringify(identity.taskIds)||controller.targetProfileSha256!==plan.targetProfileSha256)return refuse();
 assertProjectCheckpointArchive(archive,controller,mode);if(mode==='native'||options.stateProtection)assertProjectStateProtection(options.stateProtection,controller,mode);
 const ci=projectCiEvidenceBinding(baseCi);if(ci.target!==projectPlanTarget(plan)||baseCi.repository!==plan.repository||baseCi.candidateSha!==plan.request.baseSha||![plan.request.baseRef,plan.branch].includes(baseCi.branch)||baseCi.policySha256!==options.ciPolicy.sha256||baseCi.status!=='passed'||mode==='native'&&baseCi.provenance!=='native-github')return refuse();
 await controller.assertAuthorized();await ci.assertCurrent();if(mode==='native'||options.stateProtection)await verifyProjectStateProtection(options.stateProtection,controller,mode);
 if(archive.snapshot().pin!==null||archive.snapshot().stopped||await archive.inspect()!==undefined)return refuse();
 for(const t of plan.tasks){const id='project-run-'+createHash('sha256').update(JSON.stringify([plan.fingerprint,t.id])).digest('hex').slice(0,32);if((await controller.inspectExecution(t.id,id)).requests!==0)return refuse();}
 const state=await controller.inspect();if(state.remaining.requests<4||state.remaining.requestBytes<48000||state.remaining.reservedTokens<24000)return refuse();
 const payload={version:1,planFingerprint:plan.fingerprint,repository:plan.repository,taskId:task.id,baseSha:plan.request.baseSha,baseCiBranch:baseCi.branch,baseCiPolicySha256:baseCi.policySha256,budget:{projectKey:controller.projectKey,grantSha256:state.grantSha256,used:state.used},executionAuthorized:false},path=join(options.directory,task.id+'-task-start.json'),sealed=writeProjectHostEnvelope('onay-task-start-v1',JSON.stringify(payload),options.key,path);
 await ci.assertCurrent();await controller.assertAuthorized();await archive.persist({kind:'task-start',taskId:task.id,path,sha256:sealed.sha256});
 // The first durable append is the claim. A cold process cannot recreate the
 // in-memory ticket from this JSON or restart an archive that now exists.
 const current=async()=>{await controller.assertAuthorized();if(mode==='native'||options.stateProtection)await verifyProjectStateProtection(options.stateProtection,controller,mode);const history=await archive.history(),claims=history.filter(e=>e.kind==='task-start');if(claims.length!==1||claims[0]!.sha256!==sealed.sha256||claims[0]!.taskId!==task.id||history.some(e=>e.taskId!==task.id))return refuse();};
 await current();const ticket=Object.freeze({}) as ProjectInitialTaskTicket;starts.set(ticket,{plan,controller,mode,baseCi,current,used:false});return ticket;
}catch{return refuse();}}
export async function consumeProjectInitialTaskTicket(value:ProjectInitialTaskTicket,plan:PreparedProjectPlan,controller:AuthorizedProjectBudgetController,mode:'native'|'simulated'){try{
 const r=starts.get(value);if(!r||r.used||r.plan!==plan||r.controller!==controller||mode==='native'&&r.mode!=='native')return refuse();r.used=true;await r.current();await projectCiEvidenceBinding(r.baseCi).assertCurrent();return Object.freeze({taskId:plan.tasks[0]!.id,parentSha:plan.request.baseSha,baseCiBranch:r.baseCi.branch,assertCurrent:r.current});
}catch{return refuse();}}
