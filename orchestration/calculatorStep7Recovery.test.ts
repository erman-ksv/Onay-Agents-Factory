import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { validateCalculatorRecoveryRequest, validateCalculatorFailedPlanningCapsule, verifyCalculatorRecoveryHistory, CALCULATOR_RECOVERY_CHARGE } from "./calculatorStep7Recovery.js";
import { calculatorLaunchManifest, prepareCalculatorLaunchRequest } from "./calculatorLaunchState.js";
import { prepareCalculatorGoal } from "./calculatorPlan.js";
import { TeamTaskStore } from "./teamTaskStore.js";
const original = { version: 1, mode: "plan", factorySha: "d733e078800505534cd7c39f15406822416e7f24", freeTierConfirmed: true,
  goal: { version: 1, id: "calculator-pilot-step7-v1", goal: "Create the complete agreed static calculator with independent tests, keyboard support and a responsive phone layout.", provider: "groq", baseRef: "feat/calculator-pilot-bootstrap", baseSha: "2c1218f2b020962ad93adf68d902a847271a7e72" },
  config: { version: 1, sandboxImage: "node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392", trustedWorkflows: [{ id: 390241255, path: ".github/workflows/calculator-task-ci.yml", blobSha: "45fae4a292a04e89a631ad7ff2469a3af7265e70" }] } };
const runtimeSha = "a".repeat(40), request = prepareCalculatorLaunchRequest(original);
const recovery = { version: 1, approval: "ONE_REVIEWED_STEP7_RECOVERY", priorRunId: 39437299742, runtimeSha, request: original };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
test("recovery keeps the original goal and requires explicit host approval and exact runtime pin", () => {
  assert.equal(validateCalculatorRecoveryRequest(recovery, runtimeSha).goal.id, original.goal.id);
  for (const raw of [{ ...recovery, approval: "retry" }, { ...recovery, priorRunId: 2 }, { ...recovery, runtimeSha: "b".repeat(40) },
    { ...recovery, ignored: true }, { ...recovery, request: { ...original, mode: "run" } },
    { ...recovery, request: { ...original, goal: { ...original.goal, id: "new-goal" } } }]) assert.throws(() => validateCalculatorRecoveryRequest(raw, runtimeSha));
  assert.deepEqual(CALCULATOR_RECOVERY_CHARGE, { attemptedRequests: 1, totalRequestBytes: 24000, reservedRunTokens: 6000, elapsedMs: 30000 });
});
function capsule(root: string) {
  for (const part of ["prior-capsule", "prior-barrier", "prior-capsule/state", "prior-capsule/report"]) mkdirSync(join(root, part), { mode: 0o700 });
  const owner = prepareCalculatorGoal(original.goal), state = join(root, "prior-capsule/state");
  const store = new TeamTaskStore(state, { id: "calc-planning-" + owner.id, fingerprint: owner.ownerFingerprint });
  store.claim(); store.recordStage("model_plan", "running"); store.finish("blocked", "planning_interrupted_no_replay"); store.close();
  const launch = calculatorLaunchManifest(request, 39437299742, "08a2386f181cc615af58bf4f605ea8c4f1226fa1", "b".repeat(40));
  const name = "calc-planning-" + owner.id + ".json", bytes = readFileSync(join(state, name));
  const report = { mode: "plan", status: "blocked", reasonCode: "runtime_report_unverified", wholeAppCompleted: false, legalEnabled: false };
  const put = (path: string, value: unknown) => writeFileSync(join(root, path), JSON.stringify(value) + "\n", { mode: 0o600 });
  put("prior-capsule/launch.json", launch); put("prior-barrier/launch.json", launch); put("prior-capsule/report/calculator-report.json", report);
  put("prior-capsule/completion.json", { version: 1, manifestDigest: digest(launch), exitCode: 10,
    stateDigests: { [name]: createHash("sha256").update(bytes).digest("hex") }, reportDigest: digest(report) });
  return { state, name, bytes, put, launch };
}
test("failed capsule is bound to the old SHA/digests and its terminal receipt is preserved byte-for-byte", () => {
  const root = mkdtempSync(join(tmpdir(), "calculator-recovery-"));
  try {
    const fixture = capsule(root), proof = validateCalculatorFailedPlanningCapsule(root, request);
    assert.equal(proof.state.size, 1); assert.ok(readFileSync(join(fixture.state, fixture.name)).equals(fixture.bytes));
    fixture.put("prior-barrier/launch.json", { ...fixture.launch, runId: 4 }); assert.throws(() => validateCalculatorFailedPlanningCapsule(root, request));
    fixture.put("prior-barrier/launch.json", fixture.launch);
    writeFileSync(join(fixture.state, fixture.name), fixture.bytes.toString().replace('"blocked"', '"completed"'));
    assert.throws(() => validateCalculatorFailedPlanningCapsule(root, request));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
const env = { GITHUB_TOKEN: "fixture-token", GITHUB_REPOSITORY: "erman-ksv/Onay-Agents-Factory", GITHUB_REF: "refs/heads/feat/onay-task-runner-20261019",
  GITHUB_EVENT_NAME: "push", GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ID: "123", GITHUB_SHA: runtimeSha };
function history(mutator: (path: string, data: any) => any = (_path, data) => data) {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
    const path = String(url).split("Onay-Agents-Factory")[1];
    const common = { event: "push", head_branch: "feat/onay-task-runner-20261019", run_attempt: 1, run_number: 1,
      repository: { full_name: env.GITHUB_REPOSITORY }, head_repository: { full_name: env.GITHUB_REPOSITORY } };
    let data: any;
    if (path === "/actions/runs/123") data = { ...common, id: 123, path: ".github/workflows/calculator-step7-recovery.yml", workflow_id: 10, head_sha: runtimeSha };
    else if (path === "/actions/runs/39437299742") data = { ...common, id: 39437299742, path: ".github/workflows/calculator-one-cycle.yml", workflow_id: 11, head_sha: "08a2386f181cc615af58bf4f605ea8c4f1226fa1", status: "completed", conclusion: "failure", updated_at: "2026-01-01T00:00:00Z" };
    else if (path === "/actions/workflows/10/runs?per_page=100") data = { total_count: 1, workflow_runs: [{ id: 123 }] };
    else if (path === "/actions/workflows/11/runs?per_page=100") data = { total_count: 1, workflow_runs: [{ id: 39437299742 }] };
    else if (path.endsWith("/artifacts?per_page=100")) data = { total_count: 3, artifacts: [
      { id: 12272791735, digest: "sha256:bc64073a4fba21a9998e6cfdd7e389b32d461f5394995f0f16efcf20531f2262" },
      { id: 12272402010, digest: "sha256:2701db5727ec692a3a28f816592d0c4aaf7dcfc7cd70193a233ae6bd542352fc" }, { id: 4 },
    ].map(a => ({ ...a, expired: false, size_in_bytes: 1000, workflow_run: { id: 39437299742, head_sha: "08a2386f181cc615af58bf4f605ea8c4f1226fa1" } })) };
    else throw Error("unexpected endpoint");
    return Response.json(mutator(path, data));
  };
}
test("one recovery slot refuses retries, deleted/multiple history, altered artifacts and successful old plans", async () => {
  await verifyCalculatorRecoveryHistory(env, history());
  for (const key of ["GITHUB_RUN_ATTEMPT", "GITHUB_RUN_NUMBER"]) await assert.rejects(() => verifyCalculatorRecoveryHistory({ ...env, [key]: "2" }, history()));
  for (const mutate of [
    (p: string, d: any) => p.includes("/workflows/") ? { ...d, total_count: 0, workflow_runs: [] } : d,
    (p: string, d: any) => p === "/actions/runs/39437299742" ? { ...d, conclusion: "success" } : d,
    (p: string, d: any) => p.includes("/artifacts?") ? { ...d, artifacts: d.artifacts.map((a: any) => ({ ...a, digest: "forged" })) } : d,
    (p: string, d: any) => p.includes("/artifacts?") ? { ...d, artifacts: d.artifacts.map((a: any) => ({ ...a, expired: true })) } : d,
  ]) await assert.rejects(() => verifyCalculatorRecoveryHistory(env, history(mutate)));
});
