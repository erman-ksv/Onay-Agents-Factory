import test from 'node:test';import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,readdirSync,chmodSync,symlinkSync} from 'node:fs';import {join} from 'node:path';
import {createProjectPublicationFixtureForTests} from '../config/fixtures/projectPublicationFixture.js';
import {createProjectPublisherForTests,confirmProjectCandidateCi} from '../github/projectPublisher.js';
import {createProjectCiReaderForTests} from '../github/projectCi.js';
import {createProjectCorrectionRecoveryKey,destroyProjectCorrectionRecoveryKey,readProjectHostEnvelopeFile,writeProjectHostEnvelope} from './projectCorrectionCheckpoint.js';
import {createProjectCiDelivery,createProjectCiDeliveryForTests,PROJECT_CI_DELIVERY_ERROR} from './projectCiDelivery.js';
const refused=(e:unknown)=>e instanceof Error&&e.message===PROJECT_CI_DELIVERY_ERROR;
async function fixture(two=true,maxRequests=8){
 const f=await createProjectPublicationFixtureForTests(false,two,maxRequests),candidate=await createProjectPublisherForTests({env:f.env,checkpoint:f.checkpoint,transport:f.transport,runGit:f.gitRunner}).publish(f.approval),read=createProjectCiReaderForTests(f.ciPolicy,f.env,f.transport),input={repository:f.repo,branch:candidate.branch,candidateSha:candidate.candidateSha},key=createProjectCorrectionRecoveryKey('ci-delivery-test',randomBytes(32)),directory=join(f.root,'delivery');mkdirSync(directory,{mode:0o700});const options={plan:f.plan,controller:f.controller,directory,key};
 return{...f,candidate,options,directory,key,read,confirm:async()=>confirmProjectCandidateCi(candidate,await read(input)),open:()=>createProjectCiDeliveryForTests(options),cleanup:()=>{destroyProjectCorrectionRecoveryKey(key);f.cleanup();}};
}
test('successful exact-candidate CI journals before one scheduler notification, without authorizing execution',async()=>{
 const f=await fixture();try{let calls=0;const result=await f.open().deliver(await f.confirm(),async notice=>{calls++;assert.equal(readdirSync(f.directory).includes('0001.json'),true);assert.equal(notice.taskId,f.plan.tasks[1]!.id);assert.equal(notice.parentSha,f.candidate.candidateSha);assert.equal(notice.requiresCooldown,true);assert.equal(notice.requiresFreshAdmission,true);assert.equal(notice.executionAuthorized,false);});assert.equal(result.status,'notified');assert.equal(calls,1);assert.equal(f.mockedCalls(),4);const records=await f.open().inspect();assert.equal(records.length,1);assert.equal(records[0]!.dispatch,'claimed');assert.equal(f.gitCalls.filter(a=>a.includes('push')).length,1);}finally{f.cleanup();}
});
test('new delivery instance refuses duplicate dispatch even after the branch advances',async()=>{
 const f=await fixture();try{const c=await f.confirm();let calls=0;await f.open().deliver(c,async()=>{calls++;});f.moveBranch();assert.equal((await f.open().deliver(c,async()=>{calls++;})).status,'already-recorded');assert.equal(calls,1);assert.equal(f.mockedCalls(),4);}finally{f.cleanup();}
});
test('uncertain callback is permanently claimed, not automatically retried',async()=>{
 const f=await fixture();try{const c=await f.confirm();let calls=0;assert.equal((await f.open().deliver(c,async()=>{calls++;throw Error('Lost scheduler acknowledgement');})).status,'dispatch-uncertain');assert.equal((await f.open().deliver(c,async()=>{calls++;})).status,'already-recorded');assert.equal(calls,1);}finally{f.cleanup();}
});
test('concurrent CI events invoke the callback at most once',async()=>{
 const f=await fixture();try{const c=await f.confirm();let calls=0;const results=await Promise.allSettled([f.open().deliver(c,async()=>{calls++;}),f.open().deliver(c,async()=>{calls++;})]);assert.equal(calls,1);assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal((await f.open().inspect()).length,1);}finally{f.cleanup();}
});
test('last task records completion without a next task notification',async()=>{
 const f=await fixture(false);try{let calls=0;assert.equal((await f.open().deliver(await f.confirm(),async()=>{calls++;})).status,'complete');assert.equal(calls,0);assert.equal((await f.open().inspect())[0]!.nextTaskId,null);}finally{f.cleanup();}
});
test('spent request budget records passed CI but never dispatches or resets the ledger',async()=>{
 const f=await fixture(true,4);try{let calls=0;const before=await f.controller.inspect(),c=await f.confirm();assert.equal(before.remaining.requests,0);assert.equal((await f.open().deliver(c,async()=>{calls++;})).status,'budget-blocked');assert.equal((await f.open().deliver(c,async()=>{calls++;})).status,'already-recorded');assert.equal(calls,0);assert.deepEqual((await f.controller.inspect()).used,before.used);assert.equal((await f.open().inspect())[0]!.dispatch,'budget-blocked');}finally{f.cleanup();}
});
test('failed pending and forged confirmations cannot record progress',async()=>{
 const f=await fixture();try{let calls=0;for(const mode of ['failed','pending']){f.state.ciMode=mode;const c=await f.confirm();await assert.rejects(()=>f.open().deliver(c,async()=>{calls++;}),refused);}f.state.ciMode='normal';const c=await f.confirm();await assert.rejects(()=>f.open().deliver({...c},async()=>{calls++;}),refused);assert.equal(calls,0);assert.deepEqual(readdirSync(f.directory),[]);}finally{f.cleanup();}
});
test('simulated evidence cannot reach the production delivery path',async()=>{
 const f=await fixture();try{const c=await f.confirm();await assert.rejects(()=>createProjectCiDelivery(f.options).deliver(c,async()=>{}),refused);assert.deepEqual(readdirSync(f.directory),[]);}finally{f.cleanup();}
});
test('owner revocation blocks both new delivery and duplicate recognition',async()=>{
 const f=await fixture();try{const c=await f.confirm();await f.open().deliver(c,async()=>{});f.state.owner=false;await assert.rejects(()=>f.open().deliver(c,async()=>{}),refused);await assert.rejects(()=>f.open().inspect(),refused);}finally{f.cleanup();}
});
test('journal ciphertext and wrong keys fail closed, with no plaintext source or key',async()=>{
 const f=await fixture();try{const c=await f.confirm();await f.open().deliver(c,async()=>{});const path=join(f.directory,'0001.json'),bytes=readFileSync(path);assert.equal(bytes.includes(Buffer.from(f.candidate.candidateSha)),false);assert.equal(bytes.includes(Buffer.from('PRIVATE_SOURCE_MARKER')),false);const wrong=createProjectCorrectionRecoveryKey(f.key.keyId,randomBytes(32));try{await assert.rejects(()=>createProjectCiDeliveryForTests({...f.options,key:wrong}).inspect(),refused);}finally{destroyProjectCorrectionRecoveryKey(wrong);}bytes[bytes.length-10]^=1;writeFileSync(path,bytes);await assert.rejects(()=>f.open().deliver(c,async()=>{}),refused);}finally{f.cleanup();}
});
test('unknown files gaps permissions symlinks and stale lock never trigger fallback dispatch',async()=>{
 for(const mode of ['unknown','gap','permission','symlink','lock']){const f=await fixture();try{const c=await f.confirm();if(mode==='unknown')writeFileSync(join(f.directory,'unexpected'),'x');if(mode==='gap')writeFileSync(join(f.directory,'0002.json'),'x');if(mode==='permission')chmodSync(f.directory,0o755);if(mode==='symlink'){symlinkSync(f.root,join(f.root,'delivery-link'));f.options.directory=join(f.root,'delivery-link');}if(mode==='lock')writeFileSync(join(f.directory,'.delivery.lock'),'',{mode:0o600});let calls=0;await assert.rejects(()=>f.open().deliver(c,async()=>{calls++;}),refused);assert.equal(calls,0);if(mode==='lock')assert.ok(readdirSync(f.directory).includes('.delivery.lock'));}finally{f.cleanup();}}
});
test('authenticated but inconsistent journal data cannot supply restored execution authority',async()=>{
 const f=await fixture();try{await f.open().deliver(await f.confirm(),async()=>{});const sealed=readProjectHostEnvelopeFile('onay-ci-delivery-v1',f.key,join(f.directory,'0001.json')),value=JSON.parse(sealed.payload),other=join(f.root,'other');mkdirSync(other,{mode:0o700});writeProjectHostEnvelope('onay-ci-delivery-v1',JSON.stringify({...value,executionAuthorized:true}),f.key,join(other,'0001.json'));await assert.rejects(()=>createProjectCiDeliveryForTests({...f.options,directory:other}).inspect(),refused);}finally{f.cleanup();}
});
