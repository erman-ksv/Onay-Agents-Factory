import test from "node:test";
import assert from "node:assert/strict";
import { createMistralFreeFetch, MISTRAL_CHAT_URL, MISTRAL_SMALL_MODEL } from "./mistralFree.js";
import { selectProviderConfig } from "./providerConfig.js";
import { configureModelProvider } from "./modelProvider.js";
import { createAiCommander } from "./aiCommander.js";

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
