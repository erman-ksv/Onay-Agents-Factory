import test from "node:test";
import assert from "node:assert/strict";
import { createMistralFreeFetch, MISTRAL_CHAT_URL, MISTRAL_SMALL_MODEL } from "./mistralFree.js";
import { selectProviderConfig } from "./providerConfig.js";
import { configureModelProvider } from "./modelProvider.js";
import { createAiCommander, runAiCommander } from "./aiCommander.js";
import type { AiExecutionDependencies } from "./aiExecution.js";

const body = { model:MISTRAL_SMALL_MODEL, messages:[{role:"user",content:[{type:"text",text:"ping"}]}], max_tokens:9000 };
const send=(fn:typeof fetch,b:unknown=body)=>fn(MISTRAL_CHAT_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});

test("Mistral only explicit, no inherited API key or arbitrary paid model",()=>{
 assert.deepEqual(selectProviderConfig({MISTRAL_API_KEY:"key"}),{provider:"none"});
 assert.deepEqual(selectProviderConfig({AGENT_FACTORY_PROVIDER:"mistral",GROQ_API_KEY:"key"}),{provider:"none"});
 assert.deepEqual(selectProviderConfig({AGENT_FACTORY_PROVIDER:"mistral",MISTRAL_API_KEY:" key "}),{provider:"mistral",apiKey:"key",model:MISTRAL_SMALL_MODEL,baseURL:"https://api.mistral.ai/v1"});
 assert.throws(()=>selectProviderConfig({AGENT_FACTORY_PROVIDER:"mistral",MISTRAL_API_KEY:"key",MISTRAL_MODEL:"premium-model"}),/Arbitrary routes are disabled/);
});

test("Mistral sends normalized bounded text to fixed endpoint, no duplicate requests",async()=>{
 let calls=0;
 const fetcher=createMistralFreeFetch(async(input)=>{calls++;const req=new Request(input);assert.equal(req.url,MISTRAL_CHAT_URL);const b=await req.json();assert.equal(b.messages[0].content,"ping");assert.equal(b.max_tokens,512);return Response.json({choices:[]});},{maxCalls:1});
 assert.equal((await send(fetcher)).status,200);
 assert.equal((await send(fetcher)).status,429);
 assert.equal(calls,1);
});

test("Mistral unknown and multimodal payloads fail closed before network",async()=>{
 let calls=0;
 for(const candidate of [{...body,model:"premium"}, {...body,messages:[{role:"user",content:[{type:"image_url",image_url:"sensitive"}]}]}, {...body,n:2}]){
   const fn=createMistralFreeFetch(async()=>{calls++;return Response.json({});});
   assert.equal((await send(fn,candidate)).status,400);
   assert.equal((await send(fn)).status,429);
 }
 assert.equal(calls,0);
});

test("Mistral HTTP 429 is sanitized, stops without retries",async()=>{
 let calls=0;
 const fn=createMistralFreeFetch(async()=>{calls++;return new Response("provider-sensitive", {status:429,headers:{"x-secret":"do-not-leak"}});});
 const first=await send(fn);
 assert.equal(first.status,429);
 assert.ok(!(await first.text()).includes("provider-sensitive"));
 assert.equal(first.headers.get("x-secret"),null);
 assert.equal((await send(fn)).status,429);
 assert.equal(calls,1);
});

test("Mistral compact Commander exposes one host audit tool, no legal or publication",()=>{
 const env={AGENT_FACTORY_PROVIDER:"mistral",MISTRAL_API_KEY:"offline",AGENT_ALLOWED_REPOSITORIES:"erman-ksv/Onay",AGENT_FACTORY_LEGAL_ENABLED:"false",AGENT_FACTORY_ENABLE_GITHUB_WRITES:"false"};
 const c=createAiCommander("Audit Onay repository main. Read-only audit.",{env});
 assert.equal(c.provider,"mistral");
 assert.deepEqual(c.commander.tools.map(t=>t.name),["audit_onay_read_only"]);
 assert.deepEqual(c.session.options.requiredActors,["explorer","tester","security"]);
 const d=createAiCommander("Implement Onay passenger booking",{env});
 assert.ok(d.commander.tools.some(t=>t.name==="code_onay"));
 assert.ok(!d.commander.tools.some(t=>t.name==="audit_onay_read_only"||t.name==="rasul_legal_compliance"));
});

test("Mistral SDK client uses selected provider",()=>{
 const e=configureModelProvider({AGENT_FACTORY_PROVIDER:"mistral",MISTRAL_API_KEY:"fixture"});
 assert.equal(e.provider,"mistral");
 if(e.provider==="mistral")assert.equal(e.model,"mistral-small-latest");
});


test("Mistral concurrent calls are serialized, safely paced and never retried",async()=>{
 let active=0,maxActive=0,calls=0;
 const observed: Array<{requestNumber:number;bytes:number;status:number;waitedMs:number}>=[];
 const fn=createMistralFreeFetch(async()=>{active++;maxActive=Math.max(maxActive,active);calls++;await new Promise<void>(resolve=>setTimeout(resolve,5));active--;return Response.json({choices:[]});},
   {maxCalls:2,minIntervalMs:20,onDiagnostic:v=>observed.push(v)});
 const [a,b]=await Promise.all([send(fn),send(fn)]);
 assert.equal(a.status,200);assert.equal(b.status,200);
 assert.equal(maxActive,1);assert.equal(calls,2);
 assert.deepEqual(observed.map(v=>v.requestNumber),[1,2]);
 assert.ok(observed[1].waitedMs>0);
});

test("Mistral cumulative request-size budget stops before network",async()=>{
 let calls=0;
 const diagnostics: Array<{bytes:number}>=[];
 const probe=createMistralFreeFetch(async()=>Response.json({choices:[]}),{minIntervalMs:0,onDiagnostic:d=>diagnostics.push(d)});
 assert.equal((await send(probe)).status,200);
 const bytes=diagnostics[0].bytes;
 assert.ok(bytes>0);
 const fn=createMistralFreeFetch(async()=>{calls++;return Response.json({choices:[]});},{maxTotalBytes:bytes,maxCalls:4,minIntervalMs:0});
 assert.equal((await send(fn)).status,200);
 assert.equal((await send(fn)).status,400);
 assert.equal(calls,1);
});

test("Mistral request diagnostics contain metadata only, never keys or private source",async()=>{
 const recorded: unknown[]=[];
 const fn=createMistralFreeFetch(async()=>new Response("restricted", {status:429}),
   {minIntervalMs:0,onDiagnostic:info=>recorded.push(info)});
 await send(fn,{...body,messages:[{role:"user",content:"private Onay data SECRET"}]});
 assert.equal(recorded.length,1);
 assert.deepEqual(Object.keys(recorded[0] as object).sort(),["bytes","requestNumber","status","waitedMs"]);
 assert.equal((recorded[0] as {status:number}).status,429);
 assert.doesNotMatch(JSON.stringify(recorded),/SECRET|private Onay/);
});

test("Offline Mistral Commander full SDK tool roundtrip has exactly two paced model calls and no secret or source leakage",async()=>{
 const seen:Array<{status:number;bytes:number;requestNumber:number;waitedMs:number}>=[];
 const calls:string[]=[];
 const sha="a".repeat(40);
 const repo="erman-ksv/Onay";
 const deps:AiExecutionDependencies={
  getHead:async()=>{calls.push("head");return sha;},
  getCandidateHead:async()=>{throw Error("Unexpected candidate");},
  explore:async(ref)=>{calls.push("explorer");return {repository:repo,ref,files:[{path:"README.md",sha:"b".repeat(40),content:"private fixture marker never to model"}]};},
  generate:async()=>{throw Error("Unexpected generator");},
  review:()=>{throw Error("Unexpected reviewer");},
  scan:()=>{throw Error("Unexpected proposed scan");},
  inspectSecurity:async(ref)=>{calls.push("security");return {agent:"security",repository:repo,ref,status:"clean",findings:[]};},
  discoverTests:async()=>{calls.push("discover");return {scripts:["typecheck","test"]};},
  publish:async()=>{throw Error("Unexpected publish");},
  verify:async(ref,branch)=>{calls.push("verify");return {testsExecuted:true,repository:repo,ref:branch,expectedSha:ref,status:"passed",evidence:[{runId:101,name:"CI",headSha:ref,conclusion:"success",url:"https://github.com/erman-ksv/Onay/actions/runs/101"}],checks:[{jobName:"Typecheck and API tests",name:"API integration tests",status:"completed",conclusion:"success"}],notes:[]};}
 };
 let requestCount=0;
 const modelFetch:typeof fetch=async(input,init)=>{
   const req=new Request(input,init);
   const payload=await req.json() as {model:string;messages:unknown[]};
   requestCount++;
   assert.equal(req.url,MISTRAL_CHAT_URL);
   assert.equal(payload.model,MISTRAL_SMALL_MODEL);
   assert.doesNotMatch(JSON.stringify(payload),/private fixture marker never to model/);
   const message=requestCount===1
    ? {role:"assistant",content:null,tool_calls:[{id:"call1",type:"function",function:{name:"audit_onay_read_only",arguments:"{}"}}]}
    : {role:"assistant",content:"Audit verified by trusted host."};
   return Response.json({id:"offline",object:"chat.completion",created:1,model:MISTRAL_SMALL_MODEL,choices:[{index:0,message,finish_reason:requestCount===1?"tool_calls":"stop"}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}});
 };
 const result=await runAiCommander("Audit Onay repository main. Read-only audit.",{
    env:{AGENT_FACTORY_PROVIDER:"mistral",MISTRAL_API_KEY:"fixture-offline",AGENT_ALLOWED_REPOSITORIES:repo,ONAY_REPOSITORY:repo,AGENT_FACTORY_ENABLE_GITHUB_WRITES:"false",AGENT_FACTORY_LEGAL_ENABLED:"false"},
    dependencies:deps,modelFetch,maxTurns:4
 });
 assert.equal(result.status,"completed",result.reasons.join("; "));
 assert.equal(result.evidence.security?.repository?.status,"clean");
 assert.equal(result.evidence.testsExecuted,true);
 assert.deepEqual(result.missingActors,[]);
 assert.equal(requestCount,2);
 assert.deepEqual(calls,["head","explorer","security","discover","verify"]);
});
