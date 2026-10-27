import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';
import {createProjectUncertainRecoveryFixtureForTests as ownerFixture} from '../config/fixtures/projectUncertainRecoveryFixture.js';
import {createProjectCheckpointArchiveFixtureForTests} from '../config/fixtures/projectCheckpointArchiveFixture.js';
import {createProjectCheckpointArchiveForTests} from '../github/projectCheckpointArchive.js';
import {createProjectCorrectionRecoveryKey,destroyProjectCorrectionRecoveryKey,writeProjectHostEnvelope} from './projectCorrectionCheckpoint.js';
import {projectBudgetApprovalDigest} from './projectBudgetAuthorization.js';import {projectBudgetStateDigest} from './projectBudgetExtensionAuthorization.js';
import {proposeProjectUncertainRecoveryApproval as propose,authorizeProjectUncertainRecoveryForTests as approve} from './projectUncertainRecoveryApproval.js';
import {prepareProjectUncertainRecoveryClaimForTests as prepare,consumeProjectUncertainRecoveryTicket as consume} from './projectUncertainRecoveryClaim.js';
async function fixture(){
 const f=await ownerFixture(),c=f.options.controller,root=mkdtempSync(join(tmpdir(),'recovery-claim-test-')),key=createProjectCorrectionRecoveryKey('test-recovery',randomBytes(32)),api=createProjectCheckpointArchiveFixtureForTests(c.projectKey),archive=createProjectCheckpointArchiveForTests({controller:c,token:'offline',pin:null},api.transport),original=propose(f.options,f.document.expiresAt).originalExecutionId;
 const reservation={reservationId:original+':r1',taskId:'t01',requestSha256:'f'.repeat(64),requestBytes:4668,reservedTokens:3012};f.storage.data={version:1,grantSha256:c.grantSha256,reservations:[reservation]};
 for(const [kind,payload] of [['task-start',{version:1,taskId:'t01',planFingerprint:c.identity.planFingerprint,repository:c.identity.repository,baseSha:'1'.repeat(40),budget:{projectKey:c.projectKey,grantSha256:c.grantSha256,used:{requests:0,requestBytes:0,reservedTokens:0}},executionAuthorized:false}],['before-http',{version:1,stage:'before-http',taskId:'t01',executionId:original,requestSha256:reservation.requestSha256,requestBytes:4668,attemptedRequests:1,providerCallsSent:0,httpInFlight:true}]] as const){const path=join(root,'t01-'+kind+'.json'),sealed=writeProjectHostEnvelope(kind==='task-start'?'onay-task-start-v1':'onay-runtime-http-v1',JSON.stringify(payload),key,path);await archive.persist({kind,taskId:'t01',path,sha256:sealed.sha256});}
 const pin=archive.snapshot().pin!;Object.assign(f.options.binding,{archiveHead:pin.head,archiveSequence:2,budgetStateSha256:projectBudgetStateDigest(f.storage.data)});f.owner.body=JSON.stringify(propose(f.options,f.document.expiresAt));f.options.decision.bodySha256=projectBudgetApprovalDigest(JSON.parse(f.owner.body));
 const options=async()=>({controller:c,approval:await approve(f.options,f.transport),binding:f.options.binding,archive:createProjectCheckpointArchiveForTests({controller:c,token:'offline',pin},api.transport),key});
 return {f,c,api,pin,key,options,store:{read:async()=>({revision:f.storage.revision,data:f.storage.data})},cleanup:()=>{destroyProjectCorrectionRecoveryKey(key);rmSync(root,{recursive:true,force:true});}};
}
test('durable recovery claim preserves two original records and issues a single-use host ticket',async()=>{
 const x=await fixture();try{const ticket=await prepare(await x.options(),x.store),events=await createProjectCheckpointArchiveForTests({controller:x.c,token:'offline',pin:{head:x.api.state.head!,sequence:3}},x.api.transport).history();assert.equal(events.length,3);assert.deepEqual(events.map(e=>e.kind),['task-start','before-http','task-start']);assert.equal(x.f.storage.data.reservations.length,1);
 await assert.rejects(()=>consume({...ticket},x.c,'t01','simulated'));await assert.rejects(()=>consume(ticket,x.c,'t01','native'));const handoff=await consume(ticket,x.c,'t01','simulated');assert.equal(handoff.executionAuthorized,false);assert.equal(handoff.replayOriginal,false);assert.equal(handoff.requiresCooldown,true);await assert.rejects(()=>consume(ticket,x.c,'t01','simulated'));assert.equal(x.f.writes(),0);
 }finally{x.cleanup();}
});
test('competing workers have one durable winner and a cold repeated start is refused',async()=>{
 const x=await fixture();try{const a=await x.options(),b=await x.options(),results=await Promise.allSettled([prepare(a,x.store),prepare(b,x.store)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);const cold=await x.options();await assert.rejects(()=>prepare(cold,x.store));}finally{x.cleanup();}
});
test('lost append acknowledgement creates no ticket and never replays the claim',async()=>{
 const x=await fixture();try{const o=await x.options(),oldHead=x.api.state.head;x.api.state.lostAck=true;await assert.rejects(()=>prepare(o,x.store));assert.notEqual(x.api.state.head,oldHead);x.api.state.lostAck=false;
 // A fresh legitimate permission still cannot use the old two-record pin.
 const cold=await x.options();await assert.rejects(()=>prepare(cold,x.store));assert.equal(x.f.storage.data.reservations.length,1);
 }finally{x.cleanup();}
});
test('changed budget snapshot or another task reservation refuses before a new claim',async()=>{
 for(const change of ['revision','other-task']){const x=await fixture();try{const o=await x.options();if(change==='revision')x.f.storage.data.reservations[0].requestSha256='0'.repeat(64);else x.f.storage.data.reservations.push({...x.f.storage.data.reservations[0],reservationId:'other:r1',taskId:'t02'});const before=x.api.state.head;await assert.rejects(()=>prepare(o,x.store));assert.equal(x.api.state.head,before);}finally{x.cleanup();}}
});
test('owner revocation prevents ticket consumption after an acknowledged claim',async()=>{
 const x=await fixture();try{const ticket=await prepare(await x.options(),x.store);x.f.revoke();await assert.rejects(()=>consume(ticket,x.c,'t01','simulated'));assert.equal(x.f.storage.data.reservations.length,1);}finally{x.cleanup();}
});

test('later reservation drift is rejected by the consumed ticket guard',async()=>{
 const x=await fixture();try{const ticket=await prepare(await x.options(),x.store),handoff=await consume(ticket,x.c,'t01','simulated');x.f.storage.data.reservations[0].requestSha256='0'.repeat(64);await assert.rejects(handoff.assertCurrent);}finally{x.cleanup();}
});
