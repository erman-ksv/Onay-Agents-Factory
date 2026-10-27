import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {prepareCalculatorInputRepairLaunch} from '../config/calculatorInputRepairLaunch.js';
const saved=JSON.parse(readFileSync(new URL('../.factory/input-repair-launch-package-20261027.json',import.meta.url),'utf8'));
test('launch proposal preserves every old cost and proposes exactly eight new bounded requests',()=>{
 const p=prepareCalculatorInputRepairLaunch(saved.draftManifest.history.carryover,{app:2000,uiTests:saved.draftManifest.taskPolicies[1].authorSelections[0].end});assert.deepEqual(p.previousSpent,{requests:65,requestBytes:626530,reservedTokens:263359});assert.deepEqual(p.additionalMaximum,{requests:8,requestBytes:96000,reservedTokens:48000});assert.equal(p.proposedOwnerApproval.grant.maxRequests,73);assert.equal(p.proposedOwnerApproval.grant.maxTotalRequestBytes,722530);assert.equal(p.proposedOwnerApproval.grant.maxReservedTokens,311359);assert.equal(p.proposedOwnerApproval.grant.maxRequestBytes,12000);assert.equal(p.ownerDecision,null);assert.equal(p.modelCallsAuthorized,0);
});
test('two tasks are ordered and cannot edit read-only core or rewrite original regression tests',()=>{
 const d=saved.draftManifest,[first,second]=d.proposal.tasks;assert.deepEqual(first.paths,['src/app.mjs']);assert.deepEqual(second.paths,['test/ui.test.mjs']);assert.deepEqual(second.dependsOn,[first.id]);assert.deepEqual(d.profile.appendOnlyPaths,['test/ui.test.mjs']);assert.deepEqual(d.goal.readOnlyPaths,['index.html','src/calculator.mjs','styles.css']);assert.equal(d.mode,'first-task');assert.equal(d.archivePin,null);assert.equal(d.candidateSha,null);
});
test('published launch package is reproducible with a stable identity and does not contain source or approval',()=>{
 const p=prepareCalculatorInputRepairLaunch(saved.draftManifest.history.carryover,{app:2000,uiTests:saved.draftManifest.taskPolicies[1].authorSelections[0].end});assert.deepEqual(p,saved);assert.equal(p.identity.planFingerprint,saved.identity.planFingerprint);assert.ok(p.draftManifest.taskPolicies.every(v=>v.browser&&v.reviewSelections[0]!.changedWindow));assert.equal(JSON.stringify(p).includes('function append('),false);assert.equal(Object.hasOwn(p.draftManifest,'decision'),false);
});
test('invalid input lengths or removal of preserved historical costs cannot build a permission proposal',()=>{
 assert.throws(()=>prepareCalculatorInputRepairLaunch(saved.draftManifest.history.carryover,{app:1,uiTests:1}));assert.throws(()=>prepareCalculatorInputRepairLaunch({...saved.draftManifest.history.carryover,used:{requests:0,requestBytes:0,reservedTokens:0}},{app:2000,uiTests:5000}));
});
