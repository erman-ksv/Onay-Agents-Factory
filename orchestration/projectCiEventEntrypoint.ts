import {join} from 'node:path';
import {projectPlanBudgetIdentity} from './projectPlan.js';
import {isAuthorizedProjectBudgetController} from './projectBudgetAuthorization.js';
import {materializeProjectRuntimeArchive} from './projectRuntimeRecovery.js';
import type {ProjectGrantLineage} from './projectGrantLineage.js';
import {readProjectHostEnvelopeFile} from './projectCorrectionCheckpoint.js';
import {createProjectCiDelivery,createProjectCiDeliveryForTests} from './projectCiDelivery.js';
import {createProjectCiRuntime,createProjectCiRuntimeForTests} from './projectNextTaskWorker.js';
import {assertProjectCheckpointArchive} from '../github/projectCheckpointArchive.js';
import {assertProjectStateProtection,verifyProjectStateProtection} from '../github/projectStateProtection.js';
import {restoreProjectPublication,restoreProjectPublicationForTests,confirmProjectCandidateCi} from '../github/projectPublisher.js';
import {createProjectCiReader,createProjectCiReaderForTests,projectCiEventRunMatches} from '../github/projectCi.js';

export const PROJECT_CI_EVENT_ERROR='CI event entrypoint refused or uncertain. Preserve the archive, latest trusted pin and budget; no automatic task replay, new grant or publication retry is authorized.';
const refuse=():never=>{throw Error(PROJECT_CI_EVENT_ERROR);};
type RuntimeOptions=Parameters<typeof createProjectCiRuntime>[0];
type Options=Omit<RuntimeOptions,'directory'|'deliveryDirectory'>&Readonly<{directory:string;lineage?:ProjectGrantLineage}>;
type Injections=Parameters<typeof createProjectCiRuntimeForTests>[1];
type Event=Readonly<{version:1;repository:string;branch:string;candidateSha:string;runId:number;runAttempt:1;conclusion:'success'|'failure'|'cancelled'|'timed_out'}>;

/** A bounded, untrusted relay notice, never a serialized confirmation/grant.
 * Host bootstrap supplies genuine plan/controller/policies/archive/key and a
 * fresh private directory. No task, test oracle, command or callback comes from
 * this event. Native CI, immutable workflow pins and source are read again. */
function parseEvent(body:string):Event{
 if(typeof body!=='string'||Buffer.byteLength(body)>2048)return refuse();
 const v=JSON.parse(body);
 if(!v||Object.getPrototypeOf(v)!==Object.prototype||JSON.stringify(Object.keys(v).sort())!==JSON.stringify(['version','repository','branch','candidateSha','runId','runAttempt','conclusion'].sort())||v.version!==1||typeof v.repository!=='string'||v.repository.length>200||typeof v.branch!=='string'||v.branch.length>200||typeof v.candidateSha!=='string'||!/^[a-f0-9]{40}$/.test(v.candidateSha)||!Number.isSafeInteger(v.runId)||v.runId<1||v.runAttempt!==1||!['success','failure','cancelled','timed_out'].includes(v.conclusion))return refuse();
 return Object.freeze(v);
}

/** One cold event, fixed production adapters. This is a host entrypoint, not an
 * SDK/model tool or an activated workflow. It never initializes a budget or an
 * archive and cannot continue an uncertain HTTP reservation. */
export function runProjectCiEvent(options:Options,body:string){return run(options,body);}
/** Injection never produces native publication/CI authority. */
export function runProjectCiEventForTests(options:Options,body:string,injections:Injections){return run(options,body,injections);}
async function run(options:Options,body:string,injections?:Injections){try{
 if(Object.keys(options).some(k=>!['plan','controller','env','ciPolicy','taskPolicies','key','directory','stateProtection','archive','lineage'].includes(k)))return refuse();
 const {plan,controller,archive}=options,identity=projectPlanBudgetIdentity(plan),mode=injections?'simulated':'native',event=parseEvent(body);
 if(!isAuthorizedProjectBudgetController(controller)||controller.operationMode!=='development'||plan.status!=='planned'||controller.identity.projectId!==identity.projectId||controller.identity.repository!==identity.repository||controller.identity.planFingerprint!==identity.planFingerprint||controller.identity.ownerFingerprint!==identity.ownerFingerprint||JSON.stringify(controller.identity.taskIds)!==JSON.stringify(identity.taskIds)||controller.targetProfileSha256!==plan.targetProfileSha256||options.ciPolicy.targetProfileSha256!==plan.targetProfileSha256)return refuse();
 assertProjectCheckpointArchive(archive,controller,mode);
 if(!injections||options.stateProtection)assertProjectStateProtection(options.stateProtection,controller,mode);
 // Unrelated/failed notices are not permission to hydrate or claim a task.
 if(event.repository!==plan.repository||event.branch!==plan.branch||event.conclusion!=='success')return Object.freeze({status:'ignored' as const,executionAuthorized:false as const,wholeProjectCompleted:false as const});
 await controller.assertAuthorized();await controller.inspect();
 if(!injections||options.stateProtection)await verifyProjectStateProtection(options.stateProtection,controller,mode);
 if(!archive.snapshot().pin||archive.snapshot().stopped)return refuse();
 const current=await archive.inspect();if(!current)return refuse();
 const files=await materializeProjectRuntimeArchive(archive,controller,options.key,options.directory,mode,options.lineage);
 const deliveryOptions={plan,controller,key:options.key,directory:files.journal};
 const journal=await(injections?createProjectCiDeliveryForTests(deliveryOptions):createProjectCiDelivery(deliveryOptions)).inspect();
 // A verified encrypted journal can reject an old duplicate even after the
 // feature branch advanced. It does not recreate a confirmation or run a task.
 const duplicate=journal.find(r=>r.candidateSha===event.candidateSha);
 if(duplicate){if(duplicate.policySha256!==options.ciPolicy.sha256)return refuse();return Object.freeze({status:'already-recorded' as const,taskId:duplicate.taskId,dispatch:duplicate.dispatch,executionAuthorized:false as const,wholeProjectCompleted:false as const});}
 const history=await archive.history(),matches=history.filter(e=>e.kind==='before-push').filter(e=>{
  const sealed=JSON.parse(readProjectHostEnvelopeFile('onay-publication-intent-v1',options.key,join(files.runtime,e.name)).payload);
  return sealed.candidateSha===event.candidateSha;
 });
 if(matches.length!==1)return refuse();const intent=matches[0]!;
 const recovery={plan,controller,key:options.key,path:join(files.runtime,intent.name),sha256:intent.sha256,token:options.env.GITHUB_TOKEN!};
 const candidate=await(injections?restoreProjectPublicationForTests({...recovery,transport:injections.github}):restoreProjectPublication(recovery));
 if(candidate.taskId!==intent.taskId||candidate.candidateSha!==event.candidateSha)return refuse();
 const readCi=injections?createProjectCiReaderForTests(options.ciPolicy,options.env,injections.github):createProjectCiReader(options.ciPolicy,options.env);
 const evidence=await readCi({repository:plan.repository,branch:plan.branch,candidateSha:candidate.candidateSha});
 if(evidence.status!=='passed'||!projectCiEventRunMatches(evidence,event.runId,event.runAttempt))return refuse();
 const confirmation=await confirmProjectCandidateCi(candidate,evidence);
 if(!injections||options.stateProtection)await verifyProjectStateProtection(options.stateProtection,controller,mode);
 const {lineage,...withoutLineage}=options;const runtimeOptions={...withoutLineage,directory:files.runtime,deliveryDirectory:files.journal};
 const runtime=injections?createProjectCiRuntimeForTests(runtimeOptions,injections):createProjectCiRuntime(runtimeOptions);
 return Object.freeze({status:'delivered' as const,...await runtime.advance(confirmation),archivePin:archive.snapshot().pin,wholeProjectCompleted:false as const});
}catch{return refuse();}}
