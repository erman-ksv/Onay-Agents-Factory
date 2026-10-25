import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {CalculatorPlanStore} from './calculatorPlanStore.js';import {openCalculatorWorkspace} from './calculatorWorkspace.js';
import {createCalculatorExecutionCheckpointStore,type CalculatorExecutionCheckpointPayload} from './calculatorExecutionCheckpoint.js';
import {createCalculatorRuntimeCheckpointWriters,runCalculatorRuntime,CALCULATOR_RUNTIME_ERROR} from './calculatorRuntime.js';
import {prepareCalculatorRuntimeRecoveryHost,calculatorRuntimeRecoverySource,admitCalculatorRuntimeRecovery,claimCalculatorRuntimeRecovery,assertCalculatorRuntimeRecovery,routeCalculatorRuntimeRecovery,CALCULATOR_RUNTIME_RECOVERY_ERROR} from './calculatorRuntimeRecovery.js';
import {authorizeProjectBudget,projectBudgetApprovalDigest,reconcileProjectBudgetHistory} from './projectBudgetAuthorization.js';
import {createProjectModelBudgetFileStore} from './projectModelBudgetFileStore.js';
import {createCalculatorProjectRuntimeTeam} from './calculatorProjectRuntimeTeam.js';
import {createCalculatorRuntimeProposalRejection} from './calculatorRejectedProposalCheckpoint.js';
import {runCalculatorExecution,type CalculatorExecutionTools} from './calculatorExecution.js';
import type {CalculatorTreeEntry} from '../github/calculatorSnapshot.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/calculatorStep7SavedPlan.json',import.meta.url),'utf8'));
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex'),C='c'.repeat(40),D='d'.repeat(40);
const refusal={message:CALCULATOR_RUNTIME_RECOVERY_ERROR};
async function setup(mode='development'){
 const root=mkdtempSync(join(tmpdir(),'runtime-recovery-')),store=new CalculatorPlanStore(root,fixture.request),plan=store.initialize(fixture.proposal),A=plan.owner.baseSha,task=plan.tasks[1]!;
 for(const d of ['source','phase','ledger'])mkdirSync(join(root,d),{mode:0o700});
 const prior=store.taskReceipt(plan,plan.tasks[0]!);prior.claim();for(const stage of ['host_tests_1','publish_candidate']){prior.recordStage(stage,'running');prior.recordStage(stage,'passed');}prior.recordPublication({branch:plan.branch,headSha:A,number:1,url:'https://github.com/'+plan.owner.repository+'/pull/1'});prior.finish('needs-review','task_candidate_verified_not_whole_app');prior.close();
 const original=store.taskReceipt(plan,task);original.claim();original.recordStage('generate_1','running');original.recordStage('generate_1','blocked');original.finish('blocked','execution_failed_no_replay');original.close();
 const receiptPath=join(root,'calc-'+task.id+'.json'),receipt=readFileSync(receiptPath);
 const identity={repository:plan.owner.repository,goalId:plan.owner.id,ownerFingerprint:plan.owner.ownerFingerprint,planFingerprint:plan.fingerprint,taskId:task.id,branch:plan.branch,baseSha:A,bootstrapSha:A,runtimeConfigDigest:'e'.repeat(64)};
 const source=createCalculatorExecutionCheckpointStore(join(root,'source'),identity);
 const ref=source.save({attempt:1,stage:'generate_1',status:'blocked',assessments:[],modelState:{attemptedRequests:1,totalRequestBytes:100,reservedRunTokens:500,elapsedMs:10},httpInFlight:false,publicationStarted:false,failure:{reasonCode:'proposal_changes_invalid'},rejectedProposal:{taskId:task.id,kind:'generation',validationCode:'proposal_changes_invalid',result:{summary:'PRIVATE_SAVED_REJECTION',changes:[{operation:'create',path:'unapproved.txt',content:'export const fixture=1;',message:'Invalid path'}]}}});
 const sourcePath=join(root,'source',task.id+'.execution.json'),bytes=readFileSync(sourcePath);source.close();
 const blobs=new Map<string,string>(),baseTree:CalculatorTreeEntry[]=[{path:'src',sha:D,type:'tree',mode:'040000'},{path:'test',sha:D,type:'tree',mode:'040000'}];
 const blob=(s:string)=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0'+s).digest('hex');
 for(const path of plan.tasks[0]!.paths){const content='// Offline dependency fixture '+path+'\n';blobs.set(blob(content),content);baseTree.push({path,sha:blob(content),type:'blob',mode:'100644'});}
 let head=A,tree=baseTree;const reader={getHead:async()=>head,readCommit:async(sha:string)=>({sha,treeSha:sha,parents:sha===A?[]:[A]}),readTree:async(sha:string)=>({sha,truncated:false,tree:sha===A?baseTree:tree}),readBlob:async(sha:string)=>({sha,encoding:'base64',content:Buffer.from(blobs.get(sha)??'').toString('base64')})};
 const workspace=await openCalculatorWorkspace(store,reader,plan.branch,A);
 const budgetIdentity={projectId:plan.owner.id,repository:plan.owner.repository,planFingerprint:plan.fingerprint,ownerFingerprint:plan.owner.ownerFingerprint,taskIds:plan.tasks.map(t=>t.id)};
 const history={version:1 as const,projectId:plan.owner.id,repository:plan.owner.repository,planFingerprint:plan.fingerprint,observations:['planning',...budgetIdentity.taskIds].map(scopeId=>({scopeId,kind:'cumulative-scope-total' as const,charge:{requests:1,requestBytes:100,reservedTokens:500},evidenceSha256:'f'.repeat(64)}))};const h=reconcileProjectBudgetHistory(history,budgetIdentity);
 const document={version:1,kind:'authorize-project-model-budget',mode,grant:{version:1,projectId:plan.owner.id,repository:plan.owner.repository,planFingerprint:plan.fingerprint,grantId:'offline-recovery-grant',maxRequests:h.charge.requests+4,maxRequestBytes:24000,maxTotalRequestBytes:200000,maxReservedTokens:96000,historical:h.charge,historicalEvidenceSha256:h.digest,provider:'groq',freeTierConfirmed:true,legalEnabled:false},expiresAt:'2026-10-26T12:00:00Z'};
 const comment={id:1,user:{login:'erman-ksv',type:'User'},author_association:'OWNER',issue_url:'https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/75',html_url:'https://github.com/erman-ksv/Onay-Agents-Factory/pull/75#issuecomment-1',created_at:'2026-10-25T11:00:00Z',updated_at:'2026-10-25T11:00:00Z',body:JSON.stringify(document)};
 const controller=await authorizeProjectBudget({identity:budgetIdentity,history,decision:{issueNumber:75,commentId:1,bodySha256:projectBudgetApprovalDigest(document)},token:'offline-test-token',store:createProjectModelBudgetFileStore(join(root,'ledger')),now:()=>Date.parse('2026-10-25T12:00:00Z'),transport:async()=>Response.json(comment)});await controller.initialize();
 let claims=0,sourceChecks=0,claimChecks=0,dependencies=0,sourceOk=true,recoveryOk=true;
 const raw={bytes,expectedSha256:ref.sha256,identity,receipt,receiptSha256:hash(receipt),verifyDependencies:async(e:any)=>{dependencies++;return {...e,taskId:e.task.id,securityReady:true as const,independentReviewReady:true as const,taskChecksPassed:true as const,testsExecuted:true as const};},assertSourceRemote:async(b:any)=>{sourceChecks++;assert.equal(b.checkpointSha256,ref.sha256);assert.equal(b.receiptSha256,hash(receipt));if(!sourceOk)throw Error('Private source unavailable');},claimRecovery:async()=>{if(claims)throw Error('Duplicate claim');claims++;},assertRecovery:async()=>{claimChecks++;if(!recoveryOk||claims!==1)throw Error('Private marker unavailable');}};
 const host=prepareCalculatorRuntimeRecoveryHost(raw)!;
 return {root,store,plan,task,A,workspace,controller,raw,host,reader,sourcePath,receiptPath,bytes,receipt,counts:()=>({claims,sourceChecks,claimChecks,dependencies}),setSourceOk:(v:boolean)=>{sourceOk=v;},setRecoveryOk:(v:boolean)=>{recoveryOk=v;},move:(sha:string)=>{head=sha;},publish:(files:readonly {path:string;content:string}[])=>{tree=[...baseTree,...files.map(f=>({path:f.path,sha:blob(f.content),type:'blob',mode:'100644'}))];head=C;},cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('host recovery input copies private evidence and refuses JSON, getters, wrong hashes and altered identity',async()=>{const f=await setup();try{
 let reads=0;const getter=Object.defineProperty({...f.raw},'identity',{enumerable:true,get(){reads++;return f.raw.identity;}});
 for(const value of [JSON.parse(JSON.stringify(f.raw)),getter,{...f.raw,receiptSha256:'a'.repeat(64)},{...f.raw,expectedSha256:'a'.repeat(64)},{...f.raw,identity:{...f.raw.identity,taskId:'other'}}])assert.throws(()=>prepareCalculatorRuntimeRecoveryHost(value),refusal);assert.equal(reads,0);
 const lazy=Object.defineProperty({...f.raw.identity},'taskId',{enumerable:true,get(){reads++;return f.task.id;}});assert.throws(()=>prepareCalculatorRuntimeRecoveryHost({...f.raw,identity:lazy}),refusal);assert.equal(reads,0);
 const original=calculatorRuntimeRecoverySource(f.host).bytes;f.host.bytes.fill(0);assert.deepEqual(calculatorRuntimeRecoverySource(f.host).bytes,original);
 }finally{f.cleanup();}});
test('admission verifies unchanged original receipts and real dependency contract before one-use remote claim',async()=>{const f=await setup();try{
 const permit=await admitCalculatorRuntimeRecovery(f.workspace,f.store,f.host,f.controller,join(f.root,'phase'),'openai/gpt-oss-120b');assert.equal(f.counts().claims,1);assert.equal(f.counts().dependencies,1);
 await assert.rejects(()=>claimCalculatorRuntimeRecovery(f.workspace,{...permit}),refusal);const claimed=await claimCalculatorRuntimeRecovery(f.workspace,permit);assert.equal(claimed.selection.task.id,f.task.id);claimed.store.finish('blocked','offline-admission-test');claimed.store.close();
 await assert.rejects(()=>claimCalculatorRuntimeRecovery(f.workspace,permit),refusal);await assert.rejects(()=>admitCalculatorRuntimeRecovery(f.workspace,f.store,f.host,f.controller,join(f.root,'phase'),'model'),refusal);
 assert.deepEqual(readFileSync(f.sourcePath),f.bytes);assert.deepEqual(readFileSync(f.receiptPath),f.receipt);
 }finally{f.cleanup();}});
test('source and read-only authorization failures cannot create a recovery claim',async()=>{
 for(const mode of ['source','read-only-review','dependency']){const f=await setup(mode==='read-only-review'?mode:'development');try{
 if(mode==='source')f.setSourceOk(false);const host=mode==='dependency'?prepareCalculatorRuntimeRecoveryHost({...f.raw,verifyDependencies:async()=>undefined})!:f.host;
 await assert.rejects(()=>admitCalculatorRuntimeRecovery(f.workspace,f.store,host,f.controller,join(f.root,'phase'),'model'),refusal);assert.equal(f.counts().claims,0);
 }finally{f.cleanup();}}
});
test('uncertain remote claim acknowledgement is not retried with the same host capability',async()=>{const f=await setup();try{
 let writes=0;const host=prepareCalculatorRuntimeRecoveryHost({...f.raw,claimRecovery:async()=>{writes++;throw Error('PRIVATE_LOST_ACK');}})!;
 await assert.rejects(()=>admitCalculatorRuntimeRecovery(f.workspace,f.store,host,f.controller,join(f.root,'phase'),'model'),refusal);await assert.rejects(()=>admitCalculatorRuntimeRecovery(f.workspace,f.store,host,f.controller,join(f.root,'phase'),'model'),refusal);assert.equal(writes,1);
 }finally{f.cleanup();}});
test('stale base, a started successor or mismatched dependency evidence block recovery admission',async()=>{
 for(const mode of ['base','successor','dependency']){const f=await setup();try{
  if(mode==='base')f.move(C);
  if(mode==='successor'){const later=f.store.taskReceipt(f.plan,f.plan.tasks[2]!);later.claim();later.finish('blocked','offline-test');later.close();}
  const host=mode==='dependency'?prepareCalculatorRuntimeRecoveryHost({...f.raw,verifyDependencies:async(e:any)=>({...e,taskId:'wrong-task',securityReady:true,independentReviewReady:true,taskChecksPassed:true,testsExecuted:true})})!:f.host;
  await assert.rejects(()=>admitCalculatorRuntimeRecovery(f.workspace,f.store,host,f.controller,join(f.root,'phase'),'model'));assert.equal(f.counts().claims,0);
 }finally{f.cleanup();}}
});
test('receipt mutation during remote verification is caught before the remote claim',async()=>{const f=await setup();try{
 const host=prepareCalculatorRuntimeRecoveryHost({...f.raw,assertSourceRemote:async()=>{const receipt=JSON.parse(f.receipt.toString());receipt.reasonCode='changed-during-await';writeFileSync(f.receiptPath,JSON.stringify(receipt)+'\n');}})!;
 await assert.rejects(()=>admitCalculatorRuntimeRecovery(f.workspace,f.store,host,f.controller,join(f.root,'phase'),'model'),refusal);assert.equal(f.counts().claims,0);
 }finally{f.cleanup();}});
test('a failed remote assertion latches refusal even if later requests would succeed',async()=>{const f=await setup();try{
 const permit=await admitCalculatorRuntimeRecovery(f.workspace,f.store,f.host,f.controller,join(f.root,'phase'),'model');f.setRecoveryOk(false);await assert.rejects(()=>assertCalculatorRuntimeRecovery(permit),refusal);f.setRecoveryOk(true);await assert.rejects(()=>assertCalculatorRuntimeRecovery(permit),refusal);await assert.rejects(()=>claimCalculatorRuntimeRecovery(f.workspace,permit),refusal);
 }finally{f.cleanup();}});
test('normal runtime rejects recovery outside project run or with incompatible modes before creating state',async()=>{const f=await setup();try{
 const directory=join(f.root,'uncreated'),error={message:CALCULATOR_RUNTIME_ERROR},limits={maxRequests:4,maxRunBytes:96000,maxRepairs:0,hostPreset:'calculator-frontend-2048-four-roles'} as const;
 for(const mode of ['inspect','plan','preflight','run'] as const)await assert.rejects(()=>runCalculatorRuntime({}, {},directory,mode,{},limits,undefined,undefined,undefined,f.raw),error);assert.equal(existsSync(directory),false);
 }finally{f.cleanup();}});
test('routed executor preserves original failure and runs correction roles tools publication and candidate CI with separate phase state',async()=>{const f=await setup();try{
 const permit=await admitCalculatorRuntimeRecovery(f.workspace,f.store,f.host,f.controller,join(f.root,'phase'),'openai/gpt-oss-120b');
 let clock=0,sends=0,checks=0,publishes=0,ciReads=0;const env={AGENT_FACTORY_TARGET_PROFILE:'calculator',AGENT_FACTORY_PROVIDER:'groq',GROQ_API_KEY:'fixture-key',CALCULATOR_MODEL_LIVE_APPROVED:'ONE_FREE_BOUNDED_RUN',ONAY_TEAM_FREE_TIER_CONFIRMED:'true',AGENT_FACTORY_LEGAL_ENABLED:'false'};
 const identity={...f.raw.identity,runtimeConfigDigest:'9'.repeat(64)},writers=createCalculatorRuntimeCheckpointWriters(join(f.root,'phase'),identity);
 let active:CalculatorExecutionCheckpointPayload={attempt:2,stage:'load_current_source',status:'running',assessments:[],modelState:{attemptedRequests:0,totalRequestBytes:0,reservedRunTokens:0,elapsedMs:0},httpInFlight:false,publicationStarted:false};
 let team!:Awaited<ReturnType<typeof createCalculatorProjectRuntimeTeam>>;
 const afterProposalRejected=createCalculatorRuntimeProposalRejection({context:()=>({...active,taskId:f.task.id}),charge:()=>team.checkpointCharge(),persistReturned:(rejectedProposal,modelState)=>{active={...active,status:'blocked',httpInFlight:false,rejectedProposal,modelState};writers.get(f.task.id).save(active);}});
 team=await createCalculatorProjectRuntimeTeam(fixture.request,f.plan,env,{controller:f.controller,executionId:'offline-main-route'},{preset:'calculator-frontend-2048-four-roles',timing:{now:()=>clock,wait:async ms=>{clock+=ms;}},checkpoints:{beforeRequest:async modelState=>{await assertCalculatorRuntimeRecovery(permit);active={...active,modelState,httpInFlight:true};writers.get(f.task.id).save(active);},afterProposalRejected},transport:async()=>{sends++;return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(sends===1?{summary:'Agent correction fixture',changes:f.task.paths.map(path=>({operation:'create',path,content:path.endsWith('.html')?'<!doctype html><title>Fixture</title>':path.endsWith('.css')?'body{color:black}':'export const ready=true;',message:'Offline generated fixture'}))}:{ready:true,summary:'Independent fixture only',findings:[],unverifiedAreas:['Actual mobile acceptance remains separate']})}}]});}});
 const tools:CalculatorExecutionTools={checkProposal:async e=>{checks++;return {repository:f.plan.owner.repository,taskId:f.task.id,baseSha:f.A,proposalDigest:e.proposalDigest,status:'passed',testsExecuted:true,failures:[]};},publish:async e=>{publishes++;f.publish(e.changes.files);return {branch:f.plan.branch,headSha:C,number:1,url:'https://github.com/'+f.plan.owner.repository+'/pull/1'};},ci:async()=>{ciReads++;return {repository:f.plan.owner.repository,branch:f.plan.branch,candidateSha:C,runs:[{id:17,name:'Calculator task CI',status:'completed',conclusion:'success',head_sha:C,run_attempt:1,html_url:'https://github.com/'+f.plan.owner.repository+'/actions/runs/17'}],jobs:[{name:'Calculator task CI',status:'completed',conclusion:'success',run_id:17,run_attempt:1,head_sha:C,steps:['Syntax','Task tests'].map(name=>({name,status:'completed',conclusion:'success'}))}]};}};
 const routed=routeCalculatorRuntimeRecovery(team,tools,permit);
 const result=await runCalculatorExecution(f.workspace,{...routed,maxRepairs:0,rejectedProposalPermit:permit,execution:'offline-test',checkpoint:event=>{const {taskId:_,...fields}=event;active={...fields,modelState:team.checkpointCharge(),httpInFlight:event.status==='passed'?false:active.httpInFlight};writers.get(f.task.id).save(active);}});
 assert.equal(result.status,'candidate-verified',JSON.stringify({result,sends,diagnostic:team.diagnostic(),stage:active.stage}));assert.equal(result.repairs,1);assert.deepEqual({sends,checks,publishes,ciReads},{sends:4,checks:1,publishes:1,ciReads:1});assert.equal(result.wholeAppCompleted,false);
 assert.equal(writers.get(f.task.id).read()!.attempt,2);assert.equal(writers.get(f.task.id).read()!.modelState.attemptedRequests,4);writers.close();
 assert.deepEqual(readFileSync(f.sourcePath),f.bytes);assert.deepEqual(readFileSync(f.receiptPath),f.receipt);
 }finally{f.cleanup();}});
