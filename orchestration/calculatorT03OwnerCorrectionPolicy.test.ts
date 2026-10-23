import test from 'node:test';import assert from 'node:assert/strict';
import {T03_OWNER_CORRECTION_2_PRIOR as prior,T03_OWNER_CORRECTION_2_LIMITS as limits,assertT03OwnerCorrection2Charge as check} from './calculatorT03OwnerCorrectionPolicy.js';
import {CALCULATOR_FRONTEND_TASK_BUDGET as next} from './taskModelBudget.js';
test('one approved four-role cycle fits with all five prior calls and conservative charges',()=>{
 assert.equal(prior.attemptedRequests+next.maxRequests,9);
 const end={attemptedRequests:9,totalRequestBytes:prior.totalRequestBytes+next.maxRunBytes,reservedRunTokens:prior.reservedRunTokens+16000,elapsedMs:prior.elapsedMs+next.wallTimeMs};
 assert.doesNotThrow(()=>check(end));assert.doesNotThrow(()=>check(prior));assert.equal(limits.reservedRunTokens,34000);
});
test('refunds, a tenth request, over-budget tokens/time/bytes and invalid numbers fail closed',()=>{
 for(const key of Object.keys(prior) as (keyof typeof prior)[]) {
  assert.throws(()=>check({...prior,[key]:prior[key]-1}));
  assert.throws(()=>check({...prior,[key]:limits[key]+1}));
  assert.throws(()=>check({...prior,[key]:NaN}));
 }
 assert.ok(Object.isFrozen(prior));assert.ok(Object.isFrozen(limits));
});
