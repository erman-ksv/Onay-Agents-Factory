import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALCULATOR_RUNTIME_ERROR, prepareCalculatorRuntimeAfterCi, runCalculatorRuntime } from "./calculatorRuntime.js";
import type { CalculatorCheckRunner } from "./calculatorWorkspace.js";

const request = { version: 1 as const, planFingerprint: "a".repeat(64),
  previousTaskId: "calculator-pilot-step7-v1-34ee03-t01", candidateSha: "b".repeat(40),
  expectedNextTaskId: "calculator-pilot-step7-v1-34ee03-t02" };
const refusal = { message: CALCULATOR_RUNTIME_ERROR };
const verifyDependencies: CalculatorCheckRunner = async () => { throw Error("No dependency execution expected"); };
const persistBarrier = async () => { throw Error("No barrier persistence expected in boundary tests"); };

test("after-CI runtime capability preserves the trusted checker and copies immutable request data", () => {
  const input = { request: { ...request }, verifyDependencies, persistBarrier };
  const prepared = prepareCalculatorRuntimeAfterCi(input)!;
  assert.equal(prepared.verifyDependencies, verifyDependencies);
  assert.equal(prepared.persistBarrier, persistBarrier);
  assert.ok(Object.isFrozen(prepared)); assert.ok(Object.isFrozen(prepared.request));
  input.request.candidateSha = "c".repeat(40);
  assert.equal(prepared.request.candidateSha, request.candidateSha);
  assert.equal(prepareCalculatorRuntimeAfterCi(undefined), undefined);
});

test("JSON and receipt-like metadata cannot become a host dependency checker", () => {
  for (const verifyDependencies of [undefined, null, true, {}, { securityReady: true }, "verified"]) {
    assert.throws(() => prepareCalculatorRuntimeAfterCi({ request, verifyDependencies, persistBarrier }), refusal);
  }
  for (const value of [null, [], "after-ci", { request }, { request, verifyDependencies }, { request, verifyDependencies, persistBarrier, approval: true },
    { request: { ...request, restoreProposal: {} }, verifyDependencies, persistBarrier },
    Object.assign(Object.create({ trusted: true }), { request, verifyDependencies, persistBarrier })]) {
    assert.throws(() => prepareCalculatorRuntimeAfterCi(value), refusal);
  }
});

test("accessors and symbol properties are refused before evaluating them", () => {
  let reads = 0;
  const value = Object.defineProperty({ verifyDependencies, persistBarrier }, "request", {
    enumerable: true, get() { reads++; return request; },
  });
  assert.throws(() => prepareCalculatorRuntimeAfterCi(value), refusal);
  assert.throws(() => prepareCalculatorRuntimeAfterCi({ request, verifyDependencies, persistBarrier, [Symbol("hidden")]: true }), refusal);
  assert.equal(reads, 0);
});

test("after-CI never runs in inspect, plan or preflight, and rejects absent or restoration-only budgets before state access", async () => {
  const root = mkdtempSync(join(tmpdir(), "calculator-after-ci-runtime-"));
  const state = join(root, "uncreated-state");
  const afterCi = { request, verifyDependencies, persistBarrier };
  try {
    for (const mode of ["inspect", "plan", "preflight"] as const) {
      await assert.rejects(() => runCalculatorRuntime({}, {}, state, mode, {},
        { maxRequests: 4, maxRunBytes: 96000, maxRepairs: 0 }, undefined, afterCi), refusal);
    }
    for (const limits of [undefined, { maxRequests: 3, maxRunBytes: 72000, maxRepairs: 0 } as const,
      { maxRequests: 1, maxRunBytes: 24000, maxRepairs: 0 } as const]) {
      await assert.rejects(() => runCalculatorRuntime({}, {}, state, "run", {}, limits, undefined, afterCi), refusal);
    }
    await assert.rejects(() => runCalculatorRuntime({}, {}, state, "run", {},
      { maxRequests: 4, maxRunBytes: 96000, maxRepairs: 0 },
      { proposal: {}, proposalDigest: "a".repeat(64) }, afterCi), refusal);
    assert.equal(existsSync(state), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
