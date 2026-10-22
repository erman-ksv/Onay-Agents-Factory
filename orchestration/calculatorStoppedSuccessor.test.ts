import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { inspectCalculatorStoppedSuccessor, CALCULATOR_STOPPED_SUCCESSOR_PIN as PIN, CALCULATOR_STOPPED_SUCCESSOR_CHARGE as CHARGE,
  CALCULATOR_STOPPED_SUCCESSOR_TASK as TASK, CALCULATOR_STOPPED_SUCCESSOR_ERROR } from "./calculatorStoppedSuccessor.js";
import { createCalculatorExecutionCheckpointStore } from "./calculatorExecutionCheckpoint.js";
import { CALCULATOR_PUBLISHED_STATE_PIN as SOURCE } from "./calculatorPublishedTaskState.js";
import { createCalculatorSuccessorRequest } from "./calculatorSuccessor.js";
import { prepareCalculatorEventOrigin } from "./calculatorAfterCiEventState.js";
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const digest = (v: unknown) => hash(JSON.stringify(v));
const refusal = { message: CALCULATOR_STOPPED_SUCCESSOR_ERROR };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "stopped-successor-")), evidence = join(root, "evidence"); mkdirSync(evidence, { mode: 0o700 });
  const files = new Map<string, Buffer>();
  const put = (path: string, value: unknown) => {
    const full = join(evidence, path); mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
    const b = Buffer.from(JSON.stringify(value) + "\n"); writeFileSync(full, b, { mode: 0o600 }); files.set(path, b);
  };
  const origin = prepareCalculatorEventOrigin({ repository: "erman-ksv/Onay-Agents-Factory", workflowPath: ".github/workflows/calculator-after-ci-successor.yml",
    runId: PIN.runId, runAttempt: 1, eventSha: PIN.eventSha, runtimeSha: PIN.runtimeSha });
  const request = createCalculatorSuccessorRequest(PIN.runtimeSha);
  const transition = { version: 1, planFingerprint: SOURCE.planFingerprint, previousTaskId: SOURCE.taskId,
    candidateSha: SOURCE.candidateSha, expectedNextTaskId: TASK };
  put("context.json", { version: 1, origin, request, transition, admission: { manifestSha256: "a".repeat(64) } });
  put("barrier/remote.json", { artifactId: 12411024412, artifactDigest: "sha256:5239635c9ed62556c17c575b09f886f8fbcd294c640f0393526d13426cb90e77",
    manifestSha256: "a".repeat(64), origin });
  const receipt = { schemaVersion: 1, id: "calc-" + TASK, fingerprint: digest({ planFingerprint: SOURCE.planFingerprint, taskId: TASK }),
    status: "blocked", reasonCode: "execution_failed_no_replay", stages: [{ stage: "generate_1", status: "blocked" }] };
  put("state/calc-" + TASK + ".json", receipt);
  put("calculator-report.json", { status: "blocked", taskId: TASK, proposalTestsExecuted: false, candidateTestsExecuted: false, wholeAppCompleted: false, legalEnabled: false });
  const identity = { repository: "erman-ksv/Onay-Factory-Calculator", goalId: SOURCE.goalId, ownerFingerprint: "b".repeat(64),
    planFingerprint: SOURCE.planFingerprint, taskId: TASK, branch: "feat/calculator-agent/" + SOURCE.goalId,
    baseSha: SOURCE.candidateSha, bootstrapSha: "c".repeat(40), runtimeConfigDigest: "d".repeat(64) };
  const path = "execution-private/" + "d".repeat(64) + "/" + TASK + ".execution.json";
  mkdirSync(join(evidence, "execution-private"), { mode: 0o700 });
  const store = createCalculatorExecutionCheckpointStore(dirname(join(evidence, path)), identity);
  const payload = { attempt: 1 as const, stage: "generate_1", status: "running" as const, assessments: [],
    modelState: CHARGE, httpInFlight: true, publicationStarted: false };
  store.save(payload); store.save({ ...payload, status: "blocked" }); store.close(); files.set(path, readFileSync(join(evidence, path)));
  function manifest() {
    const entries = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, b]) => ({ path, bytes: b.length, sha256: hash(b) }));
    const m = { version: 1, kind: "calculator-one-successor-forensic", evidenceValidation: "unvalidated", files: entries,
      fileCount: files.size, totalBytes: entries.reduce((n, e) => n + e.bytes, 0), treeSha256: digest(entries),
      previousCharges: request.previousCharges, additionalAllowance: request.additionalAllowance, resumeAuthorized: false, budgetResetAuthorized: false };
    const text = JSON.stringify(m) + "\n"; writeFileSync(join(root, "manifest.json"), text, { mode: 0o600 });
    return { manifestSha256: hash(text), fileCount: m.fileCount, totalBytes: m.totalBytes };
  }
  return { root, evidence, files, put, manifest, receipt, path };
}
test("inspection validates every byte and checkpoint but never clears uncertainty, spends, or grants resume", () => {
  const f = fixture(); try {
    const pin = f.manifest(), before = readFileSync(join(f.evidence, f.path));
    const result = inspectCalculatorStoppedSuccessor(f.root, pin);
    assert.equal(result.taskId, TASK); assert.deepEqual(result.previousCharge, CHARGE);
    assert.equal(result.proposalAvailable, false); assert.equal(result.oldHttpInFlight, true);
    assert.equal(result.resumeAuthorized, false); assert.equal(result.budgetResetAuthorized, false);
    assert.deepEqual(readFileSync(join(f.evidence, f.path)), before);
    assert.equal(result.capsuleSha256, hash(before));
    assert.throws(() => inspectCalculatorStoppedSuccessor(f.root), refusal); // synthetic bytes cannot impersonate the production pin
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test("altered or extra evidence, links, unsafe permissions and secret data fail closed", async t => {
  for (const name of ["altered", "missing", "extra", "empty directory", "hardlink", "symlink", "permissions", "secret", "escaped secret"] as const) await t.test(name, () => {
    const f = fixture(); try {
      let pin = f.manifest(); const p = join(f.evidence, "calculator-report.json");
      if (name === "altered") writeFileSync(p, "{}\n");
      if (name === "missing") rmSync(p);
      if (name === "extra") writeFileSync(join(f.evidence, "extra.json"), "{}");
      if (name === "empty directory") mkdirSync(join(f.evidence, "unexpected"), { mode: 0o700 });
      if (name === "hardlink") linkSync(p, join(f.root, "outside.json"));
      if (name === "symlink") { rmSync(p); symlinkSync(join(f.evidence, "context.json"), p); }
      if (name === "permissions") chmodSync(p, 0o666);
      if (name === "secret" || name === "escaped secret") {
        const b = Buffer.from(name === "secret" ? JSON.stringify({ value: "gsk_" + "A".repeat(40) }) : '{"value":"\\u0067sk_' + "A".repeat(40) + '"}');
        writeFileSync(p, b); f.files.set("calculator-report.json", b); pin = f.manifest();
      }
      assert.throws(() => inspectCalculatorStoppedSuccessor(f.root, pin), refusal);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});
test("a self-consistent archive cannot erase costs, substitute a task, claim tests or publish a missing proposal", async t => {
  for (const name of ["wrong task", "published", "tests claimed", "changed charge", "in-flight cleared"] as const) await t.test(name, () => {
    const f = fixture(); try {
      if (name === "wrong task") { const c = JSON.parse(f.files.get("context.json")!.toString()); c.transition.expectedNextTaskId = "other-task"; f.put("context.json", c); }
      if (name === "published") f.put("state/calc-" + TASK + ".json", { ...f.receipt, publication: { headSha: "a".repeat(40) } });
      if (name === "tests claimed") { const r = JSON.parse(f.files.get("calculator-report.json")!.toString()); r.proposalTestsExecuted = true; f.put("calculator-report.json", r); }
      if (name === "changed charge" || name === "in-flight cleared") {
        const raw = JSON.parse(f.files.get(f.path)!.toString());
        raw.payload.modelState.attemptedRequests = name === "changed charge" ? 0 : 1;
        raw.payload.httpInFlight = name !== "in-flight cleared";
        // Even updating the outer manifest cannot forge the chained execution capsule.
        f.put(f.path, raw);
      }
      assert.throws(() => inspectCalculatorStoppedSuccessor(f.root, f.manifest()), refusal);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});
