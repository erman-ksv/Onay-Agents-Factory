import {authorizeProjectBudget,type ProjectOwnerDecision,type ProjectBudgetHistory} from './projectBudgetAuthorization.js';
import {stageCalculatorProjectHistory} from './projectBudgetMigration.js';
import {createProjectModelBudgetGitHubStore} from '../github/projectModelBudgetStore.js';
import {parseProjectModelBudgetState,type ProjectModelBudgetStore} from './projectModelBudget.js';

export const PROJECT_BUDGET_ACTIVATION_ERROR='Project budget activation is unverified. Preserve existing state; no reset, retry or model call is authorized.';
const refuse=():never=>{throw Error(PROJECT_BUDGET_ACTIVATION_ERROR);};
export type ProjectBudgetActivationRequest=Readonly<{version:1;operation:'inspect'|'initialize';historyDigest:string;ownerDecision:ProjectOwnerDecision|null}>;
function data(value:unknown,keys:string[]):value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length)return false;
 const descriptors=Object.getOwnPropertyDescriptors(value);return keys.every(k=>descriptors[k]&&Object.hasOwn(descriptors[k],'value'));
}
export function prepareProjectBudgetActivationRequest(input:unknown):ProjectBudgetActivationRequest{
 if(!data(input,['version','operation','historyDigest','ownerDecision'])||input.version!==1||
 typeof input.operation!=='string'||!['inspect','initialize'].includes(input.operation)||typeof input.historyDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.historyDigest))return refuse();
 if(input.operation==='inspect'){
  if(input.ownerDecision!==null)return refuse();return Object.freeze({version:1,operation:'inspect',historyDigest:input.historyDigest,ownerDecision:null});
 }
 const d=input.ownerDecision;
 if(!data(d,['issueNumber','commentId','bodySha256'])||d.issueNumber!==75||typeof d.commentId!=='number'||!Number.isSafeInteger(d.commentId)||d.commentId<1||typeof d.bodySha256!=='string'||!/^[a-f0-9]{64}$/.test(d.bodySha256))return refuse();
 return Object.freeze({version:1,operation:'initialize',historyDigest:input.historyDigest,ownerDecision:Object.freeze({issueNumber:75,commentId:d.commentId,bodySha256:d.bodySha256})});
}
type Options=Readonly<{request:unknown;ownerRequest:unknown;proposal:unknown;history:ProjectBudgetHistory;expectedHistoryDigest:string;
 token:string;transport?:typeof fetch;now?:()=>number}>;
/** Trusted host/test constructor. Never an SDK tool or model argument. This
 * operation cannot spend a request, create owner approval, change a grant,
 * rewrite an existing counter or retry an uncertain initialization. */
export async function runTrustedProjectBudgetActivation(options:Options&Readonly<{store:ProjectModelBudgetStore}>){
 try{
  const request=prepareProjectBudgetActivationRequest(options.request);
  const history=JSON.parse(JSON.stringify(options.history)) as ProjectBudgetHistory;
  const staged=stageCalculatorProjectHistory(options.ownerRequest,options.proposal,history,options.expectedHistoryDigest);
  if(request.historyDigest!==staged.historyDigest)return refuse();
  const existing=await options.store.read();if(existing)parseProjectModelBudgetState(existing.data);
  if(request.operation==='inspect')return Object.freeze({version:1 as const,operation:'inspect' as const,
   status:existing?'present-owner-approval-unverified':'not-initialized',projectKey:staged.projectKey,historyDigest:staged.historyDigest,
   historicalCharge:staged.historicalCharge,ledgerPresent:!!existing,ownerApprovalVerified:false as const,
   stateWrites:0 as const,modelCalls:0 as const,additionalRequestsAuthorized:0 as const,legalEnabled:false as const});
  if(!request.ownerDecision)return refuse();
  const controller=await authorizeProjectBudget({identity:staged.identity,history,decision:request.ownerDecision,token:options.token,
   store:options.store,...(options.transport?{transport:options.transport}:{}),...(options.now?{now:options.now}:{})});
  if(controller.projectKey!==staged.projectKey||controller.historyDigest!==staged.historyDigest)return refuse();
  // An existing ledger must validate against the SAME owner-approved grant.
  // Never catch an inspect failure and replace it with initialization/reset.
  if(!existing)await controller.initialize();
  const snapshot=await controller.inspect();
  return Object.freeze({version:1 as const,operation:'initialize' as const,status:existing?'already-initialized-no-reset':'initialized',
   projectKey:staged.projectKey,historyDigest:staged.historyDigest,historicalCharge:staged.historicalCharge,
   ledgerPresent:true as const,ownerApprovalVerified:true as const,grantSha256:snapshot.grantSha256,used:snapshot.used,remaining:snapshot.remaining,
   stateWrites:existing?0:1,modelCalls:0 as const,ownerApprovalCreated:false as const,legalEnabled:false as const});
 }catch{return refuse();}
}
/** Production entry always fixes GitHub storage to the audited project key. */
export async function runGitHubProjectBudgetActivation(options:Options){
 try{
  if(Object.hasOwn(options,'store'))return refuse();
  const request=prepareProjectBudgetActivationRequest(options.request);
  const staged=stageCalculatorProjectHistory(options.ownerRequest,options.proposal,options.history,options.expectedHistoryDigest);
  if(request.historyDigest!==staged.historyDigest)return refuse();
  const store=createProjectModelBudgetGitHubStore({projectKey:staged.projectKey,token:options.token,...(options.transport?{transport:options.transport}:{})});
  return await runTrustedProjectBudgetActivation({...options,request,store});
 }catch{return refuse();}
}
