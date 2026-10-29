import {T03_OWNER_CORRECTION_2_PRIOR,assertT03OwnerCorrection2Charge} from '../orchestration/calculatorT03OwnerCorrectionPolicy.js';
// One real host bridge into the ordinary executor. No replacement app source.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,readdirSync,openSync,closeSync,fsyncSync,renameSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadHistoricalArchives} from './calculator-historical-archives.mjs';
import {createCalculatorLiveBarrier} from '../orchestration/calculatorLiveBarrier.js';
import {CALCULATOR_T02_CHARGE_PIN as PIN} from '../orchestration/calculatorT02ChargeReconciliation.js';
import {inspectCalculatorT02ReadOnlyHandoff} from '../orchestration/calculatorT02ReadOnlyHandoff.js';
import {recordCalculatorT02ReconciliationSidecar} from '../orchestration/calculatorT02ReconciliationSidecar.js';
import {previewCalculatorT02Successor} from '../orchestration/calculatorT02SuccessorPreview.js';
import {admitHistoricalT02OneSuccessor,createHistoricalT03ExecutionCallback} from '../orchestration/calculatorT02Admission.js';
import {inspectCalculatorPublishedTaskState,calculatorPublishedTaskLaunch} from '../orchestration/calculatorPublishedTaskState.js';
import {parseCalculatorExecutionCheckpointBytes,createCalculatorExecutionCheckpointStore} from '../orchestration/calculatorExecutionCheckpoint.js';
import {CalculatorPlanStore} from '../orchestration/calculatorPlanStore.js';
import {createCalculatorSnapshotReader,loadCalculatorSnapshot,calculatorSources} from '../github/calculatorSnapshot.js';
import {createCalculatorCiReader} from '../github/calculatorCi.js';
import {verifyCalculatorAfterCiCandidateCi} from '../orchestration/calculatorAfterCi.js';
import {createCalculatorSandbox} from '../orchestration/calculatorSandbox.js';
import {createCalculatorBrowserSandbox} from '../orchestration/calculatorBrowserSandbox.js';
import {collectCalculatorAssessmentEvidence} from '../orchestration/calculatorAssessmentEvidence.js';
import {calculatorProposalDigest} from '../orchestration/calculatorExecutionEvidence.js';
import {createCalculatorModelTeam} from '../orchestration/calculatorModelTeam.js';
import {createCalculatorAgentRepairTeam} from '../orchestration/calculatorAgentRepair.js';
import {inspectCalculatorT03StoppedRepair,calculatorT03RepairFailure,admitCalculatorT03RepairContinuation,T03_REPAIR_CHARGE,T03_REPAIR_CAPSULE_SHA} from '../orchestration/calculatorT03RepairContinuation.js';
import {openCalculatorWorkspace} from '../orchestration/calculatorWorkspace.js';
import {runCalculatorExecution} from '../orchestration/calculatorExecution.js';
import {createCalculatorPublisher} from '../github/calculatorPublisher.js';
const REPO='erman-ksv/Onay-Factory-Calculator',TASK='calculator-pilot-step7-v1-34ee03-t03';
const PLAN='1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2';
const NODE='node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392';
const BROWSER='mcr.microsoft.com/playwright@sha256:f1e7e01021efd65dd1a2c56064be399f3e4de00fd021ac561325f2bfbb2b837a';
const sha=b=>createHash('sha256').update(b).digest('hex');
const root=join(process.env.RUNNER_TEMP,'calculator-t03-owner-correction');mkdirSync(root,{mode:0o700});
let phase='configuration',team,writer,active,high={attemptedRequests:0,totalRequestBytes:0,reservedRunTokens:0,elapsedMs:0};
let outcome,barrier,remoteClaimed=false,providerCalls=0;high={...T03_OWNER_CORRECTION_2_PRIOR};
const report={version:1,taskId:TASK,previousTaskId:'calculator-pilot-step7-v1-34ee03-t02',historicalCharges:PIN.conservative,
 legalEnabled:false,wholeStep8Closed:false,autonomousDevelopmentProven:false,modelCalls:5,newProviderCalls:0,ownerApprovedCorrectionCycle:2,lastRejectedReplyUnavailable:true};
function put(name,value){const bytes=JSON.stringify(value)+'\n';assert.ok(Buffer.byteLength(bytes)<524288);const p=join(root,name);mkdirSync(dirname(p),{recursive:true,mode:0o700});const temp=p+'.tmp';const fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,p);}
function charge(current){for(const key of Object.keys(high))high[key]=Math.max(high[key],Math.ceil(current[key]));const aggregate=Object.fromEntries(Object.keys(high).map(k=>[k,PIN.conservative[k]+high[k]]));put('charge.json',{historical:PIN.conservative,current:high,aggregate,automaticReplay:false});return {...high};}
function save(event){active={attempt:event.attempt,stage:event.stage,status:event.status,assessments:event.assessments,
 ...(event.proposal?{proposal:event.proposal}:{}),modelState:charge(team?.checkpointCharge()??high),httpInFlight:event.httpInFlight,publicationStarted:event.publicationStarted};writer.save(active);}
try{
 const env=process.env;
 assert.equal(env.CALCULATOR_T03_REPAIR_APPROVED,'OWNER_APPROVED_T03_CORRECTION_2_MAX_FOUR_REQUESTS');
 assert.equal(env.GITHUB_REPOSITORY,'erman-ksv/Onay-Agents-Factory');assert.equal(env.GITHUB_REF,'refs/heads/feat/calculator-t02-charge-reconcile-20261022');assert.equal(env.GITHUB_EVENT_NAME,'push');assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
 assert.equal(execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),env.FACTORY_RUNTIME_SHA);
 assert.ok(env.GROQ_API_KEY&&env.CALCULATOR_GITHUB_TOKEN&&env.FACTORY_STATE_TOKEN);assert.equal(env.GROQ_MODEL,undefined);
 for(const [key,value] of Object.entries({CALCULATOR_EXECUTION_LIVE_APPROVED:'RUN_ONE_FREE_CALCULATOR_TASK',CALCULATOR_MODEL_LIVE_APPROVED:'ONE_FREE_BOUNDED_RUN',AGENT_FACTORY_ENABLE_GITHUB_WRITES:'true',AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES:'false',AGENT_FACTORY_LEGAL_ENABLED:'false',ONAY_TEAM_FREE_TIER_CONFIRMED:'true',AGENT_FACTORY_PROVIDER:'groq',AGENT_FACTORY_TARGET_PROFILE:'calculator',AGENT_ALLOWED_REPOSITORIES:REPO}))assert.equal(env[key],value);
 barrier=createCalculatorLiveBarrier({runtimeSha:env.FACTORY_RUNTIME_SHA,sourceCiRunId:Number(env.FACTORY_SOURCE_CI_RUN),planFingerprint:PLAN,previousTaskId:TASK+'-r2',candidateSha:PIN.candidateSha},env);
 phase='remote_duplicate_check';
 if(!await barrier.inspectAbsent()){
  report.status='duplicate_refused';report.reason='event_already_consumed_no_replay';
 }else{
 phase='authenticate_previous_owner_correction_costs';
 const lastRoot=env.CALCULATOR_T03_LAST_REPAIR_DIRECTORY;assert.ok(lastRoot&&lastRoot.startsWith(env.RUNNER_TEMP+'/'));
 const lastBytes=readFileSync(join(lastRoot,'report.json'));assert.equal(sha(lastBytes),'63b2c524dc65074a455e061db1e614081e2eec8f8b2f6a61fb5ecb05b39e25df');
 const last=JSON.parse(lastBytes);assert.equal(last.newProviderCalls,1);assert.equal(last.modelCalls,5);assert.equal(last.modelDiagnostic.httpRequestsSent,1);assert.equal(last.modelDiagnostic.httpStatus,200);assert.equal(last.modelDiagnostic.finishReason,'stop');assert.equal(last.modelDiagnostic.reasonCode,'repair_validation_failed');assert.equal(last.lastCheckpoint.publicationStarted,false);
 assert.deepEqual(last.currentCharge,{attemptedRequests:5,totalRequestBytes:43254,reservedRunTokens:17705,elapsedMs:216625});
 // This is a new owner-approved correction, not a replay/restore of the lost reply.
 report.priorFailedCorrectionRun=39966515860;
 phase='authenticate_zero_http_context_stop';
 const contextRoot=env.CALCULATOR_T03_CONTEXT_STOP_DIRECTORY;assert.ok(contextRoot&&contextRoot.startsWith(env.RUNNER_TEMP+'/'));
 const contextReportBytes=readFileSync(join(contextRoot,'report.json'));assert.equal(sha(contextReportBytes),'9eb221b644b46fedb0376395cb35abfdfedec9e526120fcc5e61e66cb79155ae');
 const contextStop=JSON.parse(contextReportBytes);assert.equal(contextStop.newProviderCalls,0);assert.equal(contextStop.modelDiagnostic.httpRequestsSent,0);assert.equal(contextStop.modelDiagnostic.httpRequestsAttempted,0);assert.equal(contextStop.lastCheckpoint.httpInFlight,false);assert.equal(contextStop.lastCheckpoint.publicationStarted,false);assert.equal(contextStop.currentCharge.elapsedMs,210374);
 report.priorZeroHttpStopRun=39949567538;
 phase='authenticate_t03_origin';
 const token=env.FACTORY_STATE_TOKEN;const api='https://api.github.com/repos/erman-ksv/Onay-Agents-Factory';
 async function get(path){const r=await fetch(api+path,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);const b=await r.text();assert.ok(Buffer.byteLength(b)<1048576);return JSON.parse(b);}
 const lastRun=await get('/actions/runs/39966515860');assert.equal(lastRun.head_sha,'70290eef256376f51a317c5386efd0d49922c833');assert.equal(lastRun.path,'.github/workflows/calculator-t03-repair-live.yml');assert.equal(lastRun.run_attempt,1);assert.equal(lastRun.conclusion,'failure');
 const lastArtifact=await get('/actions/artifacts/12507835270');assert.equal(lastArtifact.workflow_run.id,39966515860);assert.equal(lastArtifact.digest,'sha256:eb4571c123cf1bef2ac34bdf840c5fa2db073f763f243aa4c5781a28175c6dea');assert.equal(lastArtifact.size_in_bytes,553502);assert.equal(lastArtifact.expired,false);
 const contextRun=await get('/actions/runs/39949567538');assert.equal(contextRun.head_sha,'4392a8c5337a7e36435c67aa3fdcfc3e06bc76f5');assert.equal(contextRun.path,'.github/workflows/calculator-t03-repair-live.yml');assert.equal(contextRun.run_attempt,1);assert.equal(contextRun.conclusion,'failure');
 const contextArtifact=await get('/actions/artifacts/12499003755');assert.equal(contextArtifact.workflow_run.id,39949567538);assert.equal(contextArtifact.digest,'sha256:23a716a823eb2186d5a7f8c8ca299173d5c0246249e2cbf659133434f06732ae');assert.equal(contextArtifact.size_in_bytes,553244);assert.equal(contextArtifact.expired,false);
 const priorRun=await get('/actions/runs/39942417242');assert.equal(priorRun.head_sha,'4702d866dff229b61aeb0a6ae95e652f308901a5');assert.equal(priorRun.path,'.github/workflows/calculator-historical-live.yml');assert.equal(priorRun.conclusion,'failure');assert.equal(priorRun.run_attempt,1);
 const artifact=await get('/actions/artifacts/12497425333');assert.equal(artifact.workflow_run.id,39942417242);assert.equal(artifact.digest,'sha256:15059e8a0e39314d0827ae64a7606e2cb9a588c3470b321ed8f8f69081968185');assert.equal(artifact.size_in_bytes,560241);assert.equal(artifact.expired,false);
 const priorRoot=env.CALCULATOR_T03_EVIDENCE_DIRECTORY;assert.ok(priorRoot&&priorRoot.startsWith(env.RUNNER_TEMP+'/'));
 const priorCapsule=readFileSync(join(priorRoot,'execution-private/'+TASK+'.execution.json'));
 const priorReceipt=readFileSync(join(priorRoot,'state/calc-'+TASK+'.json'));
 const stopped=inspectCalculatorT03StoppedRepair(priorCapsule,priorReceipt);
 async function assertOriginalMarker(){const r=await get('/git/ref/heads/state/calculator-live-event/fd0f81eb73598174d6044742175566fa9055c95d94c03ae325c6cd99351b48ff');assert.equal(r.object.sha,'af1ec597b00c3a220310c7e233d78619b65e70d1');const c=await get('/git/ref/heads/state/calculator-live-event/980ba96c3789a4b5b2f14bb45845dfe42e288a1af2ee02e0e3b813a1ec090e69');assert.equal(c.object.sha,'4ef4d22487ea6bc994e937db42c7f9b675b6f795');const last=await get('/git/ref/heads/state/calculator-live-event/c18a43f570c43f70fd83f4728cc4b8162eac1f5f6a200a729ccc50e7ffc459d2');assert.equal(last.object.sha,'39f2a1f141b5386141812055d6452b409f67d5b0');}
 await assertOriginalMarker();
 phase='authenticate_archives';const archived=await loadHistoricalArchives(join(root,'source'),env.FACTORY_STATE_TOKEN);
 // Every byte comes from the authenticated immutable archive, never a fixture.
 phase='inspect_pinned_t01_archive';
 const candidates=[...archived.files].filter(([p,b])=>p.endsWith('/manifest.json')&&sha(b)==='24e711c299bfd62ddf24418f6c92d878257c1d9e9ecc815aed45af711f7b30d4').map(([p])=>join(archived.root,dirname(p))).sort();
 const valid=[];for(const path of candidates){try{valid.push({path,state:inspectCalculatorPublishedTaskState(path)});}catch{}}
 report.authenticatedT01Copies=valid.length;assert.ok(valid.length>=1);assert.ok(valid.every(v=>v.state.manifestSha256==='24e711c299bfd62ddf24418f6c92d878257c1d9e9ecc815aed45af711f7b30d4'));const prior=valid[0],launch=calculatorPublishedTaskLaunch(prior.state);
 phase='restore_authentic_state';
 const state=join(root,'state');mkdirSync(state,{mode:0o700});
 const stateFiles=[...archived.files].filter(([p])=>p.startsWith('state/')&&!p.slice(6).includes('/'));
 report.authenticatedStateFileCount=stateFiles.length;assert.ok(stateFiles.length>=4&&stateFiles.length<=16);for(const [p,b] of stateFiles){assert.ok(/^[a-z0-9][a-z0-9_.-]*\.(json|lock)$/.test(p.slice(6)));writeFileSync(join(state,p.slice(6)),b,{mode:0o600,flag:'wx'});}
 const originalReceipt=readFileSync(join(state,'calc-'+report.previousTaskId+'.json'));assert.equal(sha(originalReceipt),PIN.originalReceiptSha256);
 const store=new CalculatorPlanStore(state,launch.goal),plan=store.inspect();assert.equal(plan.fingerprint,PLAN);
 const reader=createCalculatorSnapshotReader({...env,GITHUB_TOKEN:env.CALCULATOR_GITHUB_TOKEN});
 const ci=createCalculatorCiReader({trustedWorkflows:launch.config.trustedWorkflows},{...env,GITHUB_TOKEN:env.CALCULATOR_GITHUB_TOKEN});
 phase='fresh_source_head';assert.equal(await reader.getHead(plan.branch),PIN.candidateSha);
 phase='load_core_snapshot';
 const sourcesSnapshot=await loadCalculatorSnapshot({repository:REPO,baseRef:plan.branch,baseSha:PIN.candidateSha,changePaths:['src/calculator.mjs','test/calculator.test.mjs']},reader);
 phase='load_ui_snapshot';const uiSnapshot=await loadCalculatorSnapshot({repository:REPO,baseRef:plan.branch,baseSha:PIN.candidateSha,changePaths:['index.html','styles.css','src/app.mjs']},reader);
 const sources=new Map([...calculatorSources(sourcesSnapshot),...calculatorSources(uiSnapshot)]);
 phase='saved_capsules';
 const capsuleBytes=archived.files.get('execution-private/'+report.previousTaskId+'.execution.json');assert.ok(capsuleBytes);
 const capsule=parseCalculatorExecutionCheckpointBytes(capsuleBytes,JSON.parse(capsuleBytes).identity,'b49a7295bb014e25f601c04608e6c1cefb20818f27af474369dad71c25c240a7').data;
 assert.equal(capsule.payload.assessments.length,3);assert.ok(capsule.payload.assessments.every(a=>a.ready&&!a.findings.length));
 const coreCapsules=[...archived.files].filter(([p])=>p.startsWith(prior.path.slice(archived.root.length+1)+'/evidence/execution-private/')&&p.endsWith('-t01.execution.json'));
 assert.equal(coreCapsules.length,1);const coreBytes=coreCapsules[0][1],core=parseCalculatorExecutionCheckpointBytes(coreBytes,JSON.parse(coreBytes).identity).data;
 const proposals=[core.payload.proposal,capsule.payload.proposal];
 for(const proposal of proposals)for(const f of proposal.files)assert.equal(sources.get(f.path),f.content);
 phase='node_sandbox_preflight';
 const checks=createCalculatorSandbox({image:NODE,baseSha:PIN.candidateSha,baseSources:sources});assert.equal((await checks.preflight()).ready,true);
 phase='browser_sandbox_preflight';
 const browser=createCalculatorBrowserSandbox({image:BROWSER});await browser.preflight();
 const rebased=proposals.map(p=>({...p,baseSha:PIN.candidateSha}));
 const proofCache=new Map();
 const verifyDependencies=async input=>{
  assert.equal(await reader.getHead(plan.branch),PIN.candidateSha);
  const index=plan.tasks.findIndex(t=>t.id===input.task.id);if(index<0||index>1||input.currentSha!==PIN.candidateSha)return undefined;
  assert.equal(input.candidateSha,index===0?prior.state.candidateSha:PIN.candidateSha);
  if(!proofCache.has(index)){
   const task=plan.tasks[index],changes=rebased[index],proposalDigest=calculatorProposalDigest(changes);
   const checked=await checks.checkProposal({task,changes,proposalDigest});assert.equal(checked.status,'passed');assert.equal(checked.testsExecuted,true);
   if(index===1)await browser.check({task,changes,proposalDigest,dependencySha256:sha(sources.get('src/calculator.mjs')),baseSources:sources});
   proofCache.set(index,true);
  }
  return {repository:REPO,planFingerprint:PLAN,taskId:input.task.id,candidateSha:input.candidateSha,currentSha:PIN.candidateSha,securityReady:true,independentReviewReady:true,taskChecksPassed:true,testsExecuted:true};
 };
 phase='fresh_t02_ci';
 const oldCI=await ci({repository:REPO,branch:plan.branch,candidateSha:PIN.candidateSha});assert.ok(verifyCalculatorAfterCiCandidateCi(oldCI,REPO,plan.branch,PIN.candidateSha));
 const input={audit:archived.audit,archivedReceiptBytes:originalReceipt,charges:{manifestSha256:PIN.manifestSha256,candidateSha:PIN.candidateSha,sourceRunId:PIN.sourceRunId,artifactId:PIN.artifactId,phases:archived.audit.charges.phaseCosts.map(({runId,settled,checkpointHighWater})=>({runId,settled,checkpointHighWater})),recordedAggregate:archived.audit.charges.recordedAggregate,finalNewCharge:archived.audit.charges.settledNew}};
 phase='read_only_handoff';
 const handoff=await inspectCalculatorT02ReadOnlyHandoff(input,{getCurrentHead:()=>reader.getHead(plan.branch),getCandidateCI:async()=>{
  const proof=await ci({repository:REPO,branch:plan.branch,candidateSha:PIN.candidateSha});assert.ok(verifyCalculatorAfterCiCandidateCi(proof,REPO,plan.branch,PIN.candidateSha));assert.ok(proof.provenance.verifiedRunIds.includes(39791054276));
  return {runId:39791054276,headSha:PIN.candidateSha,runAttempt:1,workflowPath:'.github/workflows/calculator-task-ci.yml',completed:true,passed:true,syntaxPassed:true,taskTestsPassed:true};
 }});
 const sidecar=join(root,'sidecar'),events=join(root,'events');mkdirSync(sidecar,{mode:0o700});mkdirSync(events,{mode:0o700});recordCalculatorT02ReconciliationSidecar(sidecar,handoff);
 phase='preview_verified_dependencies';
 const preview=await previewCalculatorT02Successor(store,reader,sidecar,handoff,verifyDependencies);
 writeFileSync(join(state,'calc-'+TASK+'.json'),priorReceipt,{mode:0o600,flag:'wx'});
 const failure=calculatorT03RepairFailure(stopped);
 phase='prevalidate_saved_feedback_without_http';
 const taskSnapshot=await loadCalculatorSnapshot({repository:REPO,baseRef:plan.branch,baseSha:PIN.candidateSha,changePaths:plan.tasks[2].paths},reader);
 const validator=createCalculatorModelTeam(launch.goal,{...env,GITHUB_TOKEN:undefined,FACTORY_STATE_TOKEN:undefined,CALCULATOR_GITHUB_TOKEN:undefined},async()=>{throw Error('No HTTP permitted in feedback prevalidation');},{},undefined,undefined,'calculator-restored-repair-four-roles');
 const rebuilt=validator.restoreProposal(plan,TASK,taskSnapshot,failure.proposal,calculatorProposalDigest(failure.proposal),[]);
 const validationRequest=validator.importRepairFeedback(plan,TASK,rebuilt,failure.assessments,undefined,sourcesSnapshot);
 const requestPreview=await validator.inspectRepairContext(plan,TASK,taskSnapshot,validationRequest);report.repairRequestPreview=requestPreview;assert.equal(requestPreview.status,'ready');
 assert.equal(validator.diagnostic().httpRequestsSent,0);
 phase='admit_original_repair';
 const workspace=await openCalculatorWorkspace(store,reader,plan.branch,PIN.candidateSha);
 const continuations=join(root,'continuations');mkdirSync(continuations,{mode:0o700});
 const permit=await admitCalculatorT03RepairContinuation(workspace,store,stopped,preview,continuations,async()=>{await assertOriginalMarker();await barrier.claim();remoteClaimed=true;},async()=>{await assertOriginalMarker();await barrier.assertClaimed();});
 report.sourceCapsuleSha256=T03_REPAIR_CAPSULE_SHA;
 phase='live_host_ready';report.runtimeSha=env.FACTORY_RUNTIME_SHA;report.sourceCiRunId=Number(env.FACTORY_SOURCE_CI_RUN);report.baseSha=PIN.candidateSha;
 const privateDir=join(root,'execution-private');mkdirSync(privateDir,{mode:0o700});
 writer=createCalculatorExecutionCheckpointStore(privateDir,{repository:REPO,goalId:plan.owner.id,ownerFingerprint:plan.owner.ownerFingerprint,planFingerprint:PLAN,taskId:TASK,branch:plan.branch,baseSha:PIN.candidateSha,bootstrapSha:plan.owner.baseSha,runtimeConfigDigest:sha(JSON.stringify({runtimeSha:env.FACTORY_RUNTIME_SHA,runId:env.GITHUB_RUN_ID,preset:'calculator-restored-repair-four-roles',ownerApprovedCorrectionCycle:2,sourceCapsule:T03_REPAIR_CAPSULE_SHA}))});
 active={attempt:1,stage:'admission',status:'running',assessments:[],modelState:high,httpInFlight:false,publicationStarted:false};
 const actualChecks=new WeakMap(),hostEvidence=new WeakMap();
 async function testProposal(input){
  if(actualChecks.has(input.changes))return actualChecks.get(input.changes);
  let result=await checks.checkProposal(input);
  if(result.status==='passed'){
   const b=createCalculatorBrowserSandbox({image:BROWSER});await b.preflight();
   try{
    const browserProof=await b.check({...input,dependencySha256:sha(sources.get('src/calculator.mjs')),baseSources:sources});
    const evidence=await collectCalculatorAssessmentEvidence(input.task,input.changes,sourcesSnapshot,{checkProposal:async()=>result,checkBrowser:async()=>browserProof});hostEvidence.set(input.changes,evidence);
   }catch(error){result={...result,status:error?.code==='browser_checks_failed'?'failed':'unverified',testsExecuted:error?.code==='browser_checks_failed',failures:['Keyboard/browser acceptance is not verified']};}
  }
  actualChecks.set(input.changes,result);return result;
 }
 team=createCalculatorAgentRepairTeam(launch.goal,{...env,GITHUB_TOKEN:undefined,FACTORY_STATE_TOKEN:undefined,CALCULATOR_GITHUB_TOKEN:undefined},{
  loadAuthenticatedFailure:async(_plan,task,snapshot)=>{assert.equal(task.id,TASK);assert.equal(snapshot.baseSha,PIN.candidateSha);return {taskId:TASK,planFingerprint:PLAN,baseSha:PIN.candidateSha,sourceManifestSha256:T03_REPAIR_CAPSULE_SHA,proposal:failure.proposal,proposalDigest:calculatorProposalDigest(failure.proposal),assessments:failure.assessments,dependencySnapshot:sourcesSnapshot,priorCharge:T03_OWNER_CORRECTION_2_PRIOR,httpInFlight:false,publicationStarted:false};},
  verifyRepairedProposal:async(task,changes)=>{const checked=await testProposal({task,changes,proposalDigest:calculatorProposalDigest(changes)});assert.equal(checked.status,'passed');const evidence=hostEvidence.get(changes);assert.ok(evidence);return evidence;},
 },{transport:async(url,options)=>{
  assert.equal(String(url),'https://api.groq.com/openai/v1/chat/completions');providerCalls++;report.newProviderCalls=providerCalls;report.modelCalls=5+providerCalls;
  const response=await fetch(url,options);put('provider-'+providerCalls+'.json',{provider:'groq',sequence:providerCalls,model:JSON.parse(options.body).model,status:response.status});return response;
 },checkpoints:{afterProposalRejected:async rejection=>{put('private-rejected-proposal.json',rejection);save({...active,httpInFlight:false});},beforeRequest:async current=>{await barrier.assertClaimed();await assertOriginalMarker();assert.equal(await reader.getHead(plan.branch),PIN.candidateSha);const state=charge(current);assertT03OwnerCorrection2Charge(state);save({...active,modelState:state,httpInFlight:true});}}});
 const publisher=createCalculatorPublisher({plan,reader,env:{...env,GITHUB_TOKEN:env.CALCULATOR_GITHUB_TOKEN}});
 phase='execute_original_repair';
 const result=await runCalculatorExecution(workspace,{team,repairContinuationPermit:permit,maxRepairs:0,execution:'live',env,tools:{checkProposal:testProposal,publish:publisher.publish,ci:async query=>{
  let last;for(let turn=0;turn<36;turn++){last=await ci(query);const runs=last.runs.filter(r=>r.name==='Calculator task CI');if(runs.length&&runs.every(r=>r.status==='completed'))break;await new Promise(r=>setTimeout(r,5000));}return last;
 }},checkpoint:event=>{save({...event,httpInFlight:event.status==='passed'?false:active.httpInFlight});console.log(JSON.stringify({taskId:event.taskId,stage:event.stage,status:event.status,attempt:event.attempt,ownerApprovedCorrectionCycle:2}));}});
 report.execution=result;put('execution-report.json',result);report.status=result.status==='candidate-verified'?'repair_candidate_verified':'blocked';
 assert.equal(sha(readFileSync(join(state,'calc-'+TASK+'.json'))),sha(priorReceipt));report.originalT03ReceiptUnchanged=true;
 assert.equal(sha(readFileSync(join(state,'calc-'+report.previousTaskId+'.json'))),PIN.originalReceiptSha256);
 report.historicalReceiptUnchanged=true;report.autonomousDevelopmentProven=result.status==='candidate-verified';
 }
}catch(error){report.status='blocked';report.reason='live_bridge_'+phase+'_unverified';if(error?.name==='AssertionError'){report.assertion={operator:error.operator,...(typeof error.actual==='number'?{actual:error.actual}:{}),...(typeof error.expected==='number'?{expected:error.expected}:{})};}process.exitCode=10;}
finally{
 if(team){charge(team.checkpointCharge()??high);report.modelDiagnostic=team.diagnostic();report.modelCalls=5+providerCalls;report.newProviderCalls=providerCalls;}
 writer?.close();if(active)report.lastCheckpoint={stage:active.stage,status:active.status,attempt:active.attempt,httpInFlight:active.httpInFlight,publicationStarted:active.publicationStarted};report.remoteBarrierClaimed=remoteClaimed;report.currentCharge=high;put('report.json',report);console.log(JSON.stringify(report));
 if(report.status==='blocked')process.exitCode=10;
}
