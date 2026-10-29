import test from 'node:test';import assert from 'node:assert/strict';
import {T03_PRECISE_REPAIR_PRIOR as prior,T03_PRECISE_REPAIR_LIMITS as limits,assertT03PreciseRepairCharge as check} from './calculatorT03PreciseRepairPolicy.js';
test('new owner allowance keeps seven prior calls and caps one precise four-role cycle',()=>{
 assert.equal(prior.attemptedRequests+4,11);assert.equal(limits.reservedRunTokens,45000);assert.equal(limits.elapsedMs,600000);
 assert.doesNotThrow(()=>check(prior));assert.doesNotThrow(()=>check(limits));
 for(const key of Object.keys(prior) as (keyof typeof prior)[]){assert.throws(()=>check({...prior,[key]:prior[key]-1}));assert.throws(()=>check({...limits,[key]:limits[key]+1}));assert.throws(()=>check({...prior,[key]:NaN}));}
});
