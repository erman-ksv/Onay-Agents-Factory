import {createHash} from 'node:crypto';
import {isAuthorizedProjectBudgetController,type AuthorizedProjectBudgetController} from './projectBudgetAuthorization.js';
import {parseProjectModelBudgetState,parseProjectModelGrant,type ProjectModelBudgetState} from './projectModelBudget.js';
export const PROJECT_BUDGET_EXTENSION_ERROR='Project budget extension refused. Preserve every reservation and revision; no retry, reset, refund or model call.';
const refuse=():never=>{throw Error(PROJECT_BUDGET_EXTENSION_ERROR);};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function projectBudgetStateDigest(input:unknown){return hash(JSON.stringify(parseProjectModelBudgetState(input)));}
/** Shape checking is DATA only. Native owner authorization is separate. The
 * signed grantId binds the complete prior ledger, including every reservation. */
export function inspectProjectBudgetExtension(previous:AuthorizedProjectBudgetController,stateInput:unknown,proposedInput:unknown){
 if(!isAuthorizedProjectBudgetController(previous)||previous.operationMode!=='read-only-review')return refuse();
 const state=parseProjectModelBudgetState(stateInput),next=parseProjectModelGrant(proposedInput),old=previous.grant,stateSha256=projectBudgetStateDigest(state);
 if(state.grantSha256!==previous.grantSha256||next.grantId!=='extend-'+stateSha256||next.projectId!==old.projectId||next.repository!==old.repository||next.planFingerprint!==old.planFingerprint||next.historicalEvidenceSha256!==old.historicalEvidenceSha256||JSON.stringify(next.historical)!==JSON.stringify(old.historical)||next.maxRequestBytes!==old.maxRequestBytes||next.grantId===old.grantId)return refuse();
 const used={...old.historical};for(const r of state.reservations){used.requests++;used.requestBytes+=r.requestBytes;used.reservedTokens+=r.reservedTokens;}
 if(used.requests>old.maxRequests||used.requestBytes>old.maxTotalRequestBytes||used.reservedTokens>old.maxReservedTokens||next.maxRequests!==used.requests+3||next.maxTotalRequestBytes!==used.requestBytes+72000||next.maxReservedTokens!==used.reservedTokens+18000||next.maxRequests<=old.maxRequests||next.maxTotalRequestBytes<old.maxTotalRequestBytes||next.maxReservedTokens<old.maxReservedTokens)return refuse();
 const grantSha256=hash(JSON.stringify(next)),newState=parseProjectModelBudgetState({...state,grantSha256});
 return Object.freeze({stateSha256,grant:next,grantSha256,used:Object.freeze(used),newState,additionalRequestsAuthorized:0 as const});
}
declare const brand:unique symbol;
export type ProjectBudgetExtensionPermit=Readonly<{[brand]:true}>;
type Command=Readonly<{projectKey:string;expectedRevision:string;before:ProjectModelBudgetState;after:ProjectModelBudgetState;assertAuthorized:()=>Promise<void>}>;
const permits=new WeakMap<object,{command:Command;used:boolean}>();
/** Only two genuine controllers can mint this one-use command. JSON fields,
 * copied controllers and a proposed document never authorize a state write. */
export async function authorizeProjectBudgetExtension(previous:AuthorizedProjectBudgetController,next:AuthorizedProjectBudgetController,expectedRevision:string,stateInput:unknown):Promise<ProjectBudgetExtensionPermit>{
 if(!isAuthorizedProjectBudgetController(previous)||!isAuthorizedProjectBudgetController(next)||next.operationMode!=='read-only-review'||previous===next||previous.projectKey!==next.projectKey||JSON.stringify(previous.identity)!==JSON.stringify(next.identity)||previous.historyDigest!==next.historyDigest||previous.approvalBodySha256===next.approvalBodySha256||!/^[a-f0-9]{64}$/.test(expectedRevision))return refuse();
 const before=parseProjectModelBudgetState(stateInput),inspected=inspectProjectBudgetExtension(previous,before,next.grant);
 if(next.grantSha256!==inspected.grantSha256)return refuse();
 const assertAuthorized=async()=>{await previous.assertAuthorized();await next.assertAuthorized();};await assertAuthorized();
 const permit=Object.freeze({}) as ProjectBudgetExtensionPermit;permits.set(permit,{used:false,command:Object.freeze({projectKey:previous.projectKey,expectedRevision,before,after:inspected.newState,assertAuthorized})});return permit;
}
export function consumeProjectBudgetExtensionPermit(value:unknown,projectKey:string):Command{
 const p=value&&typeof value==='object'?permits.get(value):undefined;if(!p||p.used||p.command.projectKey!==projectKey)return refuse();p.used=true;return p.command;
}
