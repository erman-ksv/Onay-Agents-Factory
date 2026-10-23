import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
import {createCalculatorPlan} from './calculatorPlan.js';import {createCalculatorModelTeam} from './calculatorModelTeam.js';
import {loadCalculatorSnapshot} from '../github/calculatorSnapshot.js';import {prepareCalculatorRoleChanges} from '../commander/calculatorTeam.js';
import {calculatorProposalDigest} from './calculatorExecutionEvidence.js';import {collectCalculatorFailedTestEvidence} from './calculatorFailedTestRepair.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/calculatorStep7SavedPlan.json',import.meta.url),'utf8'));
const plan=createCalculatorPlan(fixture.request,fixture.proposal),task=plan.tasks[2]!,sha='a'.repeat(40);
const core='export function calculate(left, operator, right) { return left + right; }\n';
async function load(paths:string[],existing=false){const blob=createHash('sha1').update('blob '+Buffer.byteLength(core)+'\0'+core).digest('hex');return loadCalculatorSnapshot({repository:plan.owner.repository,baseRef:plan.branch,baseSha:sha,changePaths:paths},{getHead:async()=>sha,readCommit:async()=>({sha,treeSha:sha}),readTree:async()=>({sha,truncated:false,tree:existing?[{path:'src',type:'tree',mode:'040000',sha},{path:'src/calculator.mjs',type:'blob',mode:'100644',sha:blob}]:[]}),readBlob:async()=>({sha:blob,encoding:'base64',content:Buffer.from(core).toString('base64')})});}
async function setup(decline=false){const snapshot=await load([...task.paths]),dependency=await load(['src/calculator.mjs'],true);
 const raw={summary:'Previous agent proposal',changes:task.paths.map(path=>({operation:'create',path,content:path==='src/app.mjs'?'export const app = 1;':'export const tests = 1;',message:'Scoped agent file'}))};
 const previous=prepareCalculatorRoleChanges(task.role,raw,snapshot);let calls=0,clock=0;const packets:any[]=[],rejectedCodes:string[]=[];
 const team=createCalculatorModelTeam(fixture.request,{AGENT_FACTORY_TARGET_PROFILE:'calculator',AGENT_FACTORY_PROVIDER:'groq',GROQ_API_KEY:'fixture-key',CALCULATOR_MODEL_LIVE_APPROVED:'ONE_FREE_BOUNDED_RUN',ONAY_TEAM_FREE_TIER_CONFIRMED:'true',AGENT_FACTORY_LEGAL_ENABLED:'false'},async(_url,init)=>{calls++;packets.push(JSON.parse(String(init?.body)));return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(calls===1?(decline?{summary:'Blocked: insufficient verified evidence',changes:[]}:{...raw,summary:'Agent repaired imports'}):{ready:true,summary:'Scoped evidence inspected',findings:[],unverifiedAreas:['Runtime behavior beyond supplied evidence remains unverified']})}}]});},{now:()=>clock,wait:async ms=>{clock+=ms;}},undefined,{afterProposalRejected:rejection=>{rejectedCodes.push(rejection.validationCode);}},'calculator-restored-repair-four-roles');
 const restored=team.restoreProposal(plan,task.id,snapshot,JSON.parse(JSON.stringify(previous)),calculatorProposalDigest(previous));
 const token=await collectCalculatorFailedTestEvidence(task,restored,async()=>({repository:restored.repository,taskId:task.id,baseSha:sha,proposalDigest:calculatorProposalDigest(restored),status:'failed',testsExecuted:true,failures:['Trusted isolated task check failed: project-tests.']}));return{team,snapshot,dependency,restored,token,packets,rejectedCodes,calls:()=>calls};}
test('executed failure opens one author repair without inventing specialist approvals; all roles remain fresh',async()=>{
 const f=await setup();const request=f.team.importFailedHostTestRepair(plan,task.id,f.restored,f.token,f.dependency);assert.equal(f.calls(),0);
 const repaired=await f.team.repair(plan,task.id,f.snapshot,request);const packet=JSON.parse(f.packets[0]!.messages[1].content);
 assert.deepEqual(packet.repair.specialistFeedback,[]);assert.equal(packet.repair.actualProposalTests.testsExecuted,true);assert.equal(packet.repair.actualProposalTests.status,'failed');assert.equal(repaired.gates.publicationAuthorized,false);
 for(const role of ['security','reviewer','tester'] as const)await f.team.assess(role,plan,task.id,repaired);assert.equal(f.calls(),4);
 await assert.rejects(()=>f.team.repair(plan,task.id,f.snapshot,request));assert.equal(f.calls(),4);
});
test('cloned failure capability refuses before any author call',async()=>{const f=await setup();assert.throws(()=>f.team.importFailedHostTestRepair(plan,task.id,f.restored,structuredClone(f.token),f.dependency));assert.equal(f.calls(),0);});

test('explicit empty-change decline remains blocked, keeps a safe reason and never retries or authorizes reviewers',async()=>{
 const f=await setup(true);const request=f.team.importFailedHostTestRepair(plan,task.id,f.restored,f.token,f.dependency);
 await assert.rejects(()=>f.team.repair(plan,task.id,f.snapshot,request));
 assert.deepEqual(f.rejectedCodes,['model_declined_proposal']);assert.equal(f.team.diagnostic().reasonCode,'model_declined_proposal');assert.equal(f.team.diagnostic().proposalBlocked,true);assert.equal(f.team.diagnostic().blockedReason,'Blocked: insufficient verified evidence');
 await assert.rejects(()=>f.team.repair(plan,task.id,f.snapshot,request));await assert.rejects(()=>f.team.assess('security',plan,task.id,f.restored));assert.equal(f.calls(),1);
});

test('keyboard repair receives bounded original excerpts with exact SHA and explicit unknowns, never the full private original',async()=>{
 const source='const privateMarker=0;\n'+'// preserved private source data\n'.repeat(100)+'export const endMarker=0;\n';
 const blob=createHash('sha1').update('blob '+Buffer.byteLength(source)+'\0'+source).digest('hex');
 const snapshot=await loadCalculatorSnapshot({repository:plan.owner.repository,baseRef:plan.branch,baseSha:sha,changePaths:[...task.paths]},{getHead:async()=>sha,readCommit:async()=>({sha,treeSha:sha}),readTree:async()=>({sha,truncated:false,tree:[{path:'src',type:'tree',mode:'040000',sha},{path:'src/app.mjs',type:'blob',mode:'100644',sha:blob}]}),readBlob:async()=>({sha:blob,encoding:'base64',content:Buffer.from(source).toString('base64')})});
 const dependency=await load(['src/calculator.mjs'],true);
 const raw={summary:'Scoped keyboard fixture',changes:[{operation:'patch',path:'src/app.mjs',sourceSha256:createHash('sha256').update(source).digest('hex'),edits:[{before:'const privateMarker=0;',after:'const privateMarker=1;'}],message:'Scoped patch'},{operation:'create',path:'test/ui.test.mjs',content:'export const tests=1;',message:'Scoped test'}]};
 const previous=prepareCalculatorRoleChanges(task.role,raw,snapshot);let packet:any;
 const team=createCalculatorModelTeam(fixture.request,{AGENT_FACTORY_TARGET_PROFILE:'calculator',AGENT_FACTORY_PROVIDER:'groq',GROQ_API_KEY:'fixture-key',CALCULATOR_MODEL_LIVE_APPROVED:'ONE_FREE_BOUNDED_RUN',ONAY_TEAM_FREE_TIER_CONFIRMED:'true',AGENT_FACTORY_LEGAL_ENABLED:'false'},async(_url,init)=>{packet=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(raw)}}]});},{},undefined,undefined,'calculator-restored-repair-four-roles');
 const restored=team.restoreProposal(plan,task.id,snapshot,JSON.parse(JSON.stringify(previous)),calculatorProposalDigest(previous));
 const token=await collectCalculatorFailedTestEvidence(task,restored,async()=>({repository:restored.repository,taskId:task.id,baseSha:sha,proposalDigest:calculatorProposalDigest(restored),status:'failed',testsExecuted:true,failures:['Trusted isolated task check failed: project-tests.']}));
 const request=team.importFailedHostTestRepair(plan,task.id,restored,token,dependency);await team.repair(plan,task.id,snapshot,request);
 const evidence=packet.evidence.find((v:any)=>v.path==='src/app.mjs');assert.equal(evidence.sourceSha256,createHash('sha256').update(source).digest('hex'));assert.ok(evidence.excerpt.text.length>0&&evidence.excerpt.text.length<=1000);assert.ok(evidence.relatedExcerpt.text.length<=750);
 assert.equal(JSON.stringify(packet).includes(source),false);assert.equal(JSON.stringify(packet).includes(core),false);assert.ok(evidence.relatedExcerpt.startCharacter>evidence.excerpt.endCharacter);assert.match(evidence.unverified,/Remaining original source is omitted/);
});

test('rejected draft feedback is private host-bound data with validator reasons, never an approval or retry',async()=>{
 const f=await setup();const request=f.team.importFailedHostTestRepair(plan,task.id,f.restored,f.token,f.dependency);
 const raw={summary:'Untrusted rejected candidate',changes:[{operation:'patch',path:'test/ui.test.mjs',sourceSha256:'0'.repeat(64),edits:[{before:'x',after:'y'}],message:'Draft'}]};
 f.team.attachRejectedProposalFeedback(plan,task.id,request,raw);await f.team.repair(plan,task.id,f.snapshot,request);
 const packet=JSON.parse(f.packets[0]!.messages[1].content);assert.deepEqual(packet.repair.rejectedProposal,raw);assert.deepEqual(packet.repair.proposalValidation,[{code:'patch_target_absent',path:'test/ui.test.mjs'}]);assert.deepEqual(packet.repair.specialistFeedback,[]);assert.equal(f.calls(),1);
 const other=await setup();const another=other.team.importFailedHostTestRepair(plan,task.id,other.restored,other.token,other.dependency);assert.throws(()=>other.team.attachRejectedProposalFeedback(plan,task.id,{...another},raw));assert.equal(other.calls(),0);
});
