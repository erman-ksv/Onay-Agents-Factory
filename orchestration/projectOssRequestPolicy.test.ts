import test from 'node:test';import assert from 'node:assert/strict';
import {createProjectPublicationHostFixtureForTests as fixture} from '../config/fixtures/projectPublicationFixture.js';
import {createProjectExecutionAdmission} from './projectExecutionAdmission.js';
import {createProjectTaskModelTransport} from './projectTaskModelTransport.js';
test('unsupported explicit reasoning or missing JSON for that override stops before reservation, HTTP and checkpoint',async()=>{
 for(const [model,settings] of [['openai/gpt-oss-120b',{reasoning_effort:'high',response_format:{type:'json_object'}}],['openai/gpt-oss-120b',{reasoning_effort:'low'}],['qwen/qwen3-32b',{reasoning_effort:'low'}]] as const){
  const f=await fixture();let calls=0,checkpoints=0;try{const admission=await createProjectExecutionAdmission(f.plan,f.controller,{assertSource:async()=>{},assertDependencies:async()=>{}}).prepare(f.taskId),wire=createProjectTaskModelTransport({plan:f.plan,taskId:f.taskId,admission,env:{...f.env,AGENT_FACTORY_PROVIDER:'groq',GROQ_MODEL:model,GROQ_API_KEY:'offline-policy-only'},assertRequestContext:async()=>{},checkpoint:async()=>{checkpoints++;},transport:async()=>{calls++;throw Error('No HTTP allowed');}});
   await assert.rejects(()=>wire.request(JSON.stringify({model,messages:[{role:'user',content:'Bounded offline policy check'}],max_completion_tokens:1200,n:1,stream:false,...settings})));assert.equal(calls,0);assert.equal(checkpoints,0);assert.equal((await f.controller.inspect()).used.requests,0);assert.equal(wire.snapshot().reasonCode,'invalid-request');
  }finally{f.cleanup();}
 }
});
test('legacy OSS transport without a reasoning override preserves reserve/checkpoint/HTTP behavior',async()=>{
 const f=await fixture();let calls=0,checkpoints=0;try{const admission=await createProjectExecutionAdmission(f.plan,f.controller,{assertSource:async()=>{},assertDependencies:async()=>{}}).prepare(f.taskId),wire=createProjectTaskModelTransport({plan:f.plan,taskId:f.taskId,admission,env:{...f.env,AGENT_FACTORY_PROVIDER:'groq',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_API_KEY:'offline-policy-only'},assertRequestContext:async()=>{},checkpoint:async()=>{checkpoints++;},transport:async(_url,init)=>{calls++;assert.equal(JSON.parse(String(init?.body)).reasoning_effort,undefined);return Response.json({},{status:401});}});
  await assert.rejects(()=>wire.request(JSON.stringify({model:'openai/gpt-oss-120b',messages:[{role:'user',content:'Legacy offline transport check'}],max_completion_tokens:1200,n:1,stream:false})));assert.equal(calls,1);assert.equal(checkpoints,1);assert.equal((await f.controller.inspect()).used.requests,1);assert.equal(wire.snapshot().reasonCode,'transport_error');
 }finally{f.cleanup();}
});
