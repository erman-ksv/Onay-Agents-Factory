import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {captureCalculatorRuntimeFailure,parseCalculatorRuntimeFailure,createCalculatorRuntimeFailureCheckpoint,CALCULATOR_RUNTIME_FAILURE_ERROR} from './calculatorRuntimeFailure.js';
import {createCalculatorExecutionCheckpointStore,parseCalculatorExecutionCheckpointBytes,CALCULATOR_EXECUTION_CHECKPOINT_ERROR,type CalculatorExecutionCheckpointPayload} from './calculatorExecutionCheckpoint.js';
import {createCalculatorRuntimeCheckpointWriters,CALCULATOR_RUNTIME_ERROR} from './calculatorRuntime.js';
const identity={repository:'erman-ksv/Onay-Factory-Calculator',goalId:'offline-runtime',ownerFingerprint:'a'.repeat(64),planFingerprint:'b'.repeat(64),taskId:'offline-task',branch:'feat/offline-failure',baseSha:'c'.repeat(40),bootstrapSha:'d'.repeat(40),runtimeConfigDigest:'e'.repeat(64)};
const charge={attemptedRequests:2,totalRequestBytes:1200,reservedRunTokens:2400,elapsedMs:50};
const payload:CalculatorExecutionCheckpointPayload={attempt:1,stage:'generate_1',status:'running',assessments:[],modelState:charge,httpInFlight:true,publicationStarted:false};
const refusal={message:CALCULATOR_RUNTIME_FAILURE_ERROR},checkpointRefusal={message:CALCULATOR_EXECUTION_CHECKPOINT_ERROR};
function fixture(){const root=mkdtempSync(join(tmpdir(),'runtime-failure-')),store=createCalculatorExecutionCheckpointStore(root,identity);store.save(payload);return {root,store,path:join(root,identity.taskId+'.execution.json'),cleanup:()=>{store.close();rmSync(root,{recursive:true,force:true});}};}
test('capture retains fixed reason and observed HTTP status without provider body or private source',()=>{
 const failure=captureCalculatorRuntimeFailure({reasonCode:'operation_failed',message:'PRIVATE_SOURCE',body:'PRIVATE_BODY',scopedFailures:[{reasonCode:'model_rate_limited',providerHttpStatus:429,response:'PRIVATE_RESPONSE'}]});
 assert.deepEqual(failure,{reasonCode:'model_rate_limited',httpStatus:429});assert.deepEqual(captureCalculatorRuntimeFailure({httpStatus:503,scopedFailures:[{providerHttpStatus:429}]}),failure);assert.ok(!JSON.stringify(failure).includes('PRIVATE'));
 assert.deepEqual(captureCalculatorRuntimeFailure({reasonCode:'concurrent_operation',scopedFailures:[{httpStatus:503}]}),{reasonCode:'concurrent_operation',httpStatus:503});
});
test('unknown or accessor diagnostics do not become invented evidence and getters are not executed',()=>{
 let reads=0;const d=Object.defineProperty({},'reasonCode',{get(){reads++;throw Error('PRIVATE_ERROR');}});
 assert.deepEqual(captureCalculatorRuntimeFailure(d),{reasonCode:'model_failed'});assert.equal(reads,0);
 assert.deepEqual(captureCalculatorRuntimeFailure({reasonCode:'PRIVATE_ERROR',httpStatus:'429'}),{reasonCode:'model_failed'});
 assert.deepEqual(captureCalculatorRuntimeFailure({reasonCode:'operation_failed',scopedFailures:[{reasonCode:'project_owner_approval_unverified'}]}),{reasonCode:'project_owner_approval_unverified'});
});
test('failure schema refuses extra fields, arbitrary reasons, invalid status and getters',()=>{
 for(const x of [{reasonCode:'private_source'},{reasonCode:'model_failed',body:'PRIVATE_BODY'},{reasonCode:'model_failed',httpStatus:999},{reasonCode:'model_failed',httpStatus:undefined}])assert.throws(()=>parseCalculatorRuntimeFailure(x),refusal);
 let reads=0;const d=Object.defineProperty({},'reasonCode',{enumerable:true,get(){reads++;return 'model_failed';}});assert.throws(()=>parseCalculatorRuntimeFailure(d),refusal);assert.equal(reads,0);
});
test('failure and conservative charges survive a fresh checkpoint reader without clearing uncertain HTTP',async()=>{const f=fixture();try{
 const stop=createCalculatorRuntimeFailureCheckpoint({diagnostic:()=>({reasonCode:'operation_failed',providerHttpStatus:429}),charge:()=>charge,persist:(failure,modelState)=>{f.store.save({...payload,status:'blocked',failure,modelState});}});
 await stop();f.store.close();const fresh=createCalculatorExecutionCheckpointStore(f.root,identity);try{
  assert.deepEqual(fresh.read()!.failure,{reasonCode:'model_rate_limited',httpStatus:429});assert.deepEqual(fresh.inspect()!.modelState,charge);assert.equal(fresh.inspect()!.httpInFlight,true);assert.equal(fresh.inspect()!.status,'blocked');
  assert.deepEqual(fresh.inspect()!.failure,fresh.read()!.failure);
 }finally{fresh.close();}
 }finally{f.cleanup();}});
test('a durable failure is terminal and cannot be removed, changed or followed by a successful stage',()=>{const f=fixture();try{
 const stopped:CalculatorExecutionCheckpointPayload={...payload,status:'blocked',failure:{reasonCode:'concurrent_operation'}};f.store.save(stopped);const before=readFileSync(f.path);
 for(const next of [{...payload,status:'passed' as const,httpInFlight:false},{...stopped,failure:{reasonCode:'model_failed' as const}},stopped])assert.throws(()=>f.store.save(next),checkpointRefusal);
 assert.deepEqual(readFileSync(f.path),before);
 }finally{f.cleanup();}});
test('ordinary old checkpoints remain readable and are still replay barriers without a fabricated failure',()=>{const f=fixture();try{
 const before=readFileSync(f.path);f.store.close();const fresh=createCalculatorExecutionCheckpointStore(f.root,identity);try{assert.equal(fresh.read()!.failure,undefined);assert.equal(fresh.inspect()!.failure,undefined);}finally{fresh.close();}
 const {taskId,...runtimeIdentity}=identity,writers=createCalculatorRuntimeCheckpointWriters(f.root,runtimeIdentity);try{assert.throws(()=>writers.get(taskId),{message:CALCULATOR_RUNTIME_ERROR});}finally{writers.close();}
 assert.deepEqual(readFileSync(f.path),before);
 }finally{f.cleanup();}});
test('fresh runtime writers refuse a stopped checkpoint instead of resuming its request',()=>{const f=fixture();try{
 f.store.save({...payload,status:'blocked',failure:{reasonCode:'transport_stopped'}});f.store.close();const before=readFileSync(f.path),{taskId,...runtimeIdentity}=identity,writers=createCalculatorRuntimeCheckpointWriters(f.root,runtimeIdentity);
 try{assert.throws(()=>writers.get(taskId),{message:CALCULATOR_RUNTIME_ERROR});assert.throws(()=>writers.get(taskId),{message:CALCULATOR_RUNTIME_ERROR});}finally{writers.close();}
 assert.deepEqual(readFileSync(f.path),before);
 }finally{f.cleanup();}});
test('failure cannot be attached to passed/running state or contain a lazy source accessor',()=>{const f=fixture();try{
 for(const status of ['running','passed'] as const)assert.throws(()=>f.store.save({...payload,status,httpInFlight:false,failure:{reasonCode:'model_failed'}}),checkpointRefusal);
 let reads=0;const lazy=Object.defineProperty({...payload,status:'blocked'},'failure',{enumerable:true,get(){reads++;return {reasonCode:'model_failed'};}});
 assert.throws(()=>f.store.save(lazy as CalculatorExecutionCheckpointPayload),checkpointRefusal);assert.equal(reads,0);
 }finally{f.cleanup();}});
test('failure recording cannot lower previously recorded request bytes, tokens or attempts',()=>{const f=fixture();try{
 const before=readFileSync(f.path);for(const key of ['attemptedRequests','totalRequestBytes'] as const)assert.throws(()=>f.store.save({...payload,status:'blocked',failure:{reasonCode:'model_failed'},modelState:{...charge,[key]:0}}),checkpointRefusal);assert.deepEqual(readFileSync(f.path),before);f.store.save({...payload,status:'blocked',failure:{reasonCode:'model_failed'},modelState:{...charge,reservedRunTokens:0}});assert.equal(f.store.read()!.modelState.reservedRunTokens,charge.reservedRunTokens);
 }finally{f.cleanup();}});
test('failed persistence is not retried and leaves the prior checkpoint as the replay barrier',async()=>{const f=fixture();try{
 let attempts=0;const before=readFileSync(f.path),stop=createCalculatorRuntimeFailureCheckpoint({diagnostic:()=>({reasonCode:'transport_stopped'}),charge:()=>charge,persist:()=>{attempts++;throw Error('PRIVATE_DISK_ERROR');}});
 await assert.rejects(()=>stop(),refusal);await assert.rejects(()=>stop(),refusal);assert.equal(attempts,1);assert.deepEqual(readFileSync(f.path),before);assert.equal(f.store.inspect()!.httpInFlight,true);
 }finally{f.cleanup();}});
test('lost write acknowledgement keeps the persisted failure and does not cause a second save',async()=>{const f=fixture();try{
 let attempts=0;const stop=createCalculatorRuntimeFailureCheckpoint({diagnostic:()=>({reasonCode:'validation_failed'}),charge:()=>charge,persist:(failure,modelState)=>{attempts++;f.store.save({...payload,status:'blocked',failure,modelState});throw Error('PRIVATE_LOST_ACK');}});
 await assert.rejects(()=>stop(),refusal);await assert.rejects(()=>stop(),refusal);assert.equal(attempts,1);assert.equal(f.store.read()!.failure!.reasonCode,'validation_failed');assert.deepEqual(f.store.read()!.modelState,charge);
 }finally{f.cleanup();}});
test('asynchronous failure persistence is awaited and still remains one-use',async()=>{
 let release!:()=>void,completed=false;const gate=new Promise<void>(r=>{release=r;}),stop=createCalculatorRuntimeFailureCheckpoint({diagnostic:()=>({reasonCode:'execution_failed'}),charge:()=>charge,persist:async()=>{await gate;completed=true;}});
 const result=stop();assert.equal(completed,false);await assert.rejects(()=>stop(),refusal);release();await result;assert.equal(completed,true);
});
test('serialized terminal failure is integrity checked during private artifact import',()=>{const f=fixture();try{
 f.store.save({...payload,status:'blocked',failure:{reasonCode:'model_rate_limited',httpStatus:429}});const raw=readFileSync(f.path);
 assert.equal(parseCalculatorExecutionCheckpointBytes(raw,identity).data.payload.failure!.httpStatus,429);
 const changed=JSON.parse(raw.toString());changed.payload.failure.httpStatus=200;assert.throws(()=>parseCalculatorExecutionCheckpointBytes(Buffer.from(JSON.stringify(changed)),identity),checkpointRefusal);
 }finally{f.cleanup();}});
