import test from 'node:test';import assert from 'node:assert/strict';
import {T03_FAILED_TEST_PRIOR as prior,T03_FAILED_TEST_LIMITS as limits,assertT03FailedTestCharge as check} from './calculatorT03FailedTestPolicy.js';
test('new owner allowance adds one request only and retains cumulative token/time limits',()=>{
 assert.equal(prior.attemptedRequests+4,10);assert.equal(limits.reservedRunTokens,34000);assert.equal(limits.elapsedMs,600000);
 assert.doesNotThrow(()=>check(prior));assert.doesNotThrow(()=>check(limits));
 for(const key of Object.keys(prior) as (keyof typeof prior)[]){assert.throws(()=>check({...prior,[key]:prior[key]-1}));assert.throws(()=>check({...limits,[key]:limits[key]+1}));assert.throws(()=>check({...prior,[key]:NaN}));}
});
