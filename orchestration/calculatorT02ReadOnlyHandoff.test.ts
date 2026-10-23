import test from "node:test";
import { createHash } from "node:crypto";
import { prepareCalculatorRoleChanges, validateCalculatorAssessment } from "../commander/calculatorTeam.js";
import { createHistoricalT03ExecutionCallback } from "./calculatorT02Admission.js";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { CALCULATOR_T02_CHARGE_PIN as PIN, type CalculatorT02ChargeObservation } from "./calculatorT02ChargeReconciliation.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { admitHistoricalT02OneSuccessor, type HistoricalT02AdmissionTools } from "./calculatorT02Admission.js";
import type { CalculatorCiEvidence } from "../github/calculatorCi.js";
import { openCalculatorWorkspace, selectCalculatorWorkspaceTask, claimHistoricalCalculatorT03 } from "./calculatorWorkspace.js";
import { TeamTaskStore } from "./teamTaskStore.js";
import type { CalculatorSnapshotReader, CalculatorTreeEntry } from "../github/calculatorSnapshot.js";
import type { CalculatorCheckRunner } from "./calculatorWorkspace.js";
import { CALCULATOR_T02_PRESELECTION_ERROR, previewCalculatorT02Successor } from "./calculatorT02SuccessorPreview.js";
import { CALCULATOR_T02_EVENT_PREFLIGHT_ERROR, inspectCalculatorT02AfterCiEvent } from "./calculatorT02AfterCiEventPreflight.js";
import { calculatorAfterCiEventIdentity } from "./calculatorAfterCi.js";
import { CALCULATOR_T02_SIDECAR_ERROR, inspectCalculatorT02ReconciliationSidecar,
  recordCalculatorT02ReconciliationSidecar } from "./calculatorT02ReconciliationSidecar.js";
import { CALCULATOR_T02_HANDOFF_ERROR, inspectCalculatorT02ReadOnlyHandoff,
  assertCalculatorT02InspectedReadOnlyHandoff } from "./calculatorT02ReadOnlyHandoff.js";

const sourceAudit = {
  status:"publication_reconciled_read_only",
  sourceSha:"e22c946c77095868deb7e65c230e2e6ab5c860f1",
  auditRunId:39808880793,auditEventSha:"7dd8648e10451b420b1b0a65bbfbb2341c93cf50",
  readOnlyAudit:true,modelsRun:false,githubWritesPerformed:false,
  receiptsChanged:false,automaticReplay:false,resumeAuthorized:false,budgetResetAuthorized:false,
  autonomousDevelopmentProven:false,wholeStep8Closed:false,sourceRunId:PIN.sourceRunId,
  sourceArtifactId:PIN.artifactId,candidateSha:PIN.candidateSha,
  archive:{manifestSha256:PIN.manifestSha256,fileCount:255,totalBytes:1413026,allFilesVerified:true},
  capsuleObserved:{stage:"publish_candidate",status:"blocked",httpInFlight:false,publicationStarted:true,
    proposalDigest:"bc1e0790d5d4c54c06ea1abe8b6f5d8f6eca767a9a477f4146947d59f3fd6f5b",assessmentCount:3},
  capsule:{sha256:"b49a7295bb014e25f601c04608e6c1cefb20818f27af474369dad71c25c240a7",
    proposalDigest:"bc1e0790d5d4c54c06ea1abe8b6f5d8f6eca767a9a477f4146947d59f3fd6f5b",
    publicationStarted:true,httpInFlight:false,oldReceiptReason:"publication_or_ci_uncertain_inspect_no_replay",
    assessments:["security","reviewer","tester"].map((role,i)=>({role,ready:true,findings:0,unverifiedAreas:i===1?2:4}))},
  candidate:{sha:PIN.candidateSha,parent:"5c4bc71b3119a50d2ca7ce1dbdf12bcaa000ce75",
    approvedFileBytesMatch:true,unchangedDependencyAndWorkflowBlobs:true,pr:1,draft:true,
    changedPaths:["index.html","src/app.mjs","styles.css"]},
  ci:{status:"passed",testsExecuted:true,verifiedRunIds:[39791054276]},
};
const charges:CalculatorT02ChargeObservation = {
  manifestSha256:PIN.manifestSha256,candidateSha:PIN.candidateSha,sourceRunId:PIN.sourceRunId,artifactId:PIN.artifactId,
  phases:[
    {runId:39747322491,settled:{attemptedRequests:1,totalRequestBytes:4840,reservedRunTokens:3070,elapsedMs:23206},
      checkpointHighWater:{attemptedRequests:1,totalRequestBytes:4840,reservedRunTokens:3070,elapsedMs:23206}},
    {runId:39753293947,settled:{attemptedRequests:1,totalRequestBytes:5300,reservedRunTokens:3223,elapsedMs:19922},
      checkpointHighWater:{attemptedRequests:1,totalRequestBytes:5300,reservedRunTokens:3223,elapsedMs:19922}},
    {runId:39756457942,settled:{attemptedRequests:4,totalRequestBytes:33403,reservedRunTokens:11835,elapsedMs:201580},
      checkpointHighWater:{attemptedRequests:4,totalRequestBytes:33403,reservedRunTokens:11835,elapsedMs:201580}},
    {runId:39765383540,settled:{attemptedRequests:3,totalRequestBytes:33296,reservedRunTokens:9071,elapsedMs:129638},
      checkpointHighWater:{attemptedRequests:3,totalRequestBytes:33296,reservedRunTokens:11275,elapsedMs:129626}},
    {runId:39790544926,settled:{attemptedRequests:3,totalRequestBytes:33299,reservedRunTokens:9036,elapsedMs:138709},
      checkpointHighWater:{attemptedRequests:3,totalRequestBytes:33299,reservedRunTokens:11161,elapsedMs:138695}},
  ],recordedAggregate:PIN.recorded,
  finalNewCharge:{attemptedRequests:3,totalRequestBytes:33299,reservedRunTokens:9036,elapsedMs:138712},
};
/** Byte-exact, source-free task receipt from the independently hashed 255-file qualification archive. */
const ORIGINAL_RECEIPT = "{\"schemaVersion\":1,\"id\":\"calc-calculator-pilot-step7-v1-34ee03-t02\",\"fingerprint\":\"6e5431f142b6f8ca3f78298de687eb89043de1642d32c4a4602f7ece3c5dacc2\",\"status\":\"needs-review\",\"stages\":[{\"stage\":\"load_current_source\",\"status\":\"passed\"},{\"stage\":\"restore_proposal_1\",\"status\":\"passed\"},{\"stage\":\"security_1\",\"status\":\"passed\"},{\"stage\":\"reviewer_1\",\"status\":\"passed\"},{\"stage\":\"tester_1\",\"status\":\"passed\"},{\"stage\":\"host_tests_1\",\"status\":\"passed\"},{\"stage\":\"publish_candidate\",\"status\":\"blocked\"}],\"reasonCode\":\"publication_or_ci_uncertain_inspect_no_replay\"}\n";
function receipt(): Uint8Array {return new Uint8Array(Buffer.from(ORIGINAL_RECEIPT,"utf8"));}
function fixture() {
  let calls=0;
  const host={
    getCandidateCI:async()=>{calls++;return {runId:39791054276,headSha:PIN.candidateSha,runAttempt:1,
      workflowPath:".github/workflows/calculator-task-ci.yml",completed:true,passed:true,syntaxPassed:true,taskTestsPassed:true};},
    getCurrentHead:async()=>{calls++;return PIN.candidateSha;},
  };
  return {data:{audit:structuredClone(sourceAudit),archivedReceiptBytes:receipt(),charges:structuredClone(charges)},host,get calls(){return calls;}};
}
test("published t02 is read-only, with pinned high-water charge and original receipt bytes unchanged",async()=>{
  const f=fixture(),before=new Uint8Array(f.data.archivedReceiptBytes);
  const result=await inspectCalculatorT02ReadOnlyHandoff(f.data,f.host);
  assert.equal(f.calls,2);assert.equal(result.candidateSha,PIN.candidateSha);
  assert.deepEqual(result.priorCharge,PIN.conservative);
  assert.equal(result.nextTaskAuthorized,false);assert.equal(result.resumeAuthorized,false);
  assert.equal(assertCalculatorT02InspectedReadOnlyHandoff(result),result);
  assert.throws(()=>assertCalculatorT02InspectedReadOnlyHandoff(structuredClone(result)),{message:CALCULATOR_T02_HANDOFF_ERROR});
  assert.equal(result.publicationAuthorized,false);assert.equal(result.budgetResetAuthorized,false);
  assert.equal(result.historicalReceiptPreserved,true);assert.equal(result.auditClaimsArchiveVerified,true);
  assert.deepEqual(f.data.archivedReceiptBytes,before);
  assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.priorCharge));
});
test("forged summary, missing source identity, amended proposal and suspicious status refuse before remote calls",async()=>{
  const edits=[
    (a:any)=>{a.archive.fileCount=254;},(a:any)=>{a.sourceArtifactId=1;},
    (a:any)=>{a.auditEventSha="0".repeat(40);},(a:any)=>{a.capsule.assessments[2].ready=false;},
    (a:any)=>{a.candidate.changedPaths.push("src/calculator.mjs");},
    (a:any)=>{a.capsuleObserved.publicationStarted=false;},(a:any)=>{a.capsule.oldReceiptReason="ok";},
    (a:any)=>{a.ci.verifiedRunIds=[1];},(a:any)=>{a.resumeAuthorized=true;},
    (a:any)=>{a.candidate.approvedFileBytesMatch=false;},
  ];
  for(const edit of edits){const f=fixture();edit(f.data.audit);await assert.rejects(()=>inspectCalculatorT02ReadOnlyHandoff(f.data,f.host),{message:CALCULATOR_T02_HANDOFF_ERROR});assert.equal(f.calls,0);}
});
test("stale target branch or unverified CI refuses without touching historic receipts",async()=>{
  for(const changes of [
    {getCurrentHead:async()=>("d".repeat(40))},
    {getCandidateCI:async()=>({runId:39791054276,headSha:PIN.candidateSha,runAttempt:2,
      workflowPath:".github/workflows/calculator-task-ci.yml",completed:true,passed:true,syntaxPassed:true,taskTestsPassed:true})},
    {getCandidateCI:async()=>({runId:39791054276,headSha:PIN.candidateSha,runAttempt:1,
      workflowPath:".github/workflows/calculator-task-ci.yml",completed:true,passed:true,syntaxPassed:true,taskTestsPassed:false})},
  ]){const f=fixture();await assert.rejects(()=>inspectCalculatorT02ReadOnlyHandoff(f.data,{...f.host,...changes}),{message:CALCULATOR_T02_HANDOFF_ERROR});}
});
test("altered charge, malformed receipt and missing trusted host verifier refuse",async()=>{
  const f=fixture();(f.data.charges.phases[3]!.checkpointHighWater as {reservedRunTokens:number}).reservedRunTokens=9071;
  await assert.rejects(()=>inspectCalculatorT02ReadOnlyHandoff(f.data,f.host),{message:CALCULATOR_T02_HANDOFF_ERROR});
  const h=fixture();h.data.archivedReceiptBytes=new Uint8Array(Buffer.from('{"invalid":true}'));
  await assert.rejects(()=>inspectCalculatorT02ReadOnlyHandoff(h.data,h.host),{message:CALCULATOR_T02_HANDOFF_ERROR});
  const q=fixture();await assert.rejects(()=>inspectCalculatorT02ReadOnlyHandoff(q.data,{} as any),{message:CALCULATOR_T02_HANDOFF_ERROR});
});

test("a claimed successful source-free JSON or prototype cannot become a checked host capability", async()=>{
  const f=fixture();const result=await inspectCalculatorT02ReadOnlyHandoff(f.data,f.host);
  const json=JSON.parse(JSON.stringify(result));
  for(const forged of [json, Object.freeze({...result}), {...result, nextTaskAuthorized:true}, Object.create(result), null]) {
    assert.throws(()=>assertCalculatorT02InspectedReadOnlyHandoff(forged),{message:CALCULATOR_T02_HANDOFF_ERROR});
  }
});

test("real in-process verified handoff writes exactly one non-authorizing sidecar; restart reads but cannot replay",async()=>{
  const root=mkdtempSync(join(tmpdir(),"t02-real-sidecar-"));
  try {
    const dir=join(root,"sidecar");mkdirSync(dir,{mode:0o700});
    const f=fixture(),checked=await inspectCalculatorT02ReadOnlyHandoff(f.data,f.host);
    const initial=JSON.stringify(f.data.audit);
    const first=recordCalculatorT02ReconciliationSidecar(dir,checked);
    assert.equal(first.status,"recorded");
    assert.equal(first.resumeAuthorized,false);assert.equal(first.successorAuthorized,false);
    assert.equal(first.budgetResetAuthorized,false);
    assert.deepEqual(first.priorCharge,PIN.conservative);
    const names=readdirSync(dir);assert.equal(names.length,1);assert.ok(names[0]?.endsWith(".json"));
    const persisted=new Uint8Array(readFileSync(join(dir,names[0]!)));
    const inspected=inspectCalculatorT02ReconciliationSidecar(dir);
    assert.equal(inspected?.status,"already-recorded");
    assert.equal(inspected?.successorAuthorized,false);
    const crashLock=join(dir,names[0]!.slice(0,-5)+".lock");
    writeFileSync(crashLock,"",{mode:0o600,flag:"wx"});
    assert.throws(()=>inspectCalculatorT02ReconciliationSidecar(dir),{message:CALCULATOR_T02_SIDECAR_ERROR});
    unlinkSync(crashLock);
    assert.equal(inspectCalculatorT02ReconciliationSidecar(dir)?.status,"already-recorded");
    assert.deepEqual(new Uint8Array(readFileSync(join(dir,names[0]!))),persisted);
    assert.throws(()=>recordCalculatorT02ReconciliationSidecar(dir,checked),{message:CALCULATOR_T02_SIDECAR_ERROR});
    assert.throws(()=>recordCalculatorT02ReconciliationSidecar(dir,structuredClone(checked)),{message:CALCULATOR_T02_HANDOFF_ERROR});
    assert.equal(JSON.stringify(f.data.audit),initial);
    assert.deepEqual(new Uint8Array(readFileSync(join(dir,names[0]!))),persisted);
  } finally {rmSync(root,{force:true,recursive:true});}
});

const SAVED_PLAN = JSON.parse(readFileSync(new URL("./fixtures/calculatorStep7SavedPlan.json", import.meta.url),"utf8"));
const T02_PARENT = "5c4bc71b3119a50d2ca7ce1dbdf12bcaa000ce75";
function preselectionFixture(root: string, executable=false) {
  const state = join(root,"plan"), sidecarDir = join(root,"sidecar");
  mkdirSync(state,{mode:0o700});mkdirSync(sidecarDir,{mode:0o700});
  const store=new CalculatorPlanStore(state,SAVED_PLAN.request);
  const plan=store.initialize(SAVED_PLAN.proposal);
  assert.equal(plan.status,"planned");
  const first=store.taskReceipt(plan,plan.tasks[0]!);
  assert.equal(first.claim(),"claimed");
  for(const stage of ["load_current_source","generate_1","security_1","reviewer_1","tester_1",
    "host_tests_1","publish_candidate","verify_candidate_ci"]){
    first.recordStage(stage,"running");first.recordStage(stage,"passed");
  }
  first.recordPublication({branch:plan.branch,headSha:T02_PARENT,number:1,
    url:"https://github.com/"+plan.owner.repository+"/pull/1"});
  first.finish("needs-review","task_candidate_verified_not_whole_app");first.close();
  const t02path=join(state,"calc-"+plan.tasks[1]!.id+".json");
  writeFileSync(t02path,ORIGINAL_RECEIPT,{mode:0o600,flag:"wx"});
  const sources=new Map<string,string>([
    ["src/calculator.mjs","export const calculate = (a,b) => a + b;\\n"],
    ["test/calculator.test.mjs","import test from 'node:test';\\n"],
    ["index.html","<!doctype html><html><body><main><output>0</output></main></body></html>"],
    ["src/app.mjs","export const keyboardReady = false;\\n"],
    ["styles.css","body { font-family: sans-serif; }\\n"],
  ]);
  const gitBlob=(content:string)=>createHash("sha1").update(
    Buffer.concat([Buffer.from("blob "+Buffer.byteLength(content)+"\\0"),Buffer.from(content)])).digest("hex");
  const sourceBySha=new Map([...sources.values()].map(content=>[gitBlob(content),content]));
  const entry=(path:string,hash:string):CalculatorTreeEntry=>({path,sha:
    executable && sources.has(path)?gitBlob(sources.get(path)!):hash,type:"blob",mode:"100644"});
  const core=[
    {path:"src",sha:"b".repeat(40),type:"tree",mode:"040000"},
    {path:"test",sha:"c".repeat(40),type:"tree",mode:"040000"},
    entry("src/calculator.mjs","1".repeat(40)),entry("test/calculator.test.mjs","2".repeat(40))
  ] as CalculatorTreeEntry[];
  const ui=[
    entry("index.html","3".repeat(40)),entry("src/app.mjs","4".repeat(40)),
    entry("styles.css","5".repeat(40))
  ];
  const workflow=entry(".github/workflows/calculator-task-ci.yml","7".repeat(40));
  const before=[...core,workflow], after=[...core,workflow,...ui];
  let head:string=PIN.candidateSha, checks=0, verifyBad=false, alterTree=false, alterMode=false;
  const successorSha="c".repeat(40);
  let successorTree:CalculatorTreeEntry[]|undefined;
  const reader: CalculatorSnapshotReader={
    getHead:async()=>head,
    readCommit:async sha=>({sha,treeSha:sha===successorSha?"f".repeat(40):
      sha===PIN.candidateSha?"d".repeat(40):"e".repeat(40),
      parents:sha===successorSha?[PIN.candidateSha]:sha===PIN.candidateSha?[T02_PARENT]:
        sha===T02_PARENT?[SAVED_PLAN.request.baseSha]:[]}),
    readTree:async sha=>({sha,truncated:false,tree:sha==="f".repeat(40)&&successorTree?successorTree:
      sha==="d".repeat(40)?
      (alterTree?[...after,entry("src/calculator.mjs","6".repeat(40))]:
        alterMode?after.map(e=>e.path===workflow.path?{...e,mode:"100755"}:e):after):before}),
    readBlob:async sha=>{
      if(!executable)throw Error("preview must never download executable source");
      const content=sourceBySha.get(sha);if(content===undefined)throw Error("unknown blob");
      return {sha,encoding:"base64",content:Buffer.from(content).toString("base64")};
    }
  };
  const verify:CalculatorCheckRunner=async input=>{
    checks++;
    return verifyBad?undefined:{
      repository:input.repository,planFingerprint:input.planFingerprint,
      taskId:input.task.id,candidateSha:input.candidateSha,currentSha:input.currentSha,
      securityReady:true,independentReviewReady:true,taskChecksPassed:true,testsExecuted:true
    };
  };
  return {store,reader,sidecarDir,state,plan,verify,
    get checks(){return checks;},
    setHead(sha:string){head=sha;},
    setVerifierFailure(value:boolean){verifyBad=value;},
    setChangedTree(value:boolean){alterTree=value;},
    setWorkflowModeChanged(value:boolean){alterMode=value;},
    receiptBytes:()=>new Uint8Array(readFileSync(t02path)),
    t03ReceiptPath:()=>join(state,"calc-"+plan.tasks[2]!.id+".json"),
    t03LockPath:()=>join(state,"calc-"+plan.tasks[2]!.id+".lock"),
    publishSuccessor(files:readonly {path:string;content:string}[]){
      if(!executable)throw Error("not enabled");
      successorTree=[...after];
      for(const file of files){
        const sha=gitBlob(file.content);
        sourceBySha.set(sha,file.content);
        const at=successorTree.findIndex(value=>value.path===file.path);
        const item:CalculatorTreeEntry={path:file.path,sha,type:"blob",mode:"100644"};
        if(at>=0)successorTree[at]=item;else successorTree.push(item);
      }
      head=successorSha;
      return successorSha;
    }
  };
}
test("host-checked historical t02 yields exactly a non-authorizing t03 preview; no model, claim or receipt rewrite",async()=>{
  const root=mkdtempSync(join(tmpdir(),"t02-preview-integration-"));
  try{
    const x=preselectionFixture(root),f=fixture();
    const checked=await inspectCalculatorT02ReadOnlyHandoff(f.data,f.host);
    recordCalculatorT02ReconciliationSidecar(x.sidecarDir,checked);
    const before=x.receiptBytes();
    const selected=await previewCalculatorT02Successor(x.store,x.reader,x.sidecarDir,checked,x.verify);
    assert.equal(selected.status,"candidate-preview-only");
    // End-to-end READ-ONLY workspace selection uses actual commit/blob ancestry.
    const workspace=await openCalculatorWorkspace(x.store,x.reader,x.plan.branch,PIN.candidateSha);
    const workspaceSelection=await selectCalculatorWorkspaceTask(workspace,x.verify,
      {inspectedT02:selected,eventDirectory:join(root,"events-workspace")});
    // The event directory must preexist; an absent host event store fails closed.
    assert.equal(workspaceSelection.status,"needs-review");
    const workspaceEvents=join(root,"events-workspace");
    mkdirSync(workspaceEvents,{mode:0o700});
    const workspaceReady=await selectCalculatorWorkspaceTask(workspace,x.verify,
      {inspectedT02:selected,eventDirectory:workspaceEvents});
    assert.equal(workspaceReady.status,"ready");
    assert.equal(workspaceReady.task?.id,x.plan.tasks[2]!.id);
    assert.deepEqual(workspaceReady.verifiedTaskIds.slice(-2),
      [x.plan.tasks[0]!.id,x.plan.tasks[1]!.id]);
    assert.deepEqual(readdirSync(workspaceEvents),[]);
    assert.deepEqual(readdirSync(x.state).filter(name=>name.includes("-t03")),[]);
    const eventKey=calculatorAfterCiEventIdentity({version:1,planFingerprint:x.plan.fingerprint,
      previousTaskId:x.plan.tasks[1]!.id,expectedNextTaskId:x.plan.tasks[2]!.id,
      candidateSha:PIN.candidateSha});
    writeFileSync(join(workspaceEvents,eventKey.id+".lock"),"",{mode:0o600,flag:"wx"});
    const consumed=await selectCalculatorWorkspaceTask(workspace,x.verify,
      {inspectedT02:selected,eventDirectory:workspaceEvents});
    assert.equal(consumed.status,"needs-review");
    assert.equal(consumed.reasonCode,"historical_after_ci_event_unverified");
    unlinkSync(join(workspaceEvents,eventKey.id+".lock"));
    const eventDir=join(root,"events");mkdirSync(eventDir,{mode:0o700});
    // Selector accepts the *in-process* checked preview for display only.
    const inspected=await x.store.select({currentBaseSha:PIN.candidateSha,
      inspectedT02:selected,eventDirectory:eventDir,verifyTask:async(task,receipt,currentBaseSha)=>({
        repository:x.plan.owner.repository,taskId:task.id,
        candidateSha:receipt.publication!.headSha,integratedAtSha:currentBaseSha,
        securityReady:true,independentReviewReady:true,taskChecksPassed:true,testsExecuted:true,
      })});
    assert.equal(inspected.status,"ready");
    assert.equal(inspected.task?.id,x.plan.tasks[2]!.id);
    const refused=await x.store.claimNext({currentBaseSha:PIN.candidateSha,
      inspectedT02:selected,eventDirectory:eventDir,verifyTask:async()=>{throw Error("claim callback must not run");}});
    assert.equal(refused.selection.status,"needs-review");
    assert.equal(refused.selection.reasonCode,"historical_preview_cannot_claim");
    assert.equal(refused.store,undefined);
    const forged=await x.store.select({currentBaseSha:PIN.candidateSha,
      inspectedT02:structuredClone(selected)});
    assert.equal(forged.status,"needs-review");
    assert.equal(forged.reasonCode,"historical_publication_unverified");
    const racing=await x.store.select({currentBaseSha:PIN.candidateSha,inspectedT02:selected,eventDirectory:eventDir,
      verifyTask:async(task,receipt,currentBaseSha)=>{
        if(task.id===x.plan.tasks[1]!.id)
          writeFileSync(x.t03LockPath(),"",{flag:"wx",mode:0o600});
        return {repository:x.plan.owner.repository,taskId:task.id,
          candidateSha:receipt.publication!.headSha,integratedAtSha:currentBaseSha,
          securityReady:true,independentReviewReady:true,taskChecksPassed:true,testsExecuted:true};
      }});
    assert.equal(racing.status,"needs-review");
    assert.equal(racing.reasonCode,"historical_state_changed_during_verification");
    unlinkSync(x.t03LockPath());
    const event=inspectCalculatorT02AfterCiEvent(eventDir,selected);
    const eventRace=await x.store.select({currentBaseSha:PIN.candidateSha,
      inspectedT02:selected,eventDirectory:eventDir,
      verifyTask:async(task,receipt,currentBaseSha)=>{
        if(task.id===x.plan.tasks[1]!.id)
          writeFileSync(join(eventDir,event.eventId+".lock"),"",{mode:0o600,flag:"wx"});
        return {repository:x.plan.owner.repository,taskId:task.id,
          candidateSha:receipt.publication!.headSha,integratedAtSha:currentBaseSha,
          securityReady:true,independentReviewReady:true,taskChecksPassed:true,testsExecuted:true};
      }});
    assert.equal(eventRace.status,"needs-review");
    assert.equal(eventRace.reasonCode,"historical_after_ci_event_changed");
    unlinkSync(join(eventDir,event.eventId+".lock"));
    assert.equal(selected.previousTaskId,x.plan.tasks[1]!.id);
    assert.equal(selected.nextTaskId,x.plan.tasks[2]!.id);
    assert.equal(selected.candidateSha,PIN.candidateSha);
    assert.equal(selected.executionAuthorized,false);assert.equal(selected.publicationAuthorized,false);
    assert.equal(selected.resumeAuthorized,false);assert.equal(selected.wholeStep8Closed,false);
    assert.deepEqual(selected.conservativePriorCharges,PIN.conservative);
    assert.equal(event.status,"not-consumed-read-only");
    assert.equal(event.previousTaskId,x.plan.tasks[1]!.id);
    assert.equal(event.expectedNextTaskId,x.plan.tasks[2]!.id);
    assert.equal(event.eventClaimed,false);assert.equal(event.executionAuthorized,false);
    assert.deepEqual(readdirSync(eventDir),[]);
    assert.throws(()=>inspectCalculatorT02AfterCiEvent(eventDir,structuredClone(selected)),
      {message:CALCULATOR_T02_PRESELECTION_ERROR});
    writeFileSync(join(eventDir,event.eventId+".lock"),"",{mode:0o600,flag:"wx"});
    assert.throws(()=>inspectCalculatorT02AfterCiEvent(eventDir,selected),
      {message:CALCULATOR_T02_EVENT_PREFLIGHT_ERROR});
    assert.deepEqual(readdirSync(eventDir),[event.eventId+".lock"]);
    assert.equal(x.checks,4);assert.deepEqual(x.receiptBytes(),before);
    assert.deepEqual(readdirSync(x.state).filter(name=>name.includes("-t03")),[]);
    // Repeated read-only preview may be performed, but still never claims t03.
    const twice=await previewCalculatorT02Successor(x.store,x.reader,x.sidecarDir,checked,x.verify);
    assert.equal(twice.executionAuthorized,false);
    assert.equal(x.checks,6);
    assert.deepEqual(readdirSync(x.state).filter(name=>name.includes("-t03")),[]);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("stale head, changed approved blobs, missing role proof and crash-lock refuse t03 before any claim",async()=>{
  for(const bad of ["head","tree","mode","verifier","lock","receipt"] as const){
    const root=mkdtempSync(join(tmpdir(),"t02-preview-refusals-"));
    try{
      const x=preselectionFixture(root),f=fixture(),checked=await inspectCalculatorT02ReadOnlyHandoff(f.data,f.host);
      recordCalculatorT02ReconciliationSidecar(x.sidecarDir,checked);
      const before=x.receiptBytes();
      if(bad==="head")x.setHead("f".repeat(40));
      if(bad==="tree")x.setChangedTree(true);
      if(bad==="mode")x.setWorkflowModeChanged(true);
      if(bad==="verifier")x.setVerifierFailure(true);
      if(bad==="lock")writeFileSync(x.t03LockPath(),"",{flag:"wx",mode:0o600});
      if(bad==="receipt")writeFileSync(x.t03ReceiptPath(),"{}",{flag:"wx",mode:0o600});
      await assert.rejects(()=>previewCalculatorT02Successor(x.store,x.reader,x.sidecarDir,checked,x.verify),
        {message:CALCULATOR_T02_PRESELECTION_ERROR},bad);
      assert.deepEqual(x.receiptBytes(),before);
      if(bad!=="receipt")assert.equal(readdirSync(x.state).includes("calc-"+x.plan.tasks[2]!.id+".json"),false);
    }finally{rmSync(root,{recursive:true,force:true});}
  }
});

function successfulT02Ci(candidateSha:string):CalculatorCiEvidence {
  const run=39791054276,repository="erman-ksv/Onay-Factory-Calculator",
    branch="feat/calculator-agent/calculator-pilot-step7-v1";
  return {
    repository,branch,candidateSha,
    runs:[{id:run,name:"Calculator task CI",status:"completed",conclusion:"success",head_sha:candidateSha,
      run_attempt:1,html_url:"https://github.com/"+repository+"/actions/runs/"+run}],
    jobs:[{name:"Calculator task CI",status:"completed",conclusion:"success",head_sha:candidateSha,
      run_id:run,run_attempt:1,steps:["Syntax","Task tests"].map(name=>({name,status:"completed",conclusion:"success"}))}],
    provenance:{candidateSha,workflowPins:[{id:9,path:".github/workflows/calculator-task-ci.yml",
      blobSha:"a".repeat(40)}],verifiedRunIds:[run]},
  };
}
async function admissionFixture(root:string) {
  const x=preselectionFixture(root),source=fixture();
  const checked=await inspectCalculatorT02ReadOnlyHandoff(source.data,source.host);
  recordCalculatorT02ReconciliationSidecar(x.sidecarDir,checked);
  const preview=await previewCalculatorT02Successor(x.store,x.reader,x.sidecarDir,checked,x.verify);
  const events=join(root,"events");mkdirSync(events,{mode:0o700});
  let ciCalls=0,modelCalls=0,persistCalls=0,changeAfterPersist=false;
  let failPersistence=false,failExecution=false;
  const original=x.receiptBytes();
  const options:HistoricalT02AdmissionTools={
    eventDirectory:events,
    ci:async()=>{
      ciCalls++;
      return changeAfterPersist&&persistCalls>0?{
        ...successfulT02Ci(PIN.candidateSha),
        runs:successfulT02Ci(PIN.candidateSha).runs.map(run=>({...run,conclusion:"failure"})),
      }:successfulT02Ci(PIN.candidateSha);
    },
    verifyDependencies:x.verify,
    persistBarrier:async identity=>{
      persistCalls++;
      const event=new TeamTaskStore(events,identity);
      try {
        const receipt=event.inspectExisting();
        assert.equal(receipt?.status,"running");
        assert.equal(receipt?.stages[0]?.stage,"execute_next_task");
        assert.equal(receipt?.stages[0]?.status,"running");
      } finally {event.close();}
      if(failPersistence)throw Error("Simulated external save rejection");
    },
    executeOne:async(id,workspace,permit)=>{
      assert.equal(id,x.plan.tasks[2]!.id);
      const ev=calculatorAfterCiEventIdentity({version:1,planFingerprint:x.plan.fingerprint,
        previousTaskId:x.plan.tasks[1]!.id,candidateSha:PIN.candidateSha,
        expectedNextTaskId:x.plan.tasks[2]!.id});
      assert.ok(readdirSync(events).includes(ev.id+".json"));
      assert.deepEqual(x.receiptBytes(),original);
      assert.deepEqual(readdirSync(x.state).filter(name=>name.includes("-t03")),[]);
      modelCalls++;
      if(failExecution)throw Error("Simulated executor crash");
      const claimed=await claimHistoricalCalculatorT03(workspace,permit,x.verify);
      assert.equal(claimed.selection.status,"ready");
      assert.equal(claimed.selection.task?.id,id);
      const successor=claimed.store!;
      try {
        for(const stage of ["load_current_source","generate_1","security_1","reviewer_1","tester_1",
          "host_tests_1","publish_candidate","verify_candidate_ci"]){
          successor.recordStage(stage,"running");
          successor.recordStage(stage,"passed");
        }
        const publication={branch:x.plan.branch,headSha:"c".repeat(40),number:1,
          url:"https://github.com/"+x.plan.owner.repository+"/pull/1"};
        successor.recordPublication(publication);
        successor.finish("needs-review","task_candidate_verified_not_whole_app");
        return {status:"candidate-verified" as const,reasonCode:"task_candidate_verified_not_whole_app",
          taskId:id,attempts:1,repairs:0,publication,proposalTestsExecuted:true,
          candidateTestsExecuted:true,wholeAppCompleted:false as const,
          finalCalculatorCiVerified:false as const,legalEnabled:false as const};
      }finally{successor.close();}
    },
  };
  return {x,preview,events,options,original,
    get counters(){return {ciCalls,modelCalls,persistCalls};},
    failPersistence(){failPersistence=true;},
    failExecution(){failExecution=true;},
    changeAfterPersist(){changeAfterPersist=true;},
  };
}
test("historical t02 admission requires durable one-use event before one host callback",async()=>{
  const root=mkdtempSync(join(tmpdir(),"t02-admission-success-"));
  try{
    const f=await admissionFixture(root);
    const result=await admitHistoricalT02OneSuccessor(f.x.store,f.x.reader,f.preview,f.options);
    assert.equal(result.status,"consumed",result.reason);
    assert.equal(result.callbackInvoked,true);
    assert.deepEqual(f.counters,{ciCalls:3,modelCalls:1,persistCalls:1});
    const stored=readdirSync(f.events).filter(name=>name.endsWith(".json"));
    assert.equal(stored.length,1);
    const duplicate=await admitHistoricalT02OneSuccessor(f.x.store,f.x.reader,f.preview,f.options);
    assert.equal(duplicate.status,"blocked");
    assert.equal(duplicate.reason,"event_already_consumed");
    assert.deepEqual(f.counters,{ciCalls:3,modelCalls:1,persistCalls:1});
    assert.deepEqual(f.x.receiptBytes(),f.original);
    assert.equal(readdirSync(f.x.state).filter(name=>name.includes("-t03")&&name.endsWith(".json")).length,1);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("failed external persistence consumes event without invoking host executor",async()=>{
  const root=mkdtempSync(join(tmpdir(),"t02-admission-persist-failure-"));
  try{
    const f=await admissionFixture(root);f.failPersistence();
    const first=await admitHistoricalT02OneSuccessor(f.x.store,f.x.reader,f.preview,f.options);
    assert.equal(first.status,"blocked");assert.equal(first.callbackInvoked,false);
    assert.deepEqual(f.counters,{ciCalls:2,modelCalls:0,persistCalls:1});
    const retry=await admitHistoricalT02OneSuccessor(f.x.store,f.x.reader,f.preview,f.options);
    assert.equal(retry.reason,"event_already_consumed");
    assert.deepEqual(f.counters,{ciCalls:2,modelCalls:0,persistCalls:1});
    assert.deepEqual(f.x.receiptBytes(),f.original);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("changed CI after barrier persistence cannot invoke executor or reset admission",async()=>{
  const root=mkdtempSync(join(tmpdir(),"t02-admission-ci-race-"));
  try{
    const f=await admissionFixture(root);f.changeAfterPersist();
    const first=await admitHistoricalT02OneSuccessor(f.x.store,f.x.reader,f.preview,f.options);
    assert.equal(first.status,"blocked");assert.equal(first.callbackInvoked,false);
    assert.deepEqual(f.counters,{ciCalls:3,modelCalls:0,persistCalls:1});
    const retry=await admitHistoricalT02OneSuccessor(f.x.store,f.x.reader,f.preview,f.options);
    assert.equal(retry.reason,"event_already_consumed");
    assert.deepEqual(f.counters,{ciCalls:3,modelCalls:0,persistCalls:1});
    assert.deepEqual(f.x.receiptBytes(),f.original);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("host executor interruption consumes barrier; no second callback or t02 replay",async()=>{
  const root=mkdtempSync(join(tmpdir(),"t02-admission-executor-interruption-"));
  try{
    const f=await admissionFixture(root);f.failExecution();
    const result=await admitHistoricalT02OneSuccessor(f.x.store,f.x.reader,f.preview,f.options);
    assert.equal(result.status,"blocked");assert.equal(result.callbackInvoked,true);
    assert.deepEqual(f.counters,{ciCalls:3,modelCalls:1,persistCalls:1});
    const retry=await admitHistoricalT02OneSuccessor(f.x.store,f.x.reader,f.preview,f.options);
    assert.equal(retry.reason,"event_already_consumed");
    assert.deepEqual(f.counters,{ciCalls:3,modelCalls:1,persistCalls:1});
    assert.deepEqual(f.x.receiptBytes(),f.original);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("simultaneous historical after-CI deliveries admit at most one host execution callback",async()=>{
  const root=mkdtempSync(join(tmpdir(),"t02-admission-concurrent-"));
  try{
    const f=await admissionFixture(root);
    let release!:()=>void,notify!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    const entered=new Promise<void>(resolve=>{notify=resolve;});
    let persistCalls=0;
    const options:HistoricalT02AdmissionTools={...f.options,
      persistBarrier:async identity=>{
        persistCalls++;
        const inspect=new TeamTaskStore(f.events,identity);
        try{
          assert.equal(inspect.inspectExisting()?.status,"running");
        }finally{inspect.close();}
        notify();
        await held;
      },
    };
    const first=admitHistoricalT02OneSuccessor(f.x.store,f.x.reader,f.preview,options);
    await entered;
    const second=await admitHistoricalT02OneSuccessor(f.x.store,f.x.reader,f.preview,options);
    assert.equal(second.status,"blocked");
    assert.equal(second.reason,"event_already_consumed");
    assert.equal(second.callbackInvoked,false);
    assert.equal(persistCalls,1);
    assert.deepEqual(f.counters,{ciCalls:2,modelCalls:0,persistCalls:0});
    release();
    const completed=await first;
    assert.equal(completed.status,"consumed");
    assert.equal(completed.callbackInvoked,true);
    assert.equal(persistCalls,1);
    assert.deepEqual(f.counters,{ciCalls:3,modelCalls:1,persistCalls:0});
    assert.deepEqual(f.x.receiptBytes(),f.original);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("a callback returning a success-shaped report without persisted t03 receipt cannot complete admission",async()=>{
  const root=mkdtempSync(join(tmpdir(),"t02-admission-false-success-"));
  try {
    const f=await admissionFixture(root);
    let calls=0;
    const options:HistoricalT02AdmissionTools={...f.options,
      executeOne:async id=>{
        calls++;
        return {status:"candidate-verified",reasonCode:"task_candidate_verified_not_whole_app",
          taskId:id,attempts:1,repairs:0,
          publication:{branch:f.x.plan.branch,headSha:"c".repeat(40),
            number:1,url:"https://github.com/"+f.x.plan.owner.repository+"/pull/1"},
          proposalTestsExecuted:true,candidateTestsExecuted:true,
          wholeAppCompleted:false,finalCalculatorCiVerified:false,legalEnabled:false};
      },
    };
    const result=await admitHistoricalT02OneSuccessor(f.x.store,f.x.reader,f.preview,options);
    assert.equal(result.status,"blocked");
    assert.equal(result.callbackInvoked,true);
    assert.equal(calls,1);
    assert.deepEqual(readdirSync(f.x.state).filter(name=>name.includes("-t03")),[]);
    const again=await admitHistoricalT02OneSuccessor(f.x.store,f.x.reader,f.preview,options);
    assert.equal(again.reason,"event_already_consumed");
    assert.equal(calls,1);
    assert.deepEqual(f.x.receiptBytes(),f.original);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test("historical admission runs the ordinary t03 executor with guarded task claim and exact candidate CI",async()=>{
  const root=mkdtempSync(join(tmpdir(),"t02-real-executor-integration-"));
  try{
    const x=preselectionFixture(root,true),source=fixture();
    const checked=await inspectCalculatorT02ReadOnlyHandoff(source.data,source.host);
    recordCalculatorT02ReconciliationSidecar(x.sidecarDir,checked);
    const preview=await previewCalculatorT02Successor(x.store,x.reader,x.sidecarDir,checked,x.verify);
    const events=join(root,"events");mkdirSync(events,{mode:0o700});
    const before=x.receiptBytes(),roles:string[]=[];
    let generated=0,hostTests=0,publishes=0,candidateCi=0;
    const successorSha="c".repeat(40);
    const team={
      generate:async(_plan:typeof x.plan,id:string,snapshot:Parameters<typeof prepareCalculatorRoleChanges>[2])=>{
        generated++;assert.equal(id,x.plan.tasks[2]!.id);
        return prepareCalculatorRoleChanges("frontend",{summary:"Keyboard input and UI tests",
          changes:[
            {operation:"create",path:"test/ui.test.mjs",content:"import test from 'node:test'; test('keyboard',()=>{});",
              message:"Test keyboard"},
            {operation:"edit",path:"src/app.mjs",sourceSha256:snapshot.files.find(f=>f.path==="src/app.mjs")!.sourceSha256!,
              edits:[{oldText:"false",newText:"true"}],message:"Enable keyboard"},
          ]},snapshot);
      },
      repair:async()=>{throw Error("repair was not needed in this fixture");},
      assess:async(role:"security"|"reviewer"|"tester",_plan:typeof x.plan,id:string)=>{
        roles.push(role);assert.equal(id,x.plan.tasks[2]!.id);
        return validateCalculatorAssessment(role,{ready:true,summary:"Scoped fixture reviewed",
          findings:[],unverifiedAreas:[]},["changes@"+PIN.candidateSha]);
      },
    };
    const adapter=createHistoricalT03ExecutionCallback({
      team,verifyDependencies:x.verify,maxRepairs:0,execution:"offline-test",
      tools:{
        checkProposal:async input=>{
          hostTests++;return {repository:x.plan.owner.repository,taskId:input.task.id,
            baseSha:PIN.candidateSha,proposalDigest:input.proposalDigest,
            status:"passed" as const,testsExecuted:true,failures:[]};
        },
        publish:async input=>{
          publishes++;assert.equal(input.expectedSha,PIN.candidateSha);
          assert.equal(input.task.id,x.plan.tasks[2]!.id);
          const sha=x.publishSuccessor(input.changes.files);
          return {branch:x.plan.branch,headSha:sha,number:1,
            url:"https://github.com/"+x.plan.owner.repository+"/pull/1"};
        },
        ci:async input=>{
          candidateCi++;assert.equal(input.candidateSha,successorSha);
          const evidence=successfulT02Ci(successorSha);
          return {repository:evidence.repository,branch:evidence.branch,candidateSha:successorSha,
            runs:evidence.runs,jobs:evidence.jobs};
        },
      },
    });
    let persisted=0;
    const result=await admitHistoricalT02OneSuccessor(x.store,x.reader,preview,{
      eventDirectory:events,ci:async()=>successfulT02Ci(PIN.candidateSha),
      verifyDependencies:x.verify,persistBarrier:async()=>{persisted++;},
      executeOne:adapter,
    });
    const debugging=x.store.taskReceipt(x.plan,x.plan.tasks[2]!);
    const snapshot=debugging.inspectExisting();
    debugging.close();
    assert.equal(result.status,"consumed",JSON.stringify({reason:result.reason,generated,
      hostTests,publishes,candidateCi,roles,receiptStatus:snapshot?.status,
      receiptReason:snapshot?.reasonCode,stages:snapshot?.stages.map(s=>s.stage+":"+s.status)}));
    assert.equal(result.callbackInvoked,true);
    assert.equal(generated,1);assert.equal(publishes,1);assert.equal(hostTests,1);
    assert.equal(candidateCi,1);assert.equal(persisted,1);
    assert.deepEqual(roles,["security","reviewer","tester"]);
    assert.deepEqual(x.receiptBytes(),before);
    const receipt=x.store.taskReceipt(x.plan,x.plan.tasks[2]!);
    try{
      assert.equal(receipt.inspectExisting()?.publication?.headSha,successorSha);
      assert.equal(receipt.inspectExisting()?.status,"needs-review");
    }finally{receipt.close();}
  }finally{rmSync(root,{recursive:true,force:true});}
});
