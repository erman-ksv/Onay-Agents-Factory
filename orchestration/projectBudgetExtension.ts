import {createProjectModelBudgetGitHubExtensionStore} from '../github/projectModelBudgetStore.js';
import {authorizeGitHubProjectBudget,projectBudgetApprovalDigest,type ProjectBudgetHistory,type ProjectOwnerDecision} from './projectBudgetAuthorization.js';
import {stageCalculatorProjectHistory} from './projectBudgetMigration.js';
import {inspectProjectBudgetExtension,authorizeProjectBudgetExtension,projectBudgetStateDigest,PROJECT_BUDGET_EXTENSION_ERROR} from './projectBudgetExtensionAuthorization.js';
const refuse=():never=>{throw Error(PROJECT_BUDGET_EXTENSION_ERROR);};
function plain(v:unknown,keys:string[]):v is Record<string,unknown>{return !!v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)??{},'value'));}
function decision(v:unknown):ProjectOwnerDecision{if(!plain(v,['issueNumber','commentId','bodySha256'])||v.issueNumber!==75||typeof v.commentId!=='number'||!Number.isSafeInteger(v.commentId)||v.commentId<1||typeof v.bodySha256!=='string'||!/^[a-f0-9]{64}$/.test(v.bodySha256))return refuse();return Object.freeze({issueNumber:75,commentId:v.commentId,bodySha256:v.bodySha256});}
export function prepareProjectBudgetExtensionRequest(v:unknown){
 if(!plain(v,['version','operation','previousDecision','ownerDecision','expectedRevision','expectedStateSha256'])||v.version!==1||typeof v.operation!=='string'||!['inspect','extend'].includes(v.operation)||typeof v.expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(v.expectedRevision)||typeof v.expectedStateSha256!=='string'||!/^[a-f0-9]{64}$/.test(v.expectedStateSha256))return refuse();
 const previousDecision=decision(v.previousDecision);if(v.operation==='inspect'&&v.ownerDecision!==null)return refuse();const ownerDecision=v.operation==='inspect'?null:decision(v.ownerDecision);if(ownerDecision?.commentId===previousDecision.commentId)return refuse();
 return Object.freeze({version:1 as const,operation:v.operation as 'inspect'|'extend',previousDecision,ownerDecision,expectedRevision:v.expectedRevision,expectedStateSha256:v.expectedStateSha256});
}
/** Native-only operator. Inspect cannot mint a permit, initialize storage,
 * authorize models or change the ledger. Extend never resets reservations. */
export async function runGitHubProjectBudgetExtension(options:Readonly<{request:unknown;ownerRequest:unknown;proposal:unknown;history:ProjectBudgetHistory;expectedHistoryDigest:string;proposedApproval:unknown;token:string;transport?:typeof fetch;now?:()=>number}>){
 try{
  if(Object.hasOwn(options,'store'))return refuse();const request=prepareProjectBudgetExtensionRequest(options.request),stage=stageCalculatorProjectHistory(options.ownerRequest,options.proposal,options.history,options.expectedHistoryDigest),document=options.proposedApproval;
  if(!plain(document,['version','kind','mode','grant','expiresAt'])||document.version!==1||document.kind!=='authorize-project-model-budget'||document.mode!=='read-only-review'||typeof document.expiresAt!=='string'||!Number.isFinite(Date.parse(document.expiresAt)))return refuse();
  const shared={identity:stage.identity,history:options.history,token:options.token,...(options.transport?{transport:options.transport}:{}),...(options.now?{now:options.now}:{})};
  const previous=await authorizeGitHubProjectBudget({...shared,decision:request.previousDecision}),store=createProjectModelBudgetGitHubExtensionStore({projectKey:stage.projectKey,token:options.token,...(options.transport?{transport:options.transport}:{})}),current=await store.read();
  if(!current||current.revision!==request.expectedRevision||projectBudgetStateDigest(current.data)!==request.expectedStateSha256)return refuse();const before=await previous.inspect(),shape=inspectProjectBudgetExtension(previous,current.data,document.grant);
  const base={version:1 as const,projectKey:stage.projectKey,previousRevision:current.revision,priorStateSha256:shape.stateSha256,previousGrantSha256:previous.grantSha256,proposedGrantSha256:shape.grantSha256,reservationsPreserved:shape.newState.reservations.length,modelCalls:0 as const,resets:0 as const,refunds:0 as const};
  if(request.operation==='inspect'){await previous.assertAuthorized();const final=await store.read();if(final?.revision!==current.revision)return refuse();return Object.freeze({...base,status:'extension-awaiting-new-owner-decision' as const,ownerApprovalVerified:false as const,used:before.used,stateWrites:0,additionalRequestsAuthorized:0,proposedAdditionalRequests:3});}
  if(!request.ownerDecision||request.ownerDecision.bodySha256!==projectBudgetApprovalDigest(document))return refuse();const next=await authorizeGitHubProjectBudget({...shared,decision:request.ownerDecision});
  const permit=await authorizeProjectBudgetExtension(previous,next,current.revision,current.data),updated=await store.extend(permit);await next.assertAuthorized();const after=await next.inspect();
  if(JSON.stringify(after.used)!==JSON.stringify(before.used)||after.remaining.requests!==3)return refuse();return Object.freeze({...base,status:'extended-with-all-reservations-preserved' as const,ownerApprovalVerified:true as const,revision:updated.revision,used:after.used,remaining:after.remaining,stateWrites:1,additionalRequestsAuthorized:3});
 }catch{return refuse();}
}
