import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {prepareProjectBudgetActivationRequest,runTrustedProjectBudgetActivation,runGitHubProjectBudgetActivation,PROJECT_BUDGET_ACTIVATION_ERROR} from './projectBudgetActivation.js';
import {projectBudgetApprovalDigest} from './projectBudgetAuthorization.js';import {stageCalculatorProjectHistory} from './projectBudgetMigration.js';
import {createProjectModelBudgetFileStore} from './projectModelBudgetFileStore.js';import {openProjectModelBudget,type ProjectModelBudgetStore} from './projectModelBudget.js';
const saved=JSON.parse(readFileSync(new URL('./fixtures/calculatorStep7SavedPlan.json',import.meta.url),'utf8'));
const history=JSON.parse(readFileSync(new URL('../.factory/project-budget-history.json',import.meta.url),'utf8'));
const digest='6fdb95f2178edb18b60364ea659874f75f7bb434a0bf0e45dc87749b941a09f1',now=Date.parse('2026-10-25T12:00:00Z'),refusal={message:PROJECT_BUDGET_ACTIVATION_ERROR};
function fixture(extra=0){
 const root=mkdtempSync(join(tmpdir(),'budget-activation-')),inner=createProjectModelBudgetFileStore(root),stage=stageCalculatorProjectHistory(saved.request,saved.proposal,history,digest);let writes=0,ownerReads=0;
 const grant={version:1 as const,projectId:stage.identity.projectId,repository:stage.identity.repository,planFingerprint:stage.identity.planFingerprint,
  grantId:'offline-owner-history-only',maxRequests:stage.historicalCharge.requests+extra,maxRequestBytes:24000,maxTotalRequestBytes:stage.historicalCharge.requestBytes+24000*extra,maxReservedTokens:stage.historicalCharge.reservedTokens+6000*extra,
  historical:stage.historicalCharge,historicalEvidenceSha256:digest,provider:'groq' as const,freeTierConfirmed:true as const,legalEnabled:false as const};
 const document={version:1,kind:'authorize-project-model-budget',mode:'development',grant,expiresAt:'2026-10-26T00:00:00Z'};
 const comment={id:123,user:{login:'erman-ksv',type:'User'},author_association:'OWNER',issue_url:'https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/75',html_url:'https://github.com/erman-ksv/Onay-Agents-Factory/pull/75#issuecomment-123',created_at:'2026-10-25T11:00:00Z',updated_at:'2026-10-25T11:00:00Z',body:JSON.stringify(document)};
 const request={version:1,operation:'initialize',historyDigest:digest,ownerDecision:{issueNumber:75,commentId:123,bodySha256:projectBudgetApprovalDigest(document)}};
 const store:ProjectModelBudgetStore={read:inner.read,compareAndSwap:async(...a)=>{writes++;return inner.compareAndSwap(...a);}};
 const transport:typeof fetch=async(url,init)=>{ownerReads++;assert.equal(String(url),'https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/comments/123');assert.equal(init?.method,'GET');return Response.json(comment);};
 const options={request,ownerRequest:saved.request,proposal:saved.proposal,history,expectedHistoryDigest:digest,token:'offline-host-token',store,transport,now:()=>now};
 return {options,store,grant,comment,document,writes:()=>writes,ownerReads:()=>ownerReads,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('inspect without owner approval reads storage but cannot initialize or create allowance',async()=>{const f=fixture();try{
 const result=await runTrustedProjectBudgetActivation({...f.options,request:{version:1,operation:'inspect',historyDigest:digest,ownerDecision:null}});
 assert.equal(result.status,'not-initialized');assert.equal(result.stateWrites,0);assert.equal(result.modelCalls,0);assert.equal(f.writes(),0);assert.equal(f.ownerReads(),0);assert.equal(await f.store.read(),undefined);
 }finally{f.cleanup();}});
test('initialize refuses missing decision, extra flags, foreign issue and accessor input before I/O',async()=>{const f=fixture();try{
 for(const request of [{...f.options.request,ownerDecision:null},{...f.options.request,approved:true},{...f.options.request,ownerDecision:{...f.options.request.ownerDecision,issueNumber:1}},{...f.options.request,operation:'reset'}])await assert.rejects(()=>runTrustedProjectBudgetActivation({...f.options,request}),refusal);
 let reads=0;const accessor=Object.defineProperty({...f.options.request},'operation',{enumerable:true,get(){reads++;return 'initialize';}});assert.throws(()=>prepareProjectBudgetActivationRequest(accessor),refusal);assert.equal(reads,0);assert.equal(f.writes(),0);assert.equal(f.ownerReads(),0);
 }finally{f.cleanup();}});
test('native approved history-only initialization preserves 59 charges and zero remaining requests',async()=>{const f=fixture();try{
 const result=await runTrustedProjectBudgetActivation(f.options);assert.equal(result.status,'initialized');assert.ok('used' in result);if(!('used' in result))return;
 assert.deepEqual(result.used,{requests:59,requestBytes:553908,reservedTokens:230413});assert.equal(result.remaining.requests,0);assert.equal(result.remaining.reservedTokens,0);assert.equal(result.ownerApprovalCreated,false);assert.equal(f.writes(),1);assert.equal(f.ownerReads(),2);
 }finally{f.cleanup();}});
test('a second explicit initialization verifies existing state without resetting or writing',async()=>{const f=fixture();try{
 await runTrustedProjectBudgetActivation(f.options);const before=await f.store.read();const second=await runTrustedProjectBudgetActivation(f.options);assert.equal(second.status,'already-initialized-no-reset');assert.equal(second.stateWrites,0);assert.deepEqual(await f.store.read(),before);assert.equal(f.writes(),1);
 }finally{f.cleanup();}});
test('bot, different owner and edited native decision cannot initialize the ledger',async t=>{for(const kind of ['bot','author','edited'])await t.test(kind,async()=>{const f=fixture();try{
 if(kind==='bot')f.comment.user.type='Bot';if(kind==='author')f.comment.user.login='other';if(kind==='edited')f.comment.updated_at='2026-10-25T11:01:00Z';await assert.rejects(()=>runTrustedProjectBudgetActivation(f.options),refusal);assert.equal(f.writes(),0);assert.equal(await f.store.read(),undefined);
 }finally{f.cleanup();}});});
test('understated history or modified approval body is refused without writing',async()=>{const f=fixture();try{
 await assert.rejects(()=>runTrustedProjectBudgetActivation({...f.options,request:{...f.options.request,historyDigest:'f'.repeat(64)}}),refusal);assert.equal(f.ownerReads(),0);
 f.document.grant.historical={requests:0,requestBytes:0,reservedTokens:0};f.comment.body=JSON.stringify(f.document);f.options.request.ownerDecision.bodySha256=projectBudgetApprovalDigest(f.document);
 await assert.rejects(()=>runTrustedProjectBudgetActivation(f.options),refusal);assert.equal(f.writes(),0);
 }finally{f.cleanup();}});
test('lost initialization acknowledgement never retries and a later inspect is read-only',async()=>{const f=fixture();try{
 const lost:ProjectModelBudgetStore={read:f.store.read,compareAndSwap:async(...a)=>{await f.store.compareAndSwap(...a);throw Error('PRIVATE_LOST_ACK');}};
 await assert.rejects(()=>runTrustedProjectBudgetActivation({...f.options,store:lost}),refusal);assert.equal(f.writes(),1);assert.ok(await f.store.read());
 const inspected=await runTrustedProjectBudgetActivation({...f.options,request:{version:1,operation:'inspect',historyDigest:digest,ownerDecision:null}});assert.equal(inspected.status,'present-owner-approval-unverified');assert.equal(f.writes(),1);
 }finally{f.cleanup();}});
test('existing reservations survive initialization checks and conflicting grants cannot replace them',async()=>{const f=fixture(2);try{
 await runTrustedProjectBudgetActivation(f.options);const ledger=openProjectModelBudget(f.grant,f.store);await ledger.reserve({reservationId:'offline:r1',taskId:history.observations[1].scopeId,requestSha256:'c'.repeat(64),requestBytes:100,reservedTokens:500});
 const before=await f.store.read(),result=await runTrustedProjectBudgetActivation(f.options);assert.ok('used' in result);if('used' in result)assert.equal(result.used.requests,60);assert.deepEqual(await f.store.read(),before);
 f.document.grant.grantId='different-grant';f.comment.body=JSON.stringify(f.document);f.options.request.ownerDecision.bodySha256=projectBudgetApprovalDigest(f.document);await assert.rejects(()=>runTrustedProjectBudgetActivation(f.options),refusal);assert.deepEqual(await f.store.read(),before);assert.equal(f.writes(),2);
 }finally{f.cleanup();}});
test('owner HTTP 429 is source-free and not retried',async()=>{const f=fixture();try{
 let calls=0;await assert.rejects(()=>runTrustedProjectBudgetActivation({...f.options,transport:async()=>{calls++;return new Response('PRIVATE_ERROR',{status:429});}}),refusal);assert.equal(calls,1);assert.equal(f.writes(),0);
 }finally{f.cleanup();}});
test('production entry rejects store injection before contacting GitHub',async()=>{const f=fixture();try{
 await assert.rejects(()=>runGitHubProjectBudgetActivation(f.options),refusal);assert.equal(f.ownerReads(),0);assert.equal(f.writes(),0);
 }finally{f.cleanup();}});
