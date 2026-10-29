import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';import {loadCalculatorSnapshot} from '../github/calculatorSnapshot.js';import {createCalculatorPlan} from './calculatorPlan.js';import {buildCalculatorRejectedDraftCorrection} from './calculatorRejectedDraftCorrection.js';import {admitCalculatorQueuedDraftCorrection,admitCalculatorQueuedEvidenceReview,claimCalculatorQueuedSuccessor} from './calculatorQueuedSuccessor.js';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createCalculatorExecutionCheckpointStore,type CalculatorExecutionCheckpointPayload} from './calculatorExecutionCheckpoint.js';
import {prepareCalculatorRejectedProposal} from './calculatorRejectedProposalCheckpoint.js';
import {prepareCalculatorRejectedProposalRecovery,CALCULATOR_REJECTED_RECOVERY_ERROR} from './calculatorRejectedProposalRecovery.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/calculatorStep7SavedPlan.json',import.meta.url),'utf8')),plan=createCalculatorPlan(fixture.request,fixture.proposal),task=plan.tasks[3]!,A='a'.repeat(40),B='b'.repeat(40),source='body { margin: 0; }\n/* PRIVATE ORIGINAL UNSEEN TAIL */\n';
async function setup(){const blob=createHash('sha1').update('blob '+Buffer.byteLength(source)+'\0'+source).digest('hex');const snapshot=await loadCalculatorSnapshot({repository:plan.owner.repository,baseRef:plan.branch,baseSha:A,changePaths:task.paths},{getHead:async()=>A,readCommit:async()=>({sha:A,treeSha:B}),readTree:async()=>({sha:B,truncated:false,tree:[{path:'styles.css',sha:blob,type:'blob',mode:'100644'}]}),readBlob:async()=>({sha:blob,encoding:'base64',content:Buffer.from(source).toString('base64')})});const rejection={taskId:task.id,kind:'generation',validationCode:'proposal_changes_invalid',result:{summary:'Agent draft',changes:[{operation:'patch',path:'styles.css',sourceSha256:createHash('sha256').update(source).digest('hex'),edits:[{before:'',after:'@media(max-width:360px){body{margin:0}}'}],message:'Agent responsive change'}]}};return {snapshot,rejection};}
test('actual empty-anchor rejection is passed as data without a host code rewrite or full private original',async()=>{const f=await setup(),r=buildCalculatorRejectedDraftCorrection('openai/gpt-oss-120b',task,f.rejection,f.snapshot),packet=JSON.parse(JSON.parse(r.body).messages[1].content);assert.deepEqual(packet.rejectedDraft,f.rejection.result);assert.ok(r.diagnostics.some(d=>d.code==='invalid_edit'&&d.path==='styles.css'));assert.ok(!r.body.includes(source));assert.ok(r.requestedTokens<=6000);assert.equal(JSON.parse(r.body).max_completion_tokens,2048);});
test('oversized generated drafts are explicitly excerpted rather than exhausting the correction context',async()=>{const f=await setup();f.rejection.result.changes[0]!.edits[0]!.after='x'.repeat(11000);const r=buildCalculatorRejectedDraftCorrection('openai/gpt-oss-120b',task,f.rejection,f.snapshot),packet=JSON.parse(JSON.parse(r.body).messages[1].content);assert.equal(packet.rejectedDraft,undefined);assert.ok(packet.omittedEvidence.includes('full rejected draft remains in host memory'));assert.ok(r.requestedTokens<=6000);});
test('wrong task or kind and complete private originals cannot enter the correction request',async()=>{const f=await setup();assert.throws(()=>buildCalculatorRejectedDraftCorrection('model',task,{...f.rejection,taskId:'other'},f.snapshot));assert.throws(()=>buildCalculatorRejectedDraftCorrection('model',task,{...f.rejection,kind:'repair'},f.snapshot));f.rejection.result.changes[0]!.edits[0]!.after=source+'extra';assert.throws(()=>buildCalculatorRejectedDraftCorrection('model',task,f.rejection,f.snapshot));});
test('serialized continuation claims and unrelated capsules never admit a correction or remote mutation',async()=>{let writes=0;await assert.rejects(()=>claimCalculatorQueuedSuccessor({} as any,{kind:'verified-ci-queued-successor'}));await assert.rejects(()=>admitCalculatorQueuedDraftCorrection({} as any,{} as any,{},{} as any,{verify:async()=>[],persistRemote:async()=>{writes++;},assertRemote:async()=>{writes++;}}));assert.equal(writes,0);});

test('DOM-evidence review continuation rejects copied capabilities and unverified source before any remote claim',async()=>{let writes=0;await assert.rejects(()=>admitCalculatorQueuedEvidenceReview({} as any,{} as any,{},{} as any,{verify:async()=>[],persistRemote:async()=>{writes++;},assertRemote:async()=>{writes++;}}));assert.equal(writes,0);});

test('T05 create-on-existing failure gives the agent bounded anchors and permits only task-scoped tests',async()=>{
 const selected=plan.tasks[4]!,content='// first unique anchor\n'+('const privateMiddle=1;\n'.repeat(80))+'// last unique anchor\n',blob=createHash('sha1').update('blob '+Buffer.byteLength(content)+'\0'+content).digest('hex');
 const snapshot=await loadCalculatorSnapshot({repository:plan.owner.repository,baseRef:plan.branch,baseSha:A,changePaths:selected.paths},{getHead:async()=>A,readCommit:async()=>({sha:A,treeSha:B}),readTree:async()=>({sha:B,truncated:false,tree:[{path:'test',sha:B,type:'tree',mode:'040000'},{path:'test/ui.test.mjs',sha:blob,type:'blob',mode:'100644'}]}),readBlob:async()=>({sha:blob,encoding:'base64',content:Buffer.from(content).toString('base64')})});
 const rejected={taskId:selected.id,kind:'generation',validationCode:'proposal_changes_invalid',result:{summary:'Agent integration draft',changes:[{operation:'create',path:'test/ui.test.mjs',content:'// generated integration test',message:'fixture'}]}};
 const request=buildCalculatorRejectedDraftCorrection('openai/gpt-oss-120b',selected,rejected,snapshot),body=JSON.parse(request.body);assert.ok(request.diagnostics.some(d=>d.code==='create_target_exists'));assert.ok(body.messages[0].content.includes('Change only test/ui.test.mjs'));assert.ok(!body.messages[0].content.includes('Do not change application behavior, tests,'));assert.ok(!request.body.includes(content));assert.ok(request.requestedTokens<=6000);assert.ok(body.messages[0].content.includes('before MUST be NONEMPTY'));
});

test('untrusted rejection accessors and cycles are refused without evaluating lazy data',async()=>{
 const f=await setup();let reads=0;
 const lazy=Object.defineProperty({...f.rejection},'result',{enumerable:true,get(){reads++;throw Error('private getter');}});
 const cyclic:Record<string,unknown>={};cyclic.self=cyclic;
 assert.throws(()=>buildCalculatorRejectedDraftCorrection('model',task,lazy,f.snapshot));
 assert.throws(()=>buildCalculatorRejectedDraftCorrection('model',task,{...f.rejection,result:cyclic},f.snapshot));assert.equal(reads,0);
});

async function savedRejection(patch:Partial<CalculatorExecutionCheckpointPayload>={}){
 const f=await setup(),root=mkdtempSync(join(tmpdir(),'recovery-packet-'));
 const identity={repository:plan.owner.repository,goalId:plan.owner.id,ownerFingerprint:plan.owner.ownerFingerprint,planFingerprint:plan.fingerprint,taskId:task.id,branch:plan.branch,baseSha:A,bootstrapSha:B,runtimeConfigDigest:'e'.repeat(64)};
 const store=createCalculatorExecutionCheckpointStore(root,identity),modelState={attemptedRequests:1,totalRequestBytes:1000,reservedRunTokens:2000,elapsedMs:10};
 const payload:CalculatorExecutionCheckpointPayload={attempt:1,stage:'generate_1',status:'blocked',assessments:[],modelState,httpInFlight:false,publicationStarted:false,rejectedProposal:prepareCalculatorRejectedProposal(f.rejection),failure:{reasonCode:'proposal_changes_invalid'},...patch};
 if(Object.hasOwn(patch,'failure')&&patch.failure===undefined)delete (payload as {failure?:unknown}).failure;
 try{const ref=store.save(payload),bytes=readFileSync(join(root,task.id+'.execution.json'));
 return {input:{bytes,expectedSha256:ref.sha256,identity,plan,taskId:task.id,snapshot:f.snapshot,model:'openai/gpt-oss-120b'},payload,bytes,root,store,cleanup:()=>{store.close();rmSync(root,{recursive:true,force:true});}};
 }catch(error){store.close();rmSync(root,{recursive:true,force:true});throw error;}
}
const recoveryRefusal={message:CALCULATOR_REJECTED_RECOVERY_ERROR};
test('private checkpoint builds a bounded correction packet with original SHA and conservative charge, without modifying evidence',async()=>{
 const f=await savedRejection();try{
  const result=prepareCalculatorRejectedProposalRecovery(f.input),packet=JSON.parse(JSON.parse(result.request.body).messages[1].content);
  assert.equal(packet.baseSha,A);assert.equal(packet.task.id,task.id);assert.ok(packet.validatorFailures.some((d:{code:string})=>d.code==='invalid_edit'));
  assert.ok(packet.unverifiedAreas.length>=2);assert.ok(result.request.requestedTokens<=6000);assert.deepEqual(result.metadata.historicalCharge,f.payload.modelState);
  assert.equal(result.metadata.modelRequestAuthorized,false);assert.equal(result.metadata.publicationAuthorized,false);
  assert.ok(!JSON.stringify(result.metadata).includes('Agent draft'));assert.ok(!result.request.body.includes(source));
  assert.deepEqual(readFileSync(join(f.root,task.id+'.execution.json')),f.bytes);
 }finally{f.cleanup();}
});
test('missing or wrong trusted digest, altered bytes and mismatched identity refuse recovery',async()=>{
 const f=await savedRejection();try{
  for(const expectedSha256 of ['',undefined,'f'.repeat(64)])assert.throws(()=>prepareCalculatorRejectedProposalRecovery({...f.input,expectedSha256} as any),recoveryRefusal);
  assert.throws(()=>prepareCalculatorRejectedProposalRecovery({...f.input,bytes:Buffer.from(f.bytes.toString().replace('Agent draft','Changed draft'))}),recoveryRefusal);
  for(const patch of [{baseSha:B},{taskId:plan.tasks[2]!.id},{runtimeConfigDigest:'f'.repeat(64)},{ownerFingerprint:'f'.repeat(64)}])assert.throws(()=>prepareCalculatorRejectedProposalRecovery({...f.input,identity:{...f.input.identity,...patch}}),recoveryRefusal);
 }finally{f.cleanup();}
});
test('snapshot copies, stale source, wrong task and changed plan never generate a correction body',async()=>{
 const f=await savedRejection();try{
  for(const snapshot of [{...f.input.snapshot},{...f.input.snapshot,baseSha:B},{...f.input.snapshot,changePaths:[]}])assert.throws(()=>prepareCalculatorRejectedProposalRecovery({...f.input,snapshot}),recoveryRefusal);
  assert.throws(()=>prepareCalculatorRejectedProposalRecovery({...f.input,taskId:plan.tasks[2]!.id}),recoveryRefusal);
  assert.throws(()=>prepareCalculatorRejectedProposalRecovery({...f.input,plan:{...plan,fingerprint:'f'.repeat(64)}}),recoveryRefusal);
 }finally{f.cleanup();}
});
test('absent terminal failure, transport failure and zero historical charge cannot become corrective authority',async()=>{
 for(const patch of [{failure:undefined},{failure:{reasonCode:'model_rate_limited',httpStatus:429}},{failure:{reasonCode:'proposal_changes_invalid',httpStatus:500}},{modelState:{attemptedRequests:0,totalRequestBytes:0,reservedRunTokens:0,elapsedMs:0}}] as Partial<CalculatorExecutionCheckpointPayload>[]){
  const f=await savedRejection(patch);try{
   assert.throws(()=>prepareCalculatorRejectedProposalRecovery(f.input),recoveryRefusal);
  }finally{f.cleanup();}
 }
});
test('a rejected repair or explicit author decline requires a different decision, not another generation correction',async()=>{
 for(const patch of [{attempt:2,stage:'repair_2',rejectedProposal:{taskId:task.id,kind:'repair',validationCode:'proposal_changes_invalid',result:{summary:'Repair rejected',changes:[]}}},
  {failure:{reasonCode:'model_declined_proposal'},rejectedProposal:{taskId:task.id,kind:'generation',validationCode:'model_declined_proposal',result:{summary:'Blocked: no verified evidence',changes:[]}}}] as Partial<CalculatorExecutionCheckpointPayload>[]){
  const f=await savedRejection(patch);try{assert.throws(()=>prepareCalculatorRejectedProposalRecovery(f.input),recoveryRefusal);}finally{f.cleanup();}
 }
});
