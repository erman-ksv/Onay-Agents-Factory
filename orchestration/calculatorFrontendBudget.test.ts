import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CALCULATOR_FRONTEND_TASK_BUDGET as preset,CALCULATOR_SUCCESSOR_TASK_BUDGET,DEFAULT_TASK_MODEL_BUDGET,HARD_TASK_MODEL_BUDGET,createTaskModelBudgetFetch} from './taskModelBudget.js';
import {createCalculatorModelTeam} from './calculatorModelTeam.js';
import {createCalculatorPlan} from './calculatorPlan.js';
import {loadCalculatorSnapshot} from '../github/calculatorSnapshot.js';
import {buildCalculatorRoleInstructions} from '../commander/calculatorTeam.js';
import {createProviderContextBudget,createGroqBudgetedFetch} from '../commander/providerContextBudget.js';
import {runCalculatorRuntime,prepareCalculatorRuntimeHostLimits} from './calculatorRuntime.js';
const hostPreset='calculator-frontend-2048-four-roles' as const;
const saved=JSON.parse(readFileSync(new URL('./fixtures/calculatorStep7SavedPlan.json',import.meta.url),'utf8'));
const plan=createCalculatorPlan(saved.request,saved.proposal),task=plan.tasks[1]!;
const env={AGENT_FACTORY_TARGET_PROFILE:'calculator',AGENT_FACTORY_PROVIDER:'groq',GROQ_API_KEY:'fixture-key',CALCULATOR_MODEL_LIVE_APPROVED:'ONE_FREE_BOUNDED_RUN',ONAY_TEAM_FREE_TIER_CONFIRMED:'true',AGENT_FACTORY_LEGAL_ENABLED:'false'};
const proposal={summary:'Add bounded UI files',changes:task.paths.map(path=>({operation:'create',path,content:path==='index.html'?'<output>0</output>':path==='styles.css'?'output{display:block}':'export const initial=0;',message:'Add selected UI file'}))};
const response=(result:unknown,finish='stop')=>Response.json({choices:[{finish_reason:finish,message:{role:'assistant',content:JSON.stringify(result)}}]});
async function snapshot(){return loadCalculatorSnapshot({repository:plan.owner.repository,baseRef:plan.branch,baseSha:plan.owner.baseSha,changePaths:task.paths},{getHead:async()=>plan.owner.baseSha,readCommit:async()=>({sha:plan.owner.baseSha,treeSha:'b'.repeat(40)}),readTree:async()=>({sha:'b'.repeat(40),truncated:false,tree:[]}),readBlob:async()=>{throw Error('absent files cannot be read');}});}
test('only the exact new host profile raises the output ceiling; defaults and old admissions stay fixed',()=>{
 assert.equal(DEFAULT_TASK_MODEL_BUDGET.maxOutputTokens,1200);assert.equal(CALCULATOR_SUCCESSOR_TASK_BUDGET.maxOutputTokens,1200);assert.equal(HARD_TASK_MODEL_BUDGET.maxOutputTokens,2048);
 for(const key of Object.keys(preset) as (keyof typeof preset)[])for(const delta of [-1,1])assert.throws(()=>createTaskModelBudgetFetch({...preset,hostPreset,[key]:preset[key]+delta}));
 assert.throws(()=>createTaskModelBudgetFetch({hostPreset}));assert.throws(()=>createTaskModelBudgetFetch({...preset,hostPreset:'unknown' as typeof hostPreset}));
 assert.ok(buildCalculatorRoleInstructions('frontend',2048).includes('2048 output tokens'));assert.ok(!buildCalculatorRoleInstructions('frontend',2048).includes('1200 output tokens'));
 for(const role of ['security','reviewer','tester','coder','commander'])assert.throws(()=>buildCalculatorRoleInstructions(role,2048));
});
test('2048 survives both sending wrappers and the full reservation is charged before transport',async()=>{
 let calls=0;const context=createProviderContextBudget({reservedOutputTokens:2048});const body=JSON.stringify({messages:[{role:'user',content:'small'}],max_completion_tokens:2048});
 const taskBudget=createTaskModelBudgetFetch({...preset,hostPreset},async(_url,init)=>{calls++;assert.equal(JSON.parse(String(init?.body)).max_completion_tokens,2048);assert.equal(context.snapshot().reservedRunTokens,Math.ceil(Buffer.byteLength(String(init?.body))/3)+256+2048);return Response.json({});});
 const result=await createGroqBudgetedFetch(context,taskBudget.fetch)('https://api.groq.com/openai/v1/chat/completions',{method:'POST',body});assert.equal(result.status,200);await result.text();assert.equal(calls,1);
});
test('new profile completes a response rejected as truncated under the unchanged 1200-token profile',async()=>{
 const snap=await snapshot();let oldCalls=0,newCalls=0;
 const old=createCalculatorModelTeam(saved.request,env,async(_url,init)=>{oldCalls++;assert.equal(JSON.parse(String(init?.body)).max_completion_tokens,1200);return response({},'length');});
 await assert.rejects(()=>old.generate(plan,task.id,snap));await assert.rejects(()=>old.generate(plan,task.id,snap));assert.equal(oldCalls,1);
 const fresh=createCalculatorModelTeam(saved.request,env,async(_url,init)=>{newCalls++;assert.equal(JSON.parse(String(init?.body)).max_completion_tokens,2048);return response(proposal);},{},undefined,undefined,hostPreset);
 const result=await fresh.generate(plan,task.id,snap);assert.equal(result.files.length,3);assert.equal(result.gates.publicationAuthorized,false);assert.equal(newCalls,1);
});
test('only Frontend generation gets 2048; all three independent assessments remain 1200 and unexecuted',async()=>{
 let now=0;const caps:number[]=[],charges:number[]=[];
 const team=createCalculatorModelTeam(saved.request,env,async(_url,init)=>{const body=JSON.parse(String(init?.body));caps.push(body.max_completion_tokens);assert.ok(!body.tools);return caps.length===1?response(proposal):response({ready:true,summary:'Reviewed supplied changes only',findings:[],unverifiedAreas:['Actual tests have not run']});},{now:()=>now,wait:async ms=>{now+=ms;}},undefined,{beforeRequest:state=>{charges.push(state.reservedRunTokens);}},hostPreset);
 const changes=await team.generate(plan,task.id,await snapshot());for(const role of ['security','reviewer','tester'] as const){const a=await team.assess(role,plan,task.id,changes);assert.equal(a.testsExecuted,false);assert.equal(a.publicationAuthorized,false);}
 assert.deepEqual(caps,[2048,1200,1200,1200]);assert.equal(charges.length,4);assert.ok(charges.every((n,i)=>n>=(i?charges[i-1]!:2048)));assert.ok(charges[3]!<=16000);assert.equal(team.snapshot().legalEnabled,false);
});
test('four requests, 429 and cumulative context limits remain terminal without retries',async()=>{
 let calls=0,now=0;const budget=createTaskModelBudgetFetch({...preset,hostPreset,now:()=>now},async()=>{calls++;return Response.json({});});
 for(let i=0;i<4;i++){const r=await budget.fetch('https://model.invalid/',{method:'POST',body:'{"max_completion_tokens":2048}'});await r.text();}
 assert.equal((await budget.fetch('https://model.invalid/',{method:'POST',body:'{}'})).status,400);assert.equal(calls,4);
 const context=createProviderContextBudget({reservedOutputTokens:2048,now:()=>now});context.reserve(3952,2048);now=60000;context.reserve(3952,2048);now=120000;assert.equal(context.reserve(1953,2048)?.code,'run_budget_exceeded');assert.equal(context.snapshot().reservedRunTokens,12000);
 let sent=0;const team=createCalculatorModelTeam(saved.request,env,async()=>{sent++;return new Response('{}',{status:429});},{},undefined,undefined,hostPreset);const snap=await snapshot();await assert.rejects(()=>team.generate(plan,task.id,snap));await assert.rejects(()=>team.generate(plan,task.id,snap));assert.equal(sent,1);assert.equal(team.diagnostic().reasonCode,'model_rate_limited');
});
test('the larger output profile cannot be injected via normal runtime modes, charged tasks or another provider',async()=>{
 const limits={maxRequests:4,maxRunBytes:96000,maxRepairs:0,hostPreset} as const;assert.deepEqual(prepareCalculatorRuntimeHostLimits(limits),limits);
 const root=mkdtempSync(join(tmpdir(),'frontend-budget-'));try{for(const mode of ['inspect','plan','run','preflight'] as const){await assert.rejects(()=>runCalculatorRuntime(undefined,undefined,join(root,'state'),mode,{},limits));assert.equal(existsSync(join(root,'state')),false);}}finally{rmSync(root,{recursive:true,force:true});}
 assert.throws(()=>createCalculatorModelTeam(saved.request,env,undefined,{}, {attemptedRequests:1,totalRequestBytes:100,reservedRunTokens:100,elapsedMs:1},undefined,hostPreset));
 assert.throws(()=>createCalculatorModelTeam({...saved.request,provider:'gemini'},{...env,AGENT_FACTORY_PROVIDER:'gemini',GEMINI_API_KEY:'fixture-key'},undefined,{},undefined,undefined,hostPreset));
});
