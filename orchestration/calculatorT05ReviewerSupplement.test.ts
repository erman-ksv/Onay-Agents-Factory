import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCalculatorAssessment} from '../commander/calculatorTeam.js';
import {T05_REVIEW_FROZEN,restoreT05UnchangedApproval,buildT05ReviewerSupplement} from './calculatorT05ReviewerSupplement.js';
import {createProviderContextBudget,createGroqBudgetedFetch} from '../commander/providerContextBudget.js';
const refs=['changes@'+T05_REVIEW_FROZEN.baseSha,'host-checks@'+T05_REVIEW_FROZEN.proposalDigest];
for(const role of ['security','tester'] as const){
 test('frozen '+role+' approval preserves findings, unknown areas and all authority denials',()=>{
  const saved=validateCalculatorAssessment(role,{ready:true,summary:'Scoped evidence accepted',findings:[{severity:'low',message:'Other browsers remain unverified',evidenceRefs:[refs[1]]}],unverifiedAreas:['Unshown source']},refs);
  const restored=restoreT05UnchangedApproval(role,JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored,saved);assert.equal(restored.publicationAuthorized,false);assert.equal(restored.testsExecuted,false);
 });
 test('frozen '+role+' cannot acquire authority, hide disclaimer or change role',()=>{
  const saved=validateCalculatorAssessment(role,{ready:true,summary:'Scoped result',findings:[],unverifiedAreas:['Unshown source']},refs);
  for(const patch of [{publicationAuthorized:true},{testsExecuted:true},{overallTaskCompletionVerified:true},{ready:false},{role:'reviewer'},{unverifiedAreas:[]},{extra:'authority'}])assert.throws(()=>restoreT05UnchangedApproval(role,{...saved,...patch}));
 });
}
test('a rejected review is not a reusable approval',()=>{
 const rejected=validateCalculatorAssessment('reviewer',{ready:false,summary:'Syntax concern',findings:[{severity:'blocker',message:'Unverified parser failure',evidenceRefs:[refs[0]]}],unverifiedAreas:[]},refs);
 assert.throws(()=>restoreT05UnchangedApproval('security',rejected));assert.throws(()=>restoreT05UnchangedApproval('tester',rejected));
});
test('changed proposal or missing exact parser evidence refuses a supplement',()=>{
 assert.throws(()=>buildT05ReviewerSupplement('model',{} as any,{} as any,{} as any,{} as any,{}));
});
test('exhausted Reviewer context budget refuses before HTTP and never retries',async()=>{
 let sends=0;const context=createProviderContextBudget({maxRunTokens:1201,reservedOutputTokens:1200});
 const send=createGroqBudgetedFetch(context,async()=>{sends++;return new Response('{}');});
 await assert.rejects(()=>send('https://api.groq.com/openai/v1/chat/completions',{method:'POST',body:JSON.stringify({model:'openai/gpt-oss-120b',max_completion_tokens:1200,messages:[{role:'user',content:'Bounded review'}]})}));assert.equal(sends,0);
});
