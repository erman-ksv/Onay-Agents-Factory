/** Source-free terminal failure DATA. It never grants resume or replay rights. */
export const CALCULATOR_RUNTIME_FAILURE_ERROR='Runtime failure record is unverified. Preserve the prior checkpoint; no retry or replay.';
const reasons=['concurrent_operation','operation_failed','validation_failed','transport_stopped','model_rate_limited',
 'project_owner_approval_unverified','checkpoint_persistence_failed','model_failed','execution_failed','proposal_changes_invalid','model_declined_proposal','proposal_rejection_persistence_failed'] as const;
export type CalculatorRuntimeFailure=Readonly<{reasonCode:typeof reasons[number];httpStatus?:number}>;
type Charge=Readonly<{attemptedRequests:number;totalRequestBytes:number;reservedRunTokens:number;elapsedMs:number}>;
const refuse=():never=>{throw Error(CALCULATOR_RUNTIME_FAILURE_ERROR);};
function plain(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));}
function own(v:unknown,key:string):unknown{if(!v||typeof v!=='object')return undefined;const d=Object.getOwnPropertyDescriptor(v,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;}
const status=(v:unknown):v is number=>typeof v==='number'&&Number.isInteger(v)&&v>=100&&v<=599;
export function parseCalculatorRuntimeFailure(input:unknown):CalculatorRuntimeFailure{
 if(!plain(input)||Reflect.ownKeys(input).length!==(Object.hasOwn(input,'httpStatus')?2:1)||!Object.hasOwn(input,'reasonCode'))return refuse();
 const code=own(input,'reasonCode'),http=own(input,'httpStatus');
 if(typeof code!=='string'||!reasons.includes(code as typeof reasons[number])||(Object.hasOwn(input,'httpStatus')&&!status(http)))return refuse();
 return Object.freeze({reasonCode:code as typeof reasons[number],...(status(http)?{httpStatus:http}:{})});
}
/** Copy only fixed codes and numeric status. Error/body/message/source fields
 * and accessors are deliberately never evaluated or retained. */
export function captureCalculatorRuntimeFailure(diagnostic:unknown):CalculatorRuntimeFailure{
 const root=own(diagnostic,'reasonCode');let reason:CalculatorRuntimeFailure['reasonCode']=typeof root==='string'&&reasons.includes(root as typeof reasons[number])?root as typeof reasons[number]:'model_failed';
 const primary=reason==='concurrent_operation'||reason==='validation_failed'||reason==='execution_failed';
 const scoped=own(diagnostic,'scopedFailures'),items=[diagnostic];
 if(Array.isArray(scoped))for(let i=0;i<Math.min(scoped.length,64);i++)items.push(own(scoped,String(i)));
 let providerStatus:number|undefined,responseStatus:number|undefined;
 for(const item of items){
  const provider=own(item,'providerHttpStatus'),http=own(item,'httpStatus');if(providerStatus===undefined&&status(provider))providerStatus=provider;if(responseStatus===undefined&&status(http))responseStatus=http;
  if(!primary){const code=own(item,'reasonCode');if(code==='project_owner_approval_unverified')reason=code;else if(code==='model_checkpoint_persistence_failed')reason='checkpoint_persistence_failed';else if(code==='proposal_changes_invalid'||code==='model_declined_proposal'||code==='proposal_rejection_persistence_failed')reason=code;}
 }
 const httpStatus=providerStatus??responseStatus;
 if(!primary&&httpStatus===429)reason='model_rate_limited';
 return parseCalculatorRuntimeFailure({reasonCode:reason,...(httpStatus!==undefined?{httpStatus}:{})});
}
/** One attempt only, including after an uncertain disk acknowledgement. The
 * caller's existing durable checkpoint remains the replay barrier on failure. */
export function createCalculatorRuntimeFailureCheckpoint(input:Readonly<{diagnostic:()=>unknown;charge:()=>Charge;persist:(failure:CalculatorRuntimeFailure,charge:Charge)=>void|Promise<void>}>){
 if(!input||typeof input.diagnostic!=='function'||typeof input.charge!=='function'||typeof input.persist!=='function')return refuse();
 const diagnostic=input.diagnostic,charge=input.charge,persist=input.persist;let attempted=false;
 return async()=>{
  if(attempted)return refuse();attempted=true;
  try{const failure=captureCalculatorRuntimeFailure(diagnostic()),amount=charge();
   if(!plain(amount)||Reflect.ownKeys(amount).length!==4||!['attemptedRequests','totalRequestBytes','reservedRunTokens','elapsedMs'].every(k=>{const n=own(amount,k);return typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;}))return refuse();
   await persist(failure,Object.freeze({attemptedRequests:amount.attemptedRequests,totalRequestBytes:amount.totalRequestBytes,reservedRunTokens:amount.reservedRunTokens,elapsedMs:amount.elapsedMs}));
  }catch{return refuse();}
 };
}
