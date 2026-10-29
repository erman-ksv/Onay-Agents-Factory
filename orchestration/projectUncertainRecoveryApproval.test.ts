import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createProjectTargetRegistry,registeredProjectTargetProfile} from './projectTargetRegistry.js';
import {authorizeProjectBudget,reconcileProjectBudgetHistory,projectBudgetApprovalDigest} from './projectBudgetAuthorization.js';
import {proposeProjectUncertainRecoveryApproval as propose,authorizeProjectUncertainRecoveryForTests as approve,consumeProjectUncertainRecoveryApproval as consume,authorizeProjectUncertainRecovery} from './projectUncertainRecoveryApproval.js';
import {createProjectUncertainRecoveryFixtureForTests as fixture} from '../config/fixtures/projectUncertainRecoveryFixture.js';
import {verifyProjectUncertainRecoveryApproval as verify} from './projectUncertainRecoveryApproval.js';
test('pre-extension verification rechecks OWNER without consuming approval or accepting copies',async()=>{
 const f=await fixture(),cap=await approve(f.options,f.transport),c=f.options.controller,b=f.options.binding;await verify(cap,c,b,'simulated');await assert.rejects(()=>verify({...cap},c,b,'simulated'));await assert.rejects(()=>verify(cap,c,b,'native'));await consume(cap,c,b,'simulated');await assert.rejects(()=>verify(cap,c,b,'simulated'));assert.equal(f.writes(),0);
 const g=await fixture(),other=await approve(g.options,g.transport);g.revoke();await assert.rejects(()=>verify(other,g.options.controller,g.options.binding,'simulated'));
});

test('budget approval alone cannot approve recovery; exact separate OWNER decision gives no execution',async()=>{
 const f=await fixture(),cap=await approve(f.options,f.transport);await assert.rejects(()=>consume({...cap},f.options.controller,f.options.binding,'simulated'));await assert.rejects(()=>consume(cap,f.options.controller,f.options.binding,'native'));
 const handoff=await consume(cap,f.options.controller,f.options.binding,'simulated');assert.equal(handoff.executionAuthorized,false);assert.equal(handoff.budgetChangeAuthorized,false);assert.equal(handoff.replayOriginal,false);await assert.rejects(()=>consume(cap,f.options.controller,f.options.binding,'simulated'));assert.equal(f.writes(),0);
});
test('recovery attempt ID stays stable across different decisions or pinned revisions',async()=>{
 const f=await fixture(),a=propose(f.options,f.document.expiresAt),b=propose({...f.options,binding:{...f.options.binding,archiveHead:'1'.repeat(40),budgetStateSha256:'2'.repeat(64)}},f.document.expiresAt);assert.equal(a.recoveryExecutionId,b.recoveryExecutionId);assert.notEqual(a.originalExecutionId,a.recoveryExecutionId);
});
test('even a newly signed altered policy cannot increase calls, replay original or change task scope',async()=>{
 for(const change of [{maxNewRequests:5},{replayOriginal:true},{taskId:'t02'},{planFingerprint:'0'.repeat(64)},{originalOutcome:'not-sent'},{extra:'field'}]){const f=await fixture();f.owner.body=JSON.stringify({...f.document,...change});f.options.decision.bodySha256=projectBudgetApprovalDigest(JSON.parse(f.owner.body));await assert.rejects(()=>approve(f.options,f.transport));assert.equal(f.writes(),0);}
});
test('other author, edited comment, expiry and invalid body stop without writes',async()=>{
 for(const kind of ['author','edited','expired','invalid']){const f=await fixture();if(kind==='author')f.owner.user.login='other';if(kind==='edited')f.owner.updated_at=new Date().toISOString();if(kind==='expired')f.owner.body=JSON.stringify({...f.document,expiresAt:'2026-01-01T00:00:00Z'});if(kind==='invalid')f.owner.body='not json';await assert.rejects(()=>approve(f.options,f.transport));assert.equal(f.writes(),0);}
});
test('binding drift, native adapter injection and later owner revocation are refused',async()=>{
 const f=await fixture(),cap=await approve(f.options,f.transport);await assert.rejects(()=>consume(cap,f.options.controller,{...f.options.binding,archiveHead:'0'.repeat(40)},'simulated'));await assert.rejects(()=>authorizeProjectUncertainRecovery({...f.options,transport:f.transport} as any));f.revoke();await assert.rejects(()=>consume(cap,f.options.controller,f.options.binding,'simulated'));assert.equal(f.writes(),0);
});
