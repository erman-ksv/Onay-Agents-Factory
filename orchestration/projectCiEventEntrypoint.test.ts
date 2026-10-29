import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createProjectNextWorkerFixtureForTests} from '../config/fixtures/projectNextWorkerFixture.js';
import {createProjectCheckpointArchiveForTests} from '../github/projectCheckpointArchive.js';
import {saveProjectPublicationIntent} from '../github/projectPublisher.js';
import {createProjectCiReaderForTests,projectCiEventRunMatches} from '../github/projectCi.js';
import {runProjectCiEvent,runProjectCiEventForTests,PROJECT_CI_EVENT_ERROR} from './projectCiEventEntrypoint.js';

async function fixture(mode='normal'){
 const f=await createProjectNextWorkerFixtureForTests(mode);
 try{
  const path=join(f.root,'initial-intent.json'),intent=f.checkpoints.find(e=>e.stage==='before-push').intent;
  const sealed=await saveProjectPublicationIntent(intent,f.key,path);
  await f.archive.persist({kind:'before-push',taskId:f.plan.tasks[0]!.id,path,sha256:sealed.sha256});
  let n=0;
  const coldOptions=()=>{const directory=join(f.root,'cold-'+(++n));mkdirSync(directory,{mode:0o700});const {deliveryDirectory,...rest}=f.options;return {...rest,directory};};
  const event=(changes:Record<string,unknown>={})=>JSON.stringify({version:1,repository:f.repo,branch:f.plan.branch,candidateSha:f.candidate.candidateSha,runId:901,runAttempt:1,conclusion:'success',...changes});
  return {...f,coldOptions,event};
 }catch(e){f.cleanup();throw e;}
}
const stopped=(e:unknown)=>e instanceof Error&&e.message===PROJECT_CI_EVENT_ERROR;

test('cold CI entrypoint restores encrypted intent and runs exactly one successor, then rejects old duplicate',async()=>{
 const f=await fixture();try{
  const first=await runProjectCiEventForTests(f.coldOptions(),f.event(),f.injections);
  assert.equal(first.status,'delivered');if(first.status!=='delivered')assert.fail();
  assert.equal(first.delivery.status,'notified');assert.ok(first.candidate);assert.equal(first.candidate.provenance,'simulated');assert.equal(f.calls(),4);assert.equal((await f.controller.inspect()).used.requests,8);
  const pin=f.archive.snapshot().pin,archive=createProjectCheckpointArchiveForTests({controller:f.controller,token:'offline-archive-token',pin},f.storage.transport);
  const duplicate=await runProjectCiEventForTests({...f.coldOptions(),archive},f.event(),f.injections);
  assert.equal(duplicate.status,'already-recorded');assert.equal(f.calls(),4);assert.deepEqual(archive.snapshot().pin,pin);
  assert.equal(f.gitCalls.filter(a=>a.includes('push')).length,2);
 }finally{f.cleanup();}
});
test('failed, foreign repository or wrong branch notice cannot hydrate, claim or run models',async()=>{
 const f=await fixture();try{for(const change of [{conclusion:'failure'},{conclusion:'cancelled'},{repository:'evil/foreign'},{branch:'main'}]){
  const options=f.coldOptions(),pin=f.archive.snapshot().pin;
  assert.equal((await runProjectCiEventForTests(options,f.event(change),f.injections)).status,'ignored');
  assert.deepEqual(f.archive.snapshot().pin,pin);assert.equal(f.calls(),0);
 }}finally{f.cleanup();}
});
test('untrusted event cannot supply source, grant, callback, extra fields, rerun or oversized payload',async()=>{
 const f=await fixture();try{for(const body of [f.event({runAttempt:2}),f.event({runId:0}),f.event({candidateSha:'invalid'}),f.event({source:'PRIVATE_SOURCE_MARKER'}),f.event({executionAuthorized:true}),f.event({repository:'x'.repeat(2100)}),'null','{']){
  await assert.rejects(()=>runProjectCiEventForTests(f.coldOptions(),body,f.injections),stopped);
 }assert.equal(f.calls(),0);assert.equal((await f.controller.inspect()).used.requests,4);}finally{f.cleanup();}
});
test('event success cannot substitute for actual failed or pending CI or another run ID',async()=>{
 for(const mode of ['failed','pending','normal']){const f=await fixture();try{
  f.state.ciMode=mode;
  await assert.rejects(()=>runProjectCiEventForTests(f.coldOptions(),f.event({runId:mode==='normal'?902:901}),f.injections),stopped);
  assert.equal(f.calls(),0);assert.equal((await f.archive.history()).length,1);
 }finally{f.cleanup();}}
});
test('native entrypoint refuses a simulated archive and cloned plan/controller without contacting a provider',async()=>{
 const f=await fixture();try{
  await assert.rejects(()=>runProjectCiEvent(f.coldOptions(),f.event()),stopped);
  await assert.rejects(()=>runProjectCiEventForTests({...f.coldOptions(),plan:{...f.plan}},f.event(),f.injections),stopped);
  await assert.rejects(()=>runProjectCiEventForTests({...f.coldOptions(),controller:{...f.controller}},f.event(),f.injections),stopped);
  assert.equal(f.calls(),0);
 }finally{f.cleanup();}
});
test('missing archive pin and absent or foreign candidate intent stop before model requests',async()=>{
 const f=await fixture();try{
  const archive=createProjectCheckpointArchiveForTests({controller:f.controller,token:'offline-archive-token',pin:null},f.storage.transport);
  await assert.rejects(()=>runProjectCiEventForTests({...f.coldOptions(),archive},f.event(),f.injections),stopped);
  await assert.rejects(()=>runProjectCiEventForTests(f.coldOptions(),f.event({candidateSha:'a'.repeat(40)}),f.injections),stopped);
  assert.equal(f.calls(),0);
 }finally{f.cleanup();}
});
test('terminal model 429 survives cold replay without another charge or request',async()=>{
 const f=await fixture('429');try{
  const result=await runProjectCiEventForTests(f.coldOptions(),f.event(),f.injections);
  assert.equal(result.status,'delivered');if(result.status!=='delivered')assert.fail();assert.equal(result.delivery.status,'dispatch-uncertain');assert.equal(f.calls(),1);
  const archive=createProjectCheckpointArchiveForTests({controller:f.controller,token:'offline-archive-token',pin:f.archive.snapshot().pin},f.storage.transport);
  assert.equal((await runProjectCiEventForTests({...f.coldOptions(),archive},f.event(),f.injections)).status,'already-recorded');
  assert.equal(f.calls(),1);assert.equal((await f.controller.inspect()).used.requests,5);assert.equal(f.gitCalls.filter(a=>a.includes('push')).length,1);
 }finally{f.cleanup();}
});
test('private source and raw model replies are not placed in event output or remote archive',async()=>{
 const f=await fixture();try{
  const result=await runProjectCiEventForTests(f.coldOptions(),f.event(),f.injections),text=JSON.stringify({result,requests:f.storage.requests});
  for(const secret of ['PRIVATE_SOURCE_MARKER','offline-next-worker-token','return (2);','offline-archive-token'])assert.equal(text.includes(secret),false);
 }finally{f.cleanup();}
});
test('owner revocation and nonempty recovery directory fail closed without model calls',async()=>{
 const f=await fixture();try{
  const options=f.coldOptions();writeFileSync(join(options.directory,'unexpected'),'preserve');
  await assert.rejects(()=>runProjectCiEventForTests(options,f.event(),f.injections),stopped);assert.equal(readFileSync(join(options.directory,'unexpected'),'utf8'),'preserve');
  f.state.owner=false;await assert.rejects(()=>runProjectCiEventForTests(f.coldOptions(),f.event(),f.injections),stopped);assert.equal(f.calls(),0);
 }finally{f.cleanup();}
});
test('a relay cannot disguise a stable second CI attempt as the first or copy its proof',async()=>{
 const f=await fixture();try{
  const transport=(async(input:unknown,init?:RequestInit)=>{
   const url=String(input),response=await f.transport(url.replace('/attempts/2/jobs','/attempts/1/jobs'),init);
   if(!url.includes('/actions/'))return response;
   const change=(v:any):any=>Array.isArray(v)?v.map(change):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,value])=>[k,k==='run_attempt'?2:change(value)])):v;
   return Response.json(change(await response.json()),{status:response.status});
  }) as typeof fetch;
  const evidence=await createProjectCiReaderForTests(f.ciPolicy,f.env,transport)({repository:f.repo,branch:f.plan.branch,candidateSha:f.candidate.candidateSha});
  assert.equal(evidence.status,'passed');assert.equal(projectCiEventRunMatches(evidence,901,2),true);assert.equal(projectCiEventRunMatches(evidence,901,1),false);assert.equal(projectCiEventRunMatches({...evidence},901,2),false);
  await assert.rejects(()=>runProjectCiEventForTests(f.coldOptions(),f.event(),{...f.injections,github:transport}),stopped);assert.equal(f.calls(),0);
 }finally{f.cleanup();}
});
