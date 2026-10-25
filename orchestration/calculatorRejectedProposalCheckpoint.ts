import {createHash} from 'node:crypto';
import {encodeCalculatorPrivateRejectedJson} from './calculatorAssessmentRejection.js';
import type {CalculatorPriorModelCharge,CalculatorModelCheckpointHooks} from './calculatorModelTeam.js';
export const CALCULATOR_REJECTED_PROPOSAL_ERROR='Private rejected proposal capture refused. Preserve charges and uncertainty; no retry or approval.';
type Event=Parameters<NonNullable<CalculatorModelCheckpointHooks['afterProposalRejected']>>[0];
export type CalculatorRejectedProposal=Readonly<{taskId:string;kind:'generation'|'repair';validationCode:'proposal_changes_invalid'|'model_declined_proposal';result:unknown}>;
const refuse=():never=>{throw Error(CALCULATOR_REJECTED_PROPOSAL_ERROR);};
function data(v:unknown,keys:string[]):v is Record<string,unknown>{
 if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v))||Reflect.ownKeys(v).length!==keys.length)return false;
 const d=Object.getOwnPropertyDescriptors(v);return keys.every(k=>d[k]&&Object.hasOwn(d[k],'value'));
}
/** Raw author JSON remains private untrusted DATA, never PreparedChanges. */
export function prepareCalculatorRejectedProposal(value:unknown):CalculatorRejectedProposal{
 try{
  if(!data(value,['taskId','kind','validationCode','result'])||typeof value.taskId!=='string'||!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(value.taskId)||
   (value.kind!=='generation'&&value.kind!=='repair')||(value.validationCode!=='proposal_changes_invalid'&&value.validationCode!=='model_declined_proposal'))return refuse();
  const encoded=encodeCalculatorPrivateRejectedJson(value),copy=JSON.parse(encoded) as CalculatorRejectedProposal;
  if(copy.validationCode==='model_declined_proposal'&&(!data(copy.result,['summary','changes'])||typeof copy.result.summary!=='string'||!/^Blocked:/i.test(copy.result.summary)||!Array.isArray(copy.result.changes)||copy.result.changes.length))return refuse();
  const pending:unknown[]=[copy];while(pending.length){const item=pending.pop();if(item&&typeof item==='object'){pending.push(...Object.values(item));Object.freeze(item);}}
  return copy;
 }catch{return refuse();}
}
export function calculatorRejectedProposalMetadata(value:CalculatorRejectedProposal){
 const copy=prepareCalculatorRejectedProposal(value),text=encodeCalculatorPrivateRejectedJson(copy.result);
 return Object.freeze({kind:copy.kind,validationCode:copy.validationCode,resultSha256:createHash('sha256').update(text).digest('hex')});
}
export type CalculatorRuntimeProposalContext=Readonly<{taskId:string;stage:string;attempt:1|2;status:'running'|'passed'|'blocked';httpInFlight:boolean;publicationStarted:boolean}>;
/** A parsed-response hook proves HTTP returned, but clears uncertainty only
 * together with a durable private capture. One attempt, no model replay. */
export function createCalculatorRuntimeProposalRejection(input:Readonly<{
 context:()=>CalculatorRuntimeProposalContext|undefined;charge:()=>CalculatorPriorModelCharge;
 persistReturned:(rejected:CalculatorRejectedProposal,charge:CalculatorPriorModelCharge)=>void|Promise<void>;
}>){
 if(!input||typeof input.context!=='function'||typeof input.charge!=='function'||typeof input.persistReturned!=='function')return refuse();
 const context=input.context,charge=input.charge,persist=input.persistReturned;let attempted=false;
 return async(event:Event)=>{
  if(attempted)return refuse();attempted=true;
  try{
   const rejected=prepareCalculatorRejectedProposal(event),current=context();
   if(!current||current.taskId!==rejected.taskId||current.status!=='running'||!current.httpInFlight||current.publicationStarted||
    (rejected.kind==='generation'?(current.attempt!==1||current.stage!=='generate_1'):(current.attempt!==2||current.stage!=='repair_2')))return refuse();
   const amount=charge();if(!data(amount,['attemptedRequests','totalRequestBytes','reservedRunTokens','elapsedMs'])||Object.values(amount).some(n=>typeof n!=='number'||!Number.isSafeInteger(n)||n<0))return refuse();
   await persist(rejected,Object.freeze({attemptedRequests:amount.attemptedRequests,totalRequestBytes:amount.totalRequestBytes,reservedRunTokens:amount.reservedRunTokens,elapsedMs:amount.elapsedMs}));
  }catch{return refuse();}
 };
}
