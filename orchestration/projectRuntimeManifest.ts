import {createHash} from 'node:crypto';
import {createProjectTargetRegistry,registeredProjectTargetProfile} from './projectTargetRegistry.js';
import {prepareProjectGoal,createProjectPlan,projectPlanBudgetIdentity} from './projectPlan.js';
import {reconcileProjectBudgetHistory,authorizeGitHubProjectBudget,type ProjectBudgetHistory,type ProjectOwnerDecision} from './projectBudgetAuthorization.js';
import {prepareProjectNodeTestPolicy} from './projectNodeTests.js';
import {loadProjectRuntimeRecoveryKey} from './projectRuntimeRecovery.js';
import {destroyProjectCorrectionRecoveryKey} from './projectCorrectionCheckpoint.js';
import {createProjectCiPolicy} from '../github/projectCi.js';
import {createProjectCheckpointArchive,type ProjectCheckpointPin} from '../github/projectCheckpointArchive.js';
import {prepareProjectStateProtection} from '../github/projectStateProtection.js';
import {projectTaskRequiresBrowser,prepareProjectBrowserTestPolicy} from './projectBrowserTests.js';
import type {createProjectInitialTaskRuntime} from './projectNextTaskWorker.js';
import type {runProjectCiContinuation} from './projectCiContinuation.js';

export const PROJECT_RUNTIME_MANIFEST_ERROR='Pinned host runtime manifest or development authorization is unverified. No ledger initialization, new grant, provider request or fallback configuration is authorized.';
const refuse=():never=>{throw Error(PROJECT_RUNTIME_MANIFEST_ERROR);};
type Options=Parameters<typeof runProjectCiContinuation>[0];
declare const manifestBrand:unique symbol;
export type PreparedProjectRuntimeManifest=Readonly<{[manifestBrand]:true}>;
type RecordManifest={plan:Options['plan'];target:ReturnType<ReturnType<typeof createProjectTargetRegistry>['select']>;ciPolicy:Options['ciPolicy'];taskPolicies:Options['taskPolicies'];history:ProjectBudgetHistory;decision:ProjectOwnerDecision;pin:ProjectCheckpointPin|null;candidateSha:string|null;mode:'continue'|'first-task';sha256:string;used:boolean};
const records=new WeakMap<PreparedProjectRuntimeManifest,RecordManifest>();
const exact=(v:any,keys:string[])=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const sha=(v:unknown,n:number)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);

/** Host-only configuration pinned by a digest from trusted workflow code.
 * Never derive expectedSha256 from the same untrusted artifact/model/event.
 * Parsing recreates policy capabilities; it does NOT authorize model execution. */
export function prepareProjectRuntimeManifest(body:string,expectedSha256:string):PreparedProjectRuntimeManifest{try{
 if(typeof body!=='string'||Buffer.byteLength(body)>65536||!sha(expectedSha256,64)||createHash('sha256').update(body).digest('hex')!==expectedSha256)return refuse();
 const v=JSON.parse(body);if(!exact(v,['version','profile','goal','proposal','history','decision','workflowPins','taskPolicies','archivePin','candidateSha',...(Object.hasOwn(v,'mode')?['mode']:[])])||v.version!==1||!['continue','first-task'].includes(v.mode??'continue')||((v.mode??'continue')==='first-task'?(v.candidateSha!==null||v.archivePin!==null):(!sha(v.candidateSha,40)||!exact(v.archivePin,['head','sequence'])||!sha(v.archivePin.head,40)||!Number.isSafeInteger(v.archivePin.sequence)||v.archivePin.sequence<1||v.archivePin.sequence>256))||!exact(v.decision,['issueNumber','commentId','bodySha256'])||![v.decision.issueNumber,v.decision.commentId].every(x=>Number.isSafeInteger(x)&&x>0)||!sha(v.decision.bodySha256,64))return refuse();
 const registry=createProjectTargetRegistry([v.profile]),target=registry.select(v.profile.id),profile=registeredProjectTargetProfile(target),plan=createProjectPlan(prepareProjectGoal(target,v.goal),v.proposal);
 if(plan.status!=='planned'||!Array.isArray(v.taskPolicies)||v.taskPolicies.length!==plan.tasks.length)return refuse();
 reconcileProjectBudgetHistory(v.history,projectPlanBudgetIdentity(plan));
 const ciPolicy=createProjectCiPolicy(target,v.workflowPins),seen=new Set<string>();
 const taskPolicies=v.taskPolicies.map((p:any)=>{
  const task=plan.tasks.find(t=>t.id===p.taskId);if(!task||!exact(p,['taskId','node','authorSelections','reviewSelections',...(projectTaskRequiresBrowser(plan,task.id)?['browser']:[])])||seen.has(p.taskId))return refuse();seen.add(task.id);
  const ranges=(input:any)=>{if(!Array.isArray(input)||input.length>8)return refuse();return Object.freeze(input.map((r:any)=>{if(!exact(r,['path','version','start','end'])||(!task.paths.includes(r.path)&&!(r.version==='base'&&(plan.request.readOnlyPaths??[]).includes(r.path)))||!['base','proposed'].includes(r.version)||!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start<0||r.end<=r.start||r.end>profile.maxSourceBytes||r.end-r.start>2048)return refuse();return Object.freeze({...r});}));};
  return Object.freeze({taskId:task.id,nodePolicy:prepareProjectNodeTestPolicy(plan,task.id,p.node),...(projectTaskRequiresBrowser(plan,task.id)?{browserPolicy:prepareProjectBrowserTestPolicy(plan,task.id,p.browser)}:{}),authorSelections:ranges(p.authorSelections),reviewSelections:ranges(p.reviewSelections)});
 });
 const cap=Object.freeze({}) as PreparedProjectRuntimeManifest;records.set(cap,{plan,target,ciPolicy,taskPolicies:Object.freeze(taskPolicies),history:v.history,decision:Object.freeze({...v.decision}),pin:v.archivePin===null?null:Object.freeze({...v.archivePin}),candidateSha:v.candidateSha,mode:v.mode??'continue',sha256:expectedSha256,used:false});return cap;
}catch{return refuse();}}
export function projectRuntimeManifestMetadata(value:PreparedProjectRuntimeManifest){const r=records.get(value);if(!r)return refuse();return Object.freeze({manifestSha256:r.sha256,mode:r.mode,repository:r.plan.repository,planFingerprint:r.plan.fingerprint,targetProfileSha256:r.plan.targetProfileSha256,taskIds:r.plan.tasks.map(t=>t.id),candidateSha:r.candidateSha,archivePin:r.pin,executionAuthorized:false as const});}

/** Native cold bootstrap over existing state only. No storage injection,
 * initialize(), grant extension, synthetic fixture, or key rotation. */
export async function bootstrapProjectRuntime(value:PreparedProjectRuntimeManifest,environment:NodeJS.ProcessEnv,directory:string){let key:ReturnType<typeof loadProjectRuntimeRecoveryKey>|undefined;try{
 const r=records.get(value);if(!r||r.used)return refuse();r.used=true;const env={...environment};
 if(env.AGENT_FACTORY_LEGAL_ENABLED!=='false'||env.ONAY_TEAM_FREE_TIER_CONFIRMED!=='true')return refuse();
 const token=env.FACTORY_STATE_TOKEN||env.CALCULATOR_GITHUB_TOKEN||env.GITHUB_TOKEN||'';
 const controller=await authorizeGitHubProjectBudget({identity:projectPlanBudgetIdentity(r.plan),history:r.history,decision:r.decision,token,targetProfile:r.target});
 if(controller.operationMode!=='development')return refuse();const state=await controller.inspect();if(state.remaining.requests<4||state.remaining.requestBytes<48000||state.remaining.reservedTokens<24000)return refuse();
 const stateProtection=await prepareProjectStateProtection({controller,token:env.FACTORY_READ_TOKEN||token}),archive=createProjectCheckpointArchive({controller,token,pin:r.pin});const existing=await archive.inspect();if(r.mode==='first-task'?existing!==undefined:!existing)return refuse();
 key=loadProjectRuntimeRecoveryKey(env);const ownedKey=key;
 const common={plan:r.plan,controller,env,ciPolicy:r.ciPolicy,taskPolicies:r.taskPolicies,stateProtection,archive,key:ownedKey,directory};
 if(r.mode==='first-task'){const options:Parameters<typeof createProjectInitialTaskRuntime>[0]=common;return Object.freeze({mode:'first-task' as const,options,dispose:()=>destroyProjectCorrectionRecoveryKey(ownedKey)});}
 const options:Options={...common,candidateSha:r.candidateSha!,polling:{maxPolls:12,intervalMs:10000}};return Object.freeze({mode:'continue' as const,options,dispose:()=>destroyProjectCorrectionRecoveryKey(ownedKey)});
}catch{if(key)destroyProjectCorrectionRecoveryKey(key);return refuse();}}
