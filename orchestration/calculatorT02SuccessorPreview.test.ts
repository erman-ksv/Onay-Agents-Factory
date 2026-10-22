import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
