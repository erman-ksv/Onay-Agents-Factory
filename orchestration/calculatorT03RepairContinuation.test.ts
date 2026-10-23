import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCalculatorT03StoppedRepair,calculatorT03RepairFailure,admitCalculatorT03RepairContinuation,claimCalculatorT03RepairContinuation,T03_REPAIR_CHARGE} from './calculatorT03RepairContinuation.js';
import {CALCULATOR_FRONTEND_TASK_BUDGET} from './taskModelBudget.js';
test('unverified bytes and JSON copies cannot resume a stopped repair or claim a receipt',async()=>{
 assert.throws(()=>inspectCalculatorT03StoppedRepair(Buffer.from('{}'),Buffer.from('{}')));
 const clone={kind:'authenticated-t03-stopped-repair',capsuleSha256:'0f99168fbc2dfa98aad2b378ee4b36a5440e51ac5721d14c2cd8d930707ebbf7'} as const;
 assert.throws(()=>calculatorT03RepairFailure(clone));let writes=0;
 await assert.rejects(()=>admitCalculatorT03RepairContinuation({} as any,{} as any,clone,{} as any,'/tmp/unused',async()=>{writes++;},async()=>{writes++;}));
 await assert.rejects(()=>claimCalculatorT03RepairContinuation({} as any,{kind:'continue-original-t03-repair'}));assert.equal(writes,0);
});
test('existing repair preset fits entirely inside the original eight-call allowance with conservative old charges',()=>{
 assert.ok(T03_REPAIR_CHARGE.attemptedRequests+CALCULATOR_FRONTEND_TASK_BUDGET.maxRequests<=8);
 assert.ok(T03_REPAIR_CHARGE.totalRequestBytes+CALCULATOR_FRONTEND_TASK_BUDGET.maxRunBytes<=192000);
 assert.ok(T03_REPAIR_CHARGE.reservedRunTokens+16000<=32000);
 assert.ok(T03_REPAIR_CHARGE.elapsedMs+CALCULATOR_FRONTEND_TASK_BUDGET.wallTimeMs<=600000);
 assert.equal(T03_REPAIR_CHARGE.elapsedMs,207312);
});
