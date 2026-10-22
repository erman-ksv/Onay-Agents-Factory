import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderCalculatorRegenerationWorkflow } from "../config/calculatorRegenerationWorkflow.js";
import { createCalculatorPlan } from "./calculatorPlan.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import type { runCalculatorRuntime } from "./calculatorRuntime.js";
import { CALCULATOR_REGENERATION_ERROR, createCalculatorRegenerationRequest,
  validateCalculatorRegenerationRequest, validateCalculatorRegenerationPrior,
  verifyCalculatorRegenerationHistory, runCalculatorStep7Regeneration } from "./calculatorStep7Regeneration.js";

const runtimeSha = "c".repeat(40), eventSha = "a".repeat(40), treeSha = "b".repeat(40);
const repository = "erman-ksv/Onay-Agents-Factory";
const branch = "feat/calculator-step7-regeneration-20261020";
const path = ".github/workflows/calculator-step7-regeneration.yml";
const requestPath = ".factory/calculator-step7-regeneration-request.json";
const oldEvent = "666ae4a559396e57bcb8e713d29087967b5fb821";
const priorEvent = "988bed450daf80e0e9602a0b8ddd3fb1f2771bd6";
const blob = (value: string) => createHash("sha1").update("blob " + Buffer.byteLength(value) + "\0" + value).digest("hex");
const clone = <T>(value: T): T => structuredClone(value);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const refused = (error: unknown) => error instanceof Error && error.message === CALCULATOR_REGENERATION_ERROR;
const env = { GITHUB_TOKEN: "fixture-token", GITHUB_REPOSITORY: repository,
  GITHUB_REF: "refs/heads/" + branch, GITHUB_EVENT_NAME: "push", GITHUB_RUN_ATTEMPT: "1",
  GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ID: "123", GITHUB_SHA: eventSha };

test("regeneration retains the exact original task and separately accounts sealed old usage and a bounded new allowance", () => {
  const request = createCalculatorRegenerationRequest(runtimeSha);
  assert.deepEqual(validateCalculatorRegenerationRequest(request, runtimeSha), request);
  assert.equal(request.approval, "ONE_REGENERATION_AFTER_LOST_PROPOSAL");
  assert.equal(request.request.goal.id, "calculator-pilot-step7-v1");
  assert.equal(request.taskId, "calculator-pilot-step7-v1-34ee03-t01");
  assert.equal(request.planFingerprint, "1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2");
  assert.equal(request.request.goal.baseSha, "2c1218f2b020962ad93adf68d902a847271a7e72");
  assert.deepEqual(request.oldCharge, { attemptedRequests: 2, totalRequestBytes: 48000, reservedRunTokens: 16000, elapsedMs: 120000 });
  assert.deepEqual(request.planningCharge, { reservedRunTokens: 13855 });
  assert.deepEqual(request.additionalAllowance, { maxRequests: 4, maxRunBytes: 96000, maxRunTokens: 16000,
    maxOutputTokens: 1200, wallTimeMs: 120000, maxRepairs: 0 });
  assert.equal(request.priorRunId, 39448498604);
  assert.equal(request.priorStateArtifactId, 12276359076);
  assert.equal(request.priorBarrierArtifactId, 12275614858);
});

test("request validation refuses authority, identity, resource and unknown-field drift", async t => {
  const changes: Record<string, (request: any) => void> = {
    approval: request => { request.approval = "retry"; },
    version: request => { request.version = 2; },
    runtime: request => { request.runtimeSha = "d".repeat(40); },
    goal: request => { request.request.goal.id = "new-goal"; },
    task: request => { request.taskId = "calculator-pilot-step7-v1-34ee03-t02"; },
    plan: request => { request.planFingerprint = "0".repeat(64); },
    source: request => { request.request.goal.baseSha = "e".repeat(40); },
    provider: request => { request.request.goal.provider = "gemini"; },
    route: request => { request.request.config.trustedWorkflows[0].blobSha = "e".repeat(40); },
    old_run: request => { request.priorRunId++; },
    state_artifact: request => { request.priorStateArtifactId++; },
    barrier_artifact: request => { request.priorBarrierArtifactId++; },
    refund_old: request => { request.oldCharge.reservedRunTokens = 0; },
    refund_planning: request => { request.planningCharge.reservedRunTokens = 0; },
    more_requests: request => { request.additionalAllowance.maxRequests = 5; },
    more_bytes: request => { request.additionalAllowance.maxRunBytes++; },
    more_tokens: request => { request.additionalAllowance.maxRunTokens++; },
    more_time: request => { request.additionalAllowance.wallTimeMs++; },
    repair: request => { request.additionalAllowance.maxRepairs = 1; },
    unknown: request => { request.resumeAuthorized = true; },
    nested_unknown: request => { request.additionalAllowance.ignoreBudget = true; },
  };
  for (const [name, mutate] of Object.entries(changes)) await t.test(name, () => {
    const request: any = clone(createCalculatorRegenerationRequest(runtimeSha)); mutate(request);
    assert.throws(() => validateCalculatorRegenerationRequest(request, runtimeSha), refused);
  });
  for (const value of [undefined, null, [], "approved"]) assert.throws(() => validateCalculatorRegenerationRequest(value, runtimeSha), refused);
  assert.throws(() => createCalculatorRegenerationRequest("main"), refused);
});

type HistoryMutator = (endpoint: string, data: any, count: number) => any;
function history(mutate: HistoryMutator = (_endpoint, data) => data) {
  const request = createCalculatorRegenerationRequest(runtimeSha), requestText = JSON.stringify(request, null, 2) + "\n";
  const requestSha = blob(requestText), workflowSha = blob(renderCalculatorRegenerationWorkflow(runtimeSha, request.request.config.sandboxImage));
  const calls: string[] = [], counts = new Map<string, number>();
  const common = { event: "push", run_attempt: 1, repository: { full_name: repository }, head_repository: { full_name: repository } };
  const current = { ...common, id: 123, run_number: 1, workflow_id: 10, head_branch: branch, path, head_sha: eventSha, status: "in_progress", conclusion: null };
  const old = { ...common, id: 39448498604, run_number: 2, workflow_id: 11, head_branch: "feat/onay-task-runner-20261019",
    path: ".github/workflows/calculator-step7-recovery.yml", head_sha: oldEvent, status: "completed", conclusion: "failure", updated_at: "2026-01-01T00:00:00Z" };
  const previous = { ...old, id: 39446900969, run_number: 1, head_sha: priorEvent };
  const transport: typeof fetch = async (url, init) => {
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
    const target = new URL(String(url)); assert.equal(target.origin, "https://api.github.com");
    const endpoint = target.pathname.slice(("/repos/" + repository).length) + target.search;
    calls.push(endpoint); const count = (counts.get(endpoint) ?? 0) + 1; counts.set(endpoint, count);
    let data: any;
    if (endpoint === "/actions/runs/123") data = current;
    else if (endpoint === "/actions/runs/39448498604") data = old;
    else if (endpoint === "/actions/runs/39446900969") data = previous;
    else if (endpoint === "/actions/workflows/10") data = { id: 10, path, state: "active" };
    else if (endpoint === "/actions/workflows/11") data = { id: 11, path: old.path, state: "active" };
    else if (endpoint.startsWith("/actions/workflows/10/runs?")) data = { total_count: 1, workflow_runs: [current] };
    else if (endpoint.startsWith("/actions/workflows/11/runs?")) data = { total_count: 2, workflow_runs: [old, previous] };
    else if (endpoint.startsWith("/actions/runs/39448498604/artifacts?")) data = { total_count: 2, artifacts: [
      { id: 12276359076, name: "calculator-step7-recovery-state-39448498604", digest: "sha256:2ed396c73a32f6104d2f6e689c60ff4403c43925d1cbebd913d236e196929824" },
      { id: 12275614858, name: "calculator-step7-recovery-barrier-39448498604", digest: "sha256:66cd09de2753e5c68e7dfccc877534914a368fa02b543e327cf4b925bb90cb64" },
    ].map(item => ({ ...item, expired: false, size_in_bytes: 1000, workflow_run: { id: old.id, head_sha: oldEvent } })) };
    else if (endpoint === "/git/commits/" + eventSha) data = { sha: eventSha, tree: { sha: treeSha } };
    else if (endpoint === "/git/trees/" + treeSha + "?recursive=1") data = { sha: treeSha, truncated: false, tree: [
      ...[".github", ".github/workflows", ".factory"].map(path => ({ path, mode: "040000", type: "tree", sha: treeSha })),
      { path, mode: "100644", type: "blob", sha: workflowSha },
      { path: requestPath, mode: "100644", type: "blob", sha: requestSha },
    ] };
    else if (endpoint === "/git/blobs/" + requestSha) data = { sha: requestSha, encoding: "base64", size: Buffer.byteLength(requestText), content: Buffer.from(requestText).toString("base64") };
    else throw new Error("Unexpected fixture endpoint: " + endpoint);
    return Response.json(mutate(endpoint, clone(data), count));
  };
  return { request, transport, calls };
}

test("one-use history verifies both original attempts, immutable artifacts and current request/workflow before inference", async () => {
  const fixture = history();
  await verifyCalculatorRegenerationHistory(env, runtimeSha, fixture.request, fixture.transport);
  assert.ok(fixture.calls.some(path => path.startsWith("/git/blobs/")));
  assert.ok(fixture.calls.filter(path => path.startsWith("/actions/workflows/10/runs?")).length >= 2);
});

test("history rejects reruns, missing prior evidence, changed request/runtime and races", async t => {
  const mutations: Record<string, HistoryMutator> = {
    deleted_current: (p, d) => p.startsWith("/actions/workflows/10/runs?") ? { ...d, total_count: 0, workflow_runs: [] } : d,
    extra_current: (p, d) => p.startsWith("/actions/workflows/10/runs?") ? { ...d, total_count: 2, workflow_runs: [...d.workflow_runs, { id: 999 }] } : d,
    changed_current_head: (p, d) => p === "/actions/runs/123" ? { ...d, head_sha: "d".repeat(40) } : d,
    completed_current: (p, d) => p === "/actions/runs/123" ? { ...d, status: "completed", conclusion: "failure" } : d,
    disabled: (p, d) => p === "/actions/workflows/10" ? { ...d, state: "disabled_manually" } : d,
    deleted_old: (p, d) => p.startsWith("/actions/workflows/11/runs?") ? { ...d, total_count: 1, workflow_runs: d.workflow_runs.slice(0, 1) } : d,
    extra_old: (p, d) => p.startsWith("/actions/workflows/11/runs?") ? { ...d, total_count: 3, workflow_runs: [...d.workflow_runs, { id: 999 }] } : d,
    successful_old: (p, d) => p === "/actions/runs/39448498604" ? { ...d, conclusion: "success" } : d,
    different_old_head: (p, d) => p === "/actions/runs/39448498604" ? { ...d, head_sha: "d".repeat(40) } : d,
    changed_previous: (p, d) => p === "/actions/runs/39446900969" ? { ...d, head_sha: "d".repeat(40) } : d,
    expired: (p, d) => p.includes("/artifacts?") ? { ...d, artifacts: d.artifacts.map((a: any) => ({ ...a, expired: true })) } : d,
    forged_digest: (p, d) => p.includes("/artifacts?") ? { ...d, artifacts: d.artifacts.map((a: any) => ({ ...a, digest: "sha256:" + "0".repeat(64) })) } : d,
    missing_artifact: (p, d) => p.includes("/artifacts?") ? { ...d, total_count: 1, artifacts: d.artifacts.slice(0, 1) } : d,
    wrong_artifact_head: (p, d) => p.includes("/artifacts?") ? { ...d, artifacts: d.artifacts.map((a: any) => ({ ...a, workflow_run: { ...a.workflow_run, head_sha: "d".repeat(40) } })) } : d,
    wrong_workflow_blob: (p, d) => p.includes("/git/trees/") ? { ...d, tree: d.tree.map((x: any) => x.path === path ? { ...x, sha: "d".repeat(40) } : x) } : d,
    truncated_tree: (p, d) => p.includes("/git/trees/") ? { ...d, truncated: true } : d,
    invalid_request_blob: (p, d) => p.includes("/git/blobs/") ? { ...d, content: Buffer.from("{}").toString("base64") } : d,
    late_history_race: (p, d, count) => p.startsWith("/actions/workflows/10/runs?") && count > 1 ? { ...d, total_count: 2, workflow_runs: [...d.workflow_runs, { id: 999 }] } : d,
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    const fixture = history(mutate);
    await assert.rejects(() => verifyCalculatorRegenerationHistory(env, runtimeSha, fixture.request, fixture.transport), refused);
  });
  for (const key of ["GITHUB_RUN_ATTEMPT", "GITHUB_RUN_NUMBER"]) await t.test(key, async () => {
    const fixture = history();
    await assert.rejects(() => verifyCalculatorRegenerationHistory({ ...env, [key]: "2" }, runtimeSha, fixture.request, fixture.transport), refused);
    assert.equal(fixture.calls.length, 0);
  });
});

test("CLI refuses arbitrary phases and relative roots before any state, history or model work", async () => {
  for (const args of [[], ["run", "/tmp/state", runtimeSha], ["prepare", "state", runtimeSha],
    ["execute", "/tmp/state", "main"], ["collect", "/tmp/state", runtimeSha, "ignored"]]) {
    await assert.rejects(() => runCalculatorStep7Regeneration(args, {}), refused);
  }
});

test("old evidence cannot be manufactured from a missing directory or a symlink", () => {
  const root = mkdtempSync(join(tmpdir(), "calculator-regeneration-negative-"));
  try {
    const request = createCalculatorRegenerationRequest(runtimeSha);
    assert.throws(() => validateCalculatorRegenerationPrior(root, request), refused);
    mkdirSync(join(root, "real"), { mode: 0o700 });
    symlinkSync(join(root, "real"), join(root, "prior-state"));
    mkdirSync(join(root, "prior-barrier"), { mode: 0o700 });
    writeFileSync(join(root, "prior-barrier/recovery.json"), "{}", { mode: 0o600 });
    assert.throws(() => validateCalculatorRegenerationPrior(root, request), refused);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function priorFixture() {
  const base = mkdtempSync(join(tmpdir(), "calculator-regeneration-linked-")), root = join(base, "run"), workspace = join(base, "workspace");
  const request = createCalculatorRegenerationRequest(runtimeSha);
  for (const relative of ["run", "run/prior-state", "run/prior-barrier",
    "workspace", "workspace/request", "workspace/request/.factory"]) mkdirSync(join(base, relative), { mode: 0o700 });
  const audited: { path: string; content: string }[] = JSON.parse(readFileSync(new URL("./fixtures/calculatorStep7StoppedState.json", import.meta.url), "utf8"));
  assert.equal(audited.length, 25);
  for (const file of audited) {
    const destination = join(root, "prior-state", file.path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, file.content, { mode: 0o600 });
  }
  const saved = JSON.parse(readFileSync(join(root, "prior-state/state/" + request.request.goal.id + ".calculator-plan.json"), "utf8"));
  assert.equal(createCalculatorPlan(request.request.goal, saved.proposal).fingerprint, request.planFingerprint);
  const put = (relative: string, value: unknown) => writeFileSync(join(root, relative), JSON.stringify(value) + "\n", { mode: 0o600 });
  writeFileSync(join(root, "prior-barrier/recovery.json"), readFileSync(join(root, "prior-state/barrier/recovery.json")), { mode: 0o600 });
  const state = join(root, "prior-state/state"), receiptName = "calc-" + request.taskId + ".json";
  const blockedReport = { status: "blocked", reasonCode: "execution_failed_no_replay", taskId: request.taskId,
    attempts: 1, repairs: 0, proposalTestsExecuted: false, candidateTestsExecuted: false,
    wholeAppCompleted: false, finalCalculatorCiVerified: false, legalEnabled: false } as const;
  assert.deepEqual(JSON.parse(readFileSync(join(root, "prior-state/calculator-report.json"), "utf8")), blockedReport);
  writeFileSync(join(workspace, "request", requestPath), JSON.stringify(request, null, 2) + "\n", { mode: 0o600 });
  return { root, request, state, receiptPath: join(state, receiptName), receiptBytes: readFileSync(join(state, receiptName)),
    blockedReport, put, env: { ...env, GITHUB_WORKSPACE: workspace }, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test("real saved plan and exact old refusal are verified without rewriting old receipt bytes", () => {
  const fixture = priorFixture();
  try {
    const proof = validateCalculatorRegenerationPrior(fixture.root, fixture.request);
    assert.equal(proof.plan.fingerprint, fixture.request.planFingerprint);
    assert.equal(proof.plan.tasks[0].id, fixture.request.taskId);
    assert.match(proof.treeDigest, /^[a-f0-9]{64}$/); assert.match(proof.receiptDigest, /^[a-f0-9]{64}$/);
    assert.match(proof.barrierDigest, /^[a-f0-9]{64}$/);
    assert.ok(readFileSync(fixture.receiptPath).equals(fixture.receiptBytes));
  } finally { fixture.cleanup(); }
});

test("old receipt, publication, plan, report, charge and barrier drift never authorize regeneration", async t => {
  const changes: Record<string, (fixture: ReturnType<typeof priorFixture>) => void> = {
    receipt_status: f => writeFileSync(f.receiptPath, f.receiptBytes.toString().replace('"status":"blocked"', '"status":"needs-review"')),
    missing_reviewer: f => {
      const receipt = JSON.parse(f.receiptBytes.toString()); receipt.stages.pop(); writeFileSync(f.receiptPath, JSON.stringify(receipt));
    },
    publication: f => {
      const receipt = JSON.parse(f.receiptBytes.toString()); receipt.publication = { branch: "branch", headSha: "d".repeat(40), number: 1, url: "https://github.com/x/y/pull/1" };
      writeFileSync(f.receiptPath, JSON.stringify(receipt));
    },
    source_plan: f => {
      const name = "prior-state/state/" + f.request.request.goal.id + ".calculator-plan.json";
      const saved = JSON.parse(readFileSync(join(f.root, name), "utf8")); saved.proposal.tasks[0].goal = "Another task"; f.put(name, saved);
    },
    false_test_result: f => f.put("prior-state/calculator-report.json", { ...f.blockedReport, proposalTestsExecuted: true }),
    old_repair: f => f.put("prior-state/calculator-report.json", { ...f.blockedReport, repairs: 1 }),
    refund_planning: f => f.put("prior-state/planning-accounting.json", { contextBudget: { reservedRunTokens: 1855 },
      carriedPriorCharge: { reservedRunTokens: 0 }, aggregatePlanningCharge: { reservedRunTokens: 1855 } }),
    mismatched_barrier: f => f.put("prior-barrier/recovery.json", { version: 1 }),
    other_task: f => f.put("prior-state/state/calc-other-task.json", { status: "blocked" }),
    unknown_metadata: f => f.put("prior-state/unexpected.json", { extra: true }),
    missing_nested: f => rmSync(join(f.root, "prior-state/prior-recovery/prior-capsule/completion.json")),
    equivalent_whitespace: f => writeFileSync(f.receiptPath, f.receiptBytes.toString() + " "),
  };
  for (const [name, mutate] of Object.entries(changes)) await t.test(name, () => {
    const fixture = priorFixture();
    try { mutate(fixture); assert.throws(() => validateCalculatorRegenerationPrior(fixture.root, fixture.request), refused); }
    finally { fixture.cleanup(); }
  });
});

test("prepare seals old evidence and separate charges before one linked execution with no repair or next task", async () => {
  const fixture = priorFixture(), remote = history(); let runtimeCalls = 0;
  try {
    const prepared = await runCalculatorStep7Regeneration(["prepare", fixture.root, runtimeSha], fixture.env, { transport: remote.transport });
    assert.equal(prepared.status, "ready-for-one-regeneration");
    assert.ok(!existsSync(join(fixture.root, "state")));
    const barrier = JSON.parse(readFileSync(join(fixture.root, "barrier/regeneration.json"), "utf8"));
    assert.deepEqual(barrier.oldCharge, fixture.request.oldCharge); assert.deepEqual(barrier.planningCharge, fixture.request.planningCharge);
    assert.deepEqual(barrier.additionalAllowance, fixture.request.additionalAllowance);
    assert.equal(barrier.priorReceiptDigest, createHash("sha256").update(fixture.receiptBytes).digest("hex"));
    assert.equal(barrier.budgetResetAuthorized, false); assert.equal(barrier.automaticReplay, false);
    const runtime: typeof runCalculatorRuntime = async (goal, config, state, mode, _env, limits) => {
      runtimeCalls++; assert.equal(runtimeCalls, 1); assert.deepEqual(goal, fixture.request.request.goal);
      assert.deepEqual(config, fixture.request.request.config); assert.equal(mode, "run");
      assert.deepEqual(limits, { maxRequests: 4, maxRunBytes: 96000, maxRepairs: 0 });
      assert.equal(state, join(fixture.root, "state"));
      const active = new CalculatorPlanStore(state, goal).inspect();
      assert.equal(active?.fingerprint, fixture.request.planFingerprint); assert.equal(active?.tasks[0].id, fixture.request.taskId);
      assert.ok(!existsSync(join(state, "calc-" + fixture.request.taskId + ".json")));
      const marker = JSON.parse(readFileSync(join(fixture.root, "calc-regeneration-" + fixture.request.request.goal.id + ".json"), "utf8"));
      assert.equal(marker.status, "running"); assert.equal(marker.fingerprint, digest(barrier));
      assert.ok(marker.stages.some((stage: { stage: string; status: string }) => stage.stage === "one_regeneration" && stage.status === "running"));
      assert.ok(readFileSync(fixture.receiptPath).equals(fixture.receiptBytes));
      return { ...fixture.blockedReport, reasonCode: "fixture_gate_failed" };
    };
    const executionEnv = { ...fixture.env, CALCULATOR_REGENERATION_BARRIER_UPLOADED: "true", FACTORY_HISTORY_TOKEN: "fixture-token",
      AGENT_FACTORY_PROVIDER: "groq", AGENT_FACTORY_LEGAL_ENABLED: "false" };
    const result = await runCalculatorStep7Regeneration(["execute", fixture.root, runtimeSha], executionEnv, { transport: remote.transport, runtime });
    assert.equal(result.status, "blocked"); assert.equal(runtimeCalls, 1);
    assert.ok(readFileSync(fixture.receiptPath).equals(fixture.receiptBytes));
    const markerPath = join(fixture.root, "calc-regeneration-" + fixture.request.request.goal.id + ".json"), markerBytes = readFileSync(markerPath);
    await assert.rejects(() => runCalculatorStep7Regeneration(["execute", fixture.root, runtimeSha], executionEnv, { transport: remote.transport, runtime }), refused);
    assert.equal(runtimeCalls, 1); assert.ok(readFileSync(markerPath).equals(markerBytes));
    let exported = 0;
    const { GITHUB_TOKEN: _unusedToken, FACTORY_HISTORY_TOKEN: _unusedHistoryToken, ...collectEnv } = executionEnv;
    const artifact = await runCalculatorStep7Regeneration(["collect", fixture.root, runtimeSha], collectEnv, {
      exportArtifact: (_root, identity) => {
        exported++; assert.equal(identity.barrierDigest, digest(barrier)); assert.equal(identity.taskId, fixture.request.taskId);
        return Object.freeze({ status: "preserved" as const, fileCount: 3, totalBytes: 12, manifestSha256: "a".repeat(64) });
      },
    });
    assert.equal(artifact.status, "preserved"); assert.equal(exported, 1); assert.equal(runtimeCalls, 1);
  } finally { fixture.cleanup(); }
});

test("changed old bytes or missing remote barrier stop before the first runtime/model call", async t => {
  for (const name of ["old_bytes", "barrier_flag", "barrier_bytes"]) await t.test(name, async () => {
    const fixture = priorFixture(), remote = history(); let calls = 0;
    try {
      await runCalculatorStep7Regeneration(["prepare", fixture.root, runtimeSha], fixture.env, { transport: remote.transport });
      if (name === "old_bytes") writeFileSync(fixture.receiptPath, fixture.receiptBytes.toString() + " ");
      if (name === "barrier_bytes") {
        const barrierPath = join(fixture.root, "barrier/regeneration.json"), barrier = JSON.parse(readFileSync(barrierPath, "utf8"));
        barrier.oldCharge.reservedRunTokens = 0; writeFileSync(barrierPath, JSON.stringify(barrier));
      }
      const runtime: typeof runCalculatorRuntime = async () => { calls++; return fixture.blockedReport; };
      await assert.rejects(() => runCalculatorStep7Regeneration(["execute", fixture.root, runtimeSha], {
        ...fixture.env, CALCULATOR_REGENERATION_BARRIER_UPLOADED: name === "barrier_flag" ? "false" : "true",
        FACTORY_HISTORY_TOKEN: "fixture-token", AGENT_FACTORY_PROVIDER: "groq", AGENT_FACTORY_LEGAL_ENABLED: "false",
      }, { transport: remote.transport, runtime }), refused);
      assert.equal(calls, 0); assert.ok(!existsSync(join(fixture.root, "state")));
    } finally { fixture.cleanup(); }
  });
});

test("unknown runtime failure keeps both receipts terminal and allows only evidence collection", async () => {
  const fixture = priorFixture(), remote = history(); let calls = 0;
  try {
    await runCalculatorStep7Regeneration(["prepare", fixture.root, runtimeSha], fixture.env, { transport: remote.transport });
    const executionEnv = { ...fixture.env, CALCULATOR_REGENERATION_BARRIER_UPLOADED: "true", FACTORY_HISTORY_TOKEN: "fixture-token",
      AGENT_FACTORY_PROVIDER: "groq", AGENT_FACTORY_LEGAL_ENABLED: "false" };
    const runtime: typeof runCalculatorRuntime = async () => { calls++; throw Error("private upstream fixture detail"); };
    await assert.rejects(() => runCalculatorStep7Regeneration(["execute", fixture.root, runtimeSha], executionEnv, { transport: remote.transport, runtime }), refused);
    assert.equal(calls, 1); assert.ok(readFileSync(fixture.receiptPath).equals(fixture.receiptBytes));
    const marker = JSON.parse(readFileSync(join(fixture.root, "calc-regeneration-" + fixture.request.request.goal.id + ".json"), "utf8"));
    assert.equal(marker.status, "blocked"); assert.equal(marker.reasonCode, "regeneration_stopped_no_replay");
    const report = JSON.parse(readFileSync(join(fixture.root, "calculator-report.json"), "utf8"));
    assert.equal(report.status, "blocked"); assert.equal(report.wholeAppCompleted, false);
    for (const invented of ["attempts", "repairs", "proposalTestsExecuted", "candidateTestsExecuted", "publication"]) {
      assert.ok(!Object.hasOwn(report, invented));
    }
    await assert.rejects(() => runCalculatorStep7Regeneration(["execute", fixture.root, runtimeSha], executionEnv, { transport: remote.transport, runtime }), refused);
    assert.equal(calls, 1);
    const collected = await runCalculatorStep7Regeneration(["collect", fixture.root, runtimeSha], executionEnv, {
      exportArtifact: () => Object.freeze({ status: "preserved" as const, fileCount: 1, totalBytes: 1, manifestSha256: "c".repeat(64) }),
    });
    assert.equal(collected.status, "preserved");
  } finally { fixture.cleanup(); }
});
