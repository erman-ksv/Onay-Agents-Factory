import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { continueOnayGoal, inspectOnayGoal, planOnayGoal, type GoalDependencies } from "./onayGoal.js";
import { deriveGoalTaskId, prepareGoalRequest, validateGoalPlan, type GoalRequest } from "./onayGoalPlan.js";
import { OnayGoalStore } from "./onayGoalStore.js";
import { prepareTeamTask, type TeamTaskCard } from "./teamTaskCard.js";
import { TeamTaskStore } from "./teamTaskStore.js";
import { runTeamTask, type TeamTaskDependencies, type TeamTaskReport } from "./teamTask.js";

const baseSha = "a".repeat(40), candidateSha = "b".repeat(40);
const liveApproved = { ONAY_TEAM_LIVE_APPROVED: "RUN_ONE_FREE_TASK", ONAY_TEAM_FREE_TIER_CONFIRMED: "true",
  AGENT_FACTORY_ENABLE_GITHUB_WRITES: "true", AGENT_FACTORY_LEGAL_ENABLED: "false" };
function fixture(t: { after: (callback: () => void) => void }, options: { dependent?: boolean; overlapping?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "onay-goal-engine-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input: GoalRequest = { version: 1, id: "rural-onay-journey",
    goal: "Развивать Onay для ежедневных поездок между городком и сёлами. Самостоятельно найти ближайшие проверяемые улучшения пути пассажира и разделить общую цель на задачи. Сохранить правила мест и очереди, а неизвестные требования показать владельцу.",
    baseRef: "feat/owner-approved-working", baseSha, provider: "groq" };
  const request = prepareGoalRequest(input);
  const ids = [deriveGoalTaskId(request, 1), deriveGoalTaskId(request, 2)];
  const paths = ["mobile/tezjet-app/lib/orders.ts", options.overlapping ? "mobile/tezjet-app/lib/orders.ts" : "mobile/tezjet-app/lib/api.ts"];
  const inventory = [...new Set(["package.json", ...paths])].map(path => ({ path, sha: "c".repeat(40), bytes: 80 }));
  const plan = validateGoalPlan(request, inventory, { tasks: ids.map((id, index) => ({
    id, goal: "Исправить отображение состояния заказа пассажира.", acceptanceCriteria: ["Текущая поездка сохраняется после обновления."],
    profile: "mobile", changePaths: [paths[index]], contextPaths: [], dependsOn: index === 1 && options.dependent ? [ids[0]] : [],
    evidencePaths: [paths[index]],
  })), blockers: [], unverifiedAreas: [] }, inventory.map(file => file.path));
  const calls: string[] = [];
  const candidate = (card: TeamTaskCard): TeamTaskReport => {
    const task = prepareTeamTask(card);
    return { version: 1, taskId: task.id, fingerprint: task.fingerprint, execution: "live", status: "completed",
      reasonCode: "verified_candidate", repository: task.repository, baseSha: task.baseSha, branch: task.branch,
      legalReview: "disabled", mergePerformed: false, deploymentPerformed: false, changedPaths: [...task.changePaths],
      readPaths: [...task.explorerPaths], proposedPaths: [...task.changePaths], contextCoverage: {}, advisoryFindings: {},
      publication: { number: 42, headSha: candidateSha, url: "https://github.com/erman-ksv/Onay/pull/42" }, testedSha: candidateSha,
      gates: { security: true, policyReview: true, testsExecuted: true, independentAdvice: true }, unverifiedAreas: [] };
  };
  const dependencies: GoalDependencies = {
    getHead: async ref => { calls.push("getHead"); assert.equal(ref, input.baseRef); return baseSha; },
    plan: async received => { calls.push("plan"); assert.deepEqual(received, request); return structuredClone(plan); },
    execute: async card => { calls.push("execute:" + card.id); return candidate(card); },
    verify: async card => { calls.push("verify:" + card.id); return { taskId: card.id, status: "needs-review", reasonCode: "candidate_ci_unverified",
      candidateSha, url: "https://github.com/erman-ksv/Onay/pull/42", testsExecuted: false, modelRequests: 0,
      githubWrites: false, overallTaskCompletionVerified: false }; },
  };
  return { directory, input, request, ids, paths, plan, calls, candidate, dependencies,
    planGoal: () => planOnayGoal(input, directory, dependencies),
    continueGoal: () => continueOnayGoal(input, directory, dependencies),
    inspect: () => inspectOnayGoal(input, directory),
    receipt: () => JSON.parse(readFileSync(join(directory, input.id + ".goal.json"), "utf8")),
  };
}

test("one broad Russian owner goal becomes a saved bounded batch and repeated planning never calls the model again", async t => {
  const setup = fixture(t);
  const planned = await setup.planGoal();
  assert.equal(planned.status, "planned"); assert.equal(planned.tasks.length, 2);
  assert.equal(planned.wholeAppCompleted, false); assert.equal(planned.mergePerformed, false);
  assert.deepEqual(setup.calls, ["getHead", "plan", "getHead"]);
  const before = setup.receipt();
  const again = await setup.planGoal();
  assert.equal(again.reasonCode, "existing_backlog_no_replan");
  assert.deepEqual(setup.calls, ["getHead", "plan", "getHead"]);
  assert.deepEqual(setup.receipt(), before);
  assert.equal(setup.inspect().reasonCode, "offline_receipt_inspection_only");
  assert.equal(setup.inspect().wholeAppCompleted, false);
});

test("a changed base before or after planning persists a blocked batch and no execution", async t => {
  for (const when of ["before", "after"] as const) await t.test(when, async t => {
    const setup = fixture(t);
    let reads = 0;
    setup.dependencies.getHead = async () => ++reads >= (when === "before" ? 1 : 2) ? "d".repeat(40) : baseSha;
    const result = await setup.planGoal();
    assert.equal(result.status, "blocked"); assert.equal(result.reasonCode, "base_changed");
    assert.equal(setup.calls.includes("plan"), when === "after");
    assert.equal(setup.receipt().status, "blocked");
    assert.ok(!setup.calls.some(call => call.startsWith("execute:")));
    await setup.planGoal();
    assert.equal(setup.calls.filter(call => call === "plan").length, when === "after" ? 1 : 0);
  });
});

test("planning HTTP 429 persists a fixed blocked result and repeated invocations never retry", async t => {
  const setup = fixture(t);
  setup.dependencies.plan = async () => { setup.calls.push("plan-429"); throw new Error("HTTP 429 PRIVATE_DIAGNOSTIC"); };
  const result = await setup.planGoal();
  assert.equal(result.status, "blocked"); assert.equal(result.reasonCode, "planning_failed_no_retry");
  assert.equal(setup.receipt().tasks.length, 0);
  assert.ok(!JSON.stringify(setup.receipt()).includes("PRIVATE_DIAGNOSTIC"));
  await setup.planGoal(); await setup.continueGoal();
  assert.deepEqual(setup.calls, ["getHead", "plan-429"]);
});

test("a stale planning lock prevents another plan and is not silently removed", async t => {
  const setup = fixture(t), lock = join(setup.directory, setup.input.id + ".goal.planning.lock");
  writeFileSync(lock, "", { mode: 0o600 });
  await assert.rejects(setup.planGoal());
  assert.deepEqual(setup.calls, []);
  assert.deepEqual(readdirSync(setup.directory), [setup.input.id + ".goal.planning.lock"]);
});

test("each cycle executes at most one independent task and batch completion never means application completion", async t => {
  const setup = fixture(t); await setup.planGoal();
  const first = await setup.continueGoal();
  assert.equal(first.status, "waiting");
  assert.deepEqual(first.tasks.map(task => task.status), ["completed", "queued"]);
  assert.equal(setup.calls.filter(call => call.startsWith("execute:")).length, 1);
  const second = await setup.continueGoal();
  assert.equal(setup.calls.filter(call => call.startsWith("execute:")).length, 2);
  assert.equal(second.status, "batch-candidates-ready");
  assert.equal(second.wholeAppCompleted, false);
  assert.equal(second.legalReview, "disabled"); assert.equal(second.mergePerformed, false);
  const calls = [...setup.calls]; await setup.continueGoal(); assert.deepEqual(setup.calls, calls);
});

test("a base change before continuation starts no task or model execution", async t => {
  const setup = fixture(t); await setup.planGoal();
  setup.dependencies.getHead = async () => "d".repeat(40);
  const result = await setup.continueGoal();
  assert.equal(result.reasonCode, "base_changed_plan_new_snapshot");
  assert.deepEqual(result.tasks.map(task => task.status), ["queued", "queued"]);
  assert.ok(!setup.calls.some(call => call.startsWith("execute:")));
});

test("mismatched live evidence identities and offline fake results cannot complete a goal task", async t => {
  const variants: Array<[string, (report: TeamTaskReport) => void]> = [
    ["offline-test", report => { report.execution = "offline-test"; }],
    ["different task", report => { report.taskId = "unrelated-task"; }],
    ["different fingerprint", report => { report.fingerprint = "d".repeat(64); }],
    ["different repository", report => { report.repository = "someone/other"; }],
    ["different base SHA", report => { report.baseSha = "d".repeat(40); }],
    ["different branch", report => { report.branch = "feat/unrelated"; }],
  ];
  for (const [name, alter] of variants) await t.test(name, async t => {
    const setup = fixture(t); await setup.planGoal();
    setup.dependencies.execute = async card => { const result = setup.candidate(card); alter(result); return result; };
    const result = await setup.continueGoal();
    assert.equal(result.status, "blocked");
    assert.equal(result.tasks[0].status, "blocked");
    assert.equal(result.tasks[0].reasonCode, "task_interrupted_inspect_receipts_and_github");
    assert.equal(result.wholeAppCompleted, false);
  });
});

test("a completed prose verdict without every execution gate cannot complete a task", async t => {
  for (const gate of ["security", "policyReview", "testsExecuted", "independentAdvice"] as const) await t.test(gate, async t => {
    const setup = fixture(t); await setup.planGoal();
    setup.dependencies.execute = async card => { const result = setup.candidate(card); result.gates[gate] = false; return result; };
    const result = await setup.continueGoal();
    assert.equal(result.tasks[0].status, "blocked");
    assert.equal(result.wholeAppCompleted, false);
  });
});

test("pending candidate CI is checked once per cycle without another Coder or idle polling", async t => {
  const setup = fixture(t); await setup.planGoal();
  setup.dependencies.execute = async card => { setup.calls.push("execute:" + card.id); const result = setup.candidate(card);
    result.status = "needs-review"; result.gates.testsExecuted = false; delete result.testedSha; return result; };
  assert.equal((await setup.continueGoal()).tasks[0].status, "awaiting-ci");
  const result = await setup.continueGoal();
  assert.equal(result.reasonCode, "awaiting_ci_no_polling");
  assert.equal(result.tasks[0].reasonCode, "ci_pending_or_unverified");
  assert.equal(setup.calls.filter(call => call.startsWith("execute:")).length, 1);
  assert.equal(setup.calls.filter(call => call.startsWith("verify:")).length, 1);
});

test("successful CI alone keeps a prior candidate awaiting acceptance and cannot reconstruct independent execution", async t => {
  const setup = fixture(t); await setup.planGoal();
  setup.dependencies.execute = async card => { const result = setup.candidate(card); result.status = "needs-review";
    result.gates.testsExecuted = false; delete result.testedSha; return result; };
  await setup.continueGoal();
  setup.dependencies.verify = async card => ({ taskId: card.id, status: "ci-verified", reasonCode: "exact_candidate_ci_verified",
    candidateSha, url: "https://github.com/erman-ksv/Onay/pull/42", testsExecuted: true,
    modelRequests: 0, githubWrites: false, overallTaskCompletionVerified: false });
  const result = await setup.continueGoal();
  assert.equal(result.tasks[0].status, "awaiting-ci");
  assert.equal(result.tasks[0].reasonCode, "ci_verified_review_required");
  assert.equal(result.reasonCode, "ci_verified_prior_execution_and_acceptance_not_reconstructed");
  assert.equal(result.wholeAppCompleted, false);
});

test("dependent cards and overlapping published paths wait for an integrated base instead of running stale source", async t => {
  for (const options of [{ dependent: true }, { overlapping: true }]) await t.test(JSON.stringify(options), async t => {
    const setup = fixture(t, options); await setup.planGoal(); await setup.continueGoal();
    const result = await setup.continueGoal();
    assert.equal(result.reasonCode, "dependencies_or_overlapping_draft_require_integrated_base");
    assert.equal(result.tasks[1].status, "queued"); assert.equal(result.tasks[1].reasonCode, "waiting_integration");
    assert.equal(setup.calls.filter(call => call.startsWith("execute:")).length, 1);
    assert.equal(result.wholeAppCompleted, false);
  });
});

test("interrupted execution becomes blocked and is never automatically repeated", async t => {
  const setup = fixture(t); await setup.planGoal();
  setup.dependencies.execute = async () => { setup.calls.push("interrupted-execute"); throw new Error("PRIVATE_SOURCE_DIAGNOSTIC"); };
  const result = await setup.continueGoal();
  assert.equal(result.status, "blocked"); assert.equal(result.reasonCode, "task_interrupted_no_replay");
  assert.ok(!JSON.stringify(result).includes("PRIVATE_SOURCE_DIAGNOSTIC"));
  const before = [...setup.calls]; await setup.continueGoal(); assert.deepEqual(setup.calls, before);
});

test("a task persisted running at process interruption refuses continuation before another dependency call", async t => {
  const setup = fixture(t); await setup.planGoal();
  const store = new OnayGoalStore(setup.directory, setup.request.id, setup.request.fingerprint);
  store.beginCycle(); store.updateTask(setup.ids[0], { status: "running", reasonCode: "bounded_team_task_started" }); store.close();
  const before = [...setup.calls];
  await assert.rejects(setup.continueGoal(), /interrupted work/);
  assert.deepEqual(setup.calls, before);
  assert.equal(setup.receipt().tasks[0].status, "running");
});

test("the actual bounded task receipt prevents goal-level replay without generation or writes", async t => {
  const setup = fixture(t); await setup.planGoal();
  const taskDirectory = join(setup.directory, "bounded-tasks"); mkdirSync(taskDirectory, { mode: 0o700 });
  const card = setup.plan.tasks[0].card, prepared = prepareTeamTask(card);
  const seed = new TeamTaskStore(taskDirectory, { id: prepared.id, fingerprint: prepared.fingerprint });
  seed.claim(); seed.recordStage("code_onay", "running"); seed.close();
  const unexpected = async (): Promise<never> => { assert.fail("A prior receipt must prevent all bounded dependency calls"); };
  const dependencies: TeamTaskDependencies = {
    getHead: unexpected, getCandidateHead: unexpected, explore: unexpected, generatePatch: unexpected, assess: unexpected,
    inspectSecurity: unexpected, discoverTests: unexpected, publish: unexpected, verify: unexpected,
    review: () => { assert.fail("No policy replay"); }, scan: () => { assert.fail("No scanner replay"); },
  };
  setup.dependencies.execute = current => runTeamTask(current, { stateDirectory: taskDirectory, env: liveApproved,
    dependencies, execution: "live" });
  const result = await setup.continueGoal();
  assert.equal(result.status, "blocked"); assert.equal(result.tasks[0].status, "blocked");
  assert.equal(result.tasks[0].reasonCode, "task_blocked_no_replay");
  const before = [...setup.calls]; await setup.continueGoal(); assert.deepEqual(setup.calls, before);
});
