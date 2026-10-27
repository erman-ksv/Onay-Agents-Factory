import test from 'node:test';import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';import {join} from 'node:path';
import {createProjectNextWorkerFixtureForTests} from '../config/fixtures/projectNextWorkerFixture.js';
import {saveProjectPublicationIntent} from '../github/projectPublisher.js';
import {createProjectCheckpointArchiveForTests} from '../github/projectCheckpointArchive.js';
import {runProjectCiContinuation,runProjectCiContinuationForTests,PROJECT_CI_CONTINUATION_ERROR} from './projectCiContinuation.js';
async function fixture(mode='normal'){
 const f=await createProjectNextWorkerFixtureForTests(mode);try{
  const path=join(f.root,'initial-intent.json'),sealed=await saveProjectPublicationIntent(f.checkpoints.find(e=>e.stage==='before-push').intent,f.key,path);await f.archive.persist({kind:'before-push',taskId:f.plan.tasks[0]!.id,path,sha256:sealed.sha256});
  let n=0,time=0,waits=0;const options=()=>{const directory=join(f.root,'continuation-'+(++n));mkdirSync(directory,{mode:0o700});const {deliveryDirectory,...rest}=f.options;return {...rest,directory,candidateSha:f.candidate.candidateSha,polling:{maxPolls:3,intervalMs:10000}};};
  const timing={now:()=>time,wait:async(ms:number)=>{waits++;time+=ms;}};
  return {...f,options,timing,waits:()=>waits};
 }catch(e){f.cleanup();throw e;}
}
const stopped=(e:unknown)=>e instanceof Error&&e.message===PROJECT_CI_CONTINUATION_ERROR;
test('active bounded runner observes CI, executes one successor and confirms its CI without external dispatch',async()=>{
 const f=await fixture();try{const result=await runProjectCiContinuationForTests(f.options(),f.injections,f.timing);assert.equal(result.status,'plan-ci-recorded');assert.equal(result.transitions,1);assert.equal(result.polls,2);assert.equal(f.calls(),4);assert.equal((await f.controller.inspect()).used.requests,8);assert.equal(result.wholeProjectCompleted,false);assert.equal((await f.archive.history()).filter(e=>e.kind==='ci-claim').length,2);}finally{f.cleanup();}
});
test('pending CI is bounded and returns awaiting-ci with no model or state writes',async()=>{
 const f=await fixture();try{f.state.ciMode='pending';const pin=f.archive.snapshot().pin,result=await runProjectCiContinuationForTests(f.options(),f.injections,f.timing);assert.equal(result.status,'awaiting-ci');assert.equal(result.polls,3);assert.equal(f.waits(),2);assert.equal(f.calls(),0);assert.deepEqual(f.archive.snapshot().pin,pin);}finally{f.cleanup();}
});
test('CI can turn green during bounded waiting without a manual second launch',async()=>{
 const f=await fixture();try{f.state.ciMode='pending';const timing={now:f.timing.now,wait:async(ms:number)=>{await f.timing.wait(ms);f.state.ciMode='normal';}},result=await runProjectCiContinuationForTests(f.options(),f.injections,timing);assert.equal(result.status,'plan-ci-recorded');assert.equal(f.waits(),1);assert.equal(f.calls(),4);}finally{f.cleanup();}
});
test('failed CI never dispatches or retries',async()=>{
 const f=await fixture();try{f.state.ciMode='failed';const pin=f.archive.snapshot().pin,result=await runProjectCiContinuationForTests(f.options(),f.injections,f.timing);assert.equal(result.status,'ci-failed');assert.equal(result.polls,1);assert.equal(f.waits(),0);assert.equal(f.calls(),0);assert.deepEqual(f.archive.snapshot().pin,pin);}finally{f.cleanup();}
});
test('cold replay after terminal 429 cannot resend a model request or charge',async()=>{
 const f=await fixture('429');try{
  assert.equal((await runProjectCiContinuationForTests(f.options(),f.injections,f.timing)).status,'dispatch-uncertain');assert.equal(f.calls(),1);
  const archive=createProjectCheckpointArchiveForTests({controller:f.controller,token:'offline-archive-token',pin:f.archive.snapshot().pin},f.storage.transport);
  assert.equal((await runProjectCiContinuationForTests({...f.options(),archive},f.injections,f.timing)).status,'already-recorded');assert.equal(f.calls(),1);assert.equal((await f.controller.inspect()).used.requests,5);
 }finally{f.cleanup();}
});
test('unbounded polling, extra adapters and simulated native archive are refused',async()=>{
 const f=await fixture();try{for(const polling of [{maxPolls:0,intervalMs:10000},{maxPolls:13,intervalMs:10000},{maxPolls:1,intervalMs:1},{maxPolls:1,intervalMs:15001}])await assert.rejects(()=>runProjectCiContinuationForTests({...f.options(),polling},f.injections,f.timing),stopped);
  await assert.rejects(()=>runProjectCiContinuationForTests({...f.options(),transport:f.injections.github} as any,f.injections,f.timing),stopped);await assert.rejects(()=>runProjectCiContinuation(f.options()),stopped);assert.equal(f.calls(),0);
 }finally{f.cleanup();}
});
test('owner revocation or elapsed/backward clock while waiting prevents successor execution',async()=>{
 for(const mode of ['revoked','elapsed','backward']){const f=await fixture();try{f.state.ciMode='pending';let now=100;const timing={now:()=>now,wait:async()=>{f.state.ciMode='normal';if(mode==='revoked')f.state.owner=false;else now=mode==='elapsed'?700000:0;}};await assert.rejects(()=>runProjectCiContinuationForTests(f.options(),f.injections,timing),stopped);assert.equal(f.calls(),0);assert.equal((await f.archive.snapshot()).pin?.sequence,1);}finally{f.cleanup();}}
});
