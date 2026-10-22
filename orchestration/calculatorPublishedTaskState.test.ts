import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { prepareCalculatorRoleChanges, validateCalculatorAssessment } from "../commander/calculatorTeam.js";
import { loadCalculatorSnapshot, type CalculatorSnapshotReader } from "../github/calculatorSnapshot.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { createCalculatorExecutionCheckpointStore, parseCalculatorExecutionCheckpointBytes } from "./calculatorExecutionCheckpoint.js";
import { calculatorProposalDigest, type CalculatorProposalTests } from "./calculatorExecutionEvidence.js";
import { CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES, CALCULATOR_FINAL_TESTER_ALLOWANCE } from "./calculatorStep7FinalTester.js";
import { CALCULATOR_PUBLISHED_STATE_ERROR, CALCULATOR_PUBLISHED_STATE_PIN, inspectCalculatorPublishedTaskState,
  restoreCalculatorPublishedTaskState, createCalculatorPublishedDependencyRunner, type CalculatorPublishedStatePin } from "./calculatorPublishedTaskState.js";
const saved = JSON.parse(readFileSync(new URL("./fixtures/calculatorStep7SavedPlan.json", import.meta.url), "utf8"));
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const gitBlob = (value: string) => createHash("sha1").update("blob " + Buffer.byteLength(value) + "\0" + value).digest("hex");
const B = "b".repeat(40), D = "d".repeat(40), refusal = { message: CALCULATOR_PUBLISHED_STATE_ERROR };
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "calculator-published-state-")), archive = join(root, "archive"), evidence = join(archive, "evidence");
  mkdirSync(evidence, { recursive: true, mode: 0o700 }); chmodSync(archive, 0o700);
  const state = join(evidence, "state"); mkdirSync(state, { mode: 0o700 });
  const store = new CalculatorPlanStore(state, saved.request), plan = store.initialize(saved.proposal), task = plan.tasks[0]!;
  const sources = new Map([["src/calculator.mjs", "export const add = (a, b) => a + b;\n"], ["test/calculator.test.mjs", "export const checked = true;\n"]]);
  let head = B, tests = 0;
  const reader: CalculatorSnapshotReader = {
    getHead: async ref => ref === plan.owner.baseSha ? plan.owner.baseSha : head,
    readCommit: async sha => ({ sha, treeSha: sha, parents: sha === plan.owner.baseSha ? [] : [plan.owner.baseSha] }),
    readTree: async sha => ({ sha, truncated: false, tree: sha === plan.owner.baseSha ? [] : [
      { path: "src", sha: D, type: "tree", mode: "040000" }, { path: "test", sha: D, type: "tree", mode: "040000" },
      ...[...sources].map(([path, content]) => ({ path, sha: gitBlob(content), type: "blob", mode: "100644" }))] }),
    readBlob: async sha => ({ sha, encoding: "base64", content: Buffer.from([...sources.values()].find(v => gitBlob(v) === sha)!).toString("base64") }),
  };
  const original = await loadCalculatorSnapshot({ repository: plan.owner.repository, baseRef: plan.branch, baseSha: plan.owner.baseSha, changePaths: task.paths },
    { ...reader, getHead: async () => plan.owner.baseSha });
  const proposal = prepareCalculatorRoleChanges("coder", { summary: "Create scoped arithmetic modules", changes: [...sources].map(([path, content]) =>
    ({ operation: "create", path, content, message: "Add scoped module" })) }, original);
  const identity = { repository: plan.owner.repository, goalId: plan.owner.id, ownerFingerprint: plan.owner.ownerFingerprint,
    planFingerprint: plan.fingerprint, taskId: task.id, branch: plan.branch, baseSha: plan.owner.baseSha, bootstrapSha: plan.owner.baseSha, runtimeConfigDigest: "f".repeat(64) };
  const capsuleDir = join(evidence, "execution-private", "f".repeat(64)); mkdirSync(dirname(capsuleDir), { mode: 0o700 });
  const checkpoints = createCalculatorExecutionCheckpointStore(capsuleDir, identity);
  const assessments = (["security", "reviewer", "tester"] as const).map(role => validateCalculatorAssessment(role,
    { ready: true, summary: "Scoped saved assessment", findings: [], unverifiedAreas: [] }, ["changes@" + plan.owner.baseSha]));
  const modelState = { attemptedRequests: 1, totalRequestBytes: 500, reservedRunTokens: 2200, elapsedMs: 900 };
  checkpoints.save({ attempt: 1, stage: "restore_proposal_1", status: "passed", proposal, assessments: [], modelState, httpInFlight: false, publicationStarted: false });
  for (let i = 0; i < 3; i++) checkpoints.save({ attempt: 1, stage: ["restore_security_1", "restore_reviewer_1", "tester_1"][i]!, status: "passed", proposal,
    assessments: assessments.slice(0, i + 1), modelState, httpInFlight: false, publicationStarted: false });
  checkpoints.save({ attempt: 1, stage: "execution_complete", status: "passed", proposal, assessments, modelState, httpInFlight: false, publicationStarted: true });
  checkpoints.close();
  const receipt = store.taskReceipt(plan, task); receipt.claim();
  for (const stage of ["load_current_source", "restore_proposal_1", "restore_security_1", "restore_reviewer_1", "tester_1", "host_tests_1", "publish_candidate", "verify_candidate_ci"]) {
    receipt.recordStage(stage, "running"); receipt.recordStage(stage, "passed");
  }
  receipt.recordPublication({ branch: plan.branch, headSha: B, number: 1, url: "https://github.com/" + plan.owner.repository + "/pull/1" });
  receipt.finish("needs-review", "candidate_ci_pending_no_polling"); receipt.close();
  writeFileSync(join(evidence, "context.json"), JSON.stringify({ request: { request: { version: 1, mode: "run", factorySha: "a".repeat(40),
    freeTierConfirmed: true, goal: saved.request, config: { version: 1, sandboxImage: "node@sha256:" + "a".repeat(64),
      trustedWorkflows: [{ id: 9, path: ".github/workflows/calculator-task-ci.yml", blobSha: D }] } } } }), { mode: 0o600 });
  const paths: string[] = [];
  function walk(path: string, prefix: string) { for (const name of readdirSync(path)) {
    const next = join(path, name), relative = prefix ? prefix + "/" + name : name;
    if (lstatSync(next).isDirectory()) walk(next, relative); else paths.push(relative);
  } }
  walk(evidence, ""); paths.sort((a, b) => a.localeCompare(b));
  function rebuildManifest(): CalculatorPublishedStatePin {
    const files = paths.map(path => { const bytes = readFileSync(join(evidence, path)); return { path, bytes: bytes.length, sha256: hash(bytes), kind: path.endsWith(".lock") ? "stale-lock" : "json" }; });
    const barrier = { runId: CALCULATOR_PUBLISHED_STATE_PIN.runId, eventSha: CALCULATOR_PUBLISHED_STATE_PIN.eventSha,
      runtimeSha: CALCULATOR_PUBLISHED_STATE_PIN.runtimeSha, goalId: plan.owner.id, taskId: task.id, planFingerprint: plan.fingerprint,
      proposalDigest: calculatorProposalDigest(proposal), historicalCharges: CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES, additionalAllowance: CALCULATOR_FINAL_TESTER_ALLOWANCE };
    const manifest = { version: 1, kind: "calculator-final-tester-forensic", evidenceValidation: "unvalidated", barrier,
      barrierDigest: hash(JSON.stringify(barrier)), files, fileCount: files.length, totalBytes: files.reduce((n, f) => n + f.bytes, 0),
      treeSha256: hash(JSON.stringify(files)), historicalCharges: CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES,
      additionalAllowance: CALCULATOR_FINAL_TESTER_ALLOWANCE, resumeAuthorized: false, budgetResetAuthorized: false, coderRegenerationAuthorized: false };
    const bytes = Buffer.from(JSON.stringify(manifest) + "\n"); writeFileSync(join(archive, "manifest.json"), bytes, { mode: 0o600 });
    return { ...CALCULATOR_PUBLISHED_STATE_PIN, manifestSha256: hash(bytes), candidateSha: B, proposalDigest: calculatorProposalDigest(proposal), fileCount: files.length, totalBytes: manifest.totalBytes };
  }
  const pin = rebuildManifest(), capsule = join(capsuleDir, task.id + ".execution.json");
  const input = { repository: plan.owner.repository, planFingerprint: plan.fingerprint, task, candidateSha: B, currentSha: B, changedSinceCandidate: [] };
  const check = async ({ changes, proposalDigest }: { changes: { baseSha: string }; proposalDigest: string }): Promise<CalculatorProposalTests> => {
    tests++; return { repository: plan.owner.repository, taskId: task.id, baseSha: changes.baseSha, proposalDigest, status: "passed", testsExecuted: true, failures: [] };
  };
  return { root, archive, evidence, state, plan, task, reader, sources, capsule, identity, pin, paths, rebuildManifest, input, check,
    counts: () => tests, move: (sha: string) => { head = sha; }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("authenticated archive preserves all charges and three approvals; restoration copies exact receipts once", async () => {
  const f = await fixture();
  try {
    const files = f.paths.map(path => [path, readFileSync(join(f.evidence, path)).toString("hex")] as const);
    const state = inspectCalculatorPublishedTaskState(f.archive, f.pin);
    assert.deepEqual(state.completedRoles, ["security", "reviewer", "tester"]); assert.equal(state.completedTaskCharge.reservedRunTokens, 2200);
    assert.deepEqual(state.historicalCharges, CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES);
    assert.equal(state.resumeAuthorized, false); assert.equal(state.budgetResetAuthorized, false);
    assert.ok(!JSON.stringify(state).includes("export const"));
    const destination = join(f.root, "restored"); restoreCalculatorPublishedTaskState(state, destination);
    assert.equal(lstatSync(destination).mode & 0o777, 0o700);
    for (const name of readdirSync(f.state)) {
      assert.deepEqual(readFileSync(join(destination, name)), readFileSync(join(f.state, name)));
      assert.equal(lstatSync(join(destination, name)).mode & 0o777, 0o600);
    }
    assert.throws(() => restoreCalculatorPublishedTaskState(state, destination), refusal);
    const existing = join(f.root, "empty-existing"); mkdirSync(existing, { mode: 0o700 });
    assert.throws(() => restoreCalculatorPublishedTaskState(state, existing), refusal); assert.deepEqual(readdirSync(existing), []);
    for (const [path, bytes] of files) assert.equal(readFileSync(join(f.evidence, path)).toString("hex"), bytes);
    const copy = { ...state };
    assert.throws(() => restoreCalculatorPublishedTaskState(copy, join(f.root, "forged")), refusal);
    assert.equal(existsSync(join(f.root, "forged")), false);
  } finally { f.cleanup(); }
});

test("the read-only capsule parser validates every history link without creating or touching locks", async () => {
  const f = await fixture();
  try {
    const before = readdirSync(dirname(f.capsule)), bytes = readFileSync(f.capsule);
    assert.equal(parseCalculatorExecutionCheckpointBytes(bytes, f.identity, hash(bytes)).data.payload.assessments.length, 3);
    assert.deepEqual(readdirSync(dirname(f.capsule)), before);
    const changed = JSON.parse(bytes.toString()); changed.history[0].payload.modelState.reservedRunTokens++;
    assert.throws(() => parseCalculatorExecutionCheckpointBytes(Buffer.from(JSON.stringify(changed)), f.identity));
    assert.throws(() => parseCalculatorExecutionCheckpointBytes(bytes, { ...f.identity, runtimeConfigDigest: "a".repeat(64) }));
    assert.throws(() => parseCalculatorExecutionCheckpointBytes(bytes, f.identity, "a".repeat(64)));
  } finally { f.cleanup(); }
});

test("corrupt, unexpected, linked, unsafe or incomplete evidence never restores state", async t => {
  const cases: Array<[string, (f: Awaited<ReturnType<typeof fixture>>) => void]> = [
    ["changed bytes", f => writeFileSync(f.capsule, "{}")],
    ["changed manifest", f => writeFileSync(join(f.archive, "manifest.json"), "{}")],
    ["unlisted file", f => writeFileSync(join(f.evidence, "extra.json"), "{}")],
    ["root extra", f => writeFileSync(join(f.archive, "extra.json"), "{}")],
    ["missing file", f => unlinkSync(f.capsule)],
    ["unsafe permissions", f => chmodSync(f.capsule, 0o666)],
    ["hardlink", f => linkSync(f.capsule, join(f.root, "linked.json"))],
    ["symlink", f => { const bytes = readFileSync(f.capsule); unlinkSync(f.capsule); writeFileSync(join(f.root, "target.json"), bytes); symlinkSync(join(f.root, "target.json"), f.capsule); }],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const f = await fixture(); try { mutate(f); assert.throws(() => inspectCalculatorPublishedTaskState(f.archive, f.pin), refusal); } finally { f.cleanup(); }
  });
});

test("authenticated bytes still need correct identity, canonical approvals, terminal publication and monotonic history", async t => {
  for (const name of ["in-flight", "not-published", "wrong-role", "unready", "altered-disclosure", "wrong-status", "rewritten-history", "wrong-charge"]) await t.test(name, async () => {
    const f = await fixture();
    try {
      const data = JSON.parse(readFileSync(f.capsule, "utf8"));
      if (name === "in-flight") data.payload.httpInFlight = true;
      if (name === "not-published") data.payload.publicationStarted = false;
      if (name === "wrong-role") data.payload.assessments[2].role = "reviewer";
      if (name === "unready") data.payload.assessments[2].ready = false;
      if (name === "altered-disclosure") data.payload.assessments[2].unverifiedAreas = ["Claims approved"];
      if (name === "wrong-status") data.payload.status = "blocked";
      if (name === "rewritten-history") data.history[0].payload.modelState.reservedRunTokens++;
      if (name === "wrong-charge") data.payload.modelState.attemptedRequests = 2;
      const { integritySha256: _old, ...unsigned } = data; data.integritySha256 = hash(JSON.stringify(unsigned));
      writeFileSync(f.capsule, JSON.stringify(data)); const pin = f.rebuildManifest();
      assert.throws(() => inspectCalculatorPublishedTaskState(f.archive, pin), refusal);
    } finally { f.cleanup(); }
  });
});

test("a dependency gets current host-test proof without any former agent requests", async () => {
  const f = await fixture();
  try {
    const cap = inspectCalculatorPublishedTaskState(f.archive, f.pin), runner = createCalculatorPublishedDependencyRunner(cap, f.reader, f.check);
    const proof = await runner(f.input); assert.equal(proof?.testsExecuted, true); assert.equal(proof?.securityReady, true); assert.equal(f.counts(), 1);
    assert.throws(() => createCalculatorPublishedDependencyRunner({ ...cap }, f.reader, f.check), refusal);
  } finally { f.cleanup(); }
});

test("missing host-test receipt, changed publication and plan marker cannot be imported", async t => {
  for (const name of ["receipt", "publication", "marker"]) await t.test(name, async () => {
    const f = await fixture();
    try {
      const path = join(f.state, name === "marker" ? "calc-plan-" + f.plan.owner.id + ".json" : "calc-" + f.task.id + ".json");
      const data = JSON.parse(readFileSync(path, "utf8"));
      if (name === "receipt") data.stages = data.stages.filter((s: { stage: string }) => s.stage !== "host_tests_1");
      if (name === "publication") data.publication.headSha = D;
      if (name === "marker") data.reasonCode = "fabricated";
      writeFileSync(path, JSON.stringify(data)); assert.throws(() => inspectCalculatorPublishedTaskState(f.archive, f.rebuildManifest()), refusal);
    } finally { f.cleanup(); }
  });
});

test("live archive workflow has fixed provenance, no model keys and executes source only through the host sandbox", () => {
  const workflow = readFileSync(new URL("../.github/workflows/calculator-published-state-audit.yml", import.meta.url), "utf8");
  assert.ok(workflow.includes("ref: ${{ github.sha }}")); assert.ok(workflow.includes("persist-credentials: false"));
  assert.ok(workflow.includes("contents: read")); assert.ok(workflow.includes("actions: read"));
  assert.ok(workflow.includes("artifact-ids: '12350008132'")); assert.ok(workflow.includes("run-id: 39609923862"));
  assert.ok(workflow.includes(CALCULATOR_PUBLISHED_STATE_PIN.artifactDigest));
  assert.ok(workflow.includes("--check-current --restore"));
  for (const forbidden of ["GROQ_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "contents: write", "actions: write", "workflow_dispatch", "AGENT_FACTORY_ENABLE_GITHUB_WRITES"])
    assert.ok(!workflow.includes(forbidden), forbidden);
});

test("changed source, stale SHA and missing current tests cannot reuse archived approvals", async t => {
  for (const name of ["stale", "different-task", "changed-since", "source", "tests-unverified", "head-during-test"]) await t.test(name, async () => {
    const f = await fixture();
    try {
      const cap = inspectCalculatorPublishedTaskState(f.archive, f.pin);
      if (name === "stale") f.move(D);
      if (name === "source") f.sources.set("src/calculator.mjs", "export const changed = true;\n");
      const runner = createCalculatorPublishedDependencyRunner(cap, f.reader, async input => {
        const checked = await f.check(input); if (name === "head-during-test") f.move(D);
        return name === "tests-unverified" ? { ...checked, status: "unverified", testsExecuted: false } : checked;
      });
      const input = { ...f.input, ...(name === "different-task" ? { task: f.plan.tasks[1] } : {}), ...(name === "changed-since" ? { changedSinceCandidate: ["src/calculator.mjs"] } : {}) };
      assert.equal(await runner(input), undefined);
      if (!["tests-unverified", "head-during-test"].includes(name)) assert.equal(f.counts(), 0);
    } finally { f.cleanup(); }
  });
});
