import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALCULATOR_T02_SIDECAR_ERROR as ERROR,
  inspectCalculatorT02ReconciliationSidecar as inspect,
  recordCalculatorT02ReconciliationSidecar as record } from "./calculatorT02ReconciliationSidecar.js";

test("empty sidecar directory has no record, writes or permission to resume", () => {
  const root=mkdtempSync(join(tmpdir(),"t02-sidecar-"));
  try {
    const target=join(root,"private");mkdirSync(target,{mode:0o700});
    assert.equal(inspect(target),undefined);
    assert.deepEqual(readdirSync(target),[]);
    assert.throws(()=>record(target,{resumeAuthorized:false} as any),{message:/Historical Calculator t02 handoff is unverified/});
    assert.deepEqual(readdirSync(target),[]);
  } finally {rmSync(root,{force:true,recursive:true});}
});
test("forged JSON, missing source and unsafe filesystem are rejected without creating a state directory", () => {
  const root=mkdtempSync(join(tmpdir(),"t02-sidecar-boundary-"));
  try {
    const dest=join(root,"missing");const forged={status:"recorded",resumeAuthorized:false,
      budgetResetAuthorized:false,publicationAuthorized:false,successorAuthorized:false};
    assert.throws(()=>record(dest,forged as any),{message:/Historical Calculator t02 handoff is unverified/});
    assert.equal(existsSync(dest),false);
    assert.throws(()=>inspect(dest),{message:ERROR});
    assert.throws(()=>inspect("."),{message:ERROR});
  } finally {rmSync(root,{force:true,recursive:true});}
});
test("no invalid or interrupted persistent marker is treated as a successful reconciliation", () => {
  const root=mkdtempSync(join(tmpdir(),"t02-sidecar-poison-"));
  try {
    const dest=join(root,"private");mkdirSync(dest,{mode:0o700});
    assert.equal(inspect(dest),undefined);
    assert.deepEqual(readdirSync(dest),[]);
  } finally {rmSync(root,{force:true,recursive:true});}
});
