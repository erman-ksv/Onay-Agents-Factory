import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALCULATOR_RUNTIME_ERROR, createCalculatorRuntimeCheckpointWriters } from "./calculatorRuntime.js";
import { createCalculatorExecutionCheckpointStore, type CalculatorExecutionCheckpointIdentity,
  type CalculatorExecutionCheckpointPayload } from "./calculatorExecutionCheckpoint.js";

const identity: Omit<CalculatorExecutionCheckpointIdentity, "taskId"> = {
  repository: "erman-ksv/Onay-Factory-Calculator", goalId: "runtime-persistence", branch: "feat/calculator-pilot",
  ownerFingerprint: "a".repeat(64), planFingerprint: "b".repeat(64), baseSha: "c".repeat(40),
  bootstrapSha: "d".repeat(40), runtimeConfigDigest: "e".repeat(64),
};
const payload: CalculatorExecutionCheckpointPayload = {
  attempt: 1, stage: "load_current_source", status: "running", assessments: [],
  modelState: { attemptedRequests: 0, totalRequestBytes: 0, reservedRunTokens: 0, elapsedMs: 0 },
  httpInFlight: false, publicationStarted: false,
};
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("existing zero-charge capsule cannot be overwritten by a repeated failure checkpoint", t => {
  const directory = mkdtempSync(join(tmpdir(), "calculator-runtime-existing-")), taskId = "calc-core";
  const path = join(directory, taskId + ".execution.json");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const original = createCalculatorExecutionCheckpointStore(directory, { ...identity, taskId });
  const reference = original.save(payload); original.close();
  const bytes = readFileSync(path), writers = createCalculatorRuntimeCheckpointWriters(directory, identity);
  t.after(() => writers.close());
  let httpRequests = 0;
  function advance() {
    const writer = writers.get(taskId);
    writer.save({ ...payload, stage: "generate_1", httpInFlight: true,
      modelState: { attemptedRequests: 1, totalRequestBytes: 100, reservedRunTokens: 1000, elapsedMs: 1 } });
    httpRequests++;
  }
  assert.throws(advance, { message: CALCULATOR_RUNTIME_ERROR });
  // Simulate the executor catching the refusal and asking for a failure capsule.
  assert.throws(() => writers.get(taskId).save({ ...payload, status: "blocked" }), { message: CALCULATOR_RUNTIME_ERROR });
  assert.throws(advance, { message: CALCULATOR_RUNTIME_ERROR });
  assert.equal(httpRequests, 0); assert.equal(writers.has(taskId), false);
  assert.equal(existsSync(path + ".lock"), false);
  assert.deepEqual(readFileSync(path), bytes); assert.equal(digest(readFileSync(path)), reference.sha256);
  const inspected = createCalculatorExecutionCheckpointStore(directory, { ...identity, taskId });
  try {
    assert.equal(inspected.inspect()!.sequence, 1); assert.deepEqual(inspected.read(reference.sha256), payload);
  } finally { inspected.close(); }
});

test("fresh runtime writer is reused, exclusively locked and closed against later writes", t => {
  const directory = mkdtempSync(join(tmpdir(), "calculator-runtime-fresh-")), taskId = "calc-core";
  const path = join(directory, taskId + ".execution.json"), writers = createCalculatorRuntimeCheckpointWriters(directory, identity);
  t.after(() => { writers.close(); rmSync(directory, { recursive: true, force: true }); });
  assert.equal(writers.has(taskId), false);
  const writer = writers.get(taskId);
  assert.equal(writers.has(taskId), true); assert.equal(writers.get(taskId), writer);
  assert.equal(existsSync(path + ".lock"), true);
  assert.throws(() => createCalculatorExecutionCheckpointStore(directory, { ...identity, taskId }));
  const reference = writer.save(payload), bytes = readFileSync(path);
  assert.deepEqual(writer.read(reference.sha256), payload);
  writers.close(); writers.close();
  assert.equal(existsSync(path + ".lock"), false);
  assert.throws(() => writers.get(taskId), { message: CALCULATOR_RUNTIME_ERROR });
  assert.throws(() => writer.save({ ...payload, status: "blocked" }));
  assert.deepEqual(readFileSync(path), bytes); assert.equal(digest(readFileSync(path)), reference.sha256);
});
