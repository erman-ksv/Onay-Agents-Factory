import {createHash} from 'node:crypto';
import {prepareProjectRuntimeManifest,projectRuntimeManifestMetadata,projectRuntimeManifestInspectionContext} from './projectRuntimeManifest.js';
import {authorizeGitHubProjectBudget} from './projectBudgetAuthorization.js';
import {projectPlanBudgetIdentity} from './projectPlan.js';
import {registeredProjectTargetProfile} from './projectTargetRegistry.js';
import {prepareProjectStateProtection} from '../github/projectStateProtection.js';
import {createProjectCheckpointArchive} from '../github/projectCheckpointArchive.js';
import {createProjectCiReader} from '../github/projectCi.js';
import {loadProjectRuntimeRecoveryKey} from './projectRuntimeRecovery.js';
import {destroyProjectCorrectionRecoveryKey} from './projectCorrectionCheckpoint.js';
import {inspectProjectUncertainRecovery} from './projectUncertainRecoveryClaim.js';
const refuse=():never=>{throw Error('Pinned recovery preflight refused. No task start, allowance, archive write or provider request is authorized.');};
const exact=(v:any,keys:string[])=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const sha=(v:unknown,n:number)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
declare const brand:unique symbol;export type PreparedProjectRecoveryPreflight=Readonly<{[brand]:true}>;
const records=new WeakMap<object,{context:ReturnType<typeof projectRuntimeManifestInspectionContext>;binding:Parameters<typeof inspectProjectUncertainRecovery>[0]['binding'];budgetHead:string;used:boolean}>();
/** Both configuration layers are fixed by the outer host digest. Reusing the
 * reviewed task policies does not reuse the first-task bootstrap or its claim. */
export function prepareProjectRecoveryPreflight(body:string,expectedSha256:string,runtimeBody:string):PreparedProjectRecoveryPreflight{try{
 if(typeof body!=='string'||Buffer.byteLength(body)>8192||!sha(expectedSha256,64)||createHash('sha256').update(body).digest('hex')!==expectedSha256)return refuse();const v=JSON.parse(body);
 if(!exact(v,['version','kind','runtimeManifestSha256','budgetHead','binding'])||v.version!==1||v.kind!=='inspect-uncertain-recovery'||!sha(v.runtimeManifestSha256,64)||!sha(v.budgetHead,40)||!exact(v.binding,['taskId','archiveHead','archiveSequence','budgetStateSha256','originalRequestSha256'])||!sha(v.binding.archiveHead,40)||v.binding.archiveSequence!==2||!sha(v.binding.budgetStateSha256,64)||!sha(v.binding.originalRequestSha256,64))return refuse();
 const runtime=prepareProjectRuntimeManifest(runtimeBody,v.runtimeManifestSha256),metadata=projectRuntimeManifestMetadata(runtime),context=projectRuntimeManifestInspectionContext(runtime);
 if(metadata.mode!=='first-task'||context.plan.tasks.length!==2||v.binding.taskId!==context.plan.tasks[0]?.id)return refuse();
 const cap=Object.freeze({}) as PreparedProjectRecoveryPreflight;records.set(cap,{context,binding:Object.freeze({...v.binding}),budgetHead:v.budgetHead,used:false});return cap;
}catch{return refuse();}}
/** Native GET-only composition over the existing ledger and encrypted archive.
 * Deliberately has no OWNER recovery decision, extension, claim or worker API. */
export async function runProjectRecoveryPreflight(cap:PreparedProjectRecoveryPreflight,environment:NodeJS.ProcessEnv){let key:ReturnType<typeof loadProjectRuntimeRecoveryKey>|undefined;try{
 const r=records.get(cap);if(!r||r.used)return refuse();r.used=true;const env={...environment};
 if(env.GITHUB_REPOSITORY!=='erman-ksv/Onay-Agents-Factory'||env.GITHUB_RUN_ATTEMPT!=='1'||env.AGENT_FACTORY_LEGAL_ENABLED!=='false'||env.ONAY_TEAM_FREE_TIER_CONFIRMED!=='true'||['GROQ_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY','OPENROUTER_API_KEY','CLOUDFLARE_API_KEY'].some(k=>env[k]!==undefined))return refuse();
 const token=env.FACTORY_STATE_TOKEN;if(!token)return refuse();const {plan,target,history,decision,ciPolicy}=r.context;
 const controller=await authorizeGitHubProjectBudget({identity:projectPlanBudgetIdentity(plan),history,decision,token,targetProfile:target});
 const stateProtection=await prepareProjectStateProtection({controller,token:env.FACTORY_READ_TOKEN||token}),archive=createProjectCheckpointArchive({controller,token,pin:{head:r.binding.archiveHead,sequence:r.binding.archiveSequence}});
 key=loadProjectRuntimeRecoveryKey(env);
 const ci=await createProjectCiReader(ciPolicy,{...env,GITHUB_TOKEN:env.GITHUB_TOKEN||token,AGENT_FACTORY_TARGET_PROFILE:registeredProjectTargetProfile(target).id,AGENT_ALLOWED_REPOSITORIES:plan.repository})({repository:plan.repository,branch:plan.request.baseRef,candidateSha:plan.request.baseSha});if(ci.status!=='passed')return refuse();
 const result=await inspectProjectUncertainRecovery({controller,binding:r.binding,archive,key,stateProtection,token});if(result.baseSha!==plan.request.baseSha||result.budgetRevision!==createHash('sha256').update(r.budgetHead).digest('hex'))return refuse();
 return Object.freeze({...result,baseCi:'passed' as const,wholeProjectCompleted:false as const});
}catch{return refuse();}finally{if(key)destroyProjectCorrectionRecoveryKey(key);}}
