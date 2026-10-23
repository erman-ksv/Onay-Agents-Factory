import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createTaskModelBudgetFetch,CALCULATOR_KEYBOARD_TASK_BUDGET,DEFAULT_TASK_MODEL_BUDGET} from "./taskModelBudget.js";
import {createCalculatorModelTeam} from "./calculatorModelTeam.js";
import {createCalculatorPlan} from "./calculatorPlan.js";
import {loadCalculatorSnapshot} from "../github/calculatorSnapshot.js";
const saved=JSON.parse(readFileSync(new URL('./fixtures/calculatorStep7SavedPlan.json',import.meta.url),'utf8'));
test("new keyboard allowance admits at most eight requests without changing defaults or permitting a ninth",async()=>{
 let calls=0;const budget=createTaskModelBudgetFetch({...CALCULATOR_KEYBOARD_TASK_BUDGET,hostPreset:"calculator-keyboard-eight-roles"},async()=>{calls++;return Response.json({});});
 for(let i=0;i<8;i++)await(await budget.fetch('https://model.invalid/',{method:'POST',body:'{}'})).text();
 assert.equal((await budget.fetch('https://model.invalid/',{method:'POST',body:'{}'})).status,400);assert.equal(calls,8);assert.equal(DEFAULT_TASK_MODEL_BUDGET.wallTimeMs,120000);
});
test("one fresh generation, one correction and six separate assessments fit the exact new preset",async()=>{
 const plan=createCalculatorPlan(saved.request,saved.proposal),task=plan.tasks[2]!;
 const snapshot=await loadCalculatorSnapshot({repository:plan.owner.repository,baseRef:plan.branch,baseSha:plan.owner.baseSha,changePaths:task.paths},{getHead:async()=>plan.owner.baseSha,readCommit:async()=>({sha:plan.owner.baseSha,treeSha:'b'.repeat(40)}),readTree:async()=>({sha:'b'.repeat(40),truncated:false,tree:[]}),readBlob:async()=>{throw Error('absent');}});
 let calls=0,now=0;const caps:number[]=[];
 const proposal={summary:'Protocol-only bounded keyboard fixture',changes:task.paths.map(path=>({operation:'create',path,content:'export const protocolFixture=1;',message:'Fixture'}))};
 const team=createCalculatorModelTeam(saved.request,{AGENT_FACTORY_TARGET_PROFILE:'calculator',AGENT_FACTORY_PROVIDER:'groq',GROQ_API_KEY:'fixture-key',CALCULATOR_MODEL_LIVE_APPROVED:'ONE_FREE_BOUNDED_RUN',ONAY_TEAM_FREE_TIER_CONFIRMED:'true',AGENT_FACTORY_LEGAL_ENABLED:'false'},async(_url,init)=>{
  calls++;caps.push(JSON.parse(String(init?.body)).max_completion_tokens);
  return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(calls===1||calls===5?proposal:{ready:true,summary:'Protocol fixture only',findings:[],unverifiedAreas:['Runtime not verified']})}}]});
 },{now:()=>now,wait:async ms=>{now+=ms;}},undefined,undefined,'calculator-keyboard-eight-roles');
 const first=await team.generate(plan,task.id,snapshot);
 for(const role of ['security','reviewer','tester'] as const)await team.assess(role,plan,task.id,first);
 const {calculatorProposalDigest}=await import('./calculatorExecutionEvidence.js');
 const corrected=await team.repair(plan,task.id,snapshot,{previous:first,proposalDigest:calculatorProposalDigest(first),issues:['Keyboard result failed trusted acceptance']});
 for(const role of ['security','reviewer','tester'] as const)await team.assess(role,plan,task.id,corrected);
 assert.equal(calls,8);assert.deepEqual(caps,[2048,1200,1200,1200,2048,1200,1200,1200]);
 await assert.rejects(()=>team.repair(plan,task.id,snapshot,{previous:corrected,proposalDigest:calculatorProposalDigest(corrected),issues:['Second repair forbidden']}));assert.equal(calls,8);
});

async function longFeedbackFixture() {
 const plan=createCalculatorPlan(saved.request,saved.proposal),task=plan.tasks[2]!;
 const snapshot=await loadCalculatorSnapshot({repository:plan.owner.repository,baseRef:plan.branch,baseSha:plan.owner.baseSha,changePaths:task.paths},{getHead:async()=>plan.owner.baseSha,readCommit:async()=>({sha:plan.owner.baseSha,treeSha:'b'.repeat(40)}),readTree:async()=>({sha:'b'.repeat(40),truncated:false,tree:[]}),readBlob:async()=>{throw Error('absent');}});
 const summary='Important security concern. '.repeat(21).trim(),finding='A real validation concern must be corrected';
 const proposal={summary:'Bounded protocol fixture',changes:task.paths.map(path=>({operation:'create',path,content:'export const protocolFixture=1;',message:'Fixture'}))};
 let calls=0,now=0;const packets:any[]=[];
 const team=createCalculatorModelTeam(saved.request,{AGENT_FACTORY_TARGET_PROFILE:'calculator',AGENT_FACTORY_PROVIDER:'groq',GROQ_API_KEY:'fixture-key',CALCULATOR_MODEL_LIVE_APPROVED:'ONE_FREE_BOUNDED_RUN',ONAY_TEAM_FREE_TIER_CONFIRMED:'true',AGENT_FACTORY_LEGAL_ENABLED:'false'},async(_url,init)=>{
  calls++;packets.push(JSON.parse(JSON.parse(String(init?.body)).messages[1].content));
  const output=calls===1||calls===5?proposal:{ready:calls!==2,summary:calls===2?summary:'Protocol fixture only',findings:calls===2?[{severity:'high',message:finding,evidenceRefs:['changes@'+plan.owner.baseSha]}]:[],unverifiedAreas:['Unshown source remains unverified']};
  return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(output)}}]});
 },{now:()=>now,wait:async ms=>{now+=ms;}},undefined,undefined,'calculator-keyboard-eight-roles');
 const first=await team.generate(plan,task.id,snapshot);
 for(const role of ['security','reviewer','tester'] as const)await team.assess(role,plan,task.id,first);
 const request=team.prepareRepairFeedback(plan,task.id,first);
 return {team,plan,task,snapshot,request,summary,finding,packets,get calls(){return calls;}};
}
test('long specialist rejection reaches repair intact while issue labels retain the 400-character limit',async()=>{
 const f=await longFeedbackFixture();assert.ok(f.summary.length>400);assert.ok(f.request.issues.every(x=>x.length<=400));
 const {validateCalculatorRepairRequest}=await import('./calculatorExecutionEvidence.js');
 assert.doesNotThrow(()=>validateCalculatorRepairRequest(f.request));
 const corrected=await f.team.repair(f.plan,f.task.id,f.snapshot,f.request);
 const feedback=f.packets[4].repair.specialistFeedback;
 assert.equal(feedback.length,3);assert.equal(feedback[0].summary,f.summary);
 assert.equal(feedback[0].findings[0].message,f.finding);assert.equal(feedback[0].findings[0].severity,'high');
 assert.equal(feedback[0].ready,false);assert.ok(feedback[0].unverifiedAreas.includes('Unshown source remains unverified'));
 for(const role of ['security','reviewer','tester'] as const)await f.team.assess(role,f.plan,f.task.id,corrected);
 assert.equal(f.calls,8);
});
test('a cloned repair request cannot discard the host-bound complete specialist feedback',async()=>{
 const f=await longFeedbackFixture();
 await assert.rejects(()=>f.team.repair(f.plan,f.task.id,f.snapshot,{...f.request}));assert.equal(f.calls,4);
});
