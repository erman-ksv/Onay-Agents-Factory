import {createHash} from 'node:crypto';import {lstatSync,realpathSync,readdirSync,mkdtempSync} from 'node:fs';import {isAbsolute,resolve,join} from 'node:path';
import {prepareProjectRuntimeManifest,projectRuntimeManifestInspectionContext} from './projectRuntimeManifest.js';
import {prepareProjectRecoveryPreflight} from './projectRecoveryPreflight.js';
import {projectPlanBudgetIdentity} from './projectPlan.js';
import {authorizeGitHubProjectBudget,type ProjectOwnerDecision} from './projectBudgetAuthorization.js';
import {registeredProjectTargetProfile} from './projectTargetRegistry.js';
import {projectBudgetStateDigest,inspectProjectDevelopmentBudgetExtension} from './projectBudgetExtensionAuthorization.js';
import {extendGitHubProjectDevelopmentBudgetWithLineage} from './projectGrantLineage.js';
import {authorizeProjectUncertainRecovery,verifyProjectUncertainRecoveryApproval} from './projectUncertainRecoveryApproval.js';
import {inspectProjectUncertainRecovery,prepareProjectUncertainRecoveryClaim} from './projectUncertainRecoveryClaim.js';
import {createProjectUncertainRecoveryRuntime} from './projectNextTaskWorker.js';
import {runProjectCiContinuation} from './projectCiContinuation.js';
import {loadProjectRuntimeRecoveryKey} from './projectRuntimeRecovery.js';
import {destroyProjectCorrectionRecoveryKey} from './projectCorrectionCheckpoint.js';
import {createProjectModelBudgetGitHubStore} from '../github/projectModelBudgetStore.js';
import {createProjectCheckpointArchive} from '../github/projectCheckpointArchive.js';
import {prepareProjectStateProtection,verifyProjectStateProtection} from '../github/projectStateProtection.js';
import {createProjectCiReader} from '../github/projectCi.js';
const refuse=():never=>{throw Error('Uncertain recovery host stopped. Preserve every grant, claim and charge; no automatic retry or original replay is authorized.');};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const exact=(v:any,keys:string[])=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const sha=(v:unknown,n:number)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
const decision=(v:any)=>exact(v,['issueNumber','commentId','bodySha256'])&&v.issueNumber===75&&Number.isSafeInteger(v.commentId)&&v.commentId>0&&sha(v.bodySha256,64);
declare const brand:unique symbol;export type PreparedProjectUncertainRecoveryHost=Readonly<{[brand]:true}>;
type RecordHost={context:ReturnType<typeof projectRuntimeManifestInspectionContext>;beforeBinding:Parameters<typeof inspectProjectUncertainRecovery>[0]['binding'];beforeHead:string;extensionDecision:ProjectOwnerDecision;recoveryDecision:ProjectOwnerDecision;used:boolean};
const records=new WeakMap<object,RecordHost>();
/** Exact host scope, not an activation marker. Both actual OWNER comment pins
 * are required; a proposal or zero placeholder cannot authorize a native run. */
export function prepareProjectUncertainRecoveryHost(body:string,expectedSha256:string,runtimeBody:string,preflightBody:string):PreparedProjectUncertainRecoveryHost{try{
 if(typeof body!=='string'||Buffer.byteLength(body)>8192||!sha(expectedSha256,64)||hash(body)!==expectedSha256)return refuse();const v=JSON.parse(body);
 if(!exact(v,['version','kind','runtimeManifestSha256','preflightSha256','extensionDecision','recoveryDecision'])||v.version!==1||v.kind!=='extend-and-recover-uncertain-task'||!sha(v.runtimeManifestSha256,64)||!sha(v.preflightSha256,64)||!decision(v.extensionDecision)||!decision(v.recoveryDecision)||v.extensionDecision.commentId===v.recoveryDecision.commentId)return refuse();
 prepareProjectRecoveryPreflight(preflightBody,v.preflightSha256,runtimeBody);const preflight=JSON.parse(preflightBody);if(preflight.runtimeManifestSha256!==v.runtimeManifestSha256)return refuse();
 const context=projectRuntimeManifestInspectionContext(prepareProjectRuntimeManifest(runtimeBody,v.runtimeManifestSha256));
 if(v.extensionDecision.commentId===context.decision.commentId||v.recoveryDecision.commentId===context.decision.commentId||v.extensionDecision.bodySha256===context.decision.bodySha256||v.recoveryDecision.bodySha256===v.extensionDecision.bodySha256)return refuse();
 const cap=Object.freeze({}) as PreparedProjectUncertainRecoveryHost;records.set(cap,{context,beforeBinding:Object.freeze({...preflight.binding}),beforeHead:preflight.budgetHead,extensionDecision:Object.freeze({...v.extensionDecision}),recoveryDecision:Object.freeze({...v.recoveryDecision}),used:false});return cap;
}catch{return refuse();}}
/** Fixed native composition. No injected model/Git/ledger/callback, no ledger
 * initialization, key rotation, old first-task path or extension write retry. */
export async function runProjectUncertainRecoveryHost(cap:PreparedProjectUncertainRecoveryHost,environment:NodeJS.ProcessEnv,directory:string){let key:ReturnType<typeof loadProjectRuntimeRecoveryKey>|undefined;try{
 const r=records.get(cap);if(!r||r.used)return refuse();r.used=true;const env={...environment};
 if(env.GITHUB_REPOSITORY!=='erman-ksv/Onay-Agents-Factory'||env.GITHUB_RUN_ATTEMPT!=='1'||env.AGENT_FACTORY_LEGAL_ENABLED!=='false'||env.ONAY_TEAM_FREE_TIER_CONFIRMED!=='true'||env.AGENT_FACTORY_PROJECT_LIVE_APPROVED!=='ONE_FREE_BOUNDED_RUN'||env.AGENT_FACTORY_ENABLE_GITHUB_WRITES!=='true'||env.AGENT_FACTORY_PROVIDER!=='groq'||env.GROQ_MODEL!=='qwen/qwen3-32b'||!env.GROQ_API_KEY||!env.GITHUB_TOKEN||!env.FACTORY_STATE_TOKEN)return refuse();
 if(!isAbsolute(directory)||resolve(directory)!==directory||realpathSync(directory)!==directory)return refuse();const root=lstatSync(directory);
 const guardRoot=()=>{const s=lstatSync(directory);if(!s.isDirectory()||s.ino!==root.ino||s.dev!==root.dev||(s.mode&0o777)!==0o700||process.getuid&&s.uid!==process.getuid()||realpathSync(directory)!==directory)return refuse();};guardRoot();if(readdirSync(directory).length)return refuse();
 const {plan,target,history,decision:oldDecision,ciPolicy,taskPolicies}=r.context,identity=projectPlanBudgetIdentity(plan),token=env.FACTORY_STATE_TOKEN!,rulesToken=env.FACTORY_READ_TOKEN||token;
 env.AGENT_FACTORY_TARGET_PROFILE=registeredProjectTargetProfile(target).id;env.AGENT_ALLOWED_REPOSITORIES=plan.repository;
 const previous=await authorizeGitHubProjectBudget({identity,history,decision:oldDecision,token,targetProfile:target}),store=createProjectModelBudgetGitHubStore({projectKey:previous.projectKey,token}),saved=await store.read();
 if(!saved||saved.revision!==hash(r.beforeHead)||projectBudgetStateDigest(saved.data)!==r.beforeBinding.budgetStateSha256)return refuse();
 const oldProtection=await prepareProjectStateProtection({controller:previous,token:rulesToken}),oldArchive=createProjectCheckpointArchive({controller:previous,token,pin:{head:r.beforeBinding.archiveHead,sequence:2}});key=loadProjectRuntimeRecoveryKey(env);
 const ci=await createProjectCiReader(ciPolicy,env)({repository:plan.repository,branch:plan.request.baseRef,candidateSha:plan.request.baseSha});if(ci.status!=='passed')return refuse();
 const inspection=await inspectProjectUncertainRecovery({controller:previous,binding:r.beforeBinding,archive:oldArchive,key,stateProtection:oldProtection,token});if(inspection.baseSha!==plan.request.baseSha||inspection.budgetRevision!==saved.revision)return refuse();
 const next=await authorizeGitHubProjectBudget({identity,history,decision:r.extensionDecision,token,targetProfile:target}),extension=inspectProjectDevelopmentBudgetExtension(previous,saved.data,next.grant),binding=Object.freeze({...r.beforeBinding,budgetStateSha256:projectBudgetStateDigest(extension.newState)});
 // Verify both decisions, the key/archive and base CI BEFORE the first write.
 const approval=await authorizeProjectUncertainRecovery({controller:next,binding,decision:r.recoveryDecision,token}),stateProtection=await prepareProjectStateProtection({controller:next,token:rulesToken});
 await verifyProjectUncertainRecoveryApproval(approval,next,binding,'native');await verifyProjectStateProtection(oldProtection,previous,'native');guardRoot();
 const lineage=await extendGitHubProjectDevelopmentBudgetWithLineage({previous,next,expectedRevision:saved.revision,state:saved.data as Parameters<typeof extendGitHubProjectDevelopmentBudgetWithLineage>[0]['state'],token});
 const archive=createProjectCheckpointArchive({controller:next,token,pin:{head:binding.archiveHead,sequence:2}});guardRoot();
 const ticket=await prepareProjectUncertainRecoveryClaim({controller:next,approval,binding,archive,key,stateProtection,lineage,token});guardRoot();
 const common={plan,controller:next,env,ciPolicy,taskPolicies,key,stateProtection,archive},runtime=createProjectUncertainRecoveryRuntime({...common,directory:mkdtempSync(join(directory,'recovery-'))}),first=await runtime.recover(ticket);guardRoot();
 const result=await runProjectCiContinuation({...common,lineage,directory:mkdtempSync(join(directory,'ci-')),candidateSha:first.candidate.candidateSha,polling:{maxPolls:12,intervalMs:10000}});
 return Object.freeze({status:result.status,firstCandidateSha:first.candidate.candidateSha,candidateSha:result.candidateSha,archivePin:result.archivePin,used:(await next.inspect()).used,originalReplay:false as const,wholeProjectCompleted:false as const});
}catch{return refuse();}finally{if(key)destroyProjectCorrectionRecoveryKey(key);}}
