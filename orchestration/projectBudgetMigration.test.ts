import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {stageCalculatorProjectHistory,PROJECT_HISTORY_STAGE_ERROR} from './projectBudgetMigration.js';
const saved=JSON.parse(readFileSync(new URL('./fixtures/calculatorStep7SavedPlan.json',import.meta.url),'utf8'));
const history=JSON.parse(readFileSync(new URL('../.factory/project-budget-history.json',import.meta.url),'utf8'));
const digest='6fdb95f2178edb18b60364ea659874f75f7bb434a0bf0e45dc87749b941a09f1',refusal={message:PROJECT_HISTORY_STAGE_ERROR};
test('historical staging preserves complete real totals but creates no allowance or initialization authority',()=>{
 const staged=stageCalculatorProjectHistory(saved.request,saved.proposal,history,digest);
 assert.deepEqual(staged.historicalCharge,{requests:59,requestBytes:553908,reservedTokens:230413});
 assert.equal(staged.coveredScopes.length,6);assert.equal(staged.additionalRequestsAuthorized,0);assert.equal(staged.ownerDecision,null);assert.equal(staged.actualLedgerInitialized,false);
 assert.equal(staged.repositoryWrites,0);assert.equal(staged.modelCalls,0);assert.equal(staged.targetRef,'refs/heads/state/project-model-budget/'+staged.projectKey);assert.ok(Object.isFrozen(staged));
 assert.equal(stageCalculatorProjectHistory(saved.request,saved.proposal,JSON.parse(JSON.stringify(history)),digest).projectKey,staged.projectKey);
});
test('missing area, understated total or mismatching pinned history fails without returning migration data',()=>{
 for(const kind of ['missing','total','digest']){const changed=JSON.parse(JSON.stringify(history));if(kind==='missing')changed.observations.pop();if(kind==='total')changed.observations[0].charge.requests=0;
  assert.throws(()=>stageCalculatorProjectHistory(saved.request,saved.proposal,changed,kind==='digest'?'f'.repeat(64):digest),refusal);
 }
});
test('migration cannot transfer the audited history to a different owner request or plan',()=>{
 assert.throws(()=>stageCalculatorProjectHistory({...saved.request,id:'foreign-project'},saved.proposal,history,digest),refusal);
 const proposal=JSON.parse(JSON.stringify(saved.proposal));proposal.tasks[0].goal+=' Changed scope';assert.throws(()=>stageCalculatorProjectHistory(saved.request,proposal,history,digest),refusal);
});
