import {projectTaskFailureDiagnostic} from './projectTaskFailureDiagnostic.js';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {selectProviderConfig} from '../commander/providerConfig.js';
import {projectPlanTarget,type PreparedProjectPlan} from './projectPlan.js';
import {projectTargetProfile} from './projectTargetRegistry.js';
import type {AuthorizedProjectBudgetController} from './projectBudgetAuthorization.js';
import {createProjectCiDelivery,createProjectCiDeliveryForTests,consumeProjectCiDispatchNotice,type ProjectCiDispatchNotice} from './projectCiDelivery.js';
import {createProjectExecutionAdmission} from './projectExecutionAdmission.js';
import {loadGitHubProjectTaskSnapshot,createProjectSnapshotSourceGuard} from '../github/projectSourceSnapshot.js';
import {createProjectCiReader,createProjectCiReaderForTests,type ProjectCiPolicy} from '../github/projectCi.js';
import {createContextBoundProjectTransport,prepareProjectModelContext,prepareProjectReplyChanges,prepareProjectReplyAssessment} from './projectModelContext.js';
import {assertProjectNodePolicy,createProjectNodeSandbox,type ProjectNodeTestPolicy,type ProjectNodeTestReceipt} from './projectNodeTests.js';
import {createProjectPublisher,createProjectPublisherForTests,saveProjectPublicationIntent,type ProjectPublishedCandidate} from '../github/projectPublisher.js';
import {writeProjectHostEnvelope,type ProjectCorrectionRecoveryKey} from './projectCorrectionCheckpoint.js';
import {assertProjectStateProtection,verifyProjectStateProtection,type ProjectStateProtection} from '../github/projectStateProtection.js';
import {assertProjectCheckpointArchive,type createProjectCheckpointArchive} from '../github/projectCheckpointArchive.js';
import type {ProjectCandidateCiConfirmation} from '../github/projectPublisher.js';
import type {CalculatorGitRunner} from '../github/calculatorPublisher.js';
import type {CalculatorModelTiming} from './calculatorGroqPacing.js';
import type {ProjectSourceSnapshot} from '../github/projectSourceSnapshot.js';
import type {PreparedProjectChanges} from '../commander/projectChanges.js';
import {projectTaskRequiresBrowser,assertProjectBrowserPolicy,createProjectBrowserSandbox,type ProjectBrowserTestPolicy,type ProjectBrowserTestReceipt} from './projectBrowserTests.js';

import {consumeProjectInitialTaskTicket,prepareProjectInitialTask,prepareProjectInitialTaskForTests,type ProjectInitialTaskTicket} from './projectInitialTask.js';
import type {ProjectCiEvidence} from '../github/projectCi.js';
import {mkdtempSync,lstatSync,realpathSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';

export const PROJECT_NEXT_WORKER_ERROR='Next task worker stopped. Preserve the dispatch, checkpoints and budget; no automatic task replay, grant, publication retry or deployment is authorized.';
const refuse=():never=>{throw Error(PROJECT_NEXT_WORKER_ERROR);};
import {resolveProjectContextSelections,type ProjectContextSelection} from './projectContextSelection.js';
type Range=ProjectContextSelection;
type Options=Readonly<{plan:PreparedProjectPlan;controller:AuthorizedProjectBudgetController;env:NodeJS.ProcessEnv;ciPolicy:ProjectCiPolicy;taskPolicies:readonly Readonly<{taskId:string;nodePolicy:ProjectNodeTestPolicy;browserPolicy?:ProjectBrowserTestPolicy;authorSelections:readonly Range[];reviewSelections:readonly Range[]}>[];key:ProjectCorrectionRecoveryKey;directory:string;stateProtection?:ProjectStateProtection;
 /** HOST ONLY durable persistence acknowledgement. This runs before HTTP or
  * push; a local-only callback does not prove cross-machine persistence. */
 persist:(checkpoint:Readonly<{kind:string;path:string;sha256:string;taskId:string}>)=>Promise<void>}>;
type Injections=Readonly<{github:typeof fetch;model:typeof fetch;git:CalculatorGitRunner;timing:CalculatorModelTiming;node:(policy:ProjectNodeTestPolicy,snapshot:ProjectSourceSnapshot,changes:PreparedProjectChanges)=>Promise<ProjectNodeTestReceipt>;browser?:(policy:ProjectBrowserTestPolicy,snapshot:ProjectSourceSnapshot,changes:PreparedProjectChanges)=>Promise<ProjectBrowserTestReceipt>}>;
/** Fixed native source/CI/model/Git/Docker adapters. No model-selected tool,
 * repository, test oracle, callback or command can enter this composition. */
export function createProjectNextTaskWorker(options:Options){if(Object.keys(options).some(k=>!['plan','controller','env','ciPolicy','taskPolicies','key','directory','persist','stateProtection'].includes(k)))return refuse();return worker(options);}
/** All publication/CI results remain simulated with any injected adapter. */
export function createProjectNextTaskWorkerForTests(options:Options,injections:Injections){return worker(options,injections);}
function worker(options:Options,injections?:Injections){
 const {plan,controller}=options,target=projectPlanTarget(plan),profile=projectTargetProfile(target,plan.repository),env={...options.env},config=selectProviderConfig(env),mode=injections?'simulated':'native';
 if(!injections)assertProjectStateProtection(options.stateProtection,controller,'native');else if(options.stateProtection)assertProjectStateProtection(options.stateProtection,controller,'simulated');
 if(config.provider!=='groq'||env.AGENT_FACTORY_LEGAL_ENABLED!=='false'||env.ONAY_TEAM_FREE_TIER_CONFIRMED!=='true'||typeof options.persist!=='function'||options.ciPolicy.targetProfileSha256!==profile.sha256)return refuse();
 const model=config.model;
 const readCi=injections?createProjectCiReaderForTests(options.ciPolicy,env,injections.github):createProjectCiReader(options.ciPolicy,env),policies=new Map<string,Options['taskPolicies'][number]>();
 for(const value of options.taskPolicies){if(policies.has(value.taskId))return refuse();assertProjectNodePolicy(value.nodePolicy,plan,value.taskId);if(projectTaskRequiresBrowser(plan,value.taskId)){assertProjectBrowserPolicy(value.browserPolicy,plan,value.taskId);if(injections&&typeof injections.browser!=='function')return refuse();}const copy=(ranges:readonly Range[])=>Object.freeze(ranges.map(r=>Object.freeze({...r})));policies.set(value.taskId,Object.freeze({...value,authorSelections:copy(value.authorSelections),reviewSelections:copy(value.reviewSelections)}));}
 let used=false;
 async function execute(notice:ProjectCiDispatchNotice|ProjectInitialTaskTicket,initial=false):Promise<ProjectPublishedCandidate>{let requestSnapshot:(()=>unknown)|undefined;try{
  if(used)return refuse();used=true;if(!injections||options.stateProtection)await verifyProjectStateProtection(options.stateProtection,controller,mode);const dispatch=initial?await consumeProjectInitialTaskTicket(notice as ProjectInitialTaskTicket,plan,controller,mode):await consumeProjectCiDispatchNotice(notice as ProjectCiDispatchNotice,plan,controller,mode);const selected=initial?{taskId:plan.tasks[0]!.id,parentSha:plan.request.baseSha,planFingerprint:plan.fingerprint,requiresCooldown:true,requiresFreshAdmission:true,requiresFreshSource:true}:notice as ProjectCiDispatchNotice,policy=policies.get(selected.taskId);if(!policy)return refuse();
  const task=plan.tasks.find(t=>t.id===selected.taskId);if(!task||selected.planFingerprint!==plan.fingerprint||!selected.requiresCooldown||!selected.requiresFreshAdmission||!selected.requiresFreshSource)return refuse();
  const executionId='project-run-'+createHash('sha256').update(JSON.stringify([plan.fingerprint,task.id])).digest('hex').slice(0,32);if((await controller.inspectExecution(task.id,executionId)).requests!==0)return refuse();
  const snapshot=await loadGitHubProjectTaskSnapshot({plan,taskId:task.id,token:env.GITHUB_TOKEN!,...(initial?{}:{anchor:{ref:plan.branch,sha:selected.parentSha}}),...(injections?{transport:injections.github}:{})});
  const dependencyBranch=initial?('baseCiBranch' in dispatch&&typeof dispatch.baseCiBranch==='string'?dispatch.baseCiBranch:refuse()):plan.branch;
  async function dependencies(){if(!injections||options.stateProtection)await verifyProjectStateProtection(options.stateProtection,controller,mode);await dispatch.assertCurrent();const ci=await readCi({repository:plan.repository,branch:dependencyBranch,candidateSha:selected.parentSha});if(ci.status!=='passed'||mode==='native'&&ci.provenance!=='native-github')return refuse();await dispatch.assertCurrent();}
  const admission=await createProjectExecutionAdmission(plan,controller,{assertSource:createProjectSnapshotSourceGuard(snapshot),assertDependencies:dependencies}).prepare(task.id,{requireCooldown:true});
  const persist=async(kind:string,path:string,sha256:string)=>{if(!injections||options.stateProtection)await verifyProjectStateProtection(options.stateProtection,controller,mode);await controller.assertAuthorized();if(await options.persist(Object.freeze({kind,path,sha256,taskId:task.id}))!==undefined)return refuse();await controller.assertAuthorized();};
  const wire=createContextBoundProjectTransport({plan,taskId:task.id,snapshot,admission,env,...(injections?{transport:injections.model,timing:injections.timing}:{}),checkpoint:async event=>{const path=join(options.directory,task.id+'-before-http-'+event.attemptedRequests+'.json'),sealed=writeProjectHostEnvelope('onay-runtime-http-v1',JSON.stringify(event),options.key,path);await persist('before-http',path,sealed.sha256);}});
  requestSnapshot=wire.snapshot;
  const changes=await prepareProjectReplyChanges(await wire.request(await prepareProjectModelContext(plan,task.id,snapshot,{role:'author',model,selections:resolveProjectContextSelections(snapshot,undefined,policy.authorSelections)})));
  for(const role of ['security','reviewer','tester'] as const){const result=await prepareProjectReplyAssessment(await wire.request(await prepareProjectModelContext(plan,task.id,snapshot,{role,model,changes,selections:resolveProjectContextSelections(snapshot,changes,policy.reviewSelections)})));if(result.decision!=='ready')return refuse();}
  const receipt=await(injections?injections.node(policy.nodePolicy,snapshot,changes):createProjectNodeSandbox(policy.nodePolicy).run(snapshot,changes));
  if(receipt.status!=='passed'||!receipt.testsExecuted)return refuse();
  if(projectTaskRequiresBrowser(plan,task.id)){
   const browserReceipt=await(injections?injections.browser!(policy.browserPolicy!,snapshot,changes):createProjectBrowserSandbox(policy.browserPolicy!).run(snapshot,changes));
   if(browserReceipt.provenance==='native-docker')await wire.verifyBrowserTests(browserReceipt,policy.browserPolicy!);else{if(!injections)return refuse();await wire.verifyBrowserTestsForTests(browserReceipt,policy.browserPolicy!);}
  }
  let approval;if(receipt.provenance==='native-docker'){await wire.verifyRuntimeTests(receipt,policy.nodePolicy);approval=await wire.preparePublication();}else{if(!injections)return refuse();approval=await wire.preparePublicationForTests({receipt,policy:policy.nodePolicy});}
  const checkpoint=async(event:Parameters<Parameters<typeof createProjectPublisher>[0]['checkpoint']>[0])=>{if(event.stage==='before-push'){const path=join(options.directory,task.id+'-publication-intent.json'),sealed=await saveProjectPublicationIntent(event.intent,options.key,path);await persist('before-push',path,sealed.sha256);}else{const path=join(options.directory,task.id+'-after-push.json'),sealed=writeProjectHostEnvelope('onay-runtime-push-v1',JSON.stringify({taskId:task.id,candidateSha:event.candidateSha,parentSha:event.parentSha,proposalDigest:event.proposalDigest}),options.key,path);await persist('after-push',path,sealed.sha256);}};
  const publisher=injections?createProjectPublisherForTests({env,checkpoint,transport:injections.github,runGit:injections.git}):createProjectPublisher({env,checkpoint}),candidate=await publisher.publish(approval),path=join(options.directory,task.id+'-published.json'),sealed=writeProjectHostEnvelope('onay-runtime-published-v1',JSON.stringify(candidate),options.key,path);await persist('candidate-published',path,sealed.sha256);return candidate;
 }catch{if(requestSnapshot)console.error(JSON.stringify(projectTaskFailureDiagnostic(requestSnapshot())));return refuse();}}
 return Object.freeze({execute:(notice:ProjectCiDispatchNotice)=>execute(notice),start:(ticket:ProjectInitialTaskTicket)=>execute(ticket,true)});
}

/** Fixed composition of durable CI claim, encrypted remote persistence and the
 * native successor pipeline. No JSON notice/caller-provided execute callback. */
export function createProjectCiRuntime(options:Omit<Options,'persist'>&{archive:ReturnType<typeof createProjectCheckpointArchive>;deliveryDirectory:string}){return runtime(options);}
export function createProjectCiRuntimeForTests(options:Omit<Options,'persist'>&{archive:ReturnType<typeof createProjectCheckpointArchive>;deliveryDirectory:string},injections:Injections){return runtime(options,injections);}
function runtime(options:Omit<Options,'persist'>&{archive:ReturnType<typeof createProjectCheckpointArchive>;deliveryDirectory:string},injections?:Injections){
 assertProjectCheckpointArchive(options.archive,options.controller,injections?'simulated':'native');const {archive,deliveryDirectory,...workerOptions}=options,persist=async(checkpoint:Parameters<Options['persist']>[0])=>{if(!injections||options.stateProtection)await verifyProjectStateProtection(options.stateProtection,options.controller,injections?'simulated':'native');await archive.persist(checkpoint);},worker=injections?createProjectNextTaskWorkerForTests({...workerOptions,persist},injections):createProjectNextTaskWorker({...workerOptions,persist}),delivery=(injections?createProjectCiDeliveryForTests:createProjectCiDelivery)({plan:options.plan,controller:options.controller,key:options.key,directory:deliveryDirectory,persist});
 return Object.freeze({async advance(confirmation:ProjectCandidateCiConfirmation){let candidate:ProjectPublishedCandidate|undefined;const result=await delivery.deliver(confirmation,async notice=>{candidate=await worker.execute(notice);});return Object.freeze({delivery:result,...(candidate?{candidate}:{}),wholeProjectCompleted:false as const});}});
}

/** Same four-role/test/publisher pipeline for the first task. The caller must
 * supply genuine fresh base CI; this API never initializes the model ledger. */
type InitialOptions=Omit<Options,'persist'> & {archive:ReturnType<typeof createProjectCheckpointArchive>};
export function createProjectInitialTaskRuntime(options:InitialOptions){return initialRuntime(options);}
export function createProjectInitialTaskRuntimeForTests(options:InitialOptions,injections:Injections){return initialRuntime(options,injections);}
function initialRuntime(options:InitialOptions,injections?:Injections){
 assertProjectCheckpointArchive(options.archive,options.controller,injections?'simulated':'native');const root=lstatSync(options.directory);if(!isAbsolute(options.directory)||resolve(options.directory)!==options.directory||realpathSync(options.directory)!==options.directory||!root.isDirectory()||(root.mode&0o777)!==0o700||process.getuid&&root.uid!==process.getuid())return refuse();const {archive,...base}=options,directory=mkdtempSync(join(options.directory,'first-task-')),persist=async(checkpoint:Parameters<Options['persist']>[0])=>{if(!injections||options.stateProtection)await verifyProjectStateProtection(options.stateProtection,options.controller,injections?'simulated':'native');await archive.persist(checkpoint);};
 const taskWorker=injections?createProjectNextTaskWorkerForTests({...base,directory,persist},injections):createProjectNextTaskWorker({...base,directory,persist});
 return Object.freeze({async start(baseCi:ProjectCiEvidence){const prepared={plan:options.plan,controller:options.controller,archive,key:options.key,directory,ciPolicy:options.ciPolicy,...(options.stateProtection?{stateProtection:options.stateProtection}:{})},ticket=await(injections?prepareProjectInitialTaskForTests(prepared,baseCi):prepareProjectInitialTask(prepared,baseCi)),candidate=await taskWorker.start(ticket);return Object.freeze({candidate,archivePin:archive.snapshot().pin,wholeProjectCompleted:false as const});}});
}
