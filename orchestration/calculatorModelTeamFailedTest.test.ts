import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
import {createCalculatorPlan} from './calculatorPlan.js';import {createCalculatorModelTeam} from './calculatorModelTeam.js';
import {loadCalculatorSnapshot} from '../github/calculatorSnapshot.js';import {prepareCalculatorRoleChanges} from '../commander/calculatorTeam.js';
import {calculatorProposalDigest} from './calculatorExecutionEvidence.js';import {collectCalculatorFailedTestEvidence} from './calculatorFailedTestRepair.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/calculatorStep7SavedPlan.json',import.meta.url),'utf8'));
const plan=createCalculatorPlan(fixture.request,fixture.proposal),task=plan.tasks[2]!,sha='a'.repeat(40);
const core='export function calculate(left, operator, right) { return left + right; }\n';
async function load(paths:string[],existing=false){const blob=createHash('sha1').update('blob '+Buffer.byteLength(core)+'\0'+core).digest('hex');return loadCalculatorSnapshot({repository:plan.owner.repository,baseRef:plan.branch,baseSha:sha,changePaths:paths},{getHead:async()=>sha,readCommit:async()=>({sha,treeSha:sha}),readTree:async()=>({sha,truncated:false,tree:existing?[{path:'src',type:'tree',mode:'040000',sha},{path:'src/calculator.mjs',type:'blob',mode:'100644',sha:blob}]:[]}),readBlob:async()=>({sha:blob,encoding:'base64',content:Buffer.from(core).toString('base64')})});}
async function setup(){const snapshot=await load([...task.paths]),dependency=await load(['src/calculator.mjs'],true);
 const raw={summary:'Previous agent proposal',changes:task.paths.map(path=>({operation:'create',path,content:path==='src/app.mjs'?'export const app = 1;':'export const tests = 1;',message:'Scoped agent file'}))};
 const previous=prepareCalculatorRoleChanges(task.role,raw,snapshot);let calls=0,clock=0;const packets:any[]=[];
 const team=createCalculatorModelTeam(fixture.request,{AGENT_FACTORY_TARGET_PROFILE:'calculator',AGENT_FACTORY_PROVIDER:'groq',GROQ_API_KEY:'fixture-key',CALCULATOR_MODEL_LIVE_APPROVED:'ONE_FREE_BOUNDED_RUN',ONAY_TEAM_FREE_TIER_CONFIRMED:'true',AGENT_FACTORY_LEGAL_ENABLED:'false'},async(_url,init)=>{calls++;packets.push(JSON.parse(String(init?.body)));return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(calls===1?{...raw,summary:'Agent repaired imports'}:{ready:true,summary:'Scoped evidence inspected',findings:[],unverifiedAreas:['Runtime behavior beyond supplied evidence remains unverified']})}}]});},{now:()=>clock,wait:async ms=>{clock+=ms;}},undefined,undefined,'calculator-restored-repair-four-roles');
 const restored=team.restoreProposal(plan,task.id,snapshot,JSON.parse(JSON.stringify(previous)),calculatorProposalDigest(previous));
 const token=await collectCalculatorFailedTestEvidence(task,restored,async()=>({repository:restored.repository,taskId:task.id,baseSha:sha,proposalDigest:calculatorProposalDigest(restored),status:'failed',testsExecuted:true,failures:['Trusted isolated task check failed: project-tests.']}));return{team,snapshot,dependency,restored,token,packets,calls:()=>calls};}
test('executed failure opens one author repair without inventing specialist approvals; all roles remain fresh',async()=>{
 const f=await setup();const request=f.team.importFailedHostTestRepair(plan,task.id,f.restored,f.token,f.dependency);assert.equal(f.calls(),0);
 const repaired=await f.team.repair(plan,task.id,f.snapshot,request);const packet=JSON.parse(f.packets[0]!.messages[1].content);
 assert.deepEqual(packet.repair.specialistFeedback,[]);assert.equal(packet.repair.actualProposalTests.testsExecuted,true);assert.equal(packet.repair.actualProposalTests.status,'failed');assert.equal(repaired.gates.publicationAuthorized,false);
 for(const role of ['security','reviewer','tester'] as const)await f.team.assess(role,plan,task.id,repaired);assert.equal(f.calls(),4);
 await assert.rejects(()=>f.team.repair(plan,task.id,f.snapshot,request));assert.equal(f.calls(),4);
});
test('cloned failure capability refuses before any author call',async()=>{const f=await setup();assert.throws(()=>f.team.importFailedHostTestRepair(plan,task.id,f.restored,structuredClone(f.token),f.dependency));assert.equal(f.calls(),0);});
