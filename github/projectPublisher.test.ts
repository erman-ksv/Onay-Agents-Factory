import test from 'node:test';import assert from 'node:assert/strict';
import {createProjectPublicationFixtureForTests} from '../config/fixtures/projectPublicationFixture.js';
import {createProjectPublisher,createProjectPublisherForTests,projectPublicationDiagnostic,PROJECT_PUBLISHER_ERROR} from './projectPublisher.js';
const refused=(e:unknown)=>e instanceof Error&&e.message===PROJECT_PUBLISHER_ERROR;
const publisher=(f:Awaited<ReturnType<typeof createProjectPublicationFixtureForTests>>,checkpoint=f.checkpoint)=>createProjectPublisherForTests({env:f.env,checkpoint,transport:f.transport,runGit:f.gitRunner});
test('generic publisher builds exact candidate through actual Git and creates one Draft PR',async()=>{
 const f=await createProjectPublicationFixtureForTests();try{const p=await publisher(f).publish(f.approval);assert.equal(p.candidateSha,f.head());assert.equal(p.parentSha,f.baseSha);assert.equal(p.proposalDigest,f.changes.digest);assert.equal(p.provenance,'simulated');assert.equal(p.ciVerified,false);assert.equal(p.mergeAuthorized,false);assert.equal(p.wholeAppCompleted,false);assert.equal(f.gitCalls.filter(a=>a.includes('push')).length,1);assert.equal(f.requests.filter(r=>r.method==='POST'&&r.path==='/pulls').length,1);assert.deepEqual(f.checkpoints.map(c=>c.stage),['before-push','after-push']);assert.equal((await f.controller.inspect()).used.requests,4);assert.equal(f.mockedCalls(),4);assert.equal(JSON.stringify(p).includes('PRIVATE_SOURCE_MARKER'),false);}finally{f.cleanup();}
});
test('existing expected-parent branch and Draft PR update without creating a second PR',async()=>{
 const f=await createProjectPublicationFixtureForTests();try{f.seedBranch();f.state.existingPr=true;const p=await publisher(f).publish(f.approval);assert.equal(p.number,1);assert.equal(f.head(),p.candidateSha);assert.equal(f.requests.some(r=>r.method==='POST'),false);}finally{f.cleanup();}
});
test('native writer rejects simulated or copied approval before any native network/Git write',async()=>{
 const f=await createProjectPublicationFixtureForTests();try{for(const cap of [f.approval,{...f.approval,provenance:'native-host-tests' as const}])await assert.rejects(()=>createProjectPublisher({env:f.env,checkpoint:f.checkpoint}).publish(cap),refused);assert.equal(f.gitCalls.length,0);assert.equal(f.requests.some(r=>r.method==='POST'),false);}finally{f.cleanup();}
});
test('lease race cannot overwrite another writer and is never automatically pushed again',async()=>{
 const f=await createProjectPublicationFixtureForTests();try{f.state.raceBeforePush=true;const pub=publisher(f);let diagnostic;await assert.rejects(()=>pub.publish(f.approval),e=>{diagnostic=projectPublicationDiagnostic(e);return refused(e);});assert.equal(diagnostic!.writeAttempted,true);assert.equal(diagnostic!.pushAcknowledged,false);assert.notEqual(f.head(),diagnostic!.candidateSha);await assert.rejects(()=>pub.publish(f.approval),refused);assert.equal(f.gitCalls.filter(a=>a.includes('push')).length,1);assert.equal(f.requests.some(r=>r.method==='POST'),false);}finally{f.cleanup();}
});
test('lost push acknowledgement preserves known candidate and forbids republishing it',async()=>{
 const f=await createProjectPublicationFixtureForTests();try{f.state.lostPushAck=true;const pub=publisher(f);let diagnostic;await assert.rejects(()=>pub.publish(f.approval),e=>{diagnostic=projectPublicationDiagnostic(e);return refused(e);});assert.equal(diagnostic!.pushAcknowledged,false);assert.equal(f.head(),diagnostic!.candidateSha);await assert.rejects(()=>publisher(f).publish(f.approval),refused);assert.equal(f.gitCalls.filter(a=>a.includes('push')).length,1);assert.equal(f.requests.some(r=>r.method==='POST'),false);}finally{f.cleanup();}
});
test('unverified pre-push checkpoint prevents the write',async()=>{
 const f=await createProjectPublicationFixtureForTests();try{let diagnostic;await assert.rejects(()=>publisher(f,async()=>{throw Error('PRIVATE_CHECKPOINT_FAILURE');}).publish(f.approval),e=>{diagnostic=projectPublicationDiagnostic(e);return refused(e);});assert.equal(diagnostic!.writeAttempted,false);assert.equal(f.gitCalls.some(a=>a.includes('push')),false);assert.equal(f.requests.some(r=>r.method==='POST'),false);}finally{f.cleanup();}
});
test('post-push checkpoint failure retains acknowledged candidate without PR or repeat',async()=>{
 const f=await createProjectPublicationFixtureForTests();try{let diagnostic;await assert.rejects(()=>publisher(f,async e=>{if(e.stage==='after-push')throw Error('PRIVATE_CHECKPOINT_FAILURE');}).publish(f.approval),e=>{diagnostic=projectPublicationDiagnostic(e);return refused(e);});assert.equal(diagnostic!.pushAcknowledged,true);assert.equal(f.head(),diagnostic!.candidateSha);assert.equal(f.requests.some(r=>r.method==='POST'),false);await assert.rejects(()=>publisher(f).publish(f.approval),refused);assert.equal(f.gitCalls.filter(a=>a.includes('push')).length,1);}finally{f.cleanup();}
});
test('foreign, non-Draft, duplicate or wrong-base PR preflight refuses before push',async()=>{
 for(const mode of ['foreign','ready','duplicate','wrong-base']){const f=await createProjectPublicationFixtureForTests();try{f.seedBranch();f.state.existingPr=true;f.state.prMode=mode;await assert.rejects(()=>publisher(f).publish(f.approval),refused);assert.equal(f.gitCalls.some(a=>a.includes('push')),false);assert.equal(f.head(),f.baseSha);}finally{f.cleanup();}}
});
test('owner revocation between journal and push prevents any publication',async()=>{
 const f=await createProjectPublicationFixtureForTests();try{await assert.rejects(()=>publisher(f,async()=>{f.state.owner=false;}).publish(f.approval),refused);assert.equal(f.gitCalls.some(a=>a.includes('push')),false);assert.equal((await f.controller.inspect()).used.requests,4);}finally{f.cleanup();}
});
test('write opt-in, free-tier, legal and workflow protections remain mandatory',async()=>{
 const f=await createProjectPublicationFixtureForTests();try{for(const env of [{...f.env,AGENT_FACTORY_ENABLE_GITHUB_WRITES:'false'},{...f.env,ONAY_TEAM_FREE_TIER_CONFIRMED:'false'},{...f.env,AGENT_FACTORY_LEGAL_ENABLED:'true'},{...f.env,AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES:'true'}])assert.throws(()=>createProjectPublisherForTests({env,checkpoint:f.checkpoint,transport:f.transport,runGit:f.gitRunner}),refused);assert.equal(f.gitCalls.length,0);}finally{f.cleanup();}
});
