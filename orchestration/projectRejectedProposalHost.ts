import {createHash} from 'node:crypto';
import {lstatSync,realpathSync,readdirSync,mkdtempSync} from 'node:fs';
import {isAbsolute,resolve,join} from 'node:path';
import {prepareProjectRuntimeManifest,projectRuntimeManifestInspectionContext} from './projectRuntimeManifest.js';
import {authorizeGitHubProjectBudget,projectBudgetApprovalDigest,type ProjectOwnerDecision} from './projectBudgetAuthorization.js';
import {projectPlanBudgetIdentity} from './projectPlan.js';
import {registeredProjectTargetProfile} from './projectTargetRegistry.js';
import {restoreGitHubDevelopmentGrantChain} from './projectGrantLineage.js';
import {projectBudgetStateDigest} from './projectBudgetExtensionAuthorization.js';
import {createProjectModelBudgetGitHubStore} from '../github/projectModelBudgetStore.js';
import {createProjectCheckpointArchive} from '../github/projectCheckpointArchive.js';
import {prepareProjectStateProtection} from '../github/projectStateProtection.js';
import {loadGitHubProjectTaskSnapshot} from '../github/projectSourceSnapshot.js';
import {createProjectCiReader} from '../github/projectCi.js';
import {loadProjectRuntimeRecoveryKey} from './projectRuntimeRecovery.js';
import {destroyProjectCorrectionRecoveryKey} from './projectCorrectionCheckpoint.js';
import {inspectProjectRejectedProposal,projectRejectedProposalInspection,proposeProjectRejectedProposalAdmission,authorizeProjectRejectedProposal,claimProjectRejectedProposal,type ProjectRejectedProposalBinding} from './projectRejectedProposalRecovery.js';

const refuse=():never=>{throw Error('Rejected proposal host refused. Preserve claims, replies and charges; no replay, extra admission or budget mutation is authorized.');};
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const sha=(v:unknown,n:number):v is string=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
const exact=(v:unknown,keys:string[])=>!!v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
type Config={version:1;kind:'rejected-proposal-host';baseCodeSha:string;runtimeManifestSha256:string;budgetHead:string;binding:ProjectRejectedProposalBinding;grantDecisions:ProjectOwnerDecision[];grantTransitions:{beforeHead:string;afterHead:string}[];ownerBodySha256:string;expiresAt:string;expectedRemaining:{requests:number;requestBytes:number;reservedTokens:number};maxNewRequests:8};
type Context=ReturnType<typeof projectRuntimeManifestInspectionContext>;
declare const brand:unique symbol;
export type PreparedProjectRejectedProposalHost=Readonly<{[brand]:true}>;
const hosts=new WeakMap<object,{config:Config;context:Context;used:boolean}>();

/** Digest must come from separately trusted launcher/review, never computed by
 * the entrypoint from the same config it is about to trust. DATA is not OWNER. */
export function prepareProjectRejectedProposalHost(body:string,expectedSha256:string,runtimeBody:string):PreparedProjectRejectedProposalHost{try{
 if(Buffer.byteLength(body)>16384||!sha(expectedSha256,64)||hash(body)!==expectedSha256)return refuse();
 const v:Config=JSON.parse(body);
 if(!exact(v,['version','kind','baseCodeSha','runtimeManifestSha256','budgetHead','binding','grantDecisions','grantTransitions','ownerBodySha256','expiresAt','expectedRemaining','maxNewRequests'])||v.version!==1||v.kind!=='rejected-proposal-host'||v.baseCodeSha!=='7f9e4de0fa1a8d3518893ef8986c3d961a7ce1ce'||!sha(v.runtimeManifestSha256,64)||!sha(v.budgetHead,40)||!sha(v.ownerBodySha256,64)||v.maxNewRequests!==8||!Number.isFinite(Date.parse(v.expiresAt)))return refuse();
 const b=v.binding;
 if(!exact(b,['taskId','archiveHead','archiveSequence','checkpointSha256','budgetStateSha256','priorExecutionId','priorRequestSha256','priorResponseSha256','baseSha'])||b.archiveSequence!==13||!sha(b.archiveHead,40)||!sha(b.baseSha,40)||[b.checkpointSha256,b.budgetStateSha256,b.priorRequestSha256,b.priorResponseSha256].some(s=>!sha(s,64))||!/^project-run-[a-f0-9]{32}$/.test(b.priorExecutionId))return refuse();
 if(!exact(v.expectedRemaining,['requests','requestBytes','reservedTokens'])||v.expectedRemaining.requests!==15||v.expectedRemaining.requestBytes!==186739||v.expectedRemaining.reservedTokens!==92790)return refuse();
 if(!Array.isArray(v.grantDecisions)||v.grantDecisions.length!==6||v.grantDecisions.some(d=>!exact(d,['issueNumber','commentId','bodySha256'])||d.issueNumber!==75||!Number.isSafeInteger(d.commentId)||d.commentId<1||!sha(d.bodySha256,64))||new Set(v.grantDecisions.map(d=>d.commentId)).size!==6||!Array.isArray(v.grantTransitions)||v.grantTransitions.length!==5||v.grantTransitions.some(p=>!exact(p,['beforeHead','afterHead'])||!sha(p.beforeHead,40)||!sha(p.afterHead,40)||p.beforeHead===p.afterHead))return refuse();
 const context=projectRuntimeManifestInspectionContext(prepareProjectRuntimeManifest(runtimeBody,v.runtimeManifestSha256));
 if(context.plan.tasks.length!==2||context.plan.tasks[0]?.id!==b.taskId||context.plan.request.baseSha!==b.baseSha||JSON.stringify(context.decision)!==JSON.stringify(v.grantDecisions[0]))return refuse();
 const cap=Object.freeze({}) as PreparedProjectRejectedProposalHost;hosts.set(cap,{config:v,context,used:false});return cap;
}catch{return refuse();}}

/** Push can enter read-only mode only. Preflight deliberately rejects provider
 * credentials and live toggles, not merely promises to leave them unused. */
export function assertProjectRejectedHostEnvironment(env:NodeJS.ProcessEnv,mode:'preflight'|'live'){
 if(!['preflight','live'].includes(mode)||env.GITHUB_REPOSITORY!=='erman-ksv/Onay-Agents-Factory'||!(mode==='preflight'?['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME??''):env.GITHUB_EVENT_NAME==='workflow_dispatch')||env.GITHUB_RUN_ATTEMPT!=='1'||env.GITHUB_REF!=='refs/heads/fix/stage8-corrective-verification-20261029'||!sha(env.FACTORY_HOST_SOURCE_SHA,40)||env.GITHUB_SHA!==env.FACTORY_HOST_SOURCE_SHA||env.AGENT_FACTORY_LEGAL_ENABLED!=='false'||env.ONAY_TEAM_FREE_TIER_CONFIRMED!=='true')return refuse();
 if(mode==='preflight'){
  for(const k of ['GROQ_API_KEY','GEMINI_API_KEY','CLOUDFLARE_API_KEY','FACTORY_STATE_TOKEN','AGENT_FACTORY_PROJECT_LIVE_APPROVED','AGENT_FACTORY_ENABLE_GITHUB_WRITES','FACTORY_REJECTED_OWNER_COMMENT_ID','FACTORY_REJECTED_LIVE_CONFIRMATION'])if(env[k]!==undefined)return refuse();
  if(!env.FACTORY_INSPECTION_READ_TOKEN)return refuse();
 }else if(env.FACTORY_REJECTED_LIVE_CONFIRMATION!=='ONE_REJECTED_PROPOSAL_AND_SUCCESSOR_MAX_8'||env.AGENT_FACTORY_PROJECT_LIVE_APPROVED!=='ONE_FREE_BOUNDED_RUN'||env.AGENT_FACTORY_ENABLE_GITHUB_WRITES!=='true'||env.AGENT_FACTORY_PROVIDER!=='groq'||env.GROQ_MODEL!=='openai/gpt-oss-120b'||!env.GROQ_API_KEY||!env.FACTORY_STATE_TOKEN||!env.GITHUB_TOKEN||!env.FACTORY_READ_TOKEN||!/^\d+$/.test(env.FACTORY_REJECTED_OWNER_COMMENT_ID??''))return refuse();
}

/** GET-only exact implementation CI check before loading the recovery secret.
 * No previous successful SHA, caller-provided PASS, provider readiness HTTP,
 * rerun or paginated/truncated result may authorize execution. */
async function verifyHostCi(env:NodeJS.ProcessEnv,token:string){
 const read=async(path:string)=>{const r=await fetch('https://api.github.com/repos/erman-ksv/Onay-Agents-Factory'+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token}});if(r.status!==200||r.headers.get('link'))return refuse();const text=await r.text();if(Buffer.byteLength(text)>1048576)return refuse();return JSON.parse(text);};
 const ref=await read('/git/ref/heads/fix/stage8-corrective-verification-20261029');if(ref.ref!=='refs/heads/fix/stage8-corrective-verification-20261029'||ref.object?.type!=='commit'||ref.object.sha!==env.FACTORY_HOST_SOURCE_SHA)return refuse();
 const runs=await read('/actions/runs?head_sha='+env.FACTORY_HOST_SOURCE_SHA+'&per_page=30');if(!Number.isSafeInteger(runs.total_count)||runs.total_count>30||!Array.isArray(runs.workflow_runs)||runs.workflow_runs.length!==runs.total_count)return refuse();
 const matching=runs.workflow_runs.filter((r:{name:string;path:string;head_sha:string;head_branch:string;event:string;run_attempt:number;status:string;conclusion:string})=>r.name==='Agent Factory CI'&&r.path==='.github/workflows/ci.yml'&&r.head_sha===env.FACTORY_HOST_SOURCE_SHA&&r.head_branch==='fix/stage8-corrective-verification-20261029'&&r.event==='push'&&r.run_attempt===1&&r.status==='completed'&&r.conclusion==='success');if(matching.length!==1)return refuse();
 const run=matching[0];if(!Number.isSafeInteger(run.id)||run.id<1)return refuse();const jobs=await read('/actions/runs/'+run.id+'/attempts/1/jobs?per_page=30');
 if(jobs.total_count!==1||jobs.jobs?.length!==1)return refuse();const job=jobs.jobs[0];if(job.head_sha!==env.FACTORY_HOST_SOURCE_SHA||job.conclusion!=='success'||job.status!=='completed'||!Array.isArray(job.steps))return refuse();
 for(const name of ['Install','Typecheck','Test']){const steps=job.steps.filter((s:{name:string})=>s.name===name);if(steps.length!==1||steps[0].status!=='completed'||steps[0].conclusion!=='success')return refuse();}
 return run.id as number;
}

export function preflightProjectRejectedProposalHost(cap:PreparedProjectRejectedProposalHost,env:NodeJS.ProcessEnv,directory:string){return run(cap,env,directory,'preflight');}
export function runProjectRejectedProposalHost(cap:PreparedProjectRejectedProposalHost,env:NodeJS.ProcessEnv,directory:string){return run(cap,env,directory,'live');}
async function run(cap:PreparedProjectRejectedProposalHost,environment:NodeJS.ProcessEnv,directory:string,mode:'preflight'|'live'){
 let key:ReturnType<typeof loadProjectRuntimeRecoveryKey>|undefined;
 try{
  const host=hosts.get(cap);if(!host||host.used)return refuse();host.used=true; // Atomic, before the first await; preflight is not a resumable permit.
  const env={...environment};assertProjectRejectedHostEnvironment(env,mode);const {config:c,context}=host;
  if(Date.now()>=Date.parse(c.expiresAt)||!isAbsolute(directory)||resolve(directory)!==directory||realpathSync(directory)!==directory)return refuse();
  const root=lstatSync(directory);const guard=()=>{const s=lstatSync(directory);if(!s.isDirectory()||(s.mode&0o777)!==0o700||s.ino!==root.ino||s.dev!==root.dev||process.getuid&&s.uid!==process.getuid()||realpathSync(directory)!==directory||Date.now()>=Date.parse(c.expiresAt))return refuse();};guard();if(readdirSync(directory).length)return refuse();
  const token=mode==='preflight'?env.FACTORY_INSPECTION_READ_TOKEN!:env.FACTORY_STATE_TOKEN!,readToken=mode==='preflight'?token:env.FACTORY_READ_TOKEN!;
  const ciRun=await verifyHostCi(env,readToken);
  const {plan,target,history,ciPolicy,taskPolicies}=context,identity=projectPlanBudgetIdentity(plan);
  env.AGENT_FACTORY_TARGET_PROFILE=registeredProjectTargetProfile(target).id;env.AGENT_ALLOWED_REPOSITORIES=plan.repository;
  // Prior decisions prove existing budget ancestry only. No old execution,
  // replacement or corrective admission is loaded, consumed or extended.
  const controllers=[];for(const decision of c.grantDecisions)controllers.push(await authorizeGitHubProjectBudget({identity,history,decision,token,targetProfile:target}));
  const controller=controllers.at(-1)!;if(controller.operationMode!=='development')return refuse();
  const store=createProjectModelBudgetGitHubStore({projectKey:controller.projectKey,token:readToken}),before=await store.read();
  const unchanged=async()=>{await controller.assertAuthorized();const saved=await store.read();if(!saved||saved.revision!==hash(c.budgetHead)||projectBudgetStateDigest(saved.data)!==c.binding.budgetStateSha256)return refuse();const state=await controller.inspect();for(const k of ['requests','requestBytes','reservedTokens'] as const)if(state.remaining[k]!==c.expectedRemaining[k])return refuse();guard();};await unchanged();
  if(!before)return refuse();const stateProtection=await prepareProjectStateProtection({controller,token:readToken}),lineage=await restoreGitHubDevelopmentGrantChain({controllers,transitions:c.grantTransitions,stateProtection,token:readToken});
  const archive=createProjectCheckpointArchive({controller,token,pin:{head:c.binding.archiveHead,sequence:c.binding.archiveSequence}});key=loadProjectRuntimeRecoveryKey(env);
  const snapshot=await loadGitHubProjectTaskSnapshot({plan,taskId:c.binding.taskId,token:readToken}),evidence=await inspectProjectRejectedProposal({plan,controller,archive,key,stateProtection,binding:c.binding},snapshot,readToken),admission=proposeProjectRejectedProposalAdmission(evidence,c.expiresAt);
  if(projectBudgetApprovalDigest(admission)!==c.ownerBodySha256)return refuse();
  const baseCi=await createProjectCiReader(ciPolicy,{...env,GITHUB_TOKEN:readToken})({repository:plan.repository,branch:plan.request.baseRef,candidateSha:plan.request.baseSha});if(baseCi.status!=='passed')return refuse();await unchanged();
  if(mode==='preflight'){
   if(JSON.stringify(await store.read())!==JSON.stringify(before))return refuse();
   return Object.freeze({status:'rejected-proposal-preflight-verified',ciRun,inspection:projectRejectedProposalInspection(evidence),ownerAdmissionDraft:admission,ownerBodySha256:c.ownerBodySha256,remaining:c.expectedRemaining,maxNewRequests:8,providerCalls:0,budgetWrites:0,archiveWrites:0,executionAuthorized:false,replayAuthorized:false});
  }
  const commentId=Number(env.FACTORY_REJECTED_OWNER_COMMENT_ID);if(!Number.isSafeInteger(commentId)||commentId<1||c.grantDecisions.some(d=>d.commentId===commentId))return refuse();
  const approval=await authorizeProjectRejectedProposal(evidence,{issueNumber:75,commentId,bodySha256:c.ownerBodySha256},readToken);
  // All budget pins rechecked before the sole durable CAS claim. If its ACK is
  // unknown, nothing below is retried; existing archive/ledger semantics apply.
  await unchanged();const ticket=await claimProjectRejectedProposal(approval);guard();
  env.AGENT_FACTORY_TARGET_PROFILE=registeredProjectTargetProfile(target).id;env.AGENT_ALLOWED_REPOSITORIES=plan.repository;
  const common={plan,controller,env,ciPolicy,taskPolicies,key,stateProtection,archive};
  const {createProjectRejectedProposalRecoveryRuntime}=await import('./projectNextTaskWorker.js');
  const {runProjectCiContinuation}=await import('./projectCiContinuation.js');
  const first=await createProjectRejectedProposalRecoveryRuntime({...common,directory:mkdtempSync(join(directory,'rejected-'))}).recover(ticket);guard();
  const result=await runProjectCiContinuation({...common,lineage,directory:mkdtempSync(join(directory,'ci-')),candidateSha:first.candidate.candidateSha,polling:{maxPolls:12,intervalMs:10000}});
  const used=(await controller.inspect()).used;
  return Object.freeze({status:result.status,firstCandidateSha:first.candidate.candidateSha,candidateSha:result.candidateSha,archivePin:result.archivePin,used,maxNewRequests:8,wholeProjectCompleted:false,executionAuthorized:false,replayAuthorized:false});
 }catch{return refuse();}finally{if(key)destroyProjectCorrectionRecoveryKey(key);}
}
