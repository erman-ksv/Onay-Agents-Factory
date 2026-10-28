import test from 'node:test';import assert from 'node:assert/strict';
import {createProjectPublicationHostFixtureForTests as fixture} from '../config/fixtures/projectPublicationFixture.js';
import {createProjectExecutionAdmission} from './projectExecutionAdmission.js';
import {createProjectTaskModelTransport} from './projectTaskModelTransport.js';
test('unsupported reasoning or missing OSS JSON policy stops before reservation, HTTP and checkpoint',async()=>{
 for(const [model,settings] of [['openai/gpt-oss-120b',{reasoning_effort:'high',response_format:{type:'json_object'}}],['openai/gpt-oss-120b',{reasoning_effort:'low'}],['openai/gpt-oss-120b',{}],['qwen/qwen3-32b',{reasoning_effort:'low'}]] as const){
  const f=await fixture();let calls=0,checkpoints=0;try{const admission=await createProjectExecutionAdmission(f.plan,f.controller,{assertSource:async()=>{},assertDependencies:async()=>{}}).prepare(f.taskId),wire=createProjectTaskModelTransport({plan:f.plan,taskId:f.taskId,admission,env:{...f.env,AGENT_FACTORY_PROVIDER:'groq',GROQ_MODEL:model,GROQ_API_KEY:'offline-policy-only'},assertRequestContext:async()=>{},checkpoint:async()=>{checkpoints++;},transport:async()=>{calls++;throw Error('No HTTP allowed');}});
   await assert.rejects(()=>wire.request(JSON.stringify({model,messages:[{role:'user',content:'Bounded offline policy check'}],max_completion_tokens:1200,n:1,stream:false,...settings})));assert.equal(calls,0);assert.equal(checkpoints,0);assert.equal((await f.controller.inspect()).used.requests,0);assert.equal(wire.snapshot().reasonCode,'invalid-request');
  }finally{f.cleanup();}
 }
});
