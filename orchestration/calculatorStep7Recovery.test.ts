import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { validateCalculatorRecoveryRequest, validateCalculatorFailedPlanningCapsule, verifyCalculatorRecoveryHistory, CALCULATOR_RECOVERY_CHARGE, CALCULATOR_JSON_CORRECTION_CHARGE, validateCalculatorPriorRecovery } from "./calculatorStep7Recovery.js";
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
function history(mutator: (path: string, data: any) => any = (_path, data) => data, correction = false) {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
    const path = String(url).split("Onay-Agents-Factory")[1];
    const common = { event: "push", head_branch: "feat/onay-task-runner-20261019", run_attempt: 1, run_number: 1,
      repository: { full_name: env.GITHUB_REPOSITORY }, head_repository: { full_name: env.GITHUB_REPOSITORY } };
    let data: any;
    if (path === "/actions/runs/123") data = { ...common, id: 123, path: ".github/workflows/calculator-step7-recovery.yml", workflow_id: 10, head_sha: runtimeSha, run_number: correction ? 2 : 1 };
    else if (path === "/actions/runs/39437299742") data = { ...common, id: 39437299742, path: ".github/workflows/calculator-one-cycle.yml", workflow_id: 11, head_sha: "08a2386f181cc615af58bf4f605ea8c4f1226fa1", status: "completed", conclusion: "failure", updated_at: "2026-01-01T00:00:00Z" };
    else if (path === "/actions/runs/39446900969") data = { ...common, id: 39446900969, path: ".github/workflows/calculator-step7-recovery.yml", workflow_id: 10, head_sha: "988bed450daf80e0e9602a0b8ddd3fb1f2771bd6", status: "completed", conclusion: "failure", updated_at: "2026-01-01T00:00:00Z" };
    else if (path === "/actions/workflows/10/runs?per_page=100") data = { total_count: correction ? 2 : 1, workflow_runs: correction ? [{ id: 123 }, { id: 39446900969 }] : [{ id: 123 }] };
    else if (path === "/actions/workflows/11/runs?per_page=100") data = { total_count: 1, workflow_runs: [{ id: 39437299742 }] };
    else if (path === "/actions/runs/39446900969/artifacts?per_page=100") data = { total_count: 2, artifacts: [
      { id: 12277146675, digest: "sha256:a3ac5116d2f202b6b37145e0ff4c38014c1d6d9b5a9bb7511f10e87af5786184" },
      { id: 12275543477, digest: "sha256:8f3fe587b24d85836458efc8dc08850b373b1acb39431fbc336446c148540ce1" },
    ].map(a => ({ ...a, expired: false, size_in_bytes: 1000, workflow_run: { id: 39446900969, head_sha: "988bed450daf80e0e9602a0b8ddd3fb1f2771bd6" } })) };
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

test("JSON correction requires both immutable failed attempts, explicit request and the second history slot", async () => {
  const corrected = { ...recovery, approval: "ONE_JSON_REQUEST_CORRECTION", priorRecoveryRunId: 39446900969 };
  assert.equal(validateCalculatorRecoveryRequest(corrected, runtimeSha).goal.id, request.goal.id);
  assert.throws(() => validateCalculatorRecoveryRequest({ ...corrected, priorRecoveryRunId: 3 }, runtimeSha));
  assert.deepEqual(CALCULATOR_JSON_CORRECTION_CHARGE, { attemptedRequests: 2, totalRequestBytes: 48000, reservedRunTokens: 12000, elapsedMs: 60000 });
  const second = { ...env, GITHUB_RUN_NUMBER: "2" };
  await verifyCalculatorRecoveryHistory(second, history(undefined, true), true);
  await assert.rejects(() => verifyCalculatorRecoveryHistory(second, history(undefined, true)));
  await assert.rejects(() => verifyCalculatorRecoveryHistory({ ...second, GITHUB_RUN_NUMBER: "3" }, history(undefined, true), true));
  await assert.rejects(() => verifyCalculatorRecoveryHistory(second, history((p, d) => p === "/actions/runs/39446900969" ? { ...d, conclusion: "success" } : d, true), true));
});
test("correction never overwrites, relabels or replays a previous task or successful planning attempt", () => {
  const root = mkdtempSync(join(tmpdir(), "calculator-correction-")), previous = join(root, "prior-recovery");
  try {
    mkdirSync(previous, { mode: 0o700 }); const old = capsule(previous), proof = validateCalculatorFailedPlanningCapsule(previous, request);
    mkdirSync(join(previous, "state"), { mode: 0o700 }); mkdirSync(join(previous, "barrier"), { mode: 0o700 }); mkdirSync(join(root, "prior-recovery-barrier"), { mode: 0o700 });
    copyFileSync(join(old.state, old.name), join(previous, "state", old.name));
    const barrier = { version: 1, goalId: request.goal.id, priorRunId: 39437299742, recoveryRunId: "39446900969", runtimeSha: "4fcdf994f42d204fa6e5f65b1dc1fa52ea5d8ad2", eventSha: "988bed450daf80e0e9602a0b8ddd3fb1f2771bd6", priorManifestDigest: proof.priorManifestDigest, priorStateDigest: proof.priorStateDigest, conservativePriorCharge: CALCULATOR_RECOVERY_CHARGE, authorization: "ONE_REVIEWED_STEP7_RECOVERY", automaticReplay: false };
    const put = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value) + "\n", { mode: 0o600 });
    put(join(previous, "context.json"), { version: 1, runtimeSha: barrier.runtimeSha, eventSha: barrier.eventSha, runId: "39446900969", request });
    put(join(previous, "barrier/recovery.json"), barrier); put(join(root, "prior-recovery-barrier/recovery.json"), barrier);
    const store = new TeamTaskStore(join(previous, "state"), { id: "calc-recovery-" + request.goal.id, fingerprint: digest(barrier) });
    store.claim(); store.recordStage("recovery_plan", "running"); store.finish("blocked", "recovery_stopped_no_replay"); store.close();
    const marker = join(previous, "state/calc-recovery-" + request.goal.id + ".json"), before = readFileSync(marker);
    assert.match(validateCalculatorPriorRecovery(root, request).priorRecoveryReceiptDigest, /^[a-f0-9]{64}$/);
    assert.ok(before.equals(readFileSync(marker))); assert.ok(old.bytes.equals(readFileSync(join(previous, "state", old.name))));
    writeFileSync(marker, before.toString().replace('"blocked"', '"needs-review"'));
    assert.throws(() => validateCalculatorPriorRecovery(root, request));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
