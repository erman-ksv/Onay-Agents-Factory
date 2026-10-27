const reasons=new Set(['ready','request-stopped','invalid-wire-request','context-unverified','checkpoint-unverified','request-aborted','invalid-request','concurrent-request','invalid-correction-clock','provider-refused','response-too-large','response-unverified','request-failed','host-stopped','task_timeout','transport_error','request_aborted','rate_limited','project_budget_refused','request_limit','run_bytes_limit','request_bytes_limit']);
const stages=new Set(['ready','preflight','correction-cooldown','pacing','reserve-and-send','post-reservation-guard','checkpoint','post-checkpoint-guard','http','response','done']);
/** Copy only fixed host metadata; never serialize arbitrary snapshot fields or
 * the thrown error, which could contain private source/provider diagnostics. */
export function projectTaskFailureDiagnostic(value:unknown){
 const v=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const count=(key:string)=>Number.isSafeInteger(v[key])&&(v[key] as number)>=0&&(v[key] as number)<=16000000?v[key]:null;
 return Object.freeze({version:1,status:'project-task-stopped',stage:typeof v.stage==='string'&&stages.has(v.stage)?v.stage:'unclassified',reasonCode:typeof v.reasonCode==='string'&&reasons.has(v.reasonCode)?v.reasonCode:'unclassified',providerCallsSent:count('providerCallsSent'),attemptedRequests:count('attemptedRequests'),totalRequestBytes:count('totalRequestBytes'),reservedRunTokens:count('reservedRunTokens'),executionAuthorized:false,replayAuthorized:false});
}
