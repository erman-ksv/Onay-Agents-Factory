import {assertProjectCorrectiveAuthorization} from './projectCorrectiveAuthorization.js';
import {createProjectCorrectiveRuntime,createProjectCorrectiveRuntimeForTests,type ProjectCorrectiveOptions} from './projectCorrectiveRuntime.js';
import type {ProjectModelBudgetStore} from './projectModelBudget.js';
import {projectUncertainRecoveryTicketBinding,type ProjectUncertainRecoveryTicket} from './projectUncertainRecoveryClaim.js';
import {projectTaskFailureDiagnostic} from './projectTaskFailureDiagnostic.js';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {selectProviderConfig} from '../commander/providerConfig.js';
import {projectPlanTarget,type PreparedProjectPlan} from './projectPlan.js';
import {projectTargetProfile} from './projectTargetRegistry.js';
import type {AuthorizedProjectBudgetController} from './projectBudgetAuthorization.js';
import {createProjectCiDelivery,createProjectCiDeliveryForTests,consumeProjectCiDispatchNotice,type ProjectCiDispatchNotice} from './projectCiDelivery.js';
import {createProjectExecutionAdmission,projectExecutionAdmissionExecutionId,type ProjectExecutionAdmission} from './projectExecutionAdmission.js';
import {loadGitHubProjectTaskSnapshot,createProjectSnapshotSourceGuard} from '../github/projectSourceSnapshot.js';
import {createProjectCiReader,createProjectCiReaderForTests,type ProjectCiPolicy} from '../github/projectCi.js';
import {createContextBoundProjectTransport,prepareProjectModelContext,prepareProjectReplyChanges,prepareProjectReplyAssessment,projectReplyContent,projectContextRejectionReason,type PreparedProjectReply,type PreparedProjectContext,prepareProjectCorrectionContext} from './projectModelContext.js';
import {assertProjectNodePolicy,createProjectNodeSandbox,type ProjectNodeTestPolicy,type ProjectNodeTestReceipt} from './projectNodeTests.js';
import {createProjectPublisher,createProjectPublisherForTests,saveProjectPublicationIntent,type ProjectPublishedCandidate} from '../github/projectPublisher.js';
import {writeProjectHostEnvelope,saveProjectCorrectionCheckpoint,type ProjectCorrectionRecoveryKey} from './projectCorrectionCheckpoint.js';
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
type Options=Readonly<{plan:PreparedProjectPlan;controller:AuthorizedProjectBudgetController;env:NodeJS.ProcessEnv;ciPolicy:ProjectCiPolicy;taskPolicies:readonly Readonly<{taskId:string;nodePolicy:ProjectNodeTestPolicy;browserPolicy?:ProjectBrowserTestPolicy;authorSelections:readonly Range[];reviewSelections:readonly Range[]}>[];key:ProjectCorrectionRecoveryKey;directory:string;stateProtection?:ProjectStateProtection;corrective?:ProjectCorrectiveOptions;
 /** HOST ONLY durable persistence acknowledgement. This runs before HTTP or
  * push; a local-only callback does not prove cross-machine persistence. */
 persist:(checkpoint:Readonly<{kind:string;path:string;sha256:string;taskId:string}>)=>Promise<void>}>;
type Injections=Readonly<{budgetRead?:ProjectModelBudgetStore['read'];github:typeof fetch;model:typeof fetch;git:CalculatorGitRunner;timing:CalculatorModelTiming;node:(policy:ProjectNodeTestPolicy,snapshot:ProjectSourceSnapshot,changes:PreparedProjectChanges)=>Promise<ProjectNodeTestReceipt>;browser?:(policy:ProjectBrowserTestPolicy,snapshot:ProjectSourceSnapshot,changes:PreparedProjectChanges)=>Promise<ProjectBrowserTestReceipt>}>;
/** Fixed native source/CI/model/Git/Docker adapters. No model-selected tool,
 * repository, test oracle, callback or command can enter this composition. */
export function createProjectNextTaskWorker(options:Options){if(Object.keys(options).some(k=>!['plan','controller','env','ciPolicy','taskPolicies','key','directory','persist','stateProtection','corrective'].includes(k)))return refuse();return worker(options);}
/** All publication/CI results remain simulated with any injected adapter. */
export function createProjectNextTaskWorkerForTests(options:Options,injections:Injections){return worker(options,injections);}
/** Cold resumption accepts selectors only; fresh OWNER capability, archive CAS
 * and absence of a corrective reservation/claim are checked independently. */
export function createProjectCorrectiveResumeRuntime(options:Omit<Options,'persist'>&{archive:ReturnType<typeof createProjectCheckpointArchive>}){return correctiveResumeRuntime(options);}
export function createProjectCorrectiveResumeRuntimeForTests(options:Omit<Options,'persist'>&{archive:ReturnType<typeof createProjectCheckpointArchive>},injections:Injections){return correctiveResumeRuntime(options,injections);}
function correctiveResumeRuntime(options:Omit<Options,'persist'>&{archive:ReturnType<typeof createProjectCheckpointArchive>},injections?:Injections){
 const {archive,...base}=options;if(!options.corrective||options.corrective.archive!==archive)return refuse();assertProjectCheckpointArchive(archive,options.controller,injections?'simulated':'native');
 const persist=async(c:Parameters<Options['persist']>[0])=>{if(!injections||options.stateProtection)await verifyProjectStateProtection(options.stateProtection,options.controller,injections?'simulated':'native');await archive.persist(c);};
 const w=injections?createProjectNextTaskWorkerForTests({...base,persist},injections):createProjectNextTaskWorker({...base,persist});return Object.freeze({resume:w.resumeCorrection});
}
function worker(options:Options,injections?:Injections){
 const {plan,controller}=options,target=projectPlanTarget(plan),profile=projectTargetProfile(target,plan.repository),env={...options.env},config=selectProviderConfig(env),mode=injections?'simulated':'native';
 if(!injections)assertProjectStateProtection(options.stateProtection,controller,'native');else if(options.stateProtection)assertProjectStateProtection(options.stateProtection,controller,'simulated');
 if(config.provider!=='groq'||env.AGENT_FACTORY_LEGAL_ENABLED!=='false'||env.ONAY_TEAM_FREE_TIER_CONFIRMED!=='true'||typeof options.persist!=='function'||options.ciPolicy.targetProfileSha256!==profile.sha256)return refuse();
 const model=config.model;
 if(options.corrective&&(Object.keys(options.corrective).sort().join(',')!=='archive,authorization'||model!=='openai/gpt-oss-120b'))return refuse();
 const readCi=injections?createProjectCiReaderForTests(options.ciPolicy,env,injections.github):createProjectCiReader(options.ciPolicy,env),policies=new Map<string,Options['taskPolicies'][number]>();
 for(const value of options.taskPolicies){if(policies.has(value.taskId))return refuse();assertProjectNodePolicy(value.nodePolicy,plan,value.taskId);if(projectTaskRequiresBrowser(plan,value.taskId)){assertProjectBrowserPolicy(value.browserPolicy,plan,value.taskId);if(injections&&typeof injections.browser!=='function')return refuse();}const copy=(ranges:readonly Range[])=>Object.freeze(ranges.map(r=>Object.freeze({...r})));policies.set(value.taskId,Object.freeze({...value,authorSelections:copy(value.authorSelections),reviewSelections:copy(value.reviewSelections)}));}
 let used=false;
 type Resume=Readonly<{taskId:string;checkpointSha256:string}>;
 async function execute(notice:ProjectCiDispatchNotice|ProjectInitialTaskTicket|ProjectUncertainRecoveryTicket|Resume,initial=false,recovery=false,resume=false):Promise<ProjectPublishedCandidate>{
  let requestSnapshot:(()=>unknown)|undefined,captureHostFailure:(()=>Promise<void>)|undefined,stopWire:(()=>void)|undefined,lastReply:PreparedProjectReply|undefined,workerStage='admission',hostFailureCheckpoint='not-requested',pendingCorrection=false;
  try{
   if(used)return refuse();used=true;
   if(!injections||options.stateProtection)await verifyProjectStateProtection(options.stateProtection,controller,mode);
   const correctionOptions=options.corrective?{plan,controller,...options.corrective,key:options.key,directory:options.directory,stateProtection:options.stateProtection,token:env.FACTORY_STATE_TOKEN||env.GITHUB_TOKEN||''}:undefined;
   if(options.corrective)await assertProjectCorrectiveAuthorization(options.corrective.authorization,plan,controller,mode);
   const corrective=correctionOptions?(injections?(injections.budgetRead?createProjectCorrectiveRuntimeForTests(correctionOptions,{read:injections.budgetRead}):refuse()):createProjectCorrectiveRuntime(correctionOptions)):undefined;
   const resumeRequest=resume?notice as Resume:undefined;
   if(resumeRequest&&(!corrective||Object.keys(resumeRequest).sort().join(',')!=='checkpointSha256,taskId'||!/^[a-f0-9]{64}$/.test(resumeRequest.checkpointSha256)))return refuse();
   const pending=resumeRequest?await corrective!.inspectPending(resumeRequest.taskId,resumeRequest.checkpointSha256):undefined;
   const dispatch=resume?{assertCurrent:async()=>{await corrective!.inspectPending(resumeRequest!.taskId,resumeRequest!.checkpointSha256);}}:recovery?await projectUncertainRecoveryTicketBinding(notice as ProjectUncertainRecoveryTicket,controller,plan.tasks[0]!.id,mode):initial?await consumeProjectInitialTaskTicket(notice as ProjectInitialTaskTicket,plan,controller,mode):await consumeProjectCiDispatchNotice(notice as ProjectCiDispatchNotice,plan,controller,mode);
   const selected=resume?{taskId:resumeRequest!.taskId,parentSha:pending!.baseSha,planFingerprint:plan.fingerprint,requiresCooldown:true,requiresFreshAdmission:true,requiresFreshSource:true}:(initial||recovery)?{taskId:plan.tasks[0]!.id,parentSha:plan.request.baseSha,planFingerprint:plan.fingerprint,requiresCooldown:true,requiresFreshAdmission:true,requiresFreshSource:true}:notice as ProjectCiDispatchNotice;
   const task=plan.tasks.find(t=>t.id===selected.taskId),policy=policies.get(selected.taskId);
   if(!task||!policy||selected.planFingerprint!==plan.fingerprint||!selected.requiresCooldown||!selected.requiresFreshAdmission||!selected.requiresFreshSource||recovery&&'model' in dispatch&&dispatch.model!==model)return refuse();
   const executionId=resume?pending!.firstExecutionId:recovery?('executionId' in dispatch&&typeof dispatch.executionId==='string'?dispatch.executionId:refuse()):'project-run-'+createHash('sha256').update(JSON.stringify([plan.fingerprint,task.id])).digest('hex').slice(0,32);
   if(!resume&&(await controller.inspectExecution(task.id,executionId)).requests!==0)return refuse();
   const firstBase=(initial||recovery)||resume&&task===plan.tasks[0];
   const snapshot=await loadGitHubProjectTaskSnapshot({plan,taskId:task.id,token:env.GITHUB_TOKEN!,...(firstBase?{}:{anchor:{ref:plan.branch,sha:selected.parentSha}}),...(injections?{transport:injections.github}:{})});
   if(snapshot.baseSha!==selected.parentSha)return refuse();
   const dependencyBranch=initial?('baseCiBranch' in dispatch&&typeof dispatch.baseCiBranch==='string'?dispatch.baseCiBranch:refuse()):firstBase?plan.request.baseRef:plan.branch;
   let correctionGuard:(()=>Promise<void>)|undefined;
   const current=async()=>{if(correctionGuard)await correctionGuard();else await dispatch.assertCurrent();};
   async function dependencies(){if(!injections||options.stateProtection)await verifyProjectStateProtection(options.stateProtection,controller,mode);await current();const ci=await readCi({repository:plan.repository,branch:dependencyBranch,candidateSha:selected.parentSha});if(ci.status!=='passed'||mode==='native'&&ci.provenance!=='native-github')return refuse();await current();}
   const manager=createProjectExecutionAdmission(plan,controller,{assertSource:createProjectSnapshotSourceGuard(snapshot),assertDependencies:dependencies});
   const persist=async(kind:string,path:string,sha256:string)=>{if(!injections||options.stateProtection)await verifyProjectStateProtection(options.stateProtection,controller,mode);await controller.assertAuthorized();if(recovery||resume||correctionGuard)await current();if(await options.persist(Object.freeze({kind,path,sha256,taskId:task.id}))!==undefined)return refuse();await controller.assertAuthorized();if(recovery||resume||correctionGuard)await current();};
   let wire:ReturnType<typeof createContextBoundProjectTransport>,checkpointPrefix='',activeExecutionId=executionId;
   function bindWire(admission:ProjectExecutionAdmission,prefix:string){
    checkpointPrefix=prefix;activeExecutionId=projectExecutionAdmissionExecutionId(admission);
    wire=createContextBoundProjectTransport({plan,taskId:task!.id,snapshot,admission,env,...(injections?{transport:injections.model,timing:injections.timing}:{}),onRejectedReply:async event=>{const path=join(options.directory,checkpointPrefix+'-reply-rejected-'+event.role+'.json'),budget=await controller.inspect(),sealed=writeProjectHostEnvelope('onay-runtime-rejected-reply-v1',JSON.stringify({...event,executionId:projectExecutionAdmissionExecutionId(admission),budget:{projectKey:controller.projectKey,grantSha256:budget.grantSha256,used:budget.used}}),options.key,path);await persist('reply-rejected',path,sealed.sha256);},checkpoint:async event=>{const path=join(options.directory,checkpointPrefix+'-before-http-'+event.attemptedRequests+'.json'),sealed=writeProjectHostEnvelope('onay-runtime-http-v1',JSON.stringify(event),options.key,path);await persist('before-http',path,sealed.sha256);}});
    requestSnapshot=()=>wire.snapshot();stopWire=()=>wire.stop();lastReply=undefined;
   }
   let authorPacket:PreparedProjectContext|undefined,corrected=resume;
   if(resume){
    workerStage='correction-restore';pendingCorrection=true;const restored=await corrective!.restore(task.id,resumeRequest!.checkpointSha256,snapshot);
    const claim=await corrective!.claim(restored.ticket,resumeRequest!.checkpointSha256);correctionGuard=claim.assertCurrent;
    const admission=await manager.prepareCorrection(restored.ticket,claim.permit,mode);bindWire(admission,task.id+'-correction-1');authorPacket=restored.packet;pendingCorrection=false;
   }else{
    const admission=recovery?await manager.prepareRecovery(task.id,notice as ProjectUncertainRecoveryTicket,mode):await manager.prepare(task.id,{requireCooldown:true});
    bindWire(admission,task.id+(recovery&&'checkpointSuffix' in dispatch?'-'+dispatch.checkpointSuffix:''));
   }
   captureHostFailure=async()=>{
    if(pendingCorrection||!lastReply||wire.snapshot().rejectedReplyCheckpoint!=='not-requested')return;
    hostFailureCheckpoint='failed';const reply=lastReply,content=projectReplyContent(reply),path=join(options.directory,checkpointPrefix+'-host-stopped-'+reply.role+'.json'),budget=await controller.inspect(),sealed=writeProjectHostEnvelope('onay-runtime-rejected-reply-v1',JSON.stringify({version:1,kind:'last-reply-on-host-stop',stage:workerStage,repository:reply.repository,planFingerprint:reply.planFingerprint,taskId:reply.taskId,baseSha:reply.baseSha,role:reply.role,requestSha256:reply.requestSha256,responseSha256:reply.responseSha256,responseBytes:reply.responseBytes,model:reply.model,content,executionId:activeExecutionId,budget:{projectKey:controller.projectKey,grantSha256:budget.grantSha256,used:budget.used},executionAuthorized:false,replayAuthorized:false}),options.key,path);await persist('reply-rejected',path,sealed.sha256);hostFailureCheckpoint='persisted';
   };
   for(let pass=0;pass<2;pass++){
    if(!authorPacket){workerStage='author-selection';const selections=resolveProjectContextSelections(snapshot,undefined,policy.authorSelections);workerStage='author-context';authorPacket=await prepareProjectModelContext(plan,task.id,snapshot,{role:'author',model,selections});}
    workerStage='author-request';lastReply=await wire!.request(authorPacket);workerStage='author-proposal';const changes=await prepareProjectReplyChanges(lastReply);authorPacket=undefined;
    let repair=false,failedNode:ProjectNodeTestReceipt|undefined,receipt:ProjectNodeTestReceipt|undefined;
    for(const role of ['security','reviewer','tester'] as const){
     workerStage=role+'-selection';const selections=resolveProjectContextSelections(snapshot,changes,policy.reviewSelections);workerStage=role+'-context';const packet=await prepareProjectModelContext(plan,task.id,snapshot,{role,model,changes,selections});workerStage=role+'-request';lastReply=await wire!.request(packet);workerStage=role+'-assessment';const result=await prepareProjectReplyAssessment(lastReply);
     if(result.decision==='blocked')return refuse();if(result.decision==='changes-requested'){repair=true;break;}
    }
    if(!repair){workerStage='node-tests';receipt=await(injections?injections.node(policy.nodePolicy,snapshot,changes):createProjectNodeSandbox(policy.nodePolicy).run(snapshot,changes));if(receipt.status==='failed'&&receipt.testsExecuted){repair=true;failedNode=receipt;}else if(receipt.status!=='passed'||!receipt.testsExecuted)return refuse();}
    if(repair){
     if(corrected)return refuse();workerStage='correction-context';const evidence=failedNode?{receipt:failedNode,policy:policy.nodePolicy}:undefined;
     const ticket=evidence&&evidence.receipt.provenance==='simulated'?await wire!.prepareCorrectionForTests(evidence):await wire!.prepareCorrection(evidence);
     authorPacket=await prepareProjectCorrectionContext(ticket,{model,selections:[...resolveProjectContextSelections(snapshot,undefined,policy.authorSelections),...resolveProjectContextSelections(snapshot,changes,policy.reviewSelections)]});
     workerStage='correction-checkpoint';const path=join(options.directory,task.id+'-correction-ready.json'),sealed=await saveProjectCorrectionCheckpoint(ticket,plan,task.id,controller,options.key,path);await persist('correction-ready',path,sealed.sha256);pendingCorrection=true;
     workerStage='correction-authorization';if(!corrective)return refuse();workerStage='correction-claim';const claim=await corrective.claim(ticket,sealed.sha256);correctionGuard=claim.assertCurrent;
     workerStage='correction-admission';const admission=await manager.prepareCorrection(ticket,claim.permit,mode);bindWire(admission,task.id+'-correction-1');corrected=true;pendingCorrection=false;continue;
    }
    if(!receipt)return refuse();
    if(projectTaskRequiresBrowser(plan,task.id)){workerStage='browser-tests';const browser=await(injections?injections.browser!(policy.browserPolicy!,snapshot,changes):createProjectBrowserSandbox(policy.browserPolicy!).run(snapshot,changes));if(browser.provenance==='native-docker')await wire!.verifyBrowserTests(browser,policy.browserPolicy!);else{if(!injections)return refuse();await wire!.verifyBrowserTestsForTests(browser,policy.browserPolicy!);}}
    workerStage='publication-approval';let approval;
    if(receipt.provenance==='native-docker'){await wire!.verifyRuntimeTests(receipt,policy.nodePolicy);approval=await wire!.preparePublication();}else{if(!injections)return refuse();approval=await wire!.preparePublicationForTests({receipt,policy:policy.nodePolicy});}
    const checkpoint=async(event:Parameters<Parameters<typeof createProjectPublisher>[0]['checkpoint']>[0])=>{if(event.stage==='before-push'){const path=join(options.directory,checkpointPrefix+'-publication-intent.json'),sealed=await saveProjectPublicationIntent(event.intent,options.key,path);await persist('before-push',path,sealed.sha256);}else{const path=join(options.directory,checkpointPrefix+'-after-push.json'),sealed=writeProjectHostEnvelope('onay-runtime-push-v1',JSON.stringify({taskId:task.id,candidateSha:event.candidateSha,parentSha:event.parentSha,proposalDigest:event.proposalDigest}),options.key,path);await persist('after-push',path,sealed.sha256);}};
    workerStage='publication';const publisher=injections?createProjectPublisherForTests({env,checkpoint,transport:injections.github,runGit:injections.git}):createProjectPublisher({env,checkpoint}),candidate=await publisher.publish(approval),path=join(options.directory,checkpointPrefix+'-published.json'),sealed=writeProjectHostEnvelope('onay-runtime-published-v1',JSON.stringify(candidate),options.key,path);workerStage='candidate-checkpoint';await persist('candidate-published',path,sealed.sha256);return candidate;
   }
   return refuse();
  }catch(error){stopWire?.();try{await captureHostFailure?.();}catch{/* A lost acknowledgement never retries or replaces the original stop. */}if(requestSnapshot)console.error(JSON.stringify(projectTaskFailureDiagnostic({...requestSnapshot() as object,workerStage,contextRejectionCode:projectContextRejectionReason(error),hostFailureCheckpoint})));return refuse();}
 }
 return Object.freeze({execute:(notice:ProjectCiDispatchNotice)=>execute(notice),start:(ticket:ProjectInitialTaskTicket)=>execute(ticket,true),recover:(ticket:ProjectUncertainRecoveryTicket)=>execute(ticket,false,true),resumeCorrection:(request:Resume)=>execute(request,false,false,true)});
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

/** Recover only a separately claimed attempt; never prepare or replay the original start. */
export function createProjectUncertainRecoveryRuntime(options:InitialOptions){return recoveryRuntime(options);}
export function createProjectUncertainRecoveryRuntimeForTests(options:InitialOptions,injections:Injections){return recoveryRuntime(options,injections);}
function recoveryRuntime(options:InitialOptions,injections?:Injections){
 assertProjectCheckpointArchive(options.archive,options.controller,injections?'simulated':'native');const root=lstatSync(options.directory);if(!isAbsolute(options.directory)||resolve(options.directory)!==options.directory||realpathSync(options.directory)!==options.directory||!root.isDirectory()||(root.mode&0o777)!==0o700||process.getuid&&root.uid!==process.getuid())return refuse();
 const {archive,...base}=options,directory=mkdtempSync(join(options.directory,'uncertain-task-')),persist=async(checkpoint:Parameters<Options['persist']>[0])=>{if(!injections||options.stateProtection)await verifyProjectStateProtection(options.stateProtection,options.controller,injections?'simulated':'native');await archive.persist(checkpoint);};
 const w=injections?createProjectNextTaskWorkerForTests({...base,directory,persist},injections):createProjectNextTaskWorker({...base,directory,persist});
 return Object.freeze({async recover(ticket:ProjectUncertainRecoveryTicket){const candidate=await w.recover(ticket);return Object.freeze({candidate,archivePin:archive.snapshot().pin,wholeProjectCompleted:false as const});}});
}
