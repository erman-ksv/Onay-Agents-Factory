import {loadCalculatorRecoveryArtifact,type CalculatorRecoveryArtifactPin} from '../github/calculatorRecoveryArtifact.js';
import {createCalculatorSnapshotReader,loadCalculatorSnapshot} from '../github/calculatorSnapshot.js';
import {createCalculatorRecoveryGitHubClaim} from '../github/calculatorRecoveryClaim.js';
import {createCalculatorPlan} from './calculatorPlan.js';
import {prepareCalculatorRejectedProposalRecovery} from './calculatorRejectedProposalRecovery.js';
import type {CalculatorExecutionCheckpointIdentity} from './calculatorExecutionCheckpoint.js';
import {restoreCalculatorRecoveryState,type CalculatorRecoveryStateMapping} from './calculatorRecoveryState.js';
import {runGitHubProjectBudgetActivation} from './projectBudgetActivation.js';
import type {ProjectBudgetHistory} from './projectBudgetAuthorization.js';
export const CALCULATOR_RECOVERY_PREFLIGHT_ERROR='Recovery preflight unverified. Preserve state; no claim, initialization, model call or retry is authorized.';
const refuse=():never=>{throw Error(CALCULATOR_RECOVERY_PREFLIGHT_ERROR);};
const REPO='erman-ksv/Onay-Agents-Factory',APP='erman-ksv/Onay-Factory-Calculator';
type Source=Readonly<{artifact:CalculatorRecoveryArtifactPin;identity:CalculatorExecutionCheckpointIdentity;state:CalculatorRecoveryStateMapping}>;
export type CalculatorRecoveryPreflightRequest=Readonly<{version:1;operation:'preflight';historyDigest:string;source:Source|null}>;
/** Data-only host request, not a model tool. No owner approval, callbacks or
 * budget overrides can be smuggled into this bounded JSON envelope. */
export function prepareCalculatorRecoveryPreflightRequest(input:unknown):CalculatorRecoveryPreflightRequest{
 try{
  let nodes=0;const seen=new Set<object>();
  function inspect(v:unknown,depth:number){
   if(++nodes>2000||depth>16)return refuse();
   if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return;
   if(typeof v==='string'){if(v.length>4096)return refuse();return;}
   if(!v||typeof v!=='object'||seen.has(v)||Object.getOwnPropertySymbols(v).length||Object.getPrototypeOf(v)!==(Array.isArray(v)?Array.prototype:Object.prototype))return refuse();seen.add(v);
   const d=Object.getOwnPropertyDescriptors(v);if(Object.values(d).some(p=>!Object.hasOwn(p,'value')))return refuse();
   if(Array.isArray(v)&&Object.keys(v).length!==v.length)return refuse();for(const [key,p]of Object.entries(d)){if(Array.isArray(v)&&key==='length')continue;if(!p.enumerable)return refuse();inspect(p.value,depth+1);}
  }
  inspect(input,0);const text=JSON.stringify(input);if(Buffer.byteLength(text)>65536)return refuse();const r=JSON.parse(text);
  if(Object.keys(r).sort().join(',')!=='historyDigest,operation,source,version'||r.version!==1||r.operation!=='preflight'||typeof r.historyDigest!=='string'||!/^[a-f0-9]{64}$/.test(r.historyDigest))return refuse();
  if(r.source!==null&&(!r.source||Array.isArray(r.source)||Object.keys(r.source).sort().join(',')!=='artifact,identity,state'))return refuse();
  return Object.freeze(r);
 }catch{return refuse();}
}
type Options=Readonly<{request:unknown;ownerRequest:unknown;proposal:unknown;history:ProjectBudgetHistory;expectedHistoryDigest:string;
 runtimeSha:string;sourceCiRunId:number;directory:string;env:NodeJS.ProcessEnv;transport?:typeof fetch}>;
/** Concrete GET-only source/state/budget composition. Even a positive source
 * result is NOT ready to execute: collection completeness, owner/grant,
 * dependency tools, sandbox and atomic execution claim remain independent. */
export async function runCalculatorRecoveryPreflight(options:Options){
 try{
  const request=prepareCalculatorRecoveryPreflightRequest(options.request),env={...options.env},token=env.FACTORY_READ_TOKEN;
  const {runtimeSha,sourceCiRunId,directory,expectedHistoryDigest}=options;
  if(env.GITHUB_REPOSITORY!==REPO||env.GITHUB_RUN_ATTEMPT!=='1'||env.AGENT_FACTORY_LEGAL_ENABLED!=='false'||!token||request.historyDigest!==expectedHistoryDigest||
   !/^[a-f0-9]{40}$/.test(runtimeSha)||!Number.isSafeInteger(sourceCiRunId)||sourceCiRunId<1)return refuse();
  for(const key of ['GROQ_API_KEY','GEMINI_API_KEY','CLOUDFLARE_API_KEY','CLOUDFLARE_API_TOKEN','OPENAI_API_KEY','OPENROUTER_API_KEY','MISTRAL_API_KEY','FACTORY_STATE_TOKEN','CALCULATOR_GITHUB_TOKEN','FACTORY_BUDGET_TOKEN'])if(env[key]!==undefined)return refuse();
  const plan=createCalculatorPlan(options.ownerRequest,options.proposal),transport=options.transport??fetch;let reads=0;
  const readonly:typeof fetch=async(input,init)=>{
   if(init?.method!=='GET'||++reads>96)return refuse();const u=new URL(String(input));
   if(u.origin==='https://api.github.com'){if(![REPO,APP].some(repo=>u.pathname.startsWith('/repos/'+repo+'/')))return refuse();}
   else if(u.protocol!=='https:'||u.username||u.password||u.port||!['.blob.core.windows.net','.actions.githubusercontent.com'].some(s=>u.hostname.endsWith(s))||new Headers(init.headers).get('authorization'))return refuse();
   return transport(input,init);
  };
  const inspectBudget=()=>runGitHubProjectBudgetActivation({request:{version:1,operation:'inspect',historyDigest:request.historyDigest,ownerDecision:null},ownerRequest:plan.request,proposal:plan.proposal,history:options.history,expectedHistoryDigest:request.historyDigest,token,transport:readonly});
  let budget=await inspectBudget();
  const common={version:1 as const,operation:'preflight' as const,modelCalls:0 as const,githubWriteRequests:0 as const,executionAuthorized:false as const,publicationAuthorized:false as const,
   ownerApprovalVerified:false as const,sourceCollectionCompletenessVerified:false as const,dependencyAcceptanceVerified:false as const,sandboxVerified:false as const,legalEnabled:false as const};
  if(request.source===null)return Object.freeze({...common,status:'blocked-source-missing' as const,sourceVerified:false,ledgerPresent:budget.ledgerPresent,budgetStatus:budget.status,projectKey:budget.projectKey,historyDigest:budget.historyDigest,githubReads:reads});
  const source=request.source,task=plan.tasks.find(t=>t.id===source.state.taskId);if(!task||source.identity.taskId!==task.id||source.identity.bootstrapSha!==plan.owner.baseSha)return refuse();
  const artifact=await loadCalculatorRecoveryArtifact(source.artifact,env,readonly),checkpoint=source.artifact.files.find(f=>f.path===source.state.checkpointPath),receipt=source.state.receipts.find(r=>r.taskId===task.id);
  if(!checkpoint||!receipt)return refuse();const receiptPin=source.artifact.files.find(f=>f.path===receipt.path);if(!receiptPin)return refuse();
  const reader=createCalculatorSnapshotReader({AGENT_FACTORY_TARGET_PROFILE:'calculator',AGENT_ALLOWED_REPOSITORIES:APP,GITHUB_TOKEN:token},readonly);
  const snapshot=await loadCalculatorSnapshot({repository:APP,baseRef:plan.branch,baseSha:source.identity.baseSha,changePaths:task.paths},reader);
  const prepared=prepareCalculatorRejectedProposalRecovery({bytes:artifact.readPrivateFile(checkpoint.path),expectedSha256:checkpoint.sha256,identity:source.identity,plan,taskId:task.id,snapshot,model:'openai/gpt-oss-120b'});
  const binding=Object.freeze({checkpointSha256:checkpoint.sha256,receiptSha256:receiptPin.sha256,taskId:task.id,baseSha:source.identity.baseSha,executionId:prepared.metadata.executionId});
  // Only the readonly method is called; the guard rejects any write before HTTP.
  const claim=createCalculatorRecoveryGitHubClaim({planFingerprint:plan.fingerprint,runtimeSha,sourceCiRunId,binding},{...env,FACTORY_STATE_TOKEN:token},readonly);
  if(!await claim.inspectReady())return refuse();
  const state=await restoreCalculatorRecoveryState(artifact,source.state,plan.request,directory);if(state.planFingerprint!==plan.fingerprint)return refuse();
  await artifact.assertRemote();if(await reader.getHead(plan.branch)!==source.identity.baseSha||!await claim.inspectReady())return refuse();budget=await inspectBudget();
  return Object.freeze({...common,status:'source-verified-execution-checks-pending' as const,sourceVerified:true,taskId:task.id,baseSha:source.identity.baseSha,planFingerprint:plan.fingerprint,checkpointSha256:checkpoint.sha256,
   remoteClaimAbsentAtCheck:true as const,runtimeCiVerified:true as const,ledgerPresent:budget.ledgerPresent,budgetStatus:budget.status,projectKey:budget.projectKey,historyDigest:budget.historyDigest,githubReads:reads});
 }catch{return refuse();}
}
