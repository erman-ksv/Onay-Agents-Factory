import {lstatSync,realpathSync,mkdtempSync} from 'node:fs';
import {isAbsolute,resolve,join} from 'node:path';
import {isAuthorizedProjectBudgetController} from './projectBudgetAuthorization.js';
import {projectPlanBudgetIdentity} from './projectPlan.js';
import {runProjectCiEvent,runProjectCiEventForTests} from './projectCiEventEntrypoint.js';
import {createProjectCiReader,createProjectCiReaderForTests,projectCiEventRunMatches} from '../github/projectCi.js';
import {assertProjectCheckpointArchive} from '../github/projectCheckpointArchive.js';
import {assertProjectStateProtection,verifyProjectStateProtection} from '../github/projectStateProtection.js';

export const PROJECT_CI_CONTINUATION_ERROR='Bounded CI continuation stopped. Preserve the latest archive pin, ciphertext and spent budget; no automatic run replay, extra allowance or fallback executor is authorized.';
const refuse=():never=>{throw Error(PROJECT_CI_CONTINUATION_ERROR);};
type EventOptions=Parameters<typeof runProjectCiEvent>[0];
type Injections=Parameters<typeof runProjectCiEventForTests>[2];
type Options=EventOptions&Readonly<{candidateSha:string;polling:Readonly<{maxPolls:number;intervalMs:number}>}>;
type Timing=Readonly<{now:()=>number;wait:(ms:number)=>Promise<void>}>;
const nativeTiming:Timing={now:()=>performance.now(),wait:ms=>new Promise(resolve=>setTimeout(resolve,ms))};

/** Active-run alternative to cross-repository dispatch: bounded native GET
 * polling can continue after a candidate's CI without a default-branch webhook,
 * server, provider call for polling, or changes to the application workflow.
 * This does not install a daemon or restart itself after a runner stops. */
export function runProjectCiContinuation(options:Options){return run(options,nativeTiming);}
/** Only simulated CI/publication, including when all fixture responses pass. */
export function runProjectCiContinuationForTests(options:Options,injections:Injections,timing:Timing){return run(options,timing,injections);}
async function run(options:Options,timing:Timing,injections?:Injections){try{
 if(Object.keys(options).some(k=>!['plan','controller','env','ciPolicy','taskPolicies','key','directory','stateProtection','archive','candidateSha','polling'].includes(k))||Object.keys(options.polling??{}).sort().join(',')!=='intervalMs,maxPolls'||!Number.isSafeInteger(options.polling.maxPolls)||options.polling.maxPolls<1||options.polling.maxPolls>12||!Number.isSafeInteger(options.polling.intervalMs)||options.polling.intervalMs<10000||options.polling.intervalMs>15000||!/^[a-f0-9]{40}$/.test(options.candidateSha))return refuse();
 const {plan,controller,archive,polling,directory,candidateSha:initialCandidate,...rest}=options,identity=projectPlanBudgetIdentity(plan),mode=injections?'simulated':'native';
 if(!isAuthorizedProjectBudgetController(controller)||controller.operationMode!=='development'||controller.identity.projectId!==identity.projectId||controller.identity.repository!==identity.repository||controller.identity.planFingerprint!==identity.planFingerprint||controller.identity.ownerFingerprint!==identity.ownerFingerprint||JSON.stringify(controller.identity.taskIds)!==JSON.stringify(identity.taskIds)||!isAbsolute(directory)||resolve(directory)!==directory||realpathSync(directory)!==directory)return refuse();
 assertProjectCheckpointArchive(archive,controller,mode);if(!injections||options.stateProtection)assertProjectStateProtection(options.stateProtection,controller,mode);
 const stat=lstatSync(directory);if(!stat.isDirectory()||(stat.mode&0o777)!==0o700||process.getuid&&stat.uid!==process.getuid()||!archive.snapshot().pin||archive.snapshot().stopped)return refuse();
 const checkRoot=()=>{const now=lstatSync(directory);if(!now.isDirectory()||now.ino!==stat.ino||now.dev!==stat.dev||(now.mode&0o777)!==0o700||realpathSync(directory)!==directory)return refuse();};
 const reader=injections?createProjectCiReaderForTests(options.ciPolicy,options.env,injections.github):createProjectCiReader(options.ciPolicy,options.env);
 const started=timing.now();let last=started,polls=0,transitions=0,candidateSha=initialCandidate;
 const current=async()=>{const now=timing.now();if(!Number.isFinite(now)||now<last||now-started>600000)return refuse();last=now;checkRoot();await controller.assertAuthorized();await controller.inspect();if(!injections||options.stateProtection)await verifyProjectStateProtection(options.stateProtection,controller,mode);};
 const result=(status:string)=>Object.freeze({status,polls,transitions,candidateSha,archivePin:archive.snapshot().pin,executionAuthorized:false as const,wholeProjectCompleted:false as const});
 for(;polls<polling.maxPolls;){
  await current();polls++;
  const evidence=await reader({repository:plan.repository,branch:plan.branch,candidateSha});
  await current();
  if(evidence.status==='failed')return result('ci-failed');
  if(evidence.status!=='passed'){
   if(polls===polling.maxPolls)return result('awaiting-ci');
   await timing.wait(polling.intervalMs);await current();continue;
  }
  const runId=evidence.verifiedRunIds.find(id=>projectCiEventRunMatches(evidence,id,1));if(runId===undefined)return refuse();
  if(transitions>=plan.tasks.length)return refuse();
  const body=JSON.stringify({version:1,repository:plan.repository,branch:plan.branch,candidateSha,runId,runAttempt:1,conclusion:'success'});
  checkRoot();const child=mkdtempSync(join(directory,'ci-event-'));checkRoot();
  const eventOptions={...rest,plan,controller,archive,directory:child};
  // Reconciliation collects CI independently again. No cached poll response is
  // upgraded to an execution capability, even within this trusted host loop.
  const delivery=await(injections?runProjectCiEventForTests(eventOptions,body,injections):runProjectCiEvent(eventOptions,body));
  if(delivery.status==='already-recorded')return result('already-recorded');
  if(delivery.status!=='delivered')return refuse();
  if(delivery.delivery.status==='complete')return result('plan-ci-recorded');
  if(delivery.delivery.status!=='notified'||!delivery.candidate)return result(delivery.delivery.status);
  transitions++;candidateSha=delivery.candidate.candidateSha;
 }
 return result('awaiting-ci');
}catch{return refuse();}}
