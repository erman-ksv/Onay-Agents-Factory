import test from 'node:test';import assert from 'node:assert/strict';
import {collectCalculatorFailedTestEvidence as collect,consumeCalculatorFailedTestEvidence as consume} from './calculatorFailedTestRepair.js';
import {calculatorProposalDigest} from './calculatorExecutionEvidence.js';
import type {PreparedCalculatorChanges} from '../commander/calculatorChanges.js';import type {CalculatorPlanTask} from './calculatorPlan.js';
const task={id:'fixture-task'} as CalculatorPlanTask;
const changes={repository:'erman-ksv/Onay-Factory-Calculator',baseRef:'feat/calculator-agent/fixture',baseSha:'a'.repeat(40),files:[{path:'test/ui.test.mjs',content:'fixture',message:'fixture'}]} as PreparedCalculatorChanges;
const failed={repository:changes.repository,taskId:task.id,baseSha:changes.baseSha,proposalDigest:calculatorProposalDigest(changes),status:'failed' as const,testsExecuted:true,failures:['Trusted isolated task check failed: project-tests.']};
test('real failure evidence is bound to exact proposal and task, single-use and grants no approval',async()=>{
 let calls=0;const token=await collect(task,changes,async input=>{calls++;assert.equal(input.changes,changes);return failed;});assert.equal(calls,1);
 assert.throws(()=>consume(structuredClone(token),task.id,changes));assert.throws(()=>consume(token,'another',changes));assert.throws(()=>consume(token,task.id,structuredClone(changes)));
 assert.deepEqual(consume(token,task.id,changes),failed);assert.throws(()=>consume(token,task.id,changes));assert.deepEqual(Object.keys(token),['kind']);
});
test('passed, unexecuted, unverified or differently bound checks cannot open a repair',async()=>{
 for(const mutation of [{status:'passed',failures:[]},{testsExecuted:false},{status:'unverified'},{proposalDigest:'0'.repeat(64)},{taskId:'other'}])
 await assert.rejects(()=>collect(task,changes,async()=>({...failed,...mutation}) as typeof failed));
});
