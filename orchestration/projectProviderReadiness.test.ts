import test from 'node:test';import assert from 'node:assert/strict';
import {inspectProjectGroqReadiness as native,inspectProjectGroqReadinessForTests as inspect} from './projectProviderReadiness.js';
const options={model:'qwen/qwen3-32b',apiKey:'PRIVATE_KEY_MUST_NOT_APPEAR'};
test('readiness uses one bounded GET of fixed metadata endpoint and grants no generation or free-tier attestation',async()=>{
 let calls=0;const r=await inspect(options,async(url,init)=>{calls++;assert.equal(String(url),'https://api.groq.com/openai/v1/models');assert.equal(init?.method,'GET');assert.equal(init?.body,undefined);assert.equal(init?.redirect,'error');return Response.json({data:[{id:options.model,active:true,privateBody:options.apiKey}]});});assert.equal(calls,1);assert.equal(r.status,'available');assert.equal(r.modelActive,true);assert.equal(r.provenance,'simulated');assert.equal(r.modelGenerationRequests,0);assert.equal(r.executionAuthorized,false);assert.equal(JSON.stringify(r).includes(options.apiKey),false);
});
test('missing or inactive model cannot be replaced by an available alternative',async()=>{
 const absent=await inspect(options,async()=>Response.json({data:[{id:'other',active:true}]}));assert.equal(absent.status,'unavailable');assert.equal(absent.reason,'model-missing');
 const inactive=await inspect(options,async()=>Response.json({data:[{id:options.model,active:false}]}));assert.equal(inactive.status,'unavailable');assert.equal(inactive.reason,'model-inactive');
});
test('HTTP rejection, network error, malformed, oversized and duplicate metadata fail closed without exposing provider content',async()=>{
 const responses=[()=>Response.json({error:options.apiKey},{status:401}),()=>{throw Error(options.apiKey);},()=>new Response(options.apiKey),()=>new Response('x'.repeat(65537)),()=>Response.json({data:[{id:options.model},{id:options.model}]}),()=>Response.json({data:[{id:options.model,active:'true'}]})];
 for(const response of responses){const r=await inspect(options,async()=>response());assert.equal(r.status,'unverified');assert.equal(r.modelGenerationRequests,0);assert.equal(JSON.stringify(r).includes(options.apiKey),false);}
});
test('invalid scope and native transport injection are rejected before HTTP',async()=>{
 let calls=0;for(const change of [{model:'https://evil.test'},{apiKey:''},{model:options.apiKey}])await assert.rejects(()=>inspect({...options,...change},async()=>{calls++;throw Error('No HTTP');}));await assert.rejects(()=>native({...options,transport:async()=>{calls++;}} as any));assert.equal(calls,0);
});
