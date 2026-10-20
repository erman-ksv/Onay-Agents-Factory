import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
import { CALCULATOR_ACCEPTANCE, CALCULATOR_PLAN_ERROR, calculatorPlanTaskId, createCalculatorPlan,
  prepareCalculatorGoal, buildCalculatorPlanningInstructions, type CalculatorPlanTask } from "./calculatorPlan.js";
import { CalculatorPlanStore, type CalculatorDependencyEvidence } from "./calculatorPlanStore.js";
import type { TeamTaskSnapshot } from "./teamTaskStore.js";

const owner = { version: 1, id: "calculator-project", goal: "Create the complete agreed calculator website with tested arithmetic and a usable mobile browser interface.",
  baseRef: "feat/calculator-pilot-bootstrap", baseSha: "a".repeat(40), provider: "groq" };
const id = (index: number) => calculatorPlanTaskId(owner, index);
function proposal() {
  return { tasks: [
    { id: id(1), role: "coder", goal: "Implement arithmetic and meaningful module tests.", acceptanceIds: CALCULATOR_ACCEPTANCE.slice(0, 7).map(item => item.id),
      paths: ["src/calculator.mjs", "test/calculator.test.mjs"], dependsOn: [] as string[] },
    { id: id(2), role: "frontend", goal: "Implement responsive calculator controls using the arithmetic interface.", acceptanceIds: CALCULATOR_ACCEPTANCE.slice(7).map(item => item.id),
      paths: ["index.html", "styles.css", "src/app.mjs"], dependsOn: [id(1)] },
    { id: id(3), role: "frontend", goal: "Add meaningful user interaction regression tests.", acceptanceIds: ["keyboard", "zero-recovery", "narrow-screen"],
      paths: ["test/ui.test.mjs"], dependsOn: [id(2)] },
  ], blockers: [] as string[], unverifiedAreas: ["Browser behavior has not yet been checked."] };
}
const refusal = (error: unknown) => { assert.ok(error instanceof Error); assert.equal(error.message, CALCULATOR_PLAN_ERROR); return true; };
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "calculator-plan-"));
  const store = new CalculatorPlanStore(directory, owner);
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  return { directory, store, cleanup, planPath: join(directory, owner.id + ".calculator-plan.json"),
    markerPath: join(directory, "calc-plan-" + owner.id + ".json") };
}
function verified(taskId: string, candidateSha: string, integratedAtSha: string): CalculatorDependencyEvidence {
  return { repository: CALCULATOR_PROFILE.repository, taskId, candidateSha, integratedAtSha,
    securityReady: true, independentReviewReady: true, taskChecksPassed: true, testsExecuted: true };
}

test("whole-project plan covers every fixed scenario and all source/test paths without granting completion", () => {
  const plan = createCalculatorPlan(owner, proposal());
  assert.equal(plan.status, "planned"); assert.equal(plan.tasks.length, 3); assert.equal(plan.wholeAppCompleted, false);
  assert.equal(plan.publicationAuthorized, false); assert.equal(plan.owner.repository, CALCULATOR_PROFILE.repository);
  assert.ok(Object.isFrozen(plan.tasks[0].paths)); assert.ok(Object.isFrozen(plan.request));
  assert.deepEqual([...new Set(plan.tasks.flatMap(task => task.paths))].sort(), [...CALCULATOR_PROFILE.writablePaths].sort());
  assert.equal(new Set(plan.tasks.flatMap(task => task.acceptanceIds)).size, 11);
  assert.equal(createCalculatorPlan(owner, proposal()).fingerprint, plan.fingerprint);
  assert.notEqual(createCalculatorPlan({ ...owner, goal: owner.goal + " Preserve all agreed behavior." }, {
    tasks: [], blockers: ["Source scope needs reinspection."], unverifiedAreas: [],
  }).owner.ownerFingerprint, plan.owner.ownerFingerprint);
});
test("owner and model cannot override target, requirements, provider, roles or status", () => {
  for (const input of [{ ...owner, repository: "erman-ksv/Onay" }, { ...owner, provider: "openai" }, { ...owner, baseSha: "short" },
    { ...owner, baseRef: "refs/heads/main" }, { ...owner, id: "../goal" }, { ...owner, goal: "ghp_" + "A".repeat(24) },
    { ...owner, goal: "export const privateSource = 1;" }]) assert.throws(() => prepareCalculatorGoal(input), refusal);
  for (const field of ["status", "repository", "requirementsSha256", "publicationAuthorized", "testsExecuted"])
    assert.throws(() => createCalculatorPlan(owner, { ...proposal(), [field]: true }), refusal);
  for (const index of [0, 9, 1.5]) assert.throws(() => calculatorPlanTaskId(owner, index), refusal);
});
test("honest missing coverage is blocked and visibly retained", () => {
  const raw = proposal(); raw.tasks = [raw.tasks[0]];
  const plan = createCalculatorPlan(owner, raw);
  assert.equal(plan.status, "blocked"); assert.ok(plan.blockers.some(item => item.includes("keyboard")));
  assert.ok(plan.blockers.some(item => item.includes("index.html"))); assert.equal(plan.tasks.length, 1);
  const empty = createCalculatorPlan(owner, { tasks: [], blockers: ["No valid implementation task can be proven."], unverifiedAreas: [] });
  assert.equal(empty.status, "blocked"); assert.equal(empty.tasks.length, 0);
});
test("invalid task authority, forged criteria and dependency cycles are refused", async t => {
  for (const name of ["role", "id", "unknown-criterion", "expected-answer", "workflow", "wrong-role-path", "too-many-paths", "unknown-dependency", "self", "cycle", "missing-core-dependency", "unordered-overlap", "task-status"]) await t.test(name, () => {
    const raw = proposal();
    if (name === "role") raw.tasks[0].role = "security";
    if (name === "id") raw.tasks[0].id = "model-selected-id";
    if (name === "unknown-criterion") raw.tasks[0].acceptanceIds.push("rewritten-answer");
    if (name === "expected-answer") Object.assign(raw.tasks[0], { expectedAnswers: ["2+3=7"] });
    if (name === "workflow") raw.tasks[0].paths = [".github/workflows/ci.yml"];
    if (name === "wrong-role-path") raw.tasks[0].paths = ["index.html"];
    if (name === "too-many-paths") raw.tasks[1].paths.push("test/ui.test.mjs");
    if (name === "unknown-dependency") raw.tasks[1].dependsOn = ["invented-task"];
    if (name === "self") raw.tasks[0].dependsOn = [id(1)];
    if (name === "cycle") raw.tasks[0].dependsOn = [id(3)];
    if (name === "missing-core-dependency") raw.tasks[1].dependsOn = [];
    if (name === "unordered-overlap") { raw.tasks[2].paths = ["index.html"]; raw.tasks[2].dependsOn = [id(1)]; }
    if (name === "task-status") Object.assign(raw.tasks[0], { status: "completed" });
    assert.throws(() => createCalculatorPlan(owner, raw), refusal);
  });
});
test("planning instructions expose fixed answers and task IDs, never execution or branch authority", () => {
  const instructions = buildCalculatorPlanningInstructions(owner);
  assert.ok(instructions.includes(id(1)) && instructions.includes(id(8)));
  assert.ok(instructions.includes("2 + 3 = 5")); assert.ok(instructions.includes(owner.baseSha));
  assert.ok(instructions.includes("all six source/test paths")); assert.ok(instructions.includes("legal agent"));
});
test("immutable private plan restores with the same fingerprint and cannot be silently replaced", () => {
  const f = fixture();
  try {
    assert.equal(f.store.inspect(), undefined);
    const plan = f.store.initialize(proposal());
    assert.equal(statSync(f.planPath).mode & 0o777, 0o600); assert.equal(statSync(f.directory).mode & 0o777, 0o700);
    assert.equal(new CalculatorPlanStore(f.directory, owner).inspect()!.fingerprint, plan.fingerprint);
    const before = readFileSync(f.planPath, "utf8");
    assert.equal(f.store.initialize(proposal()).fingerprint, plan.fingerprint); assert.equal(readFileSync(f.planPath, "utf8"), before);
    const changed = proposal(); changed.tasks[0].goal += " Change one detail.";
    assert.throws(() => f.store.initialize(changed), refusal); assert.equal(readFileSync(f.planPath, "utf8"), before);
    assert.throws(() => new CalculatorPlanStore(f.directory, { ...owner, goal: owner.goal + " Changed." }).inspect());
  } finally { f.cleanup(); }
});
test("deleting either plan or marker and interrupted initialization never enable replanning", async t => {
  for (const name of ["missing-plan", "missing-marker", "running-marker", "fingerprint"]) await t.test(name, () => {
    const f = fixture();
    try {
      f.store.initialize(proposal());
      if (name === "missing-plan") unlinkSync(f.planPath);
      if (name === "missing-marker") unlinkSync(f.markerPath);
      if (name === "running-marker") { const data = JSON.parse(readFileSync(f.markerPath, "utf8")); data.status = "running"; delete data.reasonCode; writeFileSync(f.markerPath, JSON.stringify(data)); }
      if (name === "fingerprint") { const data = JSON.parse(readFileSync(f.planPath, "utf8")); data.fingerprint = "f".repeat(64); writeFileSync(f.planPath, JSON.stringify(data)); }
      assert.throws(() => f.store.inspect()); assert.throws(() => f.store.initialize(proposal()));
    } finally { f.cleanup(); }
  });
});
test("recomputed document fingerprint cannot replace the separately anchored saved plan", () => {
  const f = fixture();
  try {
    f.store.initialize(proposal());
    const raw = proposal(); raw.tasks[0].goal += " Changed after saving.";
    const replacement = createCalculatorPlan(owner, raw);
    writeFileSync(f.planPath, JSON.stringify({ version: 1, request: owner, proposal: replacement.proposal, fingerprint: replacement.fingerprint }));
    assert.throws(() => f.store.inspect(), refusal);
  } finally { f.cleanup(); }
});
test("symlinks, hardlinks, public permissions and replaced state roots are rejected", async t => {
  for (const name of ["symlink", "hardlink", "mode", "root-mode", "root-replaced"]) await t.test(name, () => {
    const f = fixture();
    try {
      f.store.initialize(proposal());
      if (name === "symlink") { const target = join(f.directory, "outside.json"); writeFileSync(target, "{}"); unlinkSync(f.planPath); symlinkSync(target, f.planPath); }
      if (name === "hardlink") linkSync(f.planPath, join(f.directory, "extra.json"));
      if (name === "mode") chmodSync(f.planPath, 0o644);
      if (name === "root-mode") chmodSync(f.directory, 0o755);
      if (name === "root-replaced") { renameSync(f.directory, f.directory + ".old"); mkdirSync(f.directory, { mode: 0o700 }); }
      assert.throws(() => f.store.inspect());
    } finally { f.cleanup(); rmSync(f.directory + ".old", { recursive: true, force: true }); }
  });
});
test("selection is read-only and does not treat a changed base or blocked plan as executable", async () => {
  const f = fixture();
  try {
    f.store.initialize(proposal()); const files = readdirSync(f.directory);
    const first = await f.store.select({ currentBaseSha: owner.baseSha });
    assert.equal(first.status, "ready"); assert.equal(first.task!.id, id(1)); assert.equal(first.wholeAppCompleted, false);
    assert.deepEqual(readdirSync(f.directory), files);
    assert.equal((await f.store.select({ currentBaseSha: "d".repeat(40) })).reasonCode, "initial_base_changed");
  } finally { f.cleanup(); }
  const other = fixture();
  try {
    other.store.initialize({ tasks: [], blockers: ["Source evidence is missing."], unverifiedAreas: [] });
    assert.equal((await other.store.select({ currentBaseSha: owner.baseSha })).status, "blocked");
  } finally { other.cleanup(); }
});
test("claim is durable before execution; restart refuses replay of a running task", async () => {
  const f = fixture();
  try {
    f.store.initialize(proposal()); const claimed = await f.store.claimNext({ currentBaseSha: owner.baseSha });
    assert.ok(claimed.store); assert.equal(claimed.store.snapshot().status, "running"); claimed.store.close();
    const restarted = new CalculatorPlanStore(f.directory, owner);
    const next = await restarted.claimNext({ currentBaseSha: owner.baseSha });
    assert.equal(next.selection.status, "needs-review"); assert.equal(next.store, undefined);
    assert.equal(next.selection.reasonCode, "interrupted_or_running_task_no_replay");
  } finally { f.cleanup(); }
});
test("two concurrent claim attempts cannot start the same task twice", async () => {
  const f = fixture();
  try {
    f.store.initialize(proposal());
    const outcomes = await Promise.allSettled([f.store.claimNext({ currentBaseSha: owner.baseSha }),
      new CalculatorPlanStore(f.directory, owner).claimNext({ currentBaseSha: owner.baseSha })]);
    const winners = outcomes.filter(result => result.status === "fulfilled" && result.value.store);
    assert.equal(winners.length, 1);
    for (const result of outcomes) if (result.status === "fulfilled") result.value.store?.close();
  } finally { f.cleanup(); }
});
test("completed labels and pending CI do not unlock dependencies without fresh host evidence", async t => {
  for (const status of ["completed", "needs-review"] as const) await t.test(status, async () => {
    const f = fixture();
    try {
      const plan = f.store.initialize(proposal()); const claimed = await f.store.claimNext({ currentBaseSha: owner.baseSha });
      claimed.store!.recordPublication({ branch: plan.branch, headSha: "c".repeat(40), number: 1,
        url: "https://github.com/" + plan.owner.repository + "/pull/1" });
      claimed.store!.finish(status, "offline_fixture_not_live_proof"); claimed.store!.close();
      assert.equal((await f.store.select({ currentBaseSha: "c".repeat(40) })).status, "needs-review");
      let checks = 0;
      const next = await f.store.select({ currentBaseSha: "c".repeat(40), verifyTask: async (task, receipt, sha) => {
        checks++; return verified(task.id, receipt.publication!.headSha, sha);
      } });
      assert.equal(checks, 1); assert.equal(next.status, "ready"); assert.equal(next.task!.id, id(2));
      assert.equal(next.publicationAuthorized, false); assert.equal(next.wholeAppCompleted, false);
    } finally { f.cleanup(); }
  });
});
test("wrong integration, candidate, scope or a failed gate never unlocks the next task", async t => {
  for (const field of ["repository", "taskId", "candidateSha", "integratedAtSha", "securityReady", "independentReviewReady", "taskChecksPassed", "testsExecuted", "throws"]) await t.test(field, async () => {
    const f = fixture();
    try {
      const plan = f.store.initialize(proposal()); const claim = await f.store.claimNext({ currentBaseSha: owner.baseSha });
      claim.store!.recordPublication({ branch: plan.branch, headSha: "c".repeat(40), number: 1, url: "https://github.com/" + plan.owner.repository + "/pull/1" });
      claim.store!.finish("completed", "offline_fixture_not_live_proof"); claim.store!.close();
      const selected = await f.store.select({ currentBaseSha: "c".repeat(40), verifyTask: async (task, receipt, sha) => {
        if (field === "throws") throw new Error("PRIVATE_UPSTREAM_DIAGNOSTIC");
        const result = verified(task.id, receipt.publication!.headSha, sha);
        return { ...result, [field]: typeof result[field as keyof CalculatorDependencyEvidence] === "boolean" ? false : "wrong" } as CalculatorDependencyEvidence;
      } });
      assert.equal(selected.status, "needs-review"); assert.equal(selected.task, undefined);
    } finally { f.cleanup(); }
  });
});
test("foreign publication and blocked receipts cannot be reused as a successful dependency", async t => {
  for (const name of ["foreign", "branch", "blocked", "no-publication"]) await t.test(name, async () => {
    const f = fixture();
    try {
      const plan = f.store.initialize(proposal()), claim = await f.store.claimNext({ currentBaseSha: owner.baseSha });
      if (name !== "no-publication") claim.store!.recordPublication({ branch: name === "branch" ? "main" : plan.branch, headSha: "c".repeat(40), number: 1,
        url: "https://github.com/" + (name === "foreign" ? "erman-ksv/Onay" : plan.owner.repository) + "/pull/1" });
      claim.store!.finish(name === "blocked" ? "blocked" : "completed", "offline_fixture_not_live_proof"); claim.store!.close();
      let checks = 0;
      const next = await f.store.select({ currentBaseSha: "c".repeat(40), verifyTask: async () => { checks++; return undefined; } });
      assert.equal(next.status, name === "blocked" ? "blocked" : "needs-review"); assert.equal(checks, 0);
    } finally { f.cleanup(); }
  });
});
test("all fresh task checks still do not certify the whole application", async () => {
  const f = fixture();
  try {
    const plan = f.store.initialize(proposal()); let base = owner.baseSha;
    const verifyTask = async (task: CalculatorPlanTask, receipt: TeamTaskSnapshot, sha: string) =>
      verified(task.id, receipt.publication!.headSha, sha);
    for (let index = 0; index < plan.tasks.length; index++) {
      const next = await f.store.claimNext({ currentBaseSha: base, verifyTask }); assert.ok(next.store);
      base = String(index + 1).repeat(40);
      next.store.recordPublication({ branch: plan.branch, headSha: base, number: 1, url: "https://github.com/" + plan.owner.repository + "/pull/1" });
      next.store.finish("completed", "offline_fixture_not_live_proof"); next.store.close();
    }
    const selected = await f.store.select({ currentBaseSha: base, verifyTask });
    assert.equal(selected.status, "all-candidates-verified"); assert.equal(selected.verifiedTaskIds.length, 3);
    assert.equal(selected.wholeAppCompleted, false); assert.equal(selected.publicationAuthorized, false);
  } finally { f.cleanup(); }
});
