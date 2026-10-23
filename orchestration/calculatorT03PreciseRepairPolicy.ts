/** Owner approved one complete precise-diagnostic cycle, retaining all prior costs. */
export const T03_PRECISE_REPAIR_PRIOR=Object.freeze({attemptedRequests:7,totalRequestBytes:62147,reservedRunTokens:28612,elapsedMs:237561});
export const T03_PRECISE_REPAIR_LIMITS=Object.freeze({attemptedRequests:11,totalRequestBytes:192000,reservedRunTokens:45000,elapsedMs:600000});
export function assertT03PreciseRepairCharge(value:Readonly<Record<keyof typeof T03_PRECISE_REPAIR_PRIOR,number>>):void{
 for(const key of Object.keys(T03_PRECISE_REPAIR_PRIOR) as (keyof typeof T03_PRECISE_REPAIR_PRIOR)[])
 if(!Number.isSafeInteger(value[key])||value[key]<T03_PRECISE_REPAIR_PRIOR[key]||value[key]>T03_PRECISE_REPAIR_LIMITS[key])throw Error('Failed-test repair allowance refused; preserve costs and stop.');
}
