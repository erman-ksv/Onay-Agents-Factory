import {createHash} from 'node:crypto';
import {isAuthorizedProjectBudgetController,projectBudgetApprovalDigest,type AuthorizedProjectBudgetController,type ProjectOwnerDecision} from './projectBudgetAuthorization.js';
import {inspectProjectCorrection,type PreparedProjectCorrection} from './projectModelContext.js';
import type {PreparedProjectPlan} from './projectPlan.js';

const refuse=():never=>{throw Error('Corrective admission requires a separate, current OWNER decision. No replay, allowance increase or second correction is authorized.');};
const id=(plan:PreparedProjectPlan,taskId:string)=>'project-run-'+createHash('sha256').update(JSON.stringify([plan.fingerprint,taskId,'correction-1'])).digest('hex').slice(0,32);
export type ProjectFirstExecution=Readonly<{taskId:string;executionId:string}>;
type Options=Readonly<{plan:PreparedProjectPlan;controller:AuthorizedProjectBudgetController;decision:ProjectOwnerDecision;firstExecutions:readonly ProjectFirstExecution[];model:'openai/gpt-oss-120b';token:string}>;
function policy(o:Options){
 const {plan,controller,firstExecutions}=o;
 if(!isAuthorizedProjectBudgetController(controller)||controller.operationMode!=='development'||controller.identity.planFingerprint!==plan.fingerprint||controller.targetProfileSha256!==plan.targetProfileSha256||o.model!=='openai/gpt-oss-120b'||firstExecutions.length!==plan.tasks.length||!plan.tasks.length||plan.tasks.length>16)return refuse();
 const executions=firstExecutions.map((v,i)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join(',')!=='executionId,taskId'||v.taskId!==plan.tasks[i]!.id||!/^project-run-[a-f0-9]{32}$/.test(v.executionId)||v.executionId===id(plan,v.taskId))return refuse();return Object.freeze({...v});});
 if(new Set(executions.map(v=>v.executionId)).size!==executions.length)return refuse();
 return {version:1,kind:'authorize-project-corrective-loop',projectKey:controller.projectKey,planFingerprint:plan.fingerprint,targetProfileSha256:plan.targetProfileSha256,budgetGrantSha256:controller.grantSha256,model:o.model,firstExecutions:executions,maxAdditionalAttemptsPerTask:1,maxRequestsPerCorrection:4,maxTotalAdditionalRequests:4*plan.tasks.length,evidenceKinds:['independent-review-failure','native-node-test-failure'],requestPolicy:{reasoningEffort:'low',responseFormat:'json_object',maxOutputTokens:1200},legalEnabled:false,replayAuthorized:false};
}
/** Proposal DATA only. It neither spends budget nor creates an admission. */
export function proposeProjectCorrectiveAuthorization(o:Options,expiresAt:string){return Object.freeze({...policy(o),expiresAt});}
declare const authorizationBrand:unique symbol;
export type ProjectCorrectiveAuthorization=Readonly<{[authorizationBrand]:true}>;
declare const permitBrand:unique symbol;
export type ProjectCorrectiveTaskPermit=Readonly<{[permitBrand]:true}>;
type Authorization={plan:PreparedProjectPlan;controller:AuthorizedProjectBudgetController;executions:readonly ProjectFirstExecution[];native:boolean;used:Set<string>;current:()=>Promise<void>};
const authorizations=new WeakMap<object,Authorization>();
const permits=new WeakMap<object,{authorization:Authorization;correction:PreparedProjectCorrection;taskId:string;executionId:string;consumed:boolean}>();
export function authorizeProjectCorrectiveLoop(o:Options){if(Object.keys(o).some(k=>!['plan','controller','decision','firstExecutions','model','token'].includes(k)))return Promise.reject(Error('Unverified corrective options'));return authorize(o,fetch,true);}
export function authorizeProjectCorrectiveLoopForTests(o:Options,transport:typeof fetch){return authorize(o,transport,false);}
async function authorize(o:Options,transport:typeof fetch,native:boolean):Promise<ProjectCorrectiveAuthorization>{try{
 const controller=o.controller,wanted=policy(o),decision=Object.freeze({...o.decision}),token=o.token;
 if(decision.issueNumber!==75||!Number.isSafeInteger(decision.commentId)||decision.commentId<1||!/^[a-f0-9]{64}$/.test(decision.bodySha256)||!token)return refuse();
 let stopped=false,last=Date.now();
 const current=async()=>{try{
  if(stopped)return refuse();await controller.assertAuthorized();
  const response=await transport('https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/comments/'+decision.commentId,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'}});
  if(response.status!==200||!response.body){void response.body?.cancel().catch(()=>{});return refuse();}
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;try{for(;;){const p=await reader.read();if(p.done)break;bytes+=p.value.byteLength;if(bytes>32768){await reader.cancel();return refuse();}parts.push(p.value);}}finally{reader.releaseLock();}
  const c=JSON.parse(Buffer.concat(parts).toString('utf8')),base='https://github.com/erman-ksv/Onay-Agents-Factory/';last=Math.max(last,Date.now());
  if(c.id!==decision.commentId||c.user?.login!=='erman-ksv'||c.user?.type!=='User'||c.author_association!=='OWNER'||c.issue_url!=='https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/75'||![base+'pull/75#issuecomment-'+c.id,base+'issues/75#issuecomment-'+c.id].includes(c.html_url)||typeof c.created_at!=='string'||c.created_at!==c.updated_at||typeof c.body!=='string')return refuse();
  const body=JSON.parse(c.body),created=Date.parse(c.created_at),expires=Date.parse(body.expiresAt);if(!Number.isFinite(created)||created>last+300000||!Number.isFinite(expires)||expires<=last||expires>created+7*86400000||expires>last+7*86400000||projectBudgetApprovalDigest(body)!==decision.bodySha256||projectBudgetApprovalDigest(body)!==projectBudgetApprovalDigest({...wanted,expiresAt:body.expiresAt}))return refuse();
  if(controller.grantSha256!==wanted.budgetGrantSha256)return refuse();
 }catch{stopped=true;return refuse();}};
 await current();const cap=Object.freeze({}) as ProjectCorrectiveAuthorization;authorizations.set(cap,{plan:o.plan,controller:o.controller,executions:wanted.firstExecutions,native,used:new Set(),current});return cap;
}catch{return refuse();}}
export async function assertProjectCorrectiveAuthorization(cap:ProjectCorrectiveAuthorization,plan:PreparedProjectPlan,controller:AuthorizedProjectBudgetController,mode:'native'|'simulated'){
 const r=authorizations.get(cap);if(!r||r.plan!==plan||r.controller!==controller||mode==='native'&&!r.native)return refuse();await r.current();
}
/** The authenticated checkpoint supplies evidence, never this authority. */
export async function prepareProjectCorrectiveTaskPermit(cap:ProjectCorrectiveAuthorization,plan:PreparedProjectPlan,controller:AuthorizedProjectBudgetController,correction:PreparedProjectCorrection,mode:'native'|'simulated'){
 await assertProjectCorrectiveAuthorization(cap,plan,controller,mode);const r=authorizations.get(cap)!,e=await inspectProjectCorrection(correction,plan),allowed=r.executions.find(v=>v.taskId===e.taskId);
 if(mode==='native'&&e.provenance!=='native-host')return refuse();if(!allowed||allowed.executionId!==e.firstExecutionId||(await controller.inspectExecution(e.taskId,e.executionId)).requests!==0)return refuse();
 // Keep the one-use check and mark together after every await: competing
 // callers may both observe an uncharged execution, but only one gets a permit.
 if(r.used.has(e.taskId))return refuse();r.used.add(e.taskId);const permit=Object.freeze({}) as ProjectCorrectiveTaskPermit;permits.set(permit,{authorization:r,correction,taskId:e.taskId,executionId:e.executionId,consumed:false});return permit;
}
export async function assertProjectCorrectiveTaskPermit(permit:ProjectCorrectiveTaskPermit,plan:PreparedProjectPlan,controller:AuthorizedProjectBudgetController,correction:PreparedProjectCorrection,mode:'native'|'simulated'){
 const r=permits.get(permit);if(!r||r.authorization.plan!==plan||r.authorization.controller!==controller||r.correction!==correction||mode==='native'&&!r.authorization.native)return refuse();await r.authorization.current();return Object.freeze({taskId:r.taskId,executionId:r.executionId});
}
export async function consumeProjectCorrectiveTaskPermit(permit:ProjectCorrectiveTaskPermit,plan:PreparedProjectPlan,controller:AuthorizedProjectBudgetController,correction:PreparedProjectCorrection,mode:'native'|'simulated'){
 const binding=await assertProjectCorrectiveTaskPermit(permit,plan,controller,correction,mode),r=permits.get(permit)!;if(r.consumed)return refuse();r.consumed=true;return binding;
}
