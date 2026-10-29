import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {prepareCalculatorRejectedProposal,calculatorRejectedProposalMetadata,createCalculatorRuntimeProposalRejection,CALCULATOR_REJECTED_PROPOSAL_ERROR,type CalculatorRuntimeProposalContext} from './calculatorRejectedProposalCheckpoint.js';
import {createCalculatorExecutionCheckpointStore,parseCalculatorExecutionCheckpointBytes,CALCULATOR_EXECUTION_CHECKPOINT_ERROR,type CalculatorExecutionCheckpointPayload} from './calculatorExecutionCheckpoint.js';
import {captureCalculatorRuntimeFailure} from './calculatorRuntimeFailure.js';
const identity={repository:'erman-ksv/Onay-Factory-Calculator',goalId:'offline-rejection',ownerFingerprint:'a'.repeat(64),planFingerprint:'b'.repeat(64),taskId:'offline-task',branch:'feat/offline-rejection',baseSha:'c'.repeat(40),bootstrapSha:'d'.repeat(40),runtimeConfigDigest:'e'.repeat(64)};
const amount={attemptedRequests:1,totalRequestBytes:1000,reservedRunTokens:2000,elapsedMs:10};
const payload:CalculatorExecutionCheckpointPayload={attempt:1,stage:'generate_1',status:'running',assessments:[],modelState:amount,httpInFlight:true,publicationStarted:false};
const event={taskId:identity.taskId,kind:'generation' as const,validationCode:'proposal_changes_invalid' as const,result:{summary:'PRIVATE_AUTHOR_OUTPUT',changes:[{operation:'create',path:'unexpected.txt',content:'export const fixture=1;',message:'Offline rejected fixture'}]}};
const refusal={message:CALCULATOR_REJECTED_PROPOSAL_ERROR},checkpointRefusal={message:CALCULATOR_EXECUTION_CHECKPOINT_ERROR};
function fixture(){const root=mkdtempSync(join(tmpdir(),'rejected-author-')),store=createCalculatorExecutionCheckpointStore(root,identity);store.save(payload);let writes=0;
 const context:CalculatorRuntimeProposalContext={taskId:identity.taskId,stage:'generate_1',attempt:1,status:'running',httpInFlight:true,publicationStarted:false};
 const options={context:()=>context,charge:()=>amount,persistReturned:(rejectedProposal:ReturnType<typeof prepareCalculatorRejectedProposal>,modelState:typeof amount)=>{writes++;store.save({...payload,status:'blocked',httpInFlight:false,rejectedProposal,modelState});}};
 return {root,store,context,options,writes:()=>writes,path:join(root,identity.taskId+'.execution.json'),cleanup:()=>{store.close();rmSync(root,{recursive:true,force:true});}};
}
test('rejected author output remains private data and metadata contains only a digest and fixed classification',()=>{
 const rejected=prepareCalculatorRejectedProposal(event),metadata=calculatorRejectedProposalMetadata(rejected);
 assert.deepEqual(rejected.result,event.result);assert.equal(Object.isFrozen(rejected.result),true);assert.match(metadata.resultSha256,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(metadata).includes('PRIVATE_AUTHOR_OUTPUT'));assert.equal('result' in metadata,false);assert.equal('publicationAuthorized' in metadata,false);
});
test('private encoding rejects keys, oversized data, cycles and lazy output without executing accessors',()=>{
 let reads=0;const lazy=Object.defineProperty({},'content',{enumerable:true,get(){reads++;return 'PRIVATE_SOURCE';}}),cyclic:Record<string,unknown>={};cyclic.self=cyclic;
 for(const result of [{secret:'gsk_'+'x'.repeat(48)},{text:'x'.repeat(97000)},cyclic,lazy])assert.throws(()=>prepareCalculatorRejectedProposal({...event,result}),refusal);
 assert.equal(reads,0);
});
test('task kind and classification are fixed and a decline must match the received empty proposal',()=>{
 for(const input of [{...event,kind:'security'},{...event,validationCode:'approved'},{...event,source:'PRIVATE'},{...event,validationCode:'model_declined_proposal'}])assert.throws(()=>prepareCalculatorRejectedProposal(input),refusal);
 const decline=prepareCalculatorRejectedProposal({...event,validationCode:'model_declined_proposal',result:{summary:'Blocked: missing verified context',changes:[]}});assert.equal(decline.validationCode,'model_declined_proposal');
});
test('a returned invalid proposal is captured before uncertainty is cleared and survives a fresh reader',async()=>{const f=fixture();try{
 await createCalculatorRuntimeProposalRejection(f.options)(event);assert.equal(f.writes(),1);f.store.close();const fresh=createCalculatorExecutionCheckpointStore(f.root,identity);try{
  assert.deepEqual(fresh.read()!.rejectedProposal!.result,event.result);assert.equal(fresh.inspect()!.httpInFlight,false);assert.equal(fresh.inspect()!.status,'blocked');assert.deepEqual(fresh.inspect()!.modelState,amount);
  assert.ok(!JSON.stringify(fresh.inspect()).includes('PRIVATE_AUTHOR_OUTPUT'));assert.equal('result' in fresh.inspect()!.rejectedProposal!,false);
 }finally{fresh.close();}
 }finally{f.cleanup();}});
test('wrong task, role stage, status, attempt and publication state stop capture before writing',async()=>{for(const patch of [{taskId:'other-task'},{stage:'security_1'},{status:'passed' as const},{attempt:2 as const},{httpInFlight:false},{publicationStarted:true}]){const f=fixture();try{
 const before=readFileSync(f.path);await assert.rejects(()=>createCalculatorRuntimeProposalRejection({...f.options,context:()=>({...f.context,...patch})})(event),refusal);assert.equal(f.writes(),0);assert.deepEqual(readFileSync(f.path),before);
 }finally{f.cleanup();}}});
test('an unrecorded or uncertain response cannot be captured twice or converted to approval',async()=>{const f=fixture();try{
 const hook=createCalculatorRuntimeProposalRejection(f.options);await hook(event);const before=readFileSync(f.path);await assert.rejects(()=>hook(event),refusal);assert.equal(f.writes(),1);
 assert.throws(()=>f.store.save({...payload,status:'passed',httpInFlight:false}),checkpointRefusal);assert.throws(()=>f.store.save({...payload,status:'blocked',httpInFlight:false}),checkpointRefusal);assert.deepEqual(readFileSync(f.path),before);
 }finally{f.cleanup();}});
test('only a matching terminal failure may follow capture; rejected output cannot be edited',async()=>{const f=fixture();try{
 await createCalculatorRuntimeProposalRejection(f.options)(event);const captured=f.store.read()!;
 assert.throws(()=>f.store.save({...captured,rejectedProposal:prepareCalculatorRejectedProposal({...event,result:{summary:'changed'}}),failure:{reasonCode:'model_failed'}}),checkpointRefusal);
 const failure=captureCalculatorRuntimeFailure({reasonCode:'operation_failed',scopedFailures:[{reasonCode:'proposal_changes_invalid',httpStatus:200}]});
 f.store.save({...captured,failure});assert.equal(f.store.read()!.failure!.reasonCode,'proposal_changes_invalid');assert.deepEqual(f.store.read()!.rejectedProposal,captured.rejectedProposal);
 }finally{f.cleanup();}});
test('failure before disk persistence leaves the original uncertain checkpoint and is not retried',async()=>{const f=fixture();try{
 let attempts=0;const before=readFileSync(f.path),hook=createCalculatorRuntimeProposalRejection({...f.options,persistReturned:()=>{attempts++;throw Error('PRIVATE_DISK_ERROR');}});
 await assert.rejects(()=>hook(event),refusal);await assert.rejects(()=>hook(event),refusal);assert.equal(attempts,1);assert.deepEqual(readFileSync(f.path),before);assert.equal(f.store.read()!.httpInFlight,true);
 }finally{f.cleanup();}});
test('lost persistence acknowledgement preserves the captured body without a second write',async()=>{const f=fixture();try{
 let attempts=0;const hook=createCalculatorRuntimeProposalRejection({...f.options,persistReturned:(rejected,charge)=>{attempts++;f.options.persistReturned(rejected,charge);throw Error('PRIVATE_LOST_ACK');}});
 await assert.rejects(()=>hook(event),refusal);await assert.rejects(()=>hook(event),refusal);assert.equal(attempts,1);assert.equal(f.writes(),1);assert.equal(f.store.read()!.httpInFlight,false);assert.deepEqual(f.store.read()!.rejectedProposal!.result,event.result);
 }finally{f.cleanup();}});
test('asynchronous capture completes before the parsed-response hook returns',async()=>{const f=fixture();try{
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;}),hook=createCalculatorRuntimeProposalRejection({...f.options,persistReturned:async(rejected,charge)=>{await gate;f.options.persistReturned(rejected,charge);}});
 const pending=hook(event);assert.equal(f.store.read()!.httpInFlight,true);release();await pending;assert.equal(f.store.read()!.httpInFlight,false);
 }finally{f.cleanup();}});
test('imported private rejection is identity-bound and integrity checked',async()=>{const f=fixture();try{
 await createCalculatorRuntimeProposalRejection(f.options)(event);const bytes=readFileSync(f.path);assert.deepEqual(parseCalculatorExecutionCheckpointBytes(bytes,identity).data.payload.rejectedProposal!.result,event.result);
 assert.throws(()=>parseCalculatorExecutionCheckpointBytes(bytes,{...identity,taskId:'another-task'}),checkpointRefusal);
 const changed=JSON.parse(bytes.toString());changed.payload.rejectedProposal.result.summary='changed';assert.throws(()=>parseCalculatorExecutionCheckpointBytes(Buffer.from(JSON.stringify(changed)),identity),checkpointRefusal);
 }finally{f.cleanup();}});
test('repair responses cannot masquerade as initial generation or arrive during a review stage',async()=>{const f=fixture();try{
 for(const current of [f.context,{...f.context,attempt:2 as const,stage:'reviewer_2'}])await assert.rejects(()=>createCalculatorRuntimeProposalRejection({...f.options,context:()=>current})({...event,kind:'repair'}),refusal);assert.equal(f.writes(),0);
 let captured=false;await createCalculatorRuntimeProposalRejection({...f.options,context:()=>({...f.context,attempt:2,stage:'repair_2'}),persistReturned:()=>{captured=true;}})({...event,kind:'repair'});assert.equal(captured,true);
 }finally{f.cleanup();}});
