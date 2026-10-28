import test from 'node:test';import assert from 'node:assert/strict';import {mkdirSync} from 'node:fs';import {join} from 'node:path';
import {createProjectRecoveryWorkerFixtureForTests as fixture} from '../config/fixtures/projectRecoveryWorkerFixture.js';
import {createProjectUncertainRecoveryRuntimeForTests,createProjectCiRuntimeForTests} from './projectNextTaskWorker.js';
import {createProjectCiReaderForTests} from '../github/projectCi.js';import {confirmProjectCandidateCi} from '../github/projectPublisher.js';
import {materializeProjectRuntimeArchive} from './projectRuntimeRecovery.js';
import {runProjectCiContinuationForTests} from './projectCiContinuation.js';
test('explicit OSS120b policy keeps low reasoning, JSON replies and unchanged ceilings through both tasks',async()=>{
 const f=await fixture('normal',true,'openai/gpt-oss-120b');try{
  const first=await createProjectUncertainRecoveryRuntimeForTests(f.options,f.injections).recover(f.ticket),root=join(f.root,'oss-bounded-loop');mkdirSync(root,{mode:0o700});const result=await runProjectCiContinuationForTests({...f.options,directory:root,lineage:f.lineage!,candidateSha:first.candidate.candidateSha,polling:{maxPolls:4,intervalMs:10000}},f.injections,{now:()=>0,wait:async()=>{}});assert.equal(result.status,'plan-ci-recorded');assert.equal(f.requestSettings.length,8);for(const r of f.requestSettings){assert.equal(r.model,'openai/gpt-oss-120b');assert.equal(r.reasoningEffort,'low');assert.deepEqual(r.responseFormat,{type:'json_object'});assert.equal(r.maxCompletionTokens,1200);}assert.equal((await f.controller.inspect()).used.requests,9);assert.equal(f.calls(),8);assert.ok(f.clock()>=60000);
 }finally{f.cleanup();}
});
test('provider rejection and network failure retain charges and emit only the last numeric HTTP status',async()=>{
 for(const mode of ['provider-401','network-failed']){const f=await fixture(mode),previous=console.error,logs:string[]=[];console.error=(value:unknown)=>{logs.push(String(value));};try{await assert.rejects(()=>createProjectUncertainRecoveryRuntimeForTests(f.options,f.injections).recover(f.ticket));assert.equal(f.calls(),1);assert.equal((await f.controller.inspect()).used.requests,2);assert.equal(f.gitCalls.filter(c=>c.includes('push')).length,0);assert.equal(logs.length,1);const d=JSON.parse(logs[0]!);assert.equal(d.lastProviderHttpStatus,mode==='provider-401'?401:null);assert.equal(d.reasonCode,'transport_error');assert.equal(d.providerCallsSent,1);assert.equal(d.replayAuthorized,false);assert.equal(logs.join('').includes('PRIVATE_PROVIDER_BODY_MUST_NOT_BE_LOGGED'),false);}finally{console.error=previous;f.cleanup();}}
});
test('changed-grant recovery carries genuine lineage through the bounded CI loop and successor',async()=>{
 const f=await fixture('normal',true);try{
  assert.notEqual(f.previous.grantSha256,f.controller.grantSha256);const first=await createProjectUncertainRecoveryRuntimeForTests(f.options,f.injections).recover(f.ticket);assert.equal(f.calls(),4);
  for(const lineage of [undefined,{...f.lineage!}]){const root=join(f.root,'refuse-'+(lineage?'copy':'missing'));mkdirSync(root,{mode:0o700});await assert.rejects(()=>runProjectCiContinuationForTests({...f.options,directory:root,candidateSha:first.candidate.candidateSha,polling:{maxPolls:4,intervalMs:10000},...(lineage?{lineage:lineage as any}:{})},f.injections,{now:()=>0,wait:async()=>{}}));assert.equal(f.calls(),4);}
  const root=join(f.root,'bounded-loop');mkdirSync(root,{mode:0o700});const result=await runProjectCiContinuationForTests({...f.options,directory:root,lineage:f.lineage!,candidateSha:first.candidate.candidateSha,polling:{maxPolls:4,intervalMs:10000}},f.injections,{now:()=>0,wait:async()=>{}});assert.equal(result.status,'plan-ci-recorded');assert.equal(f.calls(),8);assert.equal((await f.controller.inspect()).used.requests,9);assert.equal(f.gitCalls.filter(c=>c.includes('push')).length,2);
 }finally{f.cleanup();}
});
test('claimed recovery runs four independent roles, host tests, publication, exact CI and successor',async()=>{
 const f=await fixture();try{
  const runtime=createProjectUncertainRecoveryRuntimeForTests(f.options,f.injections),first=await runtime.recover(f.ticket);assert.equal(f.calls(),4);assert.equal(first.candidate.parentSha,f.baseSha);assert.ok(f.clock()>=60000);assert.equal((await f.controller.inspect()).used.requests,5);
  const read=createProjectCiReaderForTests(f.ciPolicy,f.options.env,f.injections.github),confirmed=await confirmProjectCandidateCi(first.candidate,await read({repository:f.repo,branch:f.plan.branch,candidateSha:first.candidate.candidateSha})),next=createProjectCiRuntimeForTests({...f.options,deliveryDirectory:join(f.root,'ci-delivery')},f.injections),second=await next.advance(confirmed);assert.equal(second.delivery.status,'notified');assert.ok(second.candidate);assert.equal(f.calls(),8);assert.equal((await f.controller.inspect()).used.requests,9);assert.equal(f.gitCalls.filter(c=>c.includes('push')).length,2);
  const final=await confirmProjectCandidateCi(second.candidate!,await read({repository:f.repo,branch:f.plan.branch,candidateSha:second.candidate!.candidateSha}));assert.equal((await next.advance(final)).delivery.status,'complete');assert.equal((await next.advance(confirmed)).delivery.status,'already-recorded');assert.equal(f.calls(),8);
  const history=await f.archive.history();assert.equal(history[0]!.kind,'task-start');assert.equal(history[1]!.kind,'before-http');const names=history.map(e=>e.name);assert.equal(new Set(names).size,names.length);assert.equal(history.filter(e=>e.kind==='before-http'&&e.name.includes('-uncertain-1-')).length,4);
  const restored=join(f.root,'restored');mkdirSync(restored,{mode:0o700});assert.equal((await materializeProjectRuntimeArchive(f.archive,f.controller,f.options.key,restored,'simulated')).encryptedFiles,history.length);
 }finally{f.cleanup();}
});
test('copied ticket or a reused worker cannot create a second model run',async()=>{
 const f=await fixture();try{const w=createProjectUncertainRecoveryRuntimeForTests(f.options,f.injections);await assert.rejects(()=>w.recover({...f.ticket}));await assert.rejects(()=>w.recover(f.ticket));assert.equal(f.calls(),0);assert.equal((await f.controller.inspect()).used.requests,1);}finally{f.cleanup();}
});
test('terminal 429 or failed independent review stops without publication or replay',async()=>{
 for(const mode of ['429','review-failed']){const f=await fixture(mode);try{const w=createProjectUncertainRecoveryRuntimeForTests(f.options,f.injections);await assert.rejects(()=>w.recover(f.ticket));const count=f.calls();assert.equal(count,mode==='429'?1:2);assert.equal(f.gitCalls.filter(c=>c.includes('push')).length,0);await assert.rejects(()=>w.recover(f.ticket));assert.equal(f.calls(),count);assert.equal((await f.controller.inspect()).used.requests,1+count);}finally{f.cleanup();}}
});
test('lost pre-HTTP checkpoint acknowledgement retains its new charge and sends no model HTTP',async()=>{
 const f=await fixture();try{f.api.state.lostAck=true;const w=createProjectUncertainRecoveryRuntimeForTests(f.options,f.injections);await assert.rejects(()=>w.recover(f.ticket));assert.equal(f.calls(),0);assert.equal((await f.controller.inspect()).used.requests,2);await assert.rejects(()=>w.recover(f.ticket));assert.equal(f.calls(),0);}finally{f.cleanup();}
});
test('unavailable host isolation cannot publish a recovered proposal',async()=>{
 const f=await fixture('node-unverified');try{await assert.rejects(()=>createProjectUncertainRecoveryRuntimeForTests(f.options,f.injections).recover(f.ticket));assert.equal(f.calls(),4);assert.equal(f.gitCalls.filter(c=>c.includes('push')).length,0);}finally{f.cleanup();}
});
