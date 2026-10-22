import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { CALCULATOR_T02_CHARGE_PIN as PIN, type CalculatorT02ChargeObservation } from "./calculatorT02ChargeReconciliation.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { TeamTaskStore } from "./teamTaskStore.js";
import type { CalculatorSnapshotReader, CalculatorTreeEntry } from "../github/calculatorSnapshot.js";
import type { CalculatorCheckRunner } from "./calculatorWorkspace.js";
import { CALCULATOR_T02_PRESELECTION_ERROR, previewCalculatorT02Successor } from "./calculatorT02SuccessorPreview.js";
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
    assert.deepEqual(new Uint8Array(readFileSync(join(dir,names[0]!))),persisted);
    assert.throws(()=>recordCalculatorT02ReconciliationSidecar(dir,checked),{message:CALCULATOR_T02_SIDECAR_ERROR});
    assert.throws(()=>recordCalculatorT02ReconciliationSidecar(dir,structuredClone(checked)),{message:CALCULATOR_T02_HANDOFF_ERROR});
    assert.equal(JSON.stringify(f.data.audit),initial);
    assert.deepEqual(new Uint8Array(readFileSync(join(dir,names[0]!))),persisted);
  } finally {rmSync(root,{force:true,recursive:true});}
});

const SAVED_PLAN = JSON.parse(readFileSync(new URL("./fixtures/calculatorStep7SavedPlan.json", import.meta.url),"utf8"));
const T02_PARENT = "5c4bc71b3119a50d2ca7ce1dbdf12bcaa000ce75";
function preselectionFixture(root: string) {
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
  const entry=(path:string,hash:string):CalculatorTreeEntry=>({path,sha:hash,type:"blob",mode:"100644"});
  const core=[
    {path:"src",sha:"b".repeat(40),type:"tree",mode:"040000"},
    {path:"test",sha:"c".repeat(40),type:"tree",mode:"040000"},
    entry("src/calculator.mjs","1".repeat(40)),entry("test/calculator.test.mjs","2".repeat(40))
  ] as CalculatorTreeEntry[];
  const ui=[
    entry("index.html","3".repeat(40)),entry("src/app.mjs","4".repeat(40)),
    entry("styles.css","5".repeat(40))
  ];
  const before=core, after=[...core,...ui];
  let head=PIN.candidateSha, checks=0, verifyBad=false, alterTree=false;
  const reader: CalculatorSnapshotReader={
    getHead:async()=>head,
    readCommit:async sha=>({sha,treeSha:sha===PIN.candidateSha?"d".repeat(40):"e".repeat(40),
      parents:sha===PIN.candidateSha?[T02_PARENT]:sha===T02_PARENT?[SAVED_PLAN.request.baseSha]:[]}),
    readTree:async sha=>({sha,truncated:false,tree:sha==="d".repeat(40)?
      (alterTree?[...after,entry("src/calculator.mjs","6".repeat(40))]:after):before}),
    readBlob:async()=>{throw Error("preview must never download executable source");}
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
    receiptBytes:()=>new Uint8Array(readFileSync(t02path)),
    t03ReceiptPath:()=>join(state,"calc-"+plan.tasks[2]!.id+".json"),
    t03LockPath:()=>join(state,"calc-"+plan.tasks[2]!.id+".lock")
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
    assert.equal(selected.previousTaskId,x.plan.tasks[1]!.id);
    assert.equal(selected.nextTaskId,x.plan.tasks[2]!.id);
    assert.equal(selected.candidateSha,PIN.candidateSha);
    assert.equal(selected.executionAuthorized,false);assert.equal(selected.publicationAuthorized,false);
    assert.equal(selected.resumeAuthorized,false);assert.equal(selected.wholeStep8Closed,false);
    assert.deepEqual(selected.conservativePriorCharges,PIN.conservative);
    assert.equal(x.checks,2);assert.deepEqual(x.receiptBytes(),before);
    assert.deepEqual(readdirSync(x.state).filter(name=>name.includes("-t03")),[]);
    // Repeated read-only preview may be performed, but still never claims t03.
    const twice=await previewCalculatorT02Successor(x.store,x.reader,x.sidecarDir,checked,x.verify);
    assert.equal(twice.executionAuthorized,false);
    assert.equal(x.checks,4);
    assert.deepEqual(readdirSync(x.state).filter(name=>name.includes("-t03")),[]);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("stale head, changed approved blobs, missing role proof and crash-lock refuse t03 before any claim",async()=>{
  for(const bad of ["head","tree","verifier","lock","receipt"] as const){
    const root=mkdtempSync(join(tmpdir(),"t02-preview-refusals-"));
    try{
      const x=preselectionFixture(root),f=fixture(),checked=await inspectCalculatorT02ReadOnlyHandoff(f.data,f.host);
      recordCalculatorT02ReconciliationSidecar(x.sidecarDir,checked);
      const before=x.receiptBytes();
      if(bad==="head")x.setHead("f".repeat(40));
      if(bad==="tree")x.setChangedTree(true);
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
