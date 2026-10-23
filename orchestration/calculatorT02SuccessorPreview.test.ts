import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALCULATOR_T02_EVENT_PREFLIGHT_ERROR, inspectCalculatorT02AfterCiEvent } from "./calculatorT02AfterCiEventPreflight.js";
import { calculatorAfterCiEventIdentity } from "./calculatorAfterCi.js";
import { CALCULATOR_T02_PRESELECTION_ERROR as ERROR,
  previewCalculatorT02Successor } from "./calculatorT02SuccessorPreview.js";

test("t03 preview cannot accept JSON, missing host objects or absent reconciliation sidecar",async()=>{
  const root=mkdtempSync(join(tmpdir(),"t02-successor-preview-"));
  try {
    const sidecar=join(root,"sidecar");mkdirSync(sidecar,{mode:0o700});
    const bad={taskId:"calculator-pilot-step7-v1-34ee03-t02",resumeAuthorized:false};
    let reads=0;
    const reader={getHead:async()=>{reads++;return "a".repeat(40);}};
    const verifier=async()=>{reads++;return undefined;};
    await assert.rejects(()=>previewCalculatorT02Successor({} as any,reader as any,sidecar,bad as any,verifier),{message:ERROR});
    await assert.rejects(()=>previewCalculatorT02Successor({} as any,reader as any,sidecar,null as any,verifier),{message:ERROR});
    await assert.rejects(()=>previewCalculatorT02Successor({} as any,reader as any,sidecar,bad as any,{} as any),{message:ERROR});
    assert.equal(reads,0);
    assert.deepEqual(readdirSync(sidecar),[]);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test("event preflight rejects cloned preview, does not create event claims, and uses existing exact event identity",()=>{
  const root=mkdtempSync(join(tmpdir(),"t02-event-preflight-"));
  try{
    const events=join(root,"events");mkdirSync(events,{mode:0o700});
    const fake=Object.freeze({status:"candidate-preview-only",readOnly:true,executionAuthorized:false,
      publicationAuthorized:false,resumeAuthorized:false,budgetResetAuthorized:false,wholeStep8Closed:false,
      planFingerprint:"1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2",
      previousTaskId:"calculator-pilot-step7-v1-34ee03-t02",nextTaskId:"calculator-pilot-step7-v1-34ee03-t03",
      candidateSha:"949a0bf874722fd8cbd886c2cb0af8f2b502ac05"});
    const key=calculatorAfterCiEventIdentity({version:1,planFingerprint:fake.planFingerprint,
      previousTaskId:fake.previousTaskId,expectedNextTaskId:fake.nextTaskId,candidateSha:fake.candidateSha});
    assert.ok(key.id.startsWith("calc-after-ci-"));
    assert.throws(()=>inspectCalculatorT02AfterCiEvent(events,fake as never),
      {message:ERROR});
    assert.deepEqual(readdirSync(events),[]);
    writeFileSync(join(events,key.id+".lock"),"",{mode:0o600,flag:"wx"});
    assert.throws(()=>inspectCalculatorT02AfterCiEvent(events,structuredClone(fake) as never),
      {message:ERROR});
    assert.deepEqual(readdirSync(events),[key.id+".lock"]);
  }finally{rmSync(root,{recursive:true,force:true});}
});
