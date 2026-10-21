import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CALCULATOR_REGENERATION_ARTIFACT_ERROR, exportCalculatorRegenerationArtifact,
  type CalculatorRegenerationArtifactIdentity } from "./calculatorRegenerationArtifact.js";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const digest = (value: unknown) => hash(JSON.stringify(value));
const error = { message: CALCULATOR_REGENERATION_ARTIFACT_ERROR };
const oldReceipt = '{\n  "status": "blocked", "reasonCode": "execution_failed_no_replay",\n  "stages": [{"stage":"security_1","status":"passed"}]\n}\n';
const privateSource = "export function PRIVATE_REGENERATED_CALCULATOR(a, b) { return a + b; }";
function fixture(t: { after(callback: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "calculator-regeneration-export-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ["prior-state", "prior-barrier", "state", "execution-private", "barrier"]) mkdirSync(join(root, name), { mode: 0o700 });
  const barrier = { version: 1, goalId: "calculator-pilot-step7-v1", taskId: "calculator-pilot-step7-v1-abcdef-t01",
    planFingerprint: "a".repeat(64), runtimeSha: "b".repeat(40), runId: 123, eventSha: "c".repeat(40), priorRunId: 111,
    priorTreeDigest: "d".repeat(64), priorReceiptDigest: "e".repeat(64), oldCharge: { attemptedRequests: 3, reservedRunTokens: 7000 },
    planningCharge: { attemptedRequests: 3, reservedRunTokens: 12000 }, additionalAllowance: { maxRequests: 6, maxTokens: 7000 },
    authorization: "ONE_REGENERATION_AFTER_LOST_PROPOSAL", automaticReplay: false, budgetResetAuthorized: false };
  const identity: CalculatorRegenerationArtifactIdentity = { goalId: barrier.goalId, taskId: barrier.taskId,
    planFingerprint: barrier.planFingerprint, runtimeSha: barrier.runtimeSha, runId: barrier.runId, eventSha: barrier.eventSha, barrierDigest: digest(barrier) };
  const context = { version: 1, request: { version: 1, approval: barrier.authorization }, barrier };
  const put = (relative: string, value: unknown) => writeFileSync(join(root, relative), JSON.stringify(value), { mode: 0o600 });
  put("barrier/regeneration.json", barrier); put("context.json", context);
  writeFileSync(join(root, "prior-state/old-task.json"), oldReceipt, { mode: 0o600 });
  writeFileSync(join(root, "prior-state/old-task.lock"), "", { mode: 0o600 });
  put("prior-barrier/recovery.json", { version: 1, authorization: "OLD_AUTHORIZATION" });
  const namespace = join(root, "execution-private", "f".repeat(64)); mkdirSync(namespace, { mode: 0o700 });
  writeFileSync(join(namespace, identity.taskId + ".execution.json"), JSON.stringify({ privateSource }), { mode: 0o600 });
  const marker = "calc-regeneration-" + identity.goalId;
  writeFileSync(join(root, marker + ".json"), oldReceipt, { mode: 0o600 }); writeFileSync(join(root, marker + ".lock"), "", { mode: 0o600 });
  put("calculator-report.json", { status: "blocked", wholeAppCompleted: false });
  const env = { GITHUB_REPOSITORY: "erman-ksv/Onay-Agents-Factory", GITHUB_REF: "refs/heads/feat/calculator-step7-regeneration-20261020",
    GITHUB_EVENT_NAME: "push", GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: String(identity.runId), GITHUB_SHA: identity.eventSha,
    CALCULATOR_REGENERATION_BARRIER_UPLOADED: "true" };
  return { root, barrier, identity, context, env, namespace, marker, put,
    collect: () => exportCalculatorRegenerationArtifact(root, identity, env), destination: join(root, "regeneration-artifact") };
}

test("separate regeneration archive preserves prior receipts, private source, markers and stale locks byte for byte", t => {
  const f = fixture(t), result = f.collect(), bytes = readFileSync(join(f.destination, "manifest.json")), manifest = JSON.parse(bytes.toString());
  assert.equal(result.status, "preserved"); assert.equal(result.manifestSha256, hash(bytes));
  assert.deepEqual(Object.keys(result).sort(), ["fileCount", "manifestSha256", "status", "totalBytes"]);
  assert.equal(manifest.fileCount, result.fileCount); assert.equal(manifest.totalBytes, result.totalBytes);
  assert.equal(manifest.kind, "calculator-regeneration-forensic"); assert.equal(manifest.evidenceValidation, "unvalidated");
  assert.deepEqual(manifest.identity, f.identity); assert.equal(manifest.resumeAuthorized, false); assert.equal(manifest.budgetResetAuthorized, false);
  assert.equal(manifest.treeSha256, digest(manifest.files));
  for (const entry of manifest.files) {
    const original = readFileSync(join(f.root, entry.path)), archived = readFileSync(join(f.destination, "evidence", entry.path));
    assert.deepEqual(archived, original); assert.equal(entry.sha256, hash(original)); assert.equal(entry.bytes, original.length);
    assert.equal(lstatSync(join(f.destination, "evidence", entry.path)).mode & 0o777, 0o600);
  }
  assert.equal(readFileSync(join(f.destination, "evidence/prior-state/old-task.json"), "utf8"), oldReceipt);
  assert.equal(readFileSync(join(f.root, "prior-state/old-task.json"), "utf8"), oldReceipt);
  assert.equal(readFileSync(join(f.destination, "evidence/prior-state/old-task.lock")).length, 0);
  assert.equal(bytes.includes(privateSource), false); assert.equal(bytes.includes("execution_failed_no_replay"), false);
  assert.equal(JSON.stringify(result).includes(privateSource), false);
  for (const path of [f.destination, join(f.destination, "evidence"), join(f.destination, "evidence/prior-state")]) assert.equal(lstatSync(path).mode & 0o777, 0o700);
  assert.deepEqual(readdirSync(join(f.root, "state")), []);
  assert.equal(existsSync(join(f.root, "capsule")), false); assert.equal(existsSync(join(f.root, "report")), false);
});

test("context and barrier are required while other missing evidence directories stay absent", t => {
  const f = fixture(t);
  for (const name of ["prior-state", "prior-barrier", "state", "execution-private"]) rmSync(join(f.root, name), { recursive: true });
  assert.equal(f.collect().status, "preserved");
  for (const name of ["prior-state", "prior-barrier", "state", "execution-private"]) assert.equal(existsSync(join(f.destination, "evidence", name)), false);
});

test("raw damaged prior JSON remains unvalidated forensic evidence", t => {
  const f = fixture(t), damaged = '{"proposal":"incomplete'; writeFileSync(join(f.root, "prior-state/old-task.json"), damaged, { mode: 0o600 });
  f.collect(); assert.equal(readFileSync(join(f.destination, "evidence/prior-state/old-task.json"), "utf8"), damaged);
  assert.equal(JSON.parse(readFileSync(join(f.destination, "manifest.json"), "utf8")).evidenceValidation, "unvalidated");
});

test("strict identity fields and formats cannot be changed or extended", async t => {
  for (const drift of ["goalId", "taskId", "planFingerprint", "runtimeSha", "runId", "eventSha", "barrierDigest", "unknown", "unsafe-goal", "nan-run"]) await t.test(drift, t => {
    const f = fixture(t), changed: any = { ...f.identity };
    if (drift === "runId") changed.runId++;
    else if (drift === "nan-run") changed.runId = NaN;
    else if (drift === "unknown") changed.extra = true;
    else if (drift === "unsafe-goal") changed.goalId = "../escape";
    else changed[drift] = drift === "goalId" || drift === "taskId" ? "different-owner" : "0".repeat(drift === "runtimeSha" || drift === "eventSha" ? 40 : 64);
    assert.throws(() => exportCalculatorRegenerationArtifact(f.root, changed, f.env), error); assert.equal(existsSync(f.destination), false);
  });
});

test("current repository, branch, event, run attempt, run ID, SHA and remote barrier flag are bound", async t => {
  for (const key of ["GITHUB_REPOSITORY", "GITHUB_REF", "GITHUB_EVENT_NAME", "GITHUB_RUN_ATTEMPT", "GITHUB_RUN_ID", "GITHUB_SHA", "CALCULATOR_REGENERATION_BARRIER_UPLOADED"]) await t.test(key, t => {
    const f = fixture(t); assert.throws(() => exportCalculatorRegenerationArtifact(f.root, f.identity, { ...f.env, [key]: "different" }), error);
    assert.equal(existsSync(f.destination), false);
  });
});

test("barrier tampering, unsafe authority flags and mismatched context cannot be laundered by updating its digest", async t => {
  for (const form of ["digest", "identity", "authorization", "automatic", "reset", "context", "context-extra", "missing-barrier", "missing-context"]) await t.test(form, t => {
    const f = fixture(t); let changed = { ...f.barrier };
    if (form === "digest") f.put("barrier/regeneration.json", { ...changed, priorRunId: 999 });
    if (form === "identity") changed = { ...changed, taskId: "different-task" };
    if (form === "authorization") changed = { ...changed, authorization: "AUTOMATIC_RETRY" };
    if (form === "automatic") changed = { ...changed, automaticReplay: true };
    if (form === "reset") changed = { ...changed, budgetResetAuthorized: true };
    if (["identity", "authorization", "automatic", "reset"].includes(form)) {
      f.put("barrier/regeneration.json", changed); f.put("context.json", { ...f.context, barrier: changed });
      assert.throws(() => exportCalculatorRegenerationArtifact(f.root, { ...f.identity, barrierDigest: digest(changed) }, f.env), error);
    } else {
      if (form === "context") f.put("context.json", { ...f.context, barrier: { ...f.barrier, priorRunId: 777 } });
      if (form === "context-extra") f.put("context.json", { ...f.context, unsafe: true });
      if (form === "missing-barrier") unlinkSync(join(f.root, "barrier/regeneration.json"));
      if (form === "missing-context") unlinkSync(join(f.root, "context.json"));
      assert.throws(f.collect, error);
    }
    assert.equal(existsSync(f.destination), false);
  });
});

test("only explicitly allowlisted root evidence and JSON or empty lock files can be exported", async t => {
  for (const form of ["root-log", "root-directory", "other-goal-marker", "nested-source", "nonempty-lock", "temporary"]) await t.test(form, t => {
    const f = fixture(t);
    if (form === "root-log") writeFileSync(join(f.root, "runtime.log"), "private log", { mode: 0o600 });
    if (form === "root-directory") mkdirSync(join(f.root, "unexpected"), { mode: 0o700 });
    if (form === "other-goal-marker") writeFileSync(join(f.root, "calc-regeneration-other-goal.json"), "{}", { mode: 0o600 });
    if (form === "nested-source") writeFileSync(join(f.root, "state/source.mjs"), privateSource, { mode: 0o600 });
    if (form === "nonempty-lock") writeFileSync(join(f.root, "prior-state/old-task.lock"), "active", { mode: 0o600 });
    if (form === "temporary") writeFileSync(join(f.namespace, "task.execution.json.tmp.interrupted"), privateSource, { mode: 0o600 });
    assert.throws(f.collect, error); assert.equal(existsSync(f.destination), false);
  });
});

test("symlink ancestors, directories, files and hardlinks are refused without changing targets", async t => {
  for (const form of ["ancestor", "directory", "file", "context", "hardlink"]) await t.test(form, t => {
    const f = fixture(t); let call = f.collect;
    if (form === "ancestor") { const path = f.root + "-link"; symlinkSync(f.root, path, "dir"); t.after(() => unlinkSync(path)); call = () => exportCalculatorRegenerationArtifact(path, f.identity, f.env); }
    if (form === "directory") { const original = join(f.root, "prior-state"), moved = join(f.root, "state/moved-original"); renameSync(original, moved); symlinkSync(moved, original, "dir"); }
    if (form === "file") { unlinkSync(join(f.root, "prior-state/old-task.json")); symlinkSync(join(f.root, "context.json"), join(f.root, "prior-state/old-task.json")); }
    if (form === "context") { unlinkSync(join(f.root, "context.json")); symlinkSync(join(f.root, "barrier/regeneration.json"), join(f.root, "context.json")); }
    if (form === "hardlink") linkSync(join(f.root, "prior-state/old-task.json"), join(f.root, "state/linked.json"));
    assert.throws(call, error); assert.equal(existsSync(f.destination), false);
  });
});

test("all source directories and files must retain private permissions", async t => {
  for (const relative of ["", "state", "prior-state/old-task.json", "barrier/regeneration.json"]) await t.test(relative || "root", t => {
    const f = fixture(t), path = join(f.root, relative); chmodSync(path, lstatSync(path).isDirectory() ? 0o755 : 0o644);
    assert.throws(f.collect, error); assert.equal(existsSync(f.destination), false);
  });
});

test("raw and escaped GitHub and Groq secrets are refused even in damaged JSON", async t => {
  for (const token of ["ghp_" + "A".repeat(30), "gsk_" + "B".repeat(40), "ghs_" + "C".repeat(36)]) {
    for (const value of [token, JSON.stringify({ token }).replace(token[0]!, "\\u0067"), '{"token":"' + token.replace(token[0]!, "\\u0067")]) await t.test("credential", t => {
      const f = fixture(t); writeFileSync(join(f.root, "prior-state/old-task.json"), value, { mode: 0o600 });
      assert.throws(f.collect, error); assert.equal(existsSync(f.destination), false);
    });
  }
});

test("file, aggregate, count and depth limits refuse export without truncating old bytes", async t => {
  for (const form of ["file", "aggregate", "count", "depth"]) await t.test(form, t => {
    const f = fixture(t);
    if (form === "file") writeFileSync(join(f.root, "state/large.json"), "X".repeat(512 * 1024 + 1), { mode: 0o600 });
    if (form === "aggregate" || form === "count") for (let index = 0; index < (form === "aggregate" ? 17 : 256); index++)
      writeFileSync(join(f.root, "state", "file-" + index + ".json"), form === "aggregate" ? "X".repeat(512 * 1024) : "{}", { mode: 0o600 });
    if (form === "depth") { let path = join(f.root, "state"); for (let index = 0; index < 8; index++) { path = join(path, "nested"); mkdirSync(path, { mode: 0o700 }); } }
    assert.throws(f.collect, error); assert.equal(existsSync(f.destination), false);
    assert.equal(readFileSync(join(f.root, "prior-state/old-task.json"), "utf8"), oldReceipt);
  });
});

test("existing export or concurrent exporter lock cannot be overwritten", async t => {
  for (const form of ["destination", "lock"]) await t.test(form, t => {
    const f = fixture(t);
    if (form === "destination") { mkdirSync(f.destination, { mode: 0o700 }); writeFileSync(join(f.destination, "retained"), "retain", { mode: 0o600 }); }
    else writeFileSync(join(f.root, ".regeneration-artifact.lock"), "other-writer", { mode: 0o600 });
    assert.throws(f.collect, error);
    assert.equal(readFileSync(form === "destination" ? join(f.destination, "retained") : join(f.root, ".regeneration-artifact.lock"), "utf8"), form === "destination" ? "retain" : "other-writer");
  });
});

test("atomic publication fault preserves all prior evidence and leaves no uploadable partial output", t => {
  const f = fixture(t), realRename = fs.renameSync;
  try { fs.renameSync = () => { throw new Error("simulated archive publication failure"); }; syncBuiltinESMExports(); assert.throws(f.collect, error); }
  finally { fs.renameSync = realRename; syncBuiltinESMExports(); }
  assert.equal(existsSync(f.destination), false); assert.equal(existsSync(join(f.root, ".regeneration-artifact.lock")), false);
  assert.equal(readdirSync(f.root).some(name => name.startsWith(".regeneration-artifact.tmp.")), false);
  assert.equal(readFileSync(join(f.root, "prior-state/old-task.json"), "utf8"), oldReceipt); assert.equal(f.collect().status, "preserved");
});

test("source mutation while exporting prevents publication", t => {
  const f = fixture(t), realWrite = fs.writeFileSync; let injected = false;
  try {
    fs.writeFileSync = ((...args: unknown[]) => {
      const result = Reflect.apply(realWrite, fs, args);
      if (!injected && typeof args[0] === "number") { injected = true; realWrite(join(f.root, "barrier/regeneration.json"), "{}", { mode: 0o600 }); }
      return result;
    }) as typeof fs.writeFileSync;
    syncBuiltinESMExports(); assert.throws(f.collect, error);
  } finally { fs.writeFileSync = realWrite; syncBuiltinESMExports(); }
  assert.equal(injected, true); assert.equal(existsSync(f.destination), false);
});
