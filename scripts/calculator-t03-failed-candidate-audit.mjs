// Read-only actual tests of the latest saved agent repair; no model adapter or target writes.
import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {parseCalculatorExecutionCheckpointBytes} from '../orchestration/calculatorExecutionCheckpoint.js';
import {createCalculatorPlan} from '../orchestration/calculatorPlan.js';
import {createCalculatorSnapshotReader,loadCalculatorSnapshot,calculatorSources} from '../github/calculatorSnapshot.js';
import {prepareCalculatorRoleChanges} from '../commander/calculatorTeam.js';
import {calculatorProposalDigest} from '../orchestration/calculatorExecutionEvidence.js';
import {createCalculatorSandbox} from '../orchestration/calculatorSandbox.js';
const TASK='calculator-pilot-step7-v1-34ee03-t03',BASE='949a0bf874722fd8cbd886c2cb0af8f2b502ac05',ROOT=join(process.env.RUNNER_TEMP,'failed-candidate-audit');mkdirSync(ROOT,{mode:0o700});
const hash=b=>createHash('sha256').update(b).digest('hex');let stage='authenticate',report={version:1,taskId:TASK,modelsRun:false,targetWrites:false,legalEnabled:false,wholeStep8Closed:false};
try{
 assert.equal(process.env.GITHUB_REPOSITORY,'erman-ksv/Onay-Agents-Factory');assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
 async function get(path){const r=await fetch('https://api.github.com/repos/erman-ksv/Onay-Agents-Factory'+path,{headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);return r.json();}
 const run=await get('/actions/runs/39981896290');assert.equal(run.head_sha,'2f70d7b37b413145c5ba6fe3373b3fbbec20dd9b');assert.equal(run.conclusion,'failure');assert.equal(run.run_attempt,1);
 const artifact=await get('/actions/artifacts/12513747660');assert.equal(artifact.workflow_run.id,39981896290);assert.equal(artifact.digest,'sha256:8b4b41617571ea11158cf3745b25228ddfef9298f88e7cffaa0a5194d49ff9a9');assert.equal(artifact.expired,false);
 const source=process.env.CALCULATOR_FAILED_REPAIR_DIRECTORY;assert.ok(source?.startsWith(process.env.RUNNER_TEMP+'/'));
 const saved=JSON.parse(readFileSync(join(source,'report.json')));assert.equal(saved.modelCalls,7);assert.equal(saved.newProviderCalls,1);assert.equal(saved.lastCheckpoint.httpInFlight,false);assert.equal(saved.lastCheckpoint.publicationStarted,false);
 report.priorCharge=saved.currentCharge;assert.deepEqual(saved.currentCharge,{attemptedRequests:7,totalRequestBytes:62147,reservedRunTokens:28612,elapsedMs:237561});
 const bytes=readFileSync(join(source,'execution-private',TASK+'.execution.json')),raw=JSON.parse(bytes);
 assert.equal(raw.identity.taskId,TASK);assert.equal(raw.identity.baseSha,BASE);assert.equal(raw.identity.planFingerprint,'1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2');assert.equal(raw.identity.repository,'erman-ksv/Onay-Factory-Calculator');
 const capsule=parseCalculatorExecutionCheckpointBytes(bytes,raw.identity).data;
 const candidates=[...capsule.history.map(h=>h.payload),capsule.payload].filter(p=>p.proposal);assert.ok(candidates.length);const previous=candidates.at(-1).proposal;
 report.sourceCapsuleSha256=hash(bytes);report.sourceProposalDigest=calculatorProposalDigest(previous);
 stage='fresh_snapshot';
 const reader=createCalculatorSnapshotReader(process.env),snapshot=await loadCalculatorSnapshot({repository:previous.repository,baseRef:previous.baseRef,baseSha:BASE,changePaths:['src/app.mjs','test/ui.test.mjs']},reader);
 const ev=JSON.parse(previous.reviewEvidence),input={summary:previous.summary,changes:ev.changes.map(c=>c.operation==='create'?{operation:'create',path:c.path,content:c.content,message:previous.files.find(f=>f.path===c.path).message}:{operation:'patch',path:c.path,sourceSha256:c.sourceSha256,edits:c.edits,message:previous.files.find(f=>f.path===c.path).message})};
 const rebuilt=prepareCalculatorRoleChanges('frontend',input,snapshot);assert.equal(calculatorProposalDigest(rebuilt),report.sourceProposalDigest);assert.equal(rebuilt.reviewEvidence,previous.reviewEvidence);
 const fixture=JSON.parse(readFileSync(new URL('../orchestration/fixtures/calculatorStep7SavedPlan.json',import.meta.url))),plan=createCalculatorPlan(fixture.request,fixture.proposal),task=plan.tasks[2];assert.equal(task.id,TASK);
 const baseSources=new Map();for(const changePaths of [['src/calculator.mjs','test/calculator.test.mjs'],['index.html','styles.css','src/app.mjs']]){
  const s=await loadCalculatorSnapshot({repository:previous.repository,baseRef:previous.baseRef,baseSha:BASE,changePaths},reader);for(const [p,b] of calculatorSources(s))baseSources.set(p,b);
 }
 stage='actual_isolated_tests';const sandbox=createCalculatorSandbox({image:'node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392',baseSha:BASE,baseSources,includeFailureDetails:true});
 assert.equal((await sandbox.preflight()).ready,true);const tests=await sandbox.checkProposal({task,changes:rebuilt,proposalDigest:report.sourceProposalDigest});report.tests=tests;
 assert.equal(tests.testsExecuted,true);assert.equal(tests.status,'failed');assert.ok(tests.failures.some(f=>f.startsWith('Untrusted project-test diagnostic:')));
 writeFileSync(join(ROOT,'private-saved-agent-proposal.json'),JSON.stringify(rebuilt)+'\n',{mode:0o600,flag:'wx'});
 report.status='actual_failed_test_diagnosed';
}catch{report.status='unverified';report.failedStage=stage;process.exitCode=10;}
writeFileSync(join(ROOT,'report.json'),JSON.stringify(report)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(report));
