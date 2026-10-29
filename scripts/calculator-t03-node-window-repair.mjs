import {buildCalculatorNodeTestRequest,prepareCalculatorNodeTestCorrection} from '../orchestration/calculatorNodeTestRepair.js';
import {selectProviderConfig} from '../commander/providerConfig.js';import {createProviderContextBudget,createGroqBudgetedFetch} from '../commander/providerContextBudget.js';import {createTaskModelBudgetFetch} from '../orchestration/taskModelBudget.js';import {scanForSecrets} from '../github/secretScanner.js';
import {prepareChecksummedCalculatorDraft} from '../orchestration/calculatorChecksummedDraft.js';
// Explicit owner allowance: at most four additional free calls and 24000 reserved tokens.
function assertRenewedCharge(c){assert.ok(c.attemptedRequests<=17&&c.reservedRunTokens<=80698&&c.totalRequestBytes<=201300&&c.elapsedMs<=670352);}
import {prepareUnpublishedCalculatorCorrection} from '../orchestration/calculatorUnpublishedCorrection.js';
import {collectCalculatorFailedTestEvidence} from '../orchestration/calculatorFailedTestRepair.js';
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
const root=join(process.env.RUNNER_TEMP,'calculator-t03-node-window-repair');mkdirSync(root,{mode:0o700});
let phase='configuration',team,writer,active,high={attemptedRequests:0,totalRequestBytes:0,reservedRunTokens:0,elapsedMs:0};
let outcome,barrier,remoteClaimed=false,providerCalls=0;high={attemptedRequests:14,totalRequestBytes:109149,reservedRunTokens:58873,elapsedMs:370352};
const report={version:1,taskId:TASK,previousTaskId:'calculator-pilot-step7-v1-34ee03-t02',historicalCharges:PIN.conservative,
 legalEnabled:false,wholeStep8Closed:false,autonomousDevelopmentProven:false,modelCalls:14,newProviderCalls:0,ownerApprovedCorrectionCycle:8,savedAgentCorrectionAdopted:false,failedTestRepairApproved:true,testerDeferredByBudget:false};
function put(name,value){const bytes=JSON.stringify(value)+'\n';assert.ok(Buffer.byteLength(bytes)<524288);const p=join(root,name);mkdirSync(dirname(p),{recursive:true,mode:0o700});const temp=p+'.tmp';const fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,p);}
function charge(current){for(const key of Object.keys(high))high[key]=Math.max(high[key],Math.ceil(current[key]));const aggregate=Object.fromEntries(Object.keys(high).map(k=>[k,PIN.conservative[k]+high[k]]));put('charge.json',{historical:PIN.conservative,current:high,aggregate,automaticReplay:false});return {...high};}
function save(event){active={attempt:event.attempt,stage:event.stage,status:event.status,assessments:event.assessments,
 ...(event.proposal?{proposal:event.proposal}:{}),modelState:charge(team?.checkpointCharge()??high),httpInFlight:event.httpInFlight,publicationStarted:event.publicationStarted};writer.save(active);}
try{
 const env=process.env;
 assert.equal(env.CALCULATOR_T03_REPAIR_APPROVED,'WINDOW_TEST_CORRECTION_TWO_REVIEWS_DEFER_TESTER_WITHIN_SIX_CALL_LIMIT');
 assert.equal(env.GITHUB_REPOSITORY,'erman-ksv/Onay-Agents-Factory');assert.equal(env.GITHUB_REF,'refs/heads/feat/calculator-t02-charge-reconcile-20261022');assert.equal(env.GITHUB_EVENT_NAME,'push');assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
 assert.equal(execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),env.FACTORY_RUNTIME_SHA);
 assert.ok(env.GROQ_API_KEY&&env.CALCULATOR_GITHUB_TOKEN&&env.FACTORY_STATE_TOKEN);assert.equal(env.GROQ_MODEL,undefined);
 for(const [key,value] of Object.entries({CALCULATOR_EXECUTION_LIVE_APPROVED:'RUN_ONE_FREE_CALCULATOR_TASK',CALCULATOR_MODEL_LIVE_APPROVED:'ONE_FREE_BOUNDED_RUN',AGENT_FACTORY_ENABLE_GITHUB_WRITES:'true',AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES:'false',AGENT_FACTORY_LEGAL_ENABLED:'false',ONAY_TEAM_FREE_TIER_CONFIRMED:'true',AGENT_FACTORY_PROVIDER:'groq',AGENT_FACTORY_TARGET_PROFILE:'calculator',AGENT_ALLOWED_REPOSITORIES:REPO}))assert.equal(env[key],value);
 barrier=createCalculatorLiveBarrier({runtimeSha:env.FACTORY_RUNTIME_SHA,sourceCiRunId:Number(env.FACTORY_SOURCE_CI_RUN),planFingerprint:PLAN,previousTaskId:TASK+'-nodewindow1',candidateSha:PIN.candidateSha},env);
 phase='remote_duplicate_check';
 if(!await barrier.inspectAbsent()){
  report.status='duplicate_refused';report.reason='event_already_consumed_no_replay';
 }else{
 phase='authenticate_saved_agent_response';
 const replyRoot=env.CALCULATOR_T03_OWNER_REPLY_DIRECTORY;assert.ok(replyRoot&&replyRoot.startsWith(env.RUNNER_TEMP+'/'));
 const replyReportBytes=readFileSync(join(replyRoot,'report.json'));assert.equal(sha(replyReportBytes),'f741eae78dde1fa4cf80e5ac0042e2295ade79d5ce557d46698ad311d59d3824');
 const replyReport=JSON.parse(replyReportBytes);assert.equal(replyReport.modelCalls,6);assert.equal(replyReport.newProviderCalls,1);assert.equal(replyReport.modelDiagnostic.httpStatus,200);assert.equal(replyReport.modelDiagnostic.finishReason,'stop');assert.equal(replyReport.modelDiagnostic.reasonCode,'proposal_changes_invalid');assert.equal(replyReport.lastCheckpoint.httpInFlight,false);assert.equal(replyReport.lastCheckpoint.publicationStarted,false);
 assert.deepEqual(replyReport.currentCharge,{attemptedRequests:6,totalRequestBytes:54064,reservedRunTokens:23613,elapsedMs:224581});
 const rawReplyBytes=readFileSync(join(replyRoot,'private-rejected-proposal.json'));assert.equal(sha(rawReplyBytes),'cb1f22efc82523cca64e086da10ac7c455d4d5c799c079a9ba774ce9961eb2dd');const rawReply=JSON.parse(rawReplyBytes);assert.equal(rawReply.taskId,TASK);assert.equal(rawReply.kind,'repair');assert.equal(rawReply.validationCode,'proposal_changes_invalid');
 report.savedAgentResponseSha256=sha(rawReplyBytes);report.savedAgentResponseRun=39973872603;
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
 const replyRun=await get('/actions/runs/39973872603');assert.equal(replyRun.head_sha,'4aa5277d3f6d28e482c50b704f70e7f9ca66f19d');assert.equal(replyRun.path,'.github/workflows/calculator-t03-owner-correction.yml');assert.equal(replyRun.run_attempt,1);assert.equal(replyRun.conclusion,'failure');
 const replyArtifact=await get('/actions/artifacts/12509264527');assert.equal(replyArtifact.workflow_run.id,39973872603);assert.equal(replyArtifact.digest,'sha256:35e61641738eb9db1ba721474b8f169e49f532110c60cb6105c52123e5810a5f');assert.equal(replyArtifact.size_in_bytes,554692);assert.equal(replyArtifact.expired,false);
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
 async function assertOriginalMarker(){const r=await get('/git/ref/heads/state/calculator-live-event/fd0f81eb73598174d6044742175566fa9055c95d94c03ae325c6cd99351b48ff');assert.equal(r.object.sha,'af1ec597b00c3a220310c7e233d78619b65e70d1');const c=await get('/git/ref/heads/state/calculator-live-event/980ba96c3789a4b5b2f14bb45845dfe42e288a1af2ee02e0e3b813a1ec090e69');assert.equal(c.object.sha,'4ef4d22487ea6bc994e937db42c7f9b675b6f795');const last=await get('/git/ref/heads/state/calculator-live-event/c18a43f570c43f70fd83f4728cc4b8162eac1f5f6a200a729ccc50e7ffc459d2');assert.equal(last.object.sha,'39f2a1f141b5386141812055d6452b409f67d5b0');const owner=await get('/git/ref/heads/state/calculator-live-event/86e72c701bac2819bdbfb475b8f41f1c2c35ea4e3769555ffbd171a196453d47');assert.equal(owner.object.sha,'e614096deea6e97de3830e132a6a5386de8cbc43');const failed=await get('/git/ref/heads/state/calculator-live-event/1c22a5164309cf92307cd98f93671b48e43d9c05b8e5e11d77d9062ee397477e');assert.equal(failed.object.sha,'071cc8f160f8e01f436f37af40b7486868123225');const declined=await get('/git/ref/heads/state/calculator-live-event/5de8ee6d1a24ce4f42fe8a4e813dba1958107dd06a65590cb389cfa66f312510');assert.equal(declined.object.sha,'e85ac2f80f99481e5b106180f0282471f18b4132');const context=await get('/git/ref/heads/state/calculator-live-event/e5cea433baa96ca52743c97b4aac4bcba4517c395cc88872b02b27474ce9a3f2');assert.equal(context.object.sha,'3553790d18f0df1ec6a563dfa5c258b6590db707');}
 await assertOriginalMarker();
 phase='authenticate_precise_failed_candidate';
 const preciseRoot=env.CALCULATOR_PRECISE_FAILURE_DIRECTORY;assert.ok(preciseRoot&&preciseRoot.startsWith(env.RUNNER_TEMP+'/'));
 const preciseRun=await get('/actions/runs/39983292798');assert.equal(preciseRun.head_sha,'5cb75fbf789cde179ad2099c2abd6f5ced664c0c');assert.equal(preciseRun.run_attempt,1);assert.equal(preciseRun.conclusion,'success');assert.equal(preciseRun.path,'.github/workflows/calculator-t03-failed-candidate-audit.yml');
 const preciseArtifact=await get('/actions/artifacts/12514596755');assert.equal(preciseArtifact.workflow_run.id,39983292798);assert.equal(preciseArtifact.digest,'sha256:9d14ce56bfc3f818696cfc93a5eaa0227b806d765dd90c141456b050b0c9b338');assert.equal(preciseArtifact.expired,false);
 const preciseReport=JSON.parse(readFileSync(join(preciseRoot,'report.json')));assert.equal(preciseReport.status,'actual_failed_test_diagnosed');assert.equal(preciseReport.modelsRun,false);assert.equal(preciseReport.targetWrites,false);assert.deepEqual(preciseReport.priorCharge,{attemptedRequests:7,totalRequestBytes:62147,reservedRunTokens:28612,elapsedMs:237561});
 assert.equal(preciseReport.sourceCapsuleSha256,'2f76d30e680ed6f31033eba8bad854442ae1a833f0947801170b9f3f0bbc09a3');assert.equal(preciseReport.sourceProposalDigest,'504dc76ea4ae0d149374a1a3e07c1b4e8698895ce6d9c141ea5670e5cf6cc75d');
 const preciseCandidate=JSON.parse(readFileSync(join(preciseRoot,'private-saved-agent-proposal.json')));assert.equal(calculatorProposalDigest(preciseCandidate),preciseReport.sourceProposalDigest);
 const failedMarker=await get('/git/ref/heads/state/calculator-live-event/1c22a5164309cf92307cd98f93671b48e43d9c05b8e5e11d77d9062ee397477e');assert.equal(failedMarker.object.sha,'071cc8f160f8e01f436f37af40b7486868123225');
 phase='authenticate_explicit_decline_and_costs';
 const declineRoot=env.CALCULATOR_EXPLICIT_DECLINE_DIRECTORY;assert.ok(declineRoot&&declineRoot.startsWith(env.RUNNER_TEMP+'/'));
 const declineRun=await get('/actions/runs/39987019627');assert.equal(declineRun.head_sha,'f02291ae40a00101895318298f61586a39bcb77a');assert.equal(declineRun.run_attempt,1);assert.equal(declineRun.conclusion,'failure');
 const declineArtifact=await get('/actions/artifacts/12516625382');assert.equal(declineArtifact.workflow_run.id,39987019627);assert.equal(declineArtifact.digest,'sha256:214a87d62c43611746631613fb494b44e5af7d8e3ef81ca146cd75fd0e29e2cc');assert.equal(declineArtifact.expired,false);
 const declineReport=JSON.parse(readFileSync(join(declineRoot,'report.json')));assert.deepEqual(declineReport.currentCharge,{attemptedRequests:8,totalRequestBytes:68432,reservedRunTokens:33011,elapsedMs:255021});assert.equal(declineReport.lastCheckpoint.httpInFlight,false);assert.equal(declineReport.lastCheckpoint.publicationStarted,false);assert.equal(declineReport.newProviderCalls,1);
 const rejected=readFileSync(join(declineRoot,'private-rejected-proposal.json'));assert.equal(sha(rejected),'7fce9bb627b4f58dbf9ab59395a46871940416b4632d355ae0ff61c1b6d50632');const declined=JSON.parse(rejected);assert.equal(declined.taskId,TASK);assert.deepEqual(declined.result.changes,[]);report.previousExplicitDecline=declined.result.summary;
 phase='authenticate_rejected_draft_and_costs';
 const validationRoot=env.CALCULATOR_VALIDATION_FAILURE_DIRECTORY;assert.ok(validationRoot&&validationRoot.startsWith(env.RUNNER_TEMP+'/'));
 const validationRun=await get('/actions/runs/39990331498');assert.equal(validationRun.head_sha,'6ddc4a5604bce139d400c0b8892d2039208fac49');assert.equal(validationRun.run_attempt,1);assert.equal(validationRun.conclusion,'failure');
 const validationArtifact=await get('/actions/artifacts/12516549326');assert.equal(validationArtifact.workflow_run.id,39990331498);assert.equal(validationArtifact.digest,'sha256:0fdf3c8725e4e2ae48beb7c0d0ee65a607ebed971a7e2f07015bdfd7bbdb296f');assert.equal(validationArtifact.expired,false);
 const validationReport=JSON.parse(readFileSync(join(validationRoot,'report.json')));assert.deepEqual(validationReport.currentCharge,{attemptedRequests:9,totalRequestBytes:76076,reservedRunTokens:37863,elapsedMs:273324});assert.equal(validationReport.lastCheckpoint.httpInFlight,false);assert.equal(validationReport.lastCheckpoint.publicationStarted,false);
 const rejectedDraftBytes=readFileSync(join(validationRoot,'private-rejected-proposal.json'));assert.equal(sha(rejectedDraftBytes),'e9fc10c41c64fb4e35badf21d2ef3fb9827bb77dd3e5dc09cbb5c0b5f1f3c787');const rejectedDraft=JSON.parse(rejectedDraftBytes);assert.equal(rejectedDraft.taskId,TASK);assert.equal(rejectedDraft.kind,'repair');assert.equal(rejectedDraft.validationCode,'proposal_changes_invalid');
 phase='authenticate_latest_proposal_and_preserved_charge';
 const latestRoot=env.CALCULATOR_LATEST_PROPOSAL_DIRECTORY,chargeRoot=env.CALCULATOR_LATEST_CHARGE_DIRECTORY;assert.ok(latestRoot?.startsWith(env.RUNNER_TEMP+'/')&&chargeRoot?.startsWith(env.RUNNER_TEMP+'/'));
 for(const [id,runId,digest,eventSha] of [[12518816662,39993060116,'sha256:e7df7d3816b5ba336b28bb68e4ee6aa507af3aea5ba705dffb8e0647f75267de','6f6700d93a75e129053fc706e2fce70dd4fd6450'],[12562824077,40102210646,'sha256:136bbd34596a82725b0c44cff576b37fa143b9d3fd4b3a2303960db0cfc495a0','911953370a198114b66493bd51328716516d6184']]){const run=await get('/actions/runs/'+runId);assert.equal(run.head_sha,eventSha);assert.equal(run.run_attempt,1);assert.equal(run.conclusion,'failure');const artifact=await get('/actions/artifacts/'+id);assert.equal(artifact.workflow_run.id,runId);assert.equal(artifact.digest,digest);assert.equal(artifact.expired,false);}
 const latestReport=JSON.parse(readFileSync(join(chargeRoot,'report.json')));assert.deepEqual(latestReport.currentCharge,{attemptedRequests:11,totalRequestBytes:87362,reservedRunTokens:44698,elapsedMs:314026});assert.equal(latestReport.httpInFlight,false);assert.equal(latestReport.publicationStarted,false);assert.equal(latestReport.modelCalls,11);
 const originCandidate=JSON.parse(readFileSync(join(latestRoot,'private-agent-repaired-proposal.json')));assert.equal(calculatorProposalDigest(originCandidate),'2e2a55352feeedad6475b21cb29fa6694b0426b00500552c321c0675790edb1f');
 const latestMarker=await get('/git/ref/heads/state/calculator-live-event/d0b1ade4db9777dc9ba1989bb5dbfd19c8e147dddd19bee61e9cfe860e5ef7b1');assert.equal(latestMarker.object.sha,'d93fa43167f066ad06cf98e2f50877b800d4127f');
 phase='authenticate_syntactically_correct_saved_failure';
 const failedRoot=env.CALCULATOR_DOM_FAILURE_DIRECTORY;assert.ok(failedRoot?.startsWith(env.RUNNER_TEMP+'/'));
 const failedRun=await get('/actions/runs/40104435920');assert.equal(failedRun.head_sha,'fbc2bed6a2ad7804bbc432b1d3458dddbd00efa3');assert.equal(failedRun.run_attempt,1);assert.equal(failedRun.conclusion,'failure');const failedArtifact=await get('/actions/artifacts/12563873339');assert.equal(failedArtifact.workflow_run.id,40104435920);assert.equal(failedArtifact.digest,'sha256:f500959a6ea4ff500226a0ab97089557e7f4c2ec2587169437322a1cd63c3a59');assert.equal(failedArtifact.expired,false);
 const failedReport=JSON.parse(readFileSync(join(failedRoot,'report.json')));assert.deepEqual(failedReport.currentCharge,{attemptedRequests:12,totalRequestBytes:95746,reservedRunTokens:49797,elapsedMs:332199});assert.equal(failedReport.newProviderCalls,0);assert.equal(failedReport.remoteBarrierClaimed,false);assert.equal(failedReport.savedAgentDraftChecks.testsExecuted,true);assert.equal(failedReport.savedAgentDraftChecks.status,'failed');
 const latestCandidate=JSON.parse(readFileSync(join(failedRoot,'private-saved-agent-correction.json')));assert.equal(calculatorProposalDigest(latestCandidate),'94fd1d72bdfbb4e994b6e6674fd7936fe3d2a0b896577edf3c21f430aa27d0ac');
 const previousRun=await get('/actions/runs/40103757771');assert.equal(previousRun.head_sha,'8cdb07b40980540a10f4075382b42865728c95a8');assert.equal(previousRun.run_attempt,1);assert.equal(previousRun.conclusion,'failure');
 phase='authenticate_saved_dom_reply';const domRoot=env.CALCULATOR_DOM_REPLY_DIRECTORY;assert.ok(domRoot?.startsWith(env.RUNNER_TEMP+'/'));const domRun=await get('/actions/runs/40106311123');assert.equal(domRun.head_sha,'e50ff31fae34647e02939cbf266360b0ec9a0f28');assert.equal(domRun.run_attempt,1);assert.equal(domRun.conclusion,'failure');const domArtifact=await get('/actions/artifacts/12565240405');assert.equal(domArtifact.workflow_run.id,40106311123);assert.equal(domArtifact.digest,'sha256:2f591b546b5f13eef140f482200278ebb9be4695c029125a1802c77400a72e20');assert.equal(domArtifact.expired,false);
 const domReport=JSON.parse(readFileSync(join(domRoot,'report.json')));assert.deepEqual(domReport.currentCharge,{attemptedRequests:13,totalRequestBytes:105300,reservedRunTokens:55286,elapsedMs:348893});assert.equal(domReport.lastCheckpoint.httpInFlight,false);assert.equal(domReport.lastCheckpoint.publicationStarted,false);const domReply=JSON.parse(readFileSync(join(domRoot,'private-rejected-proposal.json')));assert.equal(domReply.taskId,TASK);assert.equal(domReply.kind,'repair');assert.equal(domReply.validationCode,'proposal_changes_invalid');
 phase='authenticate_latest_test_only_failure';const windowRoot=env.CALCULATOR_WINDOW_FAILURE_DIRECTORY;assert.ok(windowRoot?.startsWith(env.RUNNER_TEMP+'/'));const windowRun=await get('/actions/runs/40109667410');assert.equal(windowRun.head_sha,'b57e9e926318516668daf9c0f5afc3b65ae48bcc');assert.equal(windowRun.run_attempt,1);assert.equal(windowRun.conclusion,'failure');const windowArtifact=await get('/actions/artifacts/12565318949');assert.equal(windowArtifact.workflow_run.id,40109667410);assert.equal(windowArtifact.digest,'sha256:d5ee25c1b614a015c1d76f4835576449fb314a8b7521911ebf69a50acd1b27ee');assert.equal(windowArtifact.expired,false);const windowReport=JSON.parse(readFileSync(join(windowRoot,'report.json')));assert.deepEqual(windowReport.currentCharge,{attemptedRequests:14,totalRequestBytes:109149,reservedRunTokens:58873,elapsedMs:370352});assert.equal(windowReport.lastCheckpoint.httpInFlight,false);assert.equal(windowReport.lastCheckpoint.publicationStarted,false);assert.equal(windowReport.browserVerifiedAppBytesPreserved,true);assert.equal(windowReport.repairedProposalChecks.status,'failed');assert.equal(windowReport.repairedProposalChecks.testsExecuted,true);const windowCandidate=JSON.parse(readFileSync(join(windowRoot,'private-agent-repaired-proposal.json')));
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
 const checks=createCalculatorSandbox({image:NODE,baseSha:PIN.candidateSha,baseSources:sources,includeFailureDetails:true});assert.equal((await checks.preflight()).ready,true);
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
 phase='prevalidate_saved_response_without_http';
 const taskSnapshot=await loadCalculatorSnapshot({repository:REPO,baseRef:plan.branch,baseSha:PIN.candidateSha,changePaths:plan.tasks[2].paths},reader);
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

 const PRIOR=Object.freeze({attemptedRequests:14,totalRequestBytes:109149,reservedRunTokens:58873,elapsedMs:370352});
 let authorCharge={attemptedRequests:0,totalRequestBytes:0,reservedRunTokens:0,elapsedMs:0};const addPrior=current=>Object.fromEntries(Object.keys(PRIOR).map(k=>[k,PRIOR[k]+authorCharge[k]+current[k]]));
 let adopted,repairRequest,authorSentAt;
 const coreTeam=createCalculatorModelTeam(launch.goal,{...env,GITHUB_TOKEN:undefined,FACTORY_STATE_TOKEN:undefined,CALCULATOR_GITHUB_TOKEN:undefined},async(url,options)=>{
  assert.equal(String(url),'https://api.groq.com/openai/v1/chat/completions');
  const body=JSON.parse(options.body);assert.ok(providerCalls>=1&&providerCalls<3);assert.ok(body.messages[0].content.startsWith('You are the '+['security','reviewer','tester'][providerCalls-1]+' in the isolated calculator development team.'));
  providerCalls++;report.newProviderCalls=providerCalls;report.modelCalls=14+providerCalls;
  const response=await fetch(url,options);put('provider-'+providerCalls+'.json',{provider:'groq',sequence:providerCalls,model:body.model,status:response.status});return response;
 },{},undefined,{afterProposalRejected:async rejection=>{put('private-rejected-proposal.json',rejection);save({...active,httpInFlight:false});},beforeRequest:async current=>{await barrier.assertClaimed();await assertOriginalMarker();assert.equal(await reader.getHead(plan.branch),PIN.candidateSha);const aggregate=addPrior(current);assertRenewedCharge(aggregate);charge(aggregate);save({...active,httpInFlight:true});},afterAssessmentRejected:async rejection=>{put('private-rejected-assessment.json',rejection);save({...active,httpInFlight:false});}},'calculator-frontend-2048-four-roles',()=>hostEvidence.get(adopted));
 phase='fresh_failed_node_and_passed_browser_source';const normalized=prepareChecksummedCalculatorDraft(domReply.result,taskSnapshot);const previous=windowCandidate;assert.equal(previous.files.find(f=>f.path==='src/app.mjs').content,normalized.proposal.files.find(f=>f.path==='src/app.mjs').content);assert.equal(calculatorProposalDigest(normalized.proposal),'f64fe4c271e0476dc77d109b9bf35161a221fcbb03d44ebf7e89516305df34dc');
 const failedNode=await checks.checkProposal({task:plan.tasks[2],changes:previous,proposalDigest:calculatorProposalDigest(previous)});report.freshSourceNode=failedNode;assert.equal(failedNode.status,'failed');assert.ok(failedNode.failures.some(f=>f.includes('TypeError')&&f.includes('/app/src/app.mjs:37')));
 const sourceBrowser=createCalculatorBrowserSandbox({image:BROWSER});await sourceBrowser.preflight();report.freshSourceBrowser=await sourceBrowser.check({task:plan.tasks[2],changes:previous,proposalDigest:calculatorProposalDigest(previous),dependencySha256:sha(sources.get('src/calculator.mjs')),baseSources:sources});
 const cfg=selectProviderConfig(env);assert.equal(cfg.provider,'groq');assert.equal(cfg.baseURL,'https://api.groq.com/openai/v1');const authorRequest=buildCalculatorNodeTestRequest(cfg.model,previous,[...calculatorSources(taskSnapshot).values(),...calculatorSources(sourcesSnapshot).values()]);assert.ok(!authorRequest.body.includes(cfg.apiKey));report.testOnlyRequestPreview={requestBytes:authorRequest.requestBytes,estimatedInputTokens:authorRequest.estimatedInputTokens,reservedOutputTokens:2048,requestedTokens:authorRequest.requestedTokens};
 async function correctTestOnce(){
  const started=performance.now();let sent=false;const context=createProviderContextBudget({maxRunTokens:6000,reservedOutputTokens:2048,maxRequestBytes:12000});const bounded=createTaskModelBudgetFetch({maxRequests:1,maxRequestBytes:12000,maxRunBytes:12000,maxOutputTokens:2048,wallTimeMs:30000},async(url,options)=>{assert.equal(String(url),'https://api.groq.com/openai/v1/chat/completions');assert.equal(sent,false);authorCharge={attemptedRequests:1,totalRequestBytes:authorRequest.requestBytes,reservedRunTokens:authorRequest.requestedTokens,elapsedMs:Math.ceil(performance.now()-started)};assertRenewedCharge(addPrior(coreTeam.checkpointCharge()));save({...active,httpInFlight:false});await barrier.assertClaimed();await assertOriginalMarker();assert.equal(await reader.getHead(plan.branch),PIN.candidateSha);sent=true;authorSentAt=performance.now();providerCalls++;report.newProviderCalls=providerCalls;report.modelCalls=14+providerCalls;save({...active,httpInFlight:true});return fetch(url,options);});
  const call=createGroqBudgetedFetch(context,bounded.fetch);const response=await call('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+cfg.apiKey,'Content-Type':'application/json'},body:authorRequest.body,redirect:'error',signal:AbortSignal.timeout(25000)});report.authorHttpStatus=response.status;if(response.status!==200){save({...active,httpInFlight:false});throw Error('Author refused, no retry');}
  assert.ok(response.body);let bytes=0;const chunks=[];for await(const chunk of response.body){bytes+=chunk.length;assert.ok(bytes<=32768);chunks.push(chunk);}authorCharge.elapsedMs=Math.max(authorCharge.elapsedMs,Math.ceil(performance.now()-started));save({...active,httpInFlight:false});const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));assert.equal(data.choices?.length,1);report.authorFinishReason=data.choices[0].finish_reason;assert.equal(report.authorFinishReason,'stop');const content=data.choices[0].message?.content;assert.equal(typeof content,'string');assert.ok(!content.includes(cfg.apiKey)&&!scanForSecrets(content).length);const raw=JSON.parse(content);put('private-node-test-reply.json',{taskId:TASK,result:raw});const corrected=prepareCalculatorNodeTestCorrection(raw,previous,taskSnapshot);assert.equal(corrected.files.find(f=>f.path==='src/app.mjs').content,previous.files.find(f=>f.path==='src/app.mjs').content);report.browserVerifiedAppBytesPreserved=true;return coreTeam.restoreProposal(plan,TASK,taskSnapshot,corrected,calculatorProposalDigest(corrected),[]);
 }
 phase='admit_original_repair';
 const workspace=await openCalculatorWorkspace(store,reader,plan.branch,PIN.candidateSha);
 const continuations=join(root,'continuations');mkdirSync(continuations,{mode:0o700});
 const permit=await admitCalculatorT03RepairContinuation(workspace,store,stopped,preview,continuations,async()=>{await assertOriginalMarker();await barrier.claim();remoteClaimed=true;},async()=>{await assertOriginalMarker();await barrier.assertClaimed();});
 report.sourceCapsuleSha256=T03_REPAIR_CAPSULE_SHA;
 phase='live_host_ready';report.runtimeSha=env.FACTORY_RUNTIME_SHA;report.sourceCiRunId=Number(env.FACTORY_SOURCE_CI_RUN);report.baseSha=PIN.candidateSha;
 const privateDir=join(root,'execution-private');mkdirSync(privateDir,{mode:0o700});
 writer=createCalculatorExecutionCheckpointStore(privateDir,{repository:REPO,goalId:plan.owner.id,ownerFingerprint:plan.owner.ownerFingerprint,planFingerprint:PLAN,taskId:TASK,branch:plan.branch,baseSha:PIN.candidateSha,bootstrapSha:plan.owner.baseSha,runtimeConfigDigest:sha(JSON.stringify({runtimeSha:env.FACTORY_RUNTIME_SHA,runId:env.GITHUB_RUN_ID,preset:'calculator-frontend-2048-four-roles',ownerApprovedCorrectionCycle:8,sourceCapsule:T03_REPAIR_CAPSULE_SHA}))});
 active={attempt:1,stage:'admission',status:'running',assessments:[],modelState:high,httpInFlight:false,publicationStarted:false};
 let exported=false;const freshAssessments=[];
 team=Object.freeze({
  generate:async(_plan,id,snapshot)=>{assert.equal(exported,false);assert.equal(id,TASK);assert.equal(snapshot.baseSha,PIN.candidateSha);exported=true;adopted=await correctTestOnce();put('private-agent-repaired-proposal.json',adopted);save({...active,proposal:adopted,httpInFlight:false});const verified=await testProposal({task:plan.tasks[2],changes:adopted,proposalDigest:calculatorProposalDigest(adopted)});report.repairedProposalChecks={status:verified.status,testsExecuted:verified.testsExecuted,failures:verified.failures};assert.equal(verified.status,'passed');assert.ok(hostEvidence.get(adopted));report.authorRepairVerified=true;return adopted;},
  assess:async(role,_plan,id,changes)=>{if(role==='tester'){report.pendingRole='tester';put('fresh-assessment-prefix.json',freshAssessments);throw Error('Fresh Tester deferred by remaining three-request allowance; no publication');}if(freshAssessments.length===0){assert.equal(typeof authorSentAt,'number');let remaining=61000-(performance.now()-authorSentAt);report.authorToReviewPacingMs=Math.max(0,Math.ceil(remaining));while(remaining>0){await new Promise(resolve=>setTimeout(resolve,Math.min(5000,remaining)));remaining=61000-(performance.now()-authorSentAt);}}assert.equal(exported,true);assert.equal(changes,adopted);const assessed=await coreTeam.assess(role,_plan,id,changes);freshAssessments.push(assessed);put('fresh-assessment-prefix.json',freshAssessments);assert.ok(assessed.ready&&!assessed.findings.some(f=>['blocker','high'].includes(f.severity)));return assessed;},
  repair:async()=>{throw Error('No author replay or additional correction permitted');},
  checkpointCharge:()=>addPrior(coreTeam.checkpointCharge()),diagnostic:coreTeam.diagnostic,
 });
 const publisher=createCalculatorPublisher({plan,reader,env:{...env,GITHUB_TOKEN:env.CALCULATOR_GITHUB_TOKEN}});
 phase='execute_original_repair';
 const result=await runCalculatorExecution(workspace,{team,repairContinuationPermit:permit,maxRepairs:0,execution:'live',env,tools:{checkProposal:testProposal,publish:async()=>{throw Error('Publication disabled until fresh Tester is separately authorized and passed');},ci:async query=>{
  let last;for(let turn=0;turn<36;turn++){last=await ci(query);const runs=last.runs.filter(r=>r.name==='Calculator task CI');if(runs.length&&runs.every(r=>r.status==='completed'))break;await new Promise(r=>setTimeout(r,5000));}return last;
 }},checkpoint:event=>{save({...event,httpInFlight:event.status==='passed'?false:active.httpInFlight});console.log(JSON.stringify({taskId:event.taskId,stage:event.stage,status:event.status,attempt:event.attempt,ownerApprovedCorrectionCycle:8}));}});
 report.execution=result;put('execution-report.json',result);report.status=report.authorRepairVerified&&freshAssessments.length===2&&freshAssessments.every(a=>a.ready&&!a.findings.some(f=>['blocker','high'].includes(f.severity)))&&report.pendingRole==='tester'?'awaiting_fresh_tester_no_publication':'blocked';report.freshAssessments=freshAssessments;
 assert.equal(sha(readFileSync(join(state,'calc-'+TASK+'.json'))),sha(priorReceipt));report.originalT03ReceiptUnchanged=true;
 assert.equal(sha(readFileSync(join(state,'calc-'+report.previousTaskId+'.json'))),PIN.originalReceiptSha256);
 report.historicalReceiptUnchanged=true;report.autonomousDevelopmentProven=result.status==='candidate-verified';
 }
}catch(error){report.status='blocked';report.reason='live_bridge_'+phase+'_unverified';if(error?.name==='AssertionError'){report.assertion={operator:error.operator,...(typeof error.actual==='number'?{actual:error.actual}:{}),...(typeof error.expected==='number'?{expected:error.expected}:{})};}process.exitCode=10;}
finally{
 if(team){charge(team.checkpointCharge()??high);report.modelDiagnostic=team.diagnostic();report.modelCalls=14+providerCalls;report.newProviderCalls=providerCalls;}
 writer?.close();if(active)report.lastCheckpoint={stage:active.stage,status:active.status,attempt:active.attempt,httpInFlight:active.httpInFlight,publicationStarted:active.publicationStarted};report.remoteBarrierClaimed=remoteClaimed;report.currentCharge=high;put('report.json',report);console.log(JSON.stringify(report));
 if(report.status==='blocked')process.exitCode=10;
}
