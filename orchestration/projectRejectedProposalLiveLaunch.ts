import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {projectBudgetApprovalDigest} from './projectBudgetAuthorization.js';
import {projectBudgetStateDigest} from './projectBudgetExtensionAuthorization.js';
import {parseProjectModelBudgetState} from './projectModelBudget.js';
import {prepareProjectRejectedProposalHost} from './projectRejectedProposalHost.js';

const refuse=():never=>{throw Error('Live launch refused. No provider call, claim, budget change, replay or automatic renewal authorized.');};
export const REJECTED_LIVE_PINS=Object.freeze({repository:'erman-ksv/Onay-Agents-Factory',branch:'fix/stage8-corrective-verification-20261029',hostBaseSha:'90b204bfebcf4d412583a7e2e8e8ddb33eec79e8',workflowPath:'.github/workflows/stage8-rejected-proposal-live.yml',hostScopeSha256:'4729e4ae37cbf1341bf7445625ab940c87a890318ece1ff59349176b94325d44',runtimeManifestSha256:'97a2b05c8aebcb11227230b0526375bea9aa45688d2b6b01ece2fe2dd6b77284',recoveryBodySha256:'32d1809679fc5f4b88ae5d21314e472e3cd3925cc5f492a02c3b2d1314cd5549',projectKey:'abb7eb35a69bf638cb5b57278226170e2f6b02fd039344c29044014531ca5a0b',grantSha256:'4f8b196f3a36af4b05c3417d8659d8e3209eb43efef127df14c9dea89756b293',expiresAt:'2026-10-30T23:59:59.000Z'});
export const REJECTED_LIVE_FILES=Object.freeze([
 '.github/workflows/stage8-rejected-proposal-live.yml',
 'orchestration/projectRejectedProposalLiveLaunch.ts',
 'orchestration/projectRejectedProposalLiveLaunch.test.ts',
 'config/fixtures/projectRejectedLiveState.json',
 'docs/rejected-proposal-live-20261030/OWNER-recovery-DRAFT.json',
 'docs/rejected-proposal-live-20261030/OWNER-launch-DRAFT.json',
 'docs/rejected-proposal-live-20261030/README_RU.md',
]);
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');

function policies(){
 const hostBody=readFileSync('.factory/rejected-proposal-host.json','utf8'),runtime=readFileSync('.factory/runtime-project-manifest.json','utf8');
 // Recreate only policy DATA/capability; never run Host or authorize a task.
 prepareProjectRejectedProposalHost(hostBody,REJECTED_LIVE_PINS.hostScopeSha256,runtime);
 if(hash(runtime)!==REJECTED_LIVE_PINS.runtimeManifestSha256)return refuse();
 return {host:JSON.parse(hostBody),runtime:JSON.parse(runtime)};
}

/** Exact launch-time OWNER document, separate from the existing four-request
 * recovery admission. Missing future publication SHA/comment ID is not valid. */
export function proposeRejectedLiveLaunch(sourceSha:string,recoveryCommentId:number){
 if(!sha(sourceSha)||sourceSha===REJECTED_LIVE_PINS.hostBaseSha||!positive(recoveryCommentId))return refuse();
 const {host:c}=policies();
 return Object.freeze({version:1,kind:'authorize-stage8-rejected-proposal-live-launch',repository:REJECTED_LIVE_PINS.repository,branch:REJECTED_LIVE_PINS.branch,sourceSha,hostBaseSha:REJECTED_LIVE_PINS.hostBaseSha,workflowPath:REJECTED_LIVE_PINS.workflowPath,hostScopeSha256:REJECTED_LIVE_PINS.hostScopeSha256,runtimeManifestSha256:REJECTED_LIVE_PINS.runtimeManifestSha256,projectKey:REJECTED_LIVE_PINS.projectKey,budgetHead:c.budgetHead,budgetStateSha256:c.binding.budgetStateSha256,budgetGrantSha256:REJECTED_LIVE_PINS.grantSha256,archiveHead:c.binding.archiveHead,archiveSequence:c.binding.archiveSequence,checkpointSha256:c.binding.checkpointSha256,baseSha:c.binding.baseSha,newExecutionId:'project-run-2d43cb3c8c822b8f45adc66c17874408',recoveryOwnerDecision:{issueNumber:75,commentId:recoveryCommentId,bodySha256:REJECTED_LIVE_PINS.recoveryBodySha256},expectedUsed:{requests:71,requestBytes:655866,reservedTokens:281875},expectedRemaining:c.expectedRemaining,maxNewRequests:8,maxTotalRequestBytes:96000,maxReservedTokens:48000,additionalCorrections:0,replayAuthorized:false,budgetIncreaseAuthorized:false,mergeAuthorized:false,deploymentAuthorized:false,legalEnabled:false,expiresAt:c.expiresAt});
}

export function assertRejectedLiveDispatch(env:NodeJS.ProcessEnv,now=Date.now()){
 const p=REJECTED_LIVE_PINS;
 if(!Number.isFinite(now)||now>=Date.parse(p.expiresAt)||env.GITHUB_REPOSITORY!==p.repository||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.GITHUB_REF!=='refs/heads/'+p.branch||env.GITHUB_RUN_ATTEMPT!=='1'||env.GITHUB_ACTOR!=='erman-ksv'||env.GITHUB_TRIGGERING_ACTOR!=='erman-ksv'||env.GITHUB_WORKFLOW_REF!==p.repository+'/'+p.workflowPath+'@refs/heads/'+p.branch||!sha(env.LAUNCH_SOURCE_SHA)||env.LAUNCH_SOURCE_SHA===p.hostBaseSha||env.GITHUB_SHA!==env.LAUNCH_SOURCE_SHA||env.LAUNCH_CONFIRMATION!=='ONE_REJECTED_PROPOSAL_AND_SUCCESSOR_MAX_8'||![env.LAUNCH_RECOVERY_OWNER_COMMENT_ID,env.LAUNCH_OWNER_COMMENT_ID].every(s=>typeof s==='string'&&/^[1-9][0-9]*$/.test(s)&&positive(Number(s)))||env.LAUNCH_RECOVERY_OWNER_COMMENT_ID===env.LAUNCH_OWNER_COMMENT_ID)return refuse();
 // Metadata gate runs BEFORE credentials for key/provider/state writes exist.
 for(const key of ['GROQ_API_KEY','GEMINI_API_KEY','CLOUDFLARE_API_KEY','FACTORY_STATE_TOKEN','FACTORY_RECOVERY_KEY_BASE64','AGENT_FACTORY_ENABLE_GITHUB_WRITES','AGENT_FACTORY_PROJECT_LIVE_APPROVED'])if(env[key]!==undefined)return refuse();
}

export function assertRejectedLiveDiff(lines:string){
 const changes=lines.trim().split('\n').filter(Boolean);
 if(changes.length!==REJECTED_LIVE_FILES.length||new Set(changes).size!==changes.length||changes.some(line=>!REJECTED_LIVE_FILES.some(p=>line==='A\t'+p)))return refuse();
}
function checkout(env:NodeJS.ProcessEnv){
 const git=(args:string[])=>execFileSync('/usr/bin/git',args,{encoding:'utf8',timeout:10000}).trim();
 if(git(['rev-parse','HEAD'])!==env.LAUNCH_SOURCE_SHA||git(['status','--porcelain','--untracked-files=all','--','.',':(exclude)node_modules']))return refuse();
 execFileSync('/usr/bin/git',['merge-base','--is-ancestor',REJECTED_LIVE_PINS.hostBaseSha,env.LAUNCH_SOURCE_SHA!],{timeout:10000});
 assertRejectedLiveDiff(git(['diff','--name-status',REJECTED_LIVE_PINS.hostBaseSha,env.LAUNCH_SOURCE_SHA!]));
}

/** OWNER metadata/body checker is DATA verification only, never a permit.
 * Exact digest rejects extra fields, old recovery kinds and edited approvals. */
export function inspectRejectedLiveOwner(c:any,id:number,expected:unknown,now:number,notBefore=0){
 const body=JSON.parse(c.body),created=Date.parse(c.created_at),expires=Date.parse(body.expiresAt);
 if(c.id!==id||c.user?.login!=='erman-ksv'||c.user?.type!=='User'||c.author_association!=='OWNER'||c.created_at!==c.updated_at||c.issue_url!=='https://api.github.com/repos/'+REJECTED_LIVE_PINS.repository+'/issues/75'||!['pull','issues'].some(p=>c.html_url==='https://github.com/'+REJECTED_LIVE_PINS.repository+'/'+p+'/75#issuecomment-'+id)||!Number.isFinite(created)||created<notBefore||created>now+300000||!Number.isFinite(expires)||expires<=now||expires>created+7*86400000||expires>now+7*86400000||projectBudgetApprovalDigest(body)!==projectBudgetApprovalDigest(expected))return refuse();
 return Object.freeze({createdAt:created,bodySha256:projectBudgetApprovalDigest(body),executionAuthorized:false});
}

export function inspectRejectedLiveBudget(input:unknown){
 const {host:c}=policies(),s=parseProjectModelBudgetState(input);
 if(s.grantSha256!==REJECTED_LIVE_PINS.grantSha256||projectBudgetStateDigest(s)!==c.binding.budgetStateSha256)return refuse();
 const used={requests:65,requestBytes:626530,reservedTokens:263359};for(const r of s.reservations){used.requests++;used.requestBytes+=r.requestBytes;used.reservedTokens+=r.reservedTokens;}
 if(used.requests!==71||used.requestBytes!==655866||used.reservedTokens!==281875)return refuse();
 return Object.freeze({used,remaining:c.expectedRemaining,maxNewRequests:8,executionAuthorized:false});
}

/** Fixed GitHub GET adapter. No retries, arbitrary URLs, provider transport,
 * write credentials or mutation endpoints. Native Host performs fresh complete
 * OWNER/lineage/evidence/CAS checks again after this launch-time gate. */
export async function verifyRejectedLiveLaunch(env:NodeJS.ProcessEnv){
 assertRejectedLiveDispatch(env);checkout(env);return metadata(env,fetch,'native-github');
}
/** Returns simulated DATA only. Cannot create/consume Host, OWNER approval,
 * task scope, claim or permit; production never accepts this transport. */
export function verifyRejectedLiveMetadataForTests(env:NodeJS.ProcessEnv,transport:typeof fetch,clock=Date.now){return metadata(env,transport,'simulated',clock);}
async function metadata(env:NodeJS.ProcessEnv,transport:typeof fetch,provenance:'native-github'|'simulated',clock=Date.now){
 assertRejectedLiveDispatch(env,clock());const token=env.FACTORY_LAUNCH_READ_TOKEN;if(!token)return refuse();
 const started=performance.now();let gets=0;
 const read=async(path:string):Promise<any>=>{
  if(++gets>12||performance.now()-started>120000)return refuse();
  const r=await transport('https://api.github.com/repos/'+REJECTED_LIVE_PINS.repository+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token}});
  if(r.status!==200||!r.body||r.headers.get('link'))return refuse();const reader=r.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1048576){await reader.cancel();return refuse();}parts.push(part.value);}}finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
 };
 const ref=async(branch:string,expected:string)=>{const r=await read('/git/ref/heads/'+encodeURIComponent(branch));if(r.ref!=='refs/heads/'+branch||r.object?.type!=='commit'||r.object.sha!==expected)return refuse();};
 const content=(v:any,max:number)=>{if(v.type!=='file'||v.encoding!=='base64'||typeof v.content!=='string')return refuse();const encoded=v.content.replace(/\r?\n/g,''),b=Buffer.from(encoded,'base64');if(b.length>max||b.toString('base64')!==encoded||createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex')!==v.sha)return refuse();return JSON.parse(b.toString('utf8'));};
 const {host:c}=policies(),source=env.LAUNCH_SOURCE_SHA!,recoveryId=Number(env.LAUNCH_RECOVERY_OWNER_COMMENT_ID),launchId=Number(env.LAUNCH_OWNER_COMMENT_ID),draft=proposeRejectedLiveLaunch(source,recoveryId);
 await ref(REJECTED_LIVE_PINS.branch,source);
 const all=await read('/actions/runs?head_sha='+source+'&per_page=30');if(!Number.isSafeInteger(all.total_count)||all.total_count>30||all.workflow_runs?.length!==all.total_count)return refuse();
 const runs=all.workflow_runs.filter((r:any)=>r.name==='Agent Factory CI'&&r.path==='.github/workflows/ci.yml'&&r.head_sha===source&&r.head_branch===REJECTED_LIVE_PINS.branch&&r.event==='push'&&r.run_attempt===1&&r.status==='completed'&&r.conclusion==='success');if(runs.length!==1||!positive(runs[0].id)||!Number.isFinite(Date.parse(runs[0].updated_at)))return refuse();
 const ci=runs[0],jobs=await read('/actions/runs/'+ci.id+'/attempts/1/jobs?per_page=30');if(jobs.total_count!==1||jobs.jobs?.length!==1)return refuse();const job=jobs.jobs[0];if(job.head_sha!==source||job.status!=='completed'||job.conclusion!=='success'||!Array.isArray(job.steps))return refuse();
 for(const name of ['Install','Typecheck','Test']){const steps=job.steps.filter((s:any)=>s.name===name);if(steps.length!==1||steps[0].status!=='completed'||steps[0].conclusion!=='success')return refuse();}
 const recovery=await read('/issues/comments/'+recoveryId),recoveryBody=JSON.parse(recovery.body);
 if(projectBudgetApprovalDigest(recoveryBody)!==REJECTED_LIVE_PINS.recoveryBodySha256)return refuse();
 const recovered=inspectRejectedLiveOwner(recovery,recoveryId,recoveryBody,clock(),Date.parse(ci.updated_at));
 const launch=await read('/issues/comments/'+launchId);inspectRejectedLiveOwner(launch,launchId,draft,clock(),recovered.createdAt);
 await ref('state/project-model-budget/'+REJECTED_LIVE_PINS.projectKey,c.budgetHead);
 const budget=inspectRejectedLiveBudget(content(await read('/contents/project-model-budget.json?ref='+c.budgetHead),262144));
 await ref('state/project-checkpoints/'+REJECTED_LIVE_PINS.projectKey,c.binding.archiveHead);
 const event=content(await read('/contents/encrypted-checkpoint.json?ref='+c.binding.archiveHead),524288);
 if(event.projectKey!==REJECTED_LIVE_PINS.projectKey||event.sequence!==13||event.kind!=='reply-rejected'||event.taskId!==c.binding.taskId||event.sha256!==c.binding.checkpointSha256||typeof event.ciphertextBase64!=='string'||hash(Buffer.from(event.ciphertextBase64,'base64'))!==c.binding.checkpointSha256)return refuse();
 // A second immutable-source read rejects branch movement during metadata checks.
 await ref(REJECTED_LIVE_PINS.branch,source);assertRejectedLiveDispatch(env,clock());
 return Object.freeze({status:'live-launch-metadata-verified',provenance,sourceSha:source,ciRun:ci.id,ownerLaunchBodySha256:projectBudgetApprovalDigest(draft),recoveryOwnerCommentId:recoveryId,launchOwnerCommentId:launchId,budget,metadataGetRequests:gets,providerCalls:0,budgetWrites:0,archiveWrites:0,executionAuthorized:false});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length===5&&process.argv[2]==='--draft')console.log(JSON.stringify(proposeRejectedLiveLaunch(process.argv[3]!,Number(process.argv[4])),null,2));
  else if(process.argv.length===3&&process.argv[2]==='--verify')console.log(JSON.stringify(await verifyRejectedLiveLaunch(process.env)));
  else refuse();
 }catch{console.error('Live-launch metadata check refused; no execution or retry authorized.');process.exitCode=1;}
}
