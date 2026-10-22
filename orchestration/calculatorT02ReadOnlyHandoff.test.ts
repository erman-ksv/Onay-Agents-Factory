import test from "node:test";
import assert from "node:assert/strict";
import { CALCULATOR_T02_CHARGE_PIN as PIN, type CalculatorT02ChargeObservation } from "./calculatorT02ChargeReconciliation.js";
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
