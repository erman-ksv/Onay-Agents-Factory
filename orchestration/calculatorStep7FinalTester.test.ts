import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderCalculatorFinalTesterWorkflow } from "../config/calculatorFinalTesterWorkflow.js";
import { prepareCalculatorLaunchRequest } from "./calculatorLaunchState.js";
import { validateCalculatorAssessment } from "../commander/calculatorTeam.js";
import { createCalculatorPlan } from "./calculatorPlan.js";
import type { runCalculatorRuntime } from "./calculatorRuntime.js";
import { CALCULATOR_FINAL_TESTER_ERROR, CALCULATOR_FINAL_TESTER_SOURCE as SOURCE, CALCULATOR_FINAL_TESTER_ALLOWANCE,
  CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES, CALCULATOR_FINAL_TESTER_BRANCH as BRANCH, CALCULATOR_FINAL_TESTER_PATH as PATH,
  CALCULATOR_FINAL_TESTER_REQUEST as REQUEST, createCalculatorFinalTesterRequest, validateCalculatorFinalTesterRequest,
  verifyCalculatorFinalTesterHistory, runCalculatorStep7FinalTester } from "./calculatorStep7FinalTester.js";

const runtimeSha = "d".repeat(40), eventSha = "e".repeat(40), treeSha = "f".repeat(40), repository = "erman-ksv/Onay-Agents-Factory";
const image = "node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392";
const blob = (value: string) => createHash("sha1").update("blob " + Buffer.byteLength(value) + "\0").update(value).digest("hex");
const clone = <T>(value: T): T => structuredClone(value);
const refused = (error: unknown) => error instanceof Error && error.message === CALCULATOR_FINAL_TESTER_ERROR;
const env = { GITHUB_TOKEN: "fixture-history-token", GITHUB_REPOSITORY: repository, GITHUB_REF: "refs/heads/" + BRANCH,
  GITHUB_EVENT_NAME: "push", GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ID: "123", GITHUB_SHA: eventSha };

function history(mutate: (endpoint: string, data: any, count: number) => any = (_endpoint, data) => data) {
  const request = createCalculatorFinalTesterRequest(runtimeSha), requestText = JSON.stringify(request, null, 2) + "\n";
  const requestSha = blob(requestText), workflowSha = blob(renderCalculatorFinalTesterWorkflow(runtimeSha, image));
  const common = { event: "push", run_attempt: 1, run_number: 1, repository: { full_name: repository }, head_repository: { full_name: repository }, head_branch: BRANCH };
  const current = { ...common, id: 123, workflow_id: 10, path: PATH, head_sha: eventSha, status: "in_progress", conclusion: null };
  const old = { ...common, id: SOURCE.runId, workflow_id: 11, path: ".github/workflows/calculator-step7-continuation.yml", head_sha: SOURCE.eventSha,
    status: "completed", conclusion: "failure", updated_at: "2026-01-01T00:00:00Z" };
  const calls: string[] = [], counts = new Map<string, number>();
  const transport: typeof fetch = async (url, init) => {
    const target = new URL(String(url)); assert.equal(target.origin, "https://api.github.com"); assert.equal(init?.method, "GET"); assert.equal(init.redirect, "error");
    const endpoint = target.pathname.slice(("/repos/" + repository).length) + target.search;
    calls.push(endpoint); const count = (counts.get(endpoint) ?? 0) + 1; counts.set(endpoint, count); let data: any;
    if (endpoint === "/actions/runs/123") data = current;
    else if (endpoint === "/actions/runs/" + SOURCE.runId) data = old;
    else if (endpoint === "/actions/workflows/10") data = { id: 10, path: PATH, state: "active" };
    else if (endpoint.startsWith("/actions/workflows/10/runs?")) data = { total_count: 1, workflow_runs: [current] };
    else if (endpoint.startsWith("/actions/workflows/11/runs?")) data = { total_count: 1, workflow_runs: [old] };
    else if (endpoint === "/git/commits/" + eventSha) data = { sha: eventSha, tree: { sha: treeSha } };
    else if (endpoint === "/git/trees/" + treeSha + "?recursive=1") data = { sha: treeSha, truncated: false, tree: [
      ...[".factory", ".github", ".github/workflows"].map(path => ({ path, type: "tree", mode: "040000", sha: treeSha })),
      { path: PATH, type: "blob", mode: "100644", sha: workflowSha }, { path: REQUEST, type: "blob", mode: "100644", sha: requestSha },
    ] };
    else if (endpoint === "/git/blobs/" + requestSha) data = { sha: requestSha, encoding: "base64", content: Buffer.from(requestText).toString("base64") };
    else if (endpoint === "/actions/artifacts/" + SOURCE.artifactId) data = { id: SOURCE.artifactId, name: "calculator-step7-continuation-evidence-" + SOURCE.runId,
      expired: false, digest: SOURCE.artifactDigest, size_in_bytes: 20000, workflow_run: { id: SOURCE.runId, head_sha: SOURCE.eventSha } };
    else throw Error("Unexpected fixture endpoint");
    return Response.json(mutate(endpoint, clone(data), count));
  };
  return { request, requestText, transport, calls };
}
function fixture(t: { after(callback: () => void): void }) {
  const parent = mkdtempSync(join(tmpdir(), "calculator-final-tester-")), root = join(parent, "run"), workspace = join(parent, "workspace");
  mkdirSync(root, { mode: 0o700 }); mkdirSync(join(root, "prior-evidence"), { mode: 0o700 }); mkdirSync(join(workspace, "request/.factory"), { recursive: true, mode: 0o700 });
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const h = history(); writeFileSync(join(workspace, "request", REQUEST), h.requestText, { mode: 0o600 });
  const document = JSON.parse(readFileSync(new URL("./fixtures/calculatorStep7SavedPlan.json", import.meta.url), "utf8"));
  const request = prepareCalculatorLaunchRequest({ version: 1, mode: "plan", factorySha: "d733e078800505534cd7c39f15406822416e7f24", freeTierConfirmed: true,
    goal: document.request, config: { version: 1, sandboxImage: image, trustedWorkflows: [{ id: 390241255, path: ".github/workflows/calculator-task-ci.yml", blobSha: "45fae4a292a04e89a631ad7ff2469a3af7265e70" }] } });
  const plan = createCalculatorPlan(request.goal, document.proposal); assert.equal(plan.fingerprint, SOURCE.planFingerprint);
  const oldBytes = Buffer.from('{"status":"blocked","stages":[{"stage":"tester_1","status":"blocked"}]}\n');
  writeFileSync(join(root, "prior-evidence/fixture-original.json"), oldBytes, { mode: 0o600 });
  const restoredAssessments = ["security", "reviewer"].map(role => validateCalculatorAssessment(role as "security" | "reviewer", {
    ready: true, summary: "PRIVATE_SAVED_ASSESSMENT_MUST_NEVER_BE_LOGGED", findings: [], unverifiedAreas: ["Host tests have not run."]
  }, ["changes@" + request.goal.baseSha]));
  const proposal = { privateCode: "PRIVATE_SAVED_PROPOSAL_MUST_NEVER_BE_LOGGED" };
  const prior = { request, plan, proposal, restoredAssessments, receiptSha256: "a".repeat(64), capsuleSha256: SOURCE.capsuleSha256,
    capsulePath: SOURCE.capsulePath, manifestSha256: SOURCE.manifestSha256 };
  let inspections = 0;
  const verifyArtifact = (path: string) => { assert.equal(path, join(root, "prior-evidence")); inspections++; return prior; };
  const runtimeEnv = { ...env, GITHUB_WORKSPACE: workspace, FACTORY_HISTORY_TOKEN: "fixture-history-token", AGENT_FACTORY_PROVIDER: "groq", AGENT_FACTORY_LEGAL_ENABLED: "false",
    CALCULATOR_FINAL_TESTER_BARRIER_UPLOADED: "true" };
  return { root, workspace, h, prior, proposal, oldBytes, verifyArtifact, runtimeEnv, inspections: () => inspections,
    prepare: () => runCalculatorStep7FinalTester(["prepare", root, runtimeSha], runtimeEnv, { transport: h.transport, verifyArtifact }) };
}
function report(status: "blocked" | "needs-review" = "blocked") {
  return { status, reasonCode: "fixture_checks_complete", taskId: SOURCE.taskId, attempts: 1, repairs: 0,
    proposalTestsExecuted: false, candidateTestsExecuted: false, wholeAppCompleted: false, finalCalculatorCiVerified: false, legalEnabled: false } as const;
}

test("request preserves all historical charges and seals exactly one Tester call without Coder or repair", () => {
  const request = createCalculatorFinalTesterRequest(runtimeSha);
  assert.deepEqual(validateCalculatorFinalTesterRequest(request, runtimeSha), request);
  assert.equal(request.approval, "ONE_FINAL_TESTER_OF_SAVED_PROPOSAL"); assert.equal(request.proposalDigest, SOURCE.proposalDigest);
  assert.equal(request.taskId, SOURCE.taskId); assert.deepEqual(request.historicalCharges, CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES);
  assert.deepEqual(request.additionalAllowance, CALCULATOR_FINAL_TESTER_ALLOWANCE); assert.equal(request.additionalAllowance.maxRequests, 1);
  assert.equal(request.additionalAllowance.maxRunBytes, 24000); assert.equal(request.additionalAllowance.maxRepairs, 0);
});
test("request refuses identity drift, refunds, altered allowance and unknown nested authority", async t => {
  const mutations: Record<string, (value: any) => void> = {
    runtime: value => { value.runtimeSha = "0".repeat(40); }, goal: value => { value.goalId = "new-goal"; }, task: value => { value.taskId = "next-task"; },
    plan: value => { value.planFingerprint = "0".repeat(64); }, proposal: value => { value.proposalDigest = "0".repeat(64); },
    artifact: value => { value.priorArtifactId++; }, digest: value => { value.priorManifestSha256 = "0".repeat(64); },
    capsuleDigest: value => { value.priorCapsuleSha256 = "0".repeat(64); }, capsulePath: value => { value.priorCapsulePath = "execution-private/other.json"; },
    oldRefund: value => { value.historicalCharges.oldExecution.reservedRunTokens = 0; }, planningRefund: value => { value.historicalCharges.planning.reservedRunTokens = 0; },
    regenRefund: value => { value.historicalCharges.regeneration.elapsedMs = 0; },
    priorContinuationRefund: value => { value.historicalCharges.priorContinuation.reservedRunTokens = 4422; }, calls: value => { value.additionalAllowance.maxRequests = 4; },
    bytes: value => { value.additionalAllowance.maxRunBytes++; }, tokens: value => { value.additionalAllowance.maxRunTokens++; },
    time: value => { value.additionalAllowance.wallTimeMs++; }, repair: value => { value.additionalAllowance.maxRepairs = 1; },
    extra: value => { value.resumeAuthorized = true; }, nested: value => { value.additionalAllowance.ignoreBudget = true; },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, () => {
    const request = clone(createCalculatorFinalTesterRequest(runtimeSha)); mutate(request); assert.throws(() => validateCalculatorFinalTesterRequest(request, runtimeSha), refused);
  });
});
test("history verifies exact old artifact and failed run, current workflow/request blobs and complete one-use numbering", async () => {
  const h = history(); await verifyCalculatorFinalTesterHistory(env, runtimeSha, h.request, h.transport);
  assert.ok(h.calls.includes("/actions/artifacts/" + SOURCE.artifactId));
  assert.equal(h.calls.filter(path => path.startsWith("/actions/workflows/10/runs?")).length, 2);
});
test("history rejects reruns, deleted history, changed workflow/request, expired artifacts and successful or moving old runs", async t => {
  for (const form of ["current-attempt", "current-number", "old-number", "old-success", "old-sha", "artifact-expired", "artifact-digest", "artifact-run", "workflow-pin", "tree-truncated", "request-blob", "history", "history-race"]) await t.test(form, async () => {
    const h = history((endpoint, data, count) => {
      if (endpoint === "/actions/runs/123" && form === "current-attempt") data.run_attempt = 2;
      if (endpoint === "/actions/runs/123" && form === "current-number") data.run_number = 2;
      if (endpoint === "/actions/runs/" + SOURCE.runId) { if (form === "old-number") data.run_number = 2; if (form === "old-success") data.conclusion = "success"; if (form === "old-sha") data.head_sha = eventSha; }
      if (endpoint === "/actions/artifacts/" + SOURCE.artifactId) { if (form === "artifact-expired") data.expired = true; if (form === "artifact-digest") data.digest = "sha256:" + "0".repeat(64); if (form === "artifact-run") data.workflow_run.id++; }
      if (endpoint.startsWith("/git/trees/")) { if (form === "workflow-pin") data.tree.find((item: any) => item.path === PATH).sha = "0".repeat(40); if (form === "tree-truncated") data.truncated = true; }
      if (endpoint.startsWith("/git/blobs/") && form === "request-blob") data.content = Buffer.from("{}").toString("base64");
      if (endpoint.startsWith("/actions/workflows/10/runs?") && (form === "history" || (form === "history-race" && count === 2))) data.total_count = 2;
      return data;
    });
    await assert.rejects(() => verifyCalculatorFinalTesterHistory(env, runtimeSha, h.request, h.transport), refused);
  });
});
test("prepare persists a new linked barrier without invoking runtime or changing old bytes", async t => {
  const f = fixture(t), result = await f.prepare(); assert.equal(result.status, "ready-for-final-tester");
  const context = JSON.parse(readFileSync(join(f.root, "context.json"), "utf8")), barrier = JSON.parse(readFileSync(join(f.root, "barrier/final-tester.json"), "utf8"));
  assert.deepEqual(context.barrier, barrier); assert.equal(barrier.startAt, "tester_1"); assert.deepEqual(barrier.completedRoles, ["security", "reviewer"]);
  assert.equal(barrier.proposalDigest, SOURCE.proposalDigest); assert.deepEqual(barrier.historicalCharges, CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES);
  assert.equal(barrier.budgetResetAuthorized, false); assert.equal(barrier.coderRegenerationAuthorized, false);
  assert.deepEqual(readFileSync(join(f.root, "prior-evidence/fixture-original.json")), f.oldBytes);
  assert.equal(existsSync(join(f.root, "state")), false); assert.equal(f.inspections(), 1);
});
test("execute forwards only the saved proposal and ready Security/Reviewer prefix to restored runtime with exact limits and never resets the old receipt", async t => {
  const f = fixture(t); await f.prepare(); let calls = 0;
  const runtime: typeof runCalculatorRuntime = async (goal, config, state, mode, runtimeEnv, limits, continuation) => {
    calls++; assert.deepEqual(goal, f.prior.request.goal); assert.deepEqual(config, f.prior.request.config); assert.equal(state, join(f.root, "state"));
    assert.equal(mode, "run"); assert.ok(runtimeEnv); assert.equal(runtimeEnv.FACTORY_HISTORY_TOKEN, f.runtimeEnv.FACTORY_HISTORY_TOKEN);
    assert.deepEqual(limits, { maxRequests: 1, maxRunBytes: 24000, maxRepairs: 0 }); assert.equal(continuation?.proposal, f.proposal); assert.equal(continuation?.proposalDigest, SOURCE.proposalDigest);
    assert.equal(continuation?.restoredAssessments, f.prior.restoredAssessments);
    return report();
  };
  const result = await runCalculatorStep7FinalTester(["execute", f.root, runtimeSha], f.runtimeEnv, { transport: f.h.transport, verifyArtifact: f.verifyArtifact, runtime });
  assert.equal(result.status, "blocked"); assert.equal(calls, 1); assert.equal("coderRegenerated" in result && result.coderRegenerated, false);
  assert.deepEqual(readFileSync(join(f.root, "prior-evidence/fixture-original.json")), f.oldBytes);
  const marker = JSON.parse(readFileSync(join(f.root, "calc-final-tester-" + SOURCE.goalId + ".json"), "utf8"));
  assert.equal(marker.status, "blocked"); assert.equal(marker.reasonCode, "one_saved_proposal_final_tester_no_replay");
  await assert.rejects(() => runCalculatorStep7FinalTester(["execute", f.root, runtimeSha], f.runtimeEnv, { transport: f.h.transport, verifyArtifact: f.verifyArtifact, runtime }), refused);
  assert.equal(calls, 1);
});
test("missing remote barrier, modified context, unverifiable old source or role failure prevents further model/runtime work", async t => {
  for (const form of ["no-remote", "tampered-context", "artifact", "runtime-failure"]) await t.test(form, async t => {
    const f = fixture(t); await f.prepare(); let calls = 0; const runtime: typeof runCalculatorRuntime = async () => { calls++; throw Error("fixture specialist failure"); };
    const currentEnv = { ...f.runtimeEnv };
    if (form === "no-remote") currentEnv.CALCULATOR_FINAL_TESTER_BARRIER_UPLOADED = "false";
    if (form === "tampered-context") { const path = join(f.root, "context.json"), value = JSON.parse(readFileSync(path, "utf8")); value.barrier.additionalAllowance.maxRequests++; writeFileSync(path, JSON.stringify(value), { mode: 0o600 }); }
    const verifyArtifact = form === "artifact" ? () => { throw Error("unverified archive"); } : f.verifyArtifact;
    await assert.rejects(() => runCalculatorStep7FinalTester(["execute", f.root, runtimeSha], currentEnv, { transport: f.h.transport, verifyArtifact, runtime }), refused);
    assert.equal(calls, form === "runtime-failure" ? 1 : 0); assert.deepEqual(readFileSync(join(f.root, "prior-evidence/fixture-original.json")), f.oldBytes);
  });
});
test("collector copies exact old/new evidence and emits only a source-free non-resumable manifest", async t => {
  const f = fixture(t); await f.prepare(); const privateSource = "PRIVATE_NEW_ASSESSMENT_TEXT_MUST_STAY_PRIVATE";
  mkdirSync(join(f.root, "execution-private"), { mode: 0o700 }); writeFileSync(join(f.root, "execution-private/task.json"), JSON.stringify({ privateSource }), { mode: 0o600 });
  const result = await runCalculatorStep7FinalTester(["collect", f.root, runtimeSha], f.runtimeEnv, { verifyArtifact: f.verifyArtifact });
  assert.equal(result.status, "preserved"); const manifest = readFileSync(join(f.root, "final-tester-artifact/manifest.json"), "utf8");
  assert.equal(manifest.includes(privateSource), false); assert.equal(manifest.includes("PRIVATE_SAVED_PROPOSAL"), false); assert.equal(manifest.includes("PRIVATE_SAVED_ASSESSMENT"), false);
  const value = JSON.parse(manifest); assert.equal(value.resumeAuthorized, false); assert.equal(value.coderRegenerationAuthorized, false);
  assert.deepEqual(value.historicalCharges, CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES);
  assert.deepEqual(readFileSync(join(f.root, "final-tester-artifact/evidence/prior-evidence/fixture-original.json")), f.oldBytes);
  assert.equal(JSON.parse(readFileSync(join(f.root, "final-tester-artifact/evidence/execution-private/task.json"), "utf8")).privateSource, privateSource);
  await assert.rejects(() => runCalculatorStep7FinalTester(["collect", f.root, runtimeSha], f.runtimeEnv, { verifyArtifact: f.verifyArtifact }), refused);
});
test("collector refuses links, credentials, unexpected logs and atomic publication faults", async t => {
  for (const form of ["symlink", "token", "log", "rename"]) await t.test(form, async t => {
    const f = fixture(t); await f.prepare();
    if (form === "symlink") symlinkSync(join(f.root, "context.json"), join(f.root, "prior-evidence/link.json"));
    if (form === "token") writeFileSync(join(f.root, "prior-evidence/secret.json"), JSON.stringify({ token: "gsk_" + "A".repeat(40) }), { mode: 0o600 });
    if (form === "log") writeFileSync(join(f.root, "private.log"), "untrusted private diagnostics", { mode: 0o600 });
    const realRename = fs.renameSync;
    try { if (form === "rename") { fs.renameSync = () => { throw Error("fixture persistence fault"); }; syncBuiltinESMExports(); }
      await assert.rejects(() => runCalculatorStep7FinalTester(["collect", f.root, runtimeSha], f.runtimeEnv, { verifyArtifact: f.verifyArtifact }), refused); }
    finally { fs.renameSync = realRename; syncBuiltinESMExports(); }
    assert.equal(existsSync(join(f.root, "final-tester-artifact")), false); assert.deepEqual(readFileSync(join(f.root, "prior-evidence/fixture-original.json")), f.oldBytes);
  });
});
test("production artifact verifier refuses missing pinned manifest before creating continuation state", async t => {
  const f = fixture(t);
  await assert.rejects(() => runCalculatorStep7FinalTester(["prepare", f.root, runtimeSha], f.runtimeEnv, { transport: f.h.transport }), refused);
  assert.equal(existsSync(join(f.root, "context.json")), false); assert.equal(existsSync(join(f.root, "state")), false);
});

test("all three host-only phases preserve the ready prefix and spend only the sealed Tester allowance", async t => {
  const f = fixture(t); const saved = JSON.stringify(f.prior.restoredAssessments); let testerCalls = 0;
  const prepared = await f.prepare(); assert.equal(prepared.status, "ready-for-final-tester");
  const runtime: typeof runCalculatorRuntime = async (_goal, _config, _state, _mode, _env, limits, continuation) => {
    testerCalls++; assert.deepEqual(limits, { maxRequests: 1, maxRunBytes: 24000, maxRepairs: 0 });
    assert.equal(continuation?.proposal, f.proposal); assert.equal(continuation?.proposalDigest, SOURCE.proposalDigest);
    assert.equal(continuation?.restoredAssessments, f.prior.restoredAssessments);
    assert.ok(continuation); assert.equal(JSON.stringify(continuation.restoredAssessments), saved); return report("needs-review");
  };
  const executed = await runCalculatorStep7FinalTester(["execute", f.root, runtimeSha], f.runtimeEnv, { transport: f.h.transport, verifyArtifact: f.verifyArtifact, runtime });
  assert.equal(executed.status, "needs-review"); assert.equal(testerCalls, 1);
  const collected = await runCalculatorStep7FinalTester(["collect", f.root, runtimeSha], f.runtimeEnv, { verifyArtifact: f.verifyArtifact });
  assert.equal(collected.status, "preserved");
  const manifest = JSON.parse(readFileSync(join(f.root, "final-tester-artifact/manifest.json"), "utf8"));
  assert.equal(manifest.barrier.startAt, "tester_1"); assert.deepEqual(manifest.barrier.completedRoles, ["security", "reviewer"]);
  assert.equal(manifest.historicalCharges.priorContinuation.reservedRunTokens, 6437);
  assert.equal(manifest.additionalAllowance.maxRequests, 1); assert.equal(manifest.resumeAuthorized, false);
  assert.deepEqual(readFileSync(join(f.root, "final-tester-artifact/evidence/prior-evidence/fixture-original.json")), f.oldBytes);
  assert.equal(JSON.stringify(f.prior.restoredAssessments), saved);
  assert.equal(JSON.stringify({ prepared, executed, collected, manifest }).includes("PRIVATE_SAVED_ASSESSMENT"), false);
});

test("ready specialist prefix and exact saved capsule identity are required before a new barrier", async t => {
  for (const form of ["missing", "one-role", "reordered", "not-ready", "finding", "claim-tests", "capsule-hash", "capsule-path"]) await t.test(form, async t => {
    const f = fixture(t); const restoredAssessments: unknown[] = clone(f.prior.restoredAssessments);
    const prior = { ...clone(f.prior), restoredAssessments,
      capsuleSha256: String(f.prior.capsuleSha256), capsulePath: String(f.prior.capsulePath) };
    if (form === "missing") prior.restoredAssessments = [];
    if (form === "one-role") prior.restoredAssessments.pop();
    if (form === "reordered") prior.restoredAssessments.reverse();
    if (form === "not-ready") prior.restoredAssessments[0] = { ...f.prior.restoredAssessments[0]!, ready: false };
    if (form === "finding") prior.restoredAssessments[0] = { ...f.prior.restoredAssessments[0]!, findings: [{ severity: "low", message: "Unresolved finding.", evidenceRefs: [], evidenceStatus: "missing" }] };
    if (form === "claim-tests") prior.restoredAssessments[0] = { ...f.prior.restoredAssessments[0]!, testsExecuted: true };
    if (form === "capsule-hash") prior.capsuleSha256 = "0".repeat(64);
    if (form === "capsule-path") prior.capsulePath = "execution-private/" + "0".repeat(64) + "/task.execution.json";
    await assert.rejects(() => runCalculatorStep7FinalTester(["prepare", f.root, runtimeSha], f.runtimeEnv, { transport: f.h.transport, verifyArtifact: () => prior }), refused);
    assert.equal(existsSync(join(f.root, "context.json")), false); assert.equal(existsSync(join(f.root, "state")), false);
  });
});
