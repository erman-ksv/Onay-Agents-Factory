import test from 'node:test';import assert from 'node:assert/strict';
import {createProjectPublicationFixtureForTests} from '../config/fixtures/projectPublicationFixture.js';
import {createProjectCiPolicy,createProjectCiReaderForTests,PROJECT_CI_ERROR} from './projectCi.js';
import {createProjectPublisherForTests,confirmProjectCandidateCi,consumeProjectCandidateCiConfirmation,PROJECT_PUBLISHER_ERROR} from './projectPublisher.js';
import {createProjectTargetRegistry,registeredProjectTargetProfile} from '../orchestration/projectTargetRegistry.js';
const refused=(e:unknown)=>e instanceof Error&&e.message===PROJECT_CI_ERROR,pubRefused=(e:unknown)=>e instanceof Error&&e.message===PROJECT_PUBLISHER_ERROR;
async function fixture(){const f=await createProjectPublicationFixtureForTests(),candidate=await createProjectPublisherForTests({env:f.env,checkpoint:f.checkpoint,transport:f.transport,runGit:f.gitRunner}).publish(f.approval),input={repository:f.repo,branch:candidate.branch,candidateSha:candidate.candidateSha};return{...f,candidate,input,read:createProjectCiReaderForTests(f.ciPolicy,f.env,f.transport)};}
test('exact SHA workflow blobs run attempts and required job steps confirm only the matching candidate',async()=>{
 const f=await fixture();try{const e=await f.read(f.input),c=await confirmProjectCandidateCi(f.candidate,e);assert.equal(e.status,'passed');assert.deepEqual(e.verifiedRunIds,[901]);assert.equal(c.ciVerified,true);assert.equal(c.candidateSha,f.candidate.candidateSha);assert.equal(c.provenance,'simulated');assert.equal(c.mergeAuthorized,false);assert.equal(c.wholeAppCompleted,false);assert.equal(f.gitCalls.filter(a=>a.includes('push')).length,1);}finally{f.cleanup();}
});
test('missing or skipped steps and pending/failed workflow cannot become green CI',async()=>{
 for(const [mode,status] of [['missing-step','pending'],['skipped','failed'],['pending','pending'],['failed','failed']]){const f=await fixture();try{f.state.ciMode=mode!;const e=await f.read(f.input);assert.equal(e.status,status);const c=await confirmProjectCandidateCi(f.candidate,e);assert.equal(c.ciVerified,false);assert.equal(f.gitCalls.filter(a=>a.includes('push')).length,1);}finally{f.cleanup();}}
});
test('wrong candidate SHA or foreign branch refuses before trusting CI jobs',async()=>{
 const f=await fixture();try{for(const input of [{...f.input,candidateSha:'0'.repeat(40)},{...f.input,branch:'main'},{...f.input,repository:'evil/repo'}])await assert.rejects(()=>f.read(input),refused);}finally{f.cleanup();}
});
test('workflow must match immutable host blob pin despite matching job names',async()=>{
 const f=await fixture();try{const p=createProjectCiPolicy(f.target,[{...f.ciPolicy.workflowPins[0]!,blobSha:'0'.repeat(40)}]);await assert.rejects(()=>createProjectCiReaderForTests(p,f.env,f.transport)(f.input),refused);}finally{f.cleanup();}
});
test('fork merge-ref wrong-attempt duplicate pagination and changing rerun evidence refuse',async()=>{
 for(const mode of ['fork','merge-event','wrong-attempt','duplicate','pagination','rerun']){const f=await fixture();try{f.state.ciMode=mode;await assert.rejects(()=>f.read(f.input),refused);}finally{f.cleanup();}}
});
test('copied policy, getters and sparse pins cannot choose trusted workflows',async()=>{
 const f=await fixture();try{assert.throws(()=>createProjectCiReaderForTests({...f.ciPolicy},f.env,f.transport),refused);let calls=0;const pins:any[]=[];Object.defineProperty(pins,0,{enumerable:true,get(){calls++;return f.ciPolicy.workflowPins[0];}});assert.throws(()=>createProjectCiPolicy(f.target,pins),refused);assert.equal(calls,0);assert.throws(()=>createProjectCiPolicy(f.target,Array(1)),refused);}finally{f.cleanup();}
});
test('a later rerun invalidates previously collected successful CI without republishing',async()=>{
 const f=await fixture();try{const e=await f.read(f.input);f.state.ciMode='rerun';await assert.rejects(()=>confirmProjectCandidateCi(f.candidate,e),pubRefused);assert.equal(f.gitCalls.filter(a=>a.includes('push')).length,1);}finally{f.cleanup();}
});
test('a moved candidate head invalidates earlier successful CI and PR metadata',async()=>{
 const f=await fixture();try{const e=await f.read(f.input),other=f.moveBranch();assert.notEqual(other,f.candidate.candidateSha);await assert.rejects(()=>confirmProjectCandidateCi(f.candidate,e),pubRefused);assert.equal(f.gitCalls.filter(a=>a.includes('push')).length,1);}finally{f.cleanup();}
});
test('serialized publication or CI metadata cannot substitute genuine host capabilities',async()=>{
 const f=await fixture();try{const e=await f.read(f.input);await assert.rejects(()=>confirmProjectCandidateCi({...f.candidate},e),pubRefused);await assert.rejects(()=>confirmProjectCandidateCi(f.candidate,{...e,provenance:'native-github'}),pubRefused);}finally{f.cleanup();}
});
test('same-looking registered profile from another capability cannot confirm this publication',async()=>{
 const f=await fixture();try{const {sha256,...definition}=registeredProjectTargetProfile(f.target),other=createProjectTargetRegistry([definition]).select(definition.id),policy=createProjectCiPolicy(other,f.ciPolicy.workflowPins),e=await createProjectCiReaderForTests(policy,f.env,f.transport)(f.input);assert.equal(e.status,'passed');await assert.rejects(()=>confirmProjectCandidateCi(f.candidate,e),pubRefused);}finally{f.cleanup();}
});
test('repeated successful CI observations yield the same one-use confirmation and no new publication',async()=>{
 const f=await fixture();try{const a=await confirmProjectCandidateCi(f.candidate,await f.read(f.input)),b=await confirmProjectCandidateCi(f.candidate,await f.read(f.input));assert.equal(a,b);await consumeProjectCandidateCiConfirmation(a,'simulated');await assert.rejects(()=>consumeProjectCandidateCiConfirmation(b,'simulated'),pubRefused);assert.equal(f.gitCalls.filter(a=>a.includes('push')).length,1);}finally{f.cleanup();}
});
test('copied simulated or non-passing confirmation cannot authorize native advancement',async()=>{
 const f=await fixture();try{const c=await confirmProjectCandidateCi(f.candidate,await f.read(f.input));await assert.rejects(()=>consumeProjectCandidateCiConfirmation({...c,provenance:'native-github'},'native'),pubRefused);await assert.rejects(()=>consumeProjectCandidateCiConfirmation(c,'native'),pubRefused);f.state.ciMode='pending';const pending=await confirmProjectCandidateCi(f.candidate,await f.read(f.input));await assert.rejects(()=>consumeProjectCandidateCiConfirmation(pending,'simulated'),pubRefused);}finally{f.cleanup();}
});
