/** Owner approved one additional request, not a token/time reset. */
export const T03_FAILED_TEST_PRIOR=Object.freeze({attemptedRequests:6,totalRequestBytes:54064,reservedRunTokens:23613,elapsedMs:224581});
export const T03_FAILED_TEST_LIMITS=Object.freeze({attemptedRequests:10,totalRequestBytes:192000,reservedRunTokens:34000,elapsedMs:600000});
export function assertT03FailedTestCharge(value:Readonly<Record<keyof typeof T03_FAILED_TEST_PRIOR,number>>):void{
 for(const key of Object.keys(T03_FAILED_TEST_PRIOR) as (keyof typeof T03_FAILED_TEST_PRIOR)[])
 if(!Number.isSafeInteger(value[key])||value[key]<T03_FAILED_TEST_PRIOR[key]||value[key]>T03_FAILED_TEST_LIMITS[key])throw Error('Failed-test repair allowance refused; preserve costs and stop.');
}
