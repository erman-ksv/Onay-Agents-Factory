import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { TeamTaskStore, parseTeamTaskSnapshotBytes } from "./teamTaskStore.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { calculatorAfterCiEventIdentity, prepareCalculatorAfterCiRequest, runCalculatorAfterCi } from "./calculatorAfterCi.js";
import { calculatorRuntimeAfterCiEventPath } from "./calculatorRuntime.js";
import { runCalculatorEventStateAudit } from "./calculatorEventStateAudit.js";
import { CALCULATOR_EVENT_STATE_ERROR, exportCalculatorAfterCiEventState, inspectCalculatorAfterCiEventState,
  restoreCalculatorAfterCiEventState, type CalculatorEventOrigin } from "./calculatorAfterCiEventState.js";
const saved = JSON.parse(readFileSync(new URL("./fixtures/calculatorStep7SavedPlan.json", import.meta.url), "utf8"));
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const request = prepareCalculatorAfterCiRequest({ version: 1, planFingerprint: saved.fingerprint,
  previousTaskId: saved.proposal.tasks[0].id, candidateSha: "b".repeat(40), expectedNextTaskId: saved.proposal.tasks[1].id });
const origin: CalculatorEventOrigin = { repository: "erman-ksv/Onay-Agents-Factory", workflowPath: ".github/workflows/calculator-event-state-audit.yml",
  runId: 123, runAttempt: 1, eventSha: "a".repeat(40), runtimeSha: "c".repeat(40) };
const refusal = { message: CALCULATOR_EVENT_STATE_ERROR };
function fixture(status: "running" | "blocked" | "lock-only" = "blocked") {
  const root = mkdtempSync(join(tmpdir(), "calculator-event-transfer-")), source = join(root, "source"), artifact = join(root, "artifact");
  mkdirSync(source, { mode: 0o700 }); const key = calculatorAfterCiEventIdentity(request);
  let store: TeamTaskStore | undefined;
  if (status === "lock-only") writeFileSync(join(source, key.id + ".lock"), "", { mode: 0o600 });
  else {
    store = new TeamTaskStore(source, key); store.claim(); store.recordStage("execute_next_task", "running");
    if (status === "blocked") { store.recordStage("execute_next_task", "blocked"); store.finish("blocked", "simulated_transport_audit_no_model"); store.close(); store = undefined; }
  }
  const exported = exportCalculatorAfterCiEventState(source, artifact, request, origin);
  return { root, source, artifact, key, exported, expected: { request, origin, manifestSha256: exported.manifestSha256 },
    cleanup: () => { store?.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("event identity survives relocation and binds the successor without using CI run IDs", () => {
  const key = calculatorAfterCiEventIdentity(request), changed = calculatorAfterCiEventIdentity({ ...request, expectedNextTaskId: saved.proposal.tasks[2].id });
  assert.equal(key.id, changed.id); assert.notEqual(key.fingerprint, changed.fingerprint);
  assert.notEqual(calculatorRuntimeAfterCiEventPath("/tmp/worker-a/state"), calculatorRuntimeAfterCiEventPath("/tmp/worker-b/state"));
  assert.throws(() => calculatorRuntimeAfterCiEventPath("state"));
});

test("blocked, running and receipt-less crash locks survive transport and still prevent claims", async t => {
  for (const status of ["blocked", "running", "lock-only"] as const) await t.test(status, () => {
    const f = fixture(status);
    try {
      const original = readdirSync(f.source).map(name => [name, readFileSync(join(f.source, name))] as const);
      const cap = inspectCalculatorAfterCiEventState(f.artifact, f.expected), dest = join(f.root, "restored");
      restoreCalculatorAfterCiEventState(cap, dest);
      assert.equal(cap.consumed, true); assert.equal(cap.resumeAuthorized, false); assert.equal(cap.budgetResetAuthorized, false);
      for (const [name, bytes] of original) {
        assert.deepEqual(readFileSync(join(dest, name)), bytes); assert.deepEqual(readFileSync(join(f.source, name)), bytes);
        assert.equal(lstatSync(join(dest, name)).mode & 0o777, 0o600);
      }
      const probe = new TeamTaskStore(dest, f.key);
      try {
        assert.ok(probe.inspectExisting() || probe.inspectExistingLock());
        if (cap.lockPresent) assert.throws(() => probe.claim()); else assert.equal(probe.claim(), "already-recorded");
      } finally { probe.close(); }
      assert.throws(() => restoreCalculatorAfterCiEventState(cap, dest), refusal);
      const empty = join(f.root, "existing"); mkdirSync(empty, { mode: 0o700 });
      assert.throws(() => restoreCalculatorAfterCiEventState(cap, empty), refusal); assert.deepEqual(readdirSync(empty), []);
      assert.throws(() => restoreCalculatorAfterCiEventState({ ...cap }, join(f.root, "forged")), refusal);
      assert.equal(existsSync(join(f.root, "forged")), false);
    } finally { f.cleanup(); }
  });
});

test("a separate worker's restored event stops the real controller before CI, dependencies or any model", async t => {
  for (const status of ["blocked", "lock-only"] as const) await t.test(status, async () => {
    const f = fixture(status);
    try {
      const root = join(f.root, "worker-b"); mkdirSync(root, { mode: 0o700 });
      const metadata = join(root, "metadata"); mkdirSync(metadata, { mode: 0o700 });
      const planStore = new CalculatorPlanStore(metadata, saved.request);
      planStore.initialize(saved.proposal);
      const eventPath = calculatorRuntimeAfterCiEventPath(metadata); mkdirSync(dirname(eventPath), { recursive: true, mode: 0o700 });
      restoreCalculatorAfterCiEventState(inspectCalculatorAfterCiEventState(f.artifact, f.expected), eventPath);
      let calls = 0; const forbidden = async (): Promise<never> => { calls++; throw Error("No tool may run after a consumed event"); };
      const report = await runCalculatorAfterCi(planStore, { getHead: forbidden, readCommit: forbidden, readTree: forbidden, readBlob: forbidden }, request,
        { eventDirectory: eventPath, ci: forbidden, verifyDependencies: forbidden,
          execution: { execution: "offline-test", maxRepairs: 0, team: { generate: forbidden, repair: forbidden, assess: forbidden },
            tools: { ci: forbidden, publish: forbidden, checkProposal: forbidden } } });
      assert.equal(report.reasonCode, "after_ci_event_already_recorded_no_replay"); assert.equal(calls, 0);
    } finally { f.cleanup(); }
  });
});

test("downloaded artifact permissions are accepted as data and restored files become private", () => {
  const f = fixture();
  try {
    chmodSync(f.artifact, 0o755); chmodSync(join(f.artifact, "state"), 0o755); chmodSync(join(f.artifact, "manifest.json"), 0o644);
    chmodSync(join(f.artifact, "state", f.key.id + ".json"), 0o644);
    const dest = join(f.root, "restored"); restoreCalculatorAfterCiEventState(inspectCalculatorAfterCiEventState(f.artifact, f.expected), dest);
    assert.equal(lstatSync(dest).mode & 0o777, 0o700); assert.equal(lstatSync(join(dest, f.key.id + ".json")).mode & 0o777, 0o600);
  } finally { f.cleanup(); }
});

test("changed artifact, provenance, candidate, successor, links and unlisted files are refused", async t => {
  const cases: Array<[string, (f: ReturnType<typeof fixture>) => void]> = [
    ["wrong hash", f => { f.expected.manifestSha256 = "a".repeat(64); }],
    ["wrong run", f => { f.expected = { ...f.expected, origin: { ...origin, runId: 999 } }; }],
    ["wrong SHA", f => { f.expected = { ...f.expected, origin: { ...origin, eventSha: "d".repeat(40) } }; }],
    ["wrong candidate", f => { f.expected = { ...f.expected, request: { ...request, candidateSha: "d".repeat(40) } }; }],
    ["wrong successor", f => { f.expected = { ...f.expected, request: { ...request, expectedNextTaskId: saved.proposal.tasks[2].id } }; }],
    ["changed bytes", f => { writeFileSync(join(f.artifact, "state", f.key.id + ".json"), "{}"); }],
    ["missing receipt", f => { unlinkSync(join(f.artifact, "state", f.key.id + ".json")); }],
    ["unlisted", f => { writeFileSync(join(f.artifact, "state", "extra.json"), "{}"); }],
    ["unsafe mode", f => { chmodSync(join(f.artifact, "state", f.key.id + ".json"), 0o666); }],
    ["hardlink", f => { linkSync(join(f.artifact, "state", f.key.id + ".json"), join(f.root, "link")); }],
    ["symlink", f => { const path = join(f.artifact, "state", f.key.id + ".json"), target = join(f.root, "original.json");
      writeFileSync(target, readFileSync(path)); unlinkSync(path); symlinkSync(target, path); }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const f = fixture(); try { mutate(f); assert.throws(() => inspectCalculatorAfterCiEventState(f.artifact, f.expected), refusal); } finally { f.cleanup(); }
  });
});

test("self-consistent artifact bytes cannot smuggle another receipt identity or a nonempty lock", async t => {
  for (const name of ["receipt", "lock"] as const) await t.test(name, () => {
    const f = fixture(name === "lock" ? "lock-only" : "blocked");
    try {
      const file = join(f.artifact, "state", f.key.id + (name === "lock" ? ".lock" : ".json"));
      if (name === "lock") writeFileSync(file, "uncertain");
      else { const json = JSON.parse(readFileSync(file, "utf8")); json.fingerprint = "a".repeat(64); writeFileSync(file, JSON.stringify(json)); }
      const manifestPath = join(f.artifact, "manifest.json"), manifest = JSON.parse(readFileSync(manifestPath, "utf8")), bytes = readFileSync(file);
      manifest.files[0].bytes = bytes.length; manifest.files[0].sha256 = hash(bytes); manifest.totalBytes = bytes.length;
      const raw = JSON.stringify(manifest) + "\n"; writeFileSync(manifestPath, raw);
      assert.throws(() => inspectCalculatorAfterCiEventState(f.artifact, { ...f.expected, manifestSha256: hash(raw) }), refusal);
    } finally { f.cleanup(); }
  });
});

test("missing, empty and foreign event state cannot be exported as a new admission", () => {
  const f = fixture();
  try {
    const empty = join(f.root, "empty"); mkdirSync(empty, { mode: 0o700 });
    assert.throws(() => exportCalculatorAfterCiEventState(empty, join(f.root, "empty-export"), request, origin), refusal);
    assert.equal(existsSync(join(f.root, "empty-export")), false);
    writeFileSync(join(f.source, "foreign.json"), "{}", { mode: 0o600 });
    assert.throws(() => exportCalculatorAfterCiEventState(f.source, join(f.root, "foreign-export"), request, origin), refusal);
    assert.equal(existsSync(join(f.root, "foreign-export")), false);
    assert.throws(() => parseTeamTaskSnapshotBytes(Buffer.from("{}"), f.key));
  } finally { f.cleanup(); }
});

test("two-worker audit harness restores the uploaded bytes and blocks the controller without production execution", async () => {
  const root = mkdtempSync(join(tmpdir(), "calculator-event-audit-"));
  const env = { GITHUB_REPOSITORY: origin.repository, GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feat/calculator-event-state-20261022",
    GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: String(origin.runId), GITHUB_SHA: origin.eventSha };
  try {
    const first = join(root, "worker-a"), second = join(root, "worker-b");
    const exported = await runCalculatorEventStateAudit(["export", first], env); mkdirSync(second, { mode: 0o700 });
    cpSync(join(first, "artifact"), join(second, "incoming"), { recursive: true });
    const restored = await runCalculatorEventStateAudit(["restore", second], { ...env, EXPECTED_EVENT_MANIFEST_SHA256: exported.manifestSha256 });
    assert.equal(restored.status, "event-barrier-restored-replay-blocked"); assert.equal(restored.productionTaskExecuted, false);
    assert.equal(restored.modelsRun, false); assert.equal("toolsCalled" in restored && restored.toolsCalled, 0);
    assert.equal(restored.transportAuditOnly, true);
    await assert.rejects(() => runCalculatorEventStateAudit(["restore", second], { ...env, GITHUB_RUN_ATTEMPT: "2" }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("artifact transport workflow uses a trusted prior job digest and separate workers without model credentials", () => {
  const workflow = readFileSync(new URL("../.github/workflows/calculator-event-state-audit.yml", import.meta.url), "utf8");
  assert.equal((workflow.match(/runs-on: ubuntu-latest/g) ?? []).length, 2); assert.ok(workflow.includes("needs: preserve"));
  assert.ok(workflow.includes("${{ needs.preserve.outputs.manifest_sha256 }}"));
  assert.ok(workflow.includes("overwrite: false")); assert.ok(workflow.includes("ref: ${{ github.sha }}"));
  for (const forbidden of ["GROQ_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "contents: write", "actions: write", "secrets.", "pull_request_target"])
    assert.ok(!workflow.includes(forbidden), forbidden);
});
