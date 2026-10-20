import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveGoalTaskId, GOAL_PLAN_LIMITS, isGoalInventoryPath, prepareGoalInventory,
  prepareGoalRequest, validateGoalPlan, type GoalInventoryFile, type GoalRequest,
} from "./onayGoalPlan.js";

const ORDER = "mobile/tezjet-app/lib/orders.ts";
const TEST = "mobile/tezjet-app/test/orders.test.mjs";
const CONTROLLER = "artifacts/api-server/src/controllers/orderController.ts";
function request(): GoalRequest {
  return { version: 1, id: "onay-whole-app", goal: "Довести приложение Onay до удобной поездки пассажира и водителя.",
    baseRef: "feat/onay-current", baseSha: "a".repeat(40), provider: "cloudflare" };
}
function inventory(): GoalInventoryFile[] {
  return ["package.json", ORDER, TEST, CONTROLLER, "docs/ARCHITECTURE.md"].map((path, index) => ({
    path, sha: String(index + 1).repeat(40), bytes: 100,
  }));
}
function task(ordinal = 1) {
  return { id: deriveGoalTaskId(request(), ordinal), goal: "Исправить восстановление текущего заказа пассажира.",
    acceptanceCriteria: ["После восстановления соединения текущий заказ сохраняется."], profile: "mobile",
    changePaths: [ORDER], contextPaths: ["package.json", TEST], dependsOn: [] as string[], evidencePaths: [ORDER, TEST] };
}
function plan() { return { tasks: [task()], blockers: [] as string[], unverifiedAreas: [] as string[] }; }

test("a whole-product owner goal becomes a pinned canonical request without write authority", () => {
  const goal = prepareGoalRequest(request());
  assert.equal(goal.repository, "erman-ksv/Onay");
  assert.match(goal.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(goal.baseSha, request().baseSha);
  assert.equal("writesEnabled" in goal, false);
  assert.equal("legalEnabled" in goal, false);
  assert.equal(prepareGoalRequest({ ...request(), baseSha: "A".repeat(40) }).fingerprint, goal.fingerprint);
});

test("request shape cannot choose another repository or smuggle execution policy", () => {
  for (const key of ["repository", "fingerprint", "writesEnabled", "legalEnabled", "allowWorkflowChanges", "model"]) {
    assert.throws(() => prepareGoalRequest({ ...request(), [key]: "override" }), /Invalid Onay owner goal/);
  }
  for (const provider of ["openai", "openrouter", "mistral", "auto"]) {
    assert.throws(() => prepareGoalRequest({ ...request(), provider }), /Invalid Onay owner goal/);
  }
});

test("raw source, secret values and source-bearing unknown fields are rejected without echo", () => {
  for (const goal of ["```ts\nprivate source\n```", "const privateSource = 'not for metadata';",
    "Use this credential: ghp_" + "x".repeat(24), "authorization=Bearer-private-secret-value"]) {
    assert.throws(() => prepareGoalRequest({ ...request(), goal }), error => {
      assert.equal(String(error).includes(goal), false); return /Invalid Onay owner goal/.test(String(error));
    });
  }
  assert.throws(() => prepareGoalRequest({ ...request(), content: "private source" }), /Invalid Onay owner goal/);
});

test("owner goal/ref/SHA/ID bounds fail closed with source-free diagnostics", () => {
  for (const patch of [{ goal: "g".repeat(GOAL_PLAN_LIMITS.maxGoalCharacters + 1) }, { id: "../escape" },
    { id: "x".repeat(49) }, { baseSha: "main" }, { baseRef: "main; private shell" },
    { goal: "Modify Onay-Agents-Factory itself." }]) {
    assert.throws(() => prepareGoalRequest({ ...request(), ...patch }), /Invalid Onay owner goal/);
  }
});

test("inventory contains bounded immutable metadata, never source", () => {
  const input = inventory();
  input[0].sha = "A".repeat(40);
  const result = prepareGoalInventory(input);
  assert.equal(result[0].sha, "a".repeat(40));
  input[0].path = ORDER;
  assert.equal(result[0].path, "package.json");
  assert.throws(() => prepareGoalInventory([{ ...inventory()[0], content: "private source" }]), /Invalid bounded host/);
  assert.throws(() => prepareGoalInventory([inventory()[0], inventory()[0]]), /Invalid bounded host/);
  assert.throws(() => prepareGoalInventory([{ ...inventory()[0], sha: "branch" }]), /Invalid bounded host/);
  assert.throws(() => prepareGoalInventory([{ ...inventory()[0], bytes: -1 }]), /Invalid bounded host/);
});

test("inventory allowlist excludes workflow/config/schema paths and traversal", () => {
  for (const path of [ORDER, TEST, CONTROLLER, "docs/ARCHITECTURE.md", "package.json"]) assert.equal(isGoalInventoryPath(path), true);
  for (const path of [".env", ".github/workflows/ci.yml", "artifacts/api-server/migrations/001.sql",
    "mobile/tezjet-app/app/../config.ts", "docs/.private/SECRET.md", "package-lock.json", "other/repo.ts"]) {
    assert.equal(isGoalInventoryPath(path), false);
    assert.throws(() => prepareGoalInventory([{ path, sha: "a".repeat(40) }]), /Invalid bounded host/);
  }
});

test("inventory file and exact serialized-byte limits reject oversized trees", () => {
  assert.throws(() => prepareGoalInventory(Array.from({ length: 301 }, (_, i) => ({
    path: "mobile/tezjet-app/lib/a" + i + ".ts", sha: "a".repeat(40),
  }))), /Invalid bounded host/);
  assert.throws(() => prepareGoalInventory(Array.from({ length: 200 }, (_, i) => ({
    path: "mobile/tezjet-app/lib/" + "a".repeat(120) + i + ".ts", sha: "a".repeat(40),
  }))), /Invalid bounded host/);
});

test("task IDs are host-derived, deterministic and collision-resistant for long owner IDs", () => {
  const first = { ...request(), id: "a".repeat(47) + "b" };
  const second = { ...request(), id: "a".repeat(47) + "c" };
  assert.notEqual(deriveGoalTaskId(first, 1), deriveGoalTaskId(second, 1));
  assert.ok(deriveGoalTaskId(first, 1).length <= 48);
  assert.equal(deriveGoalTaskId(request(), 1), deriveGoalTaskId(prepareGoalRequest(request()), 1));
  assert.throws(() => deriveGoalTaskId(request(), 0), /Invalid bounded Onay goal plan/);
  assert.throws(() => deriveGoalTaskId(request(), 7), /Invalid bounded Onay goal plan/);
});

test("inspected-source plan injects owner scope and keeps unrelated source explicitly unverified", () => {
  const result = validateGoalPlan(request(), inventory(), plan(), [ORDER, TEST]);
  assert.equal(result.status, "planned");
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].card.provider, request().provider);
  assert.equal(result.tasks[0].card.baseSha, request().baseSha);
  assert.equal(result.tasks[0].card.baseRef, request().baseRef);
  assert.equal(result.tasks[0].id, deriveGoalTaskId(request(), 1));
  assert.ok(result.unverifiedAreas.some(value => value.includes("3 inventory files were not inspected")));
  assert.ok(result.unverifiedAreas.some(value => value.includes("not a complete product roadmap")));
  assert.ok(result.unverifiedAreas.some(value => value.includes("legal-agent authority")));
});

test("metadata-only planning cannot assert source evidence or authorize execution", () => {
  const input = plan(); input.tasks[0].evidencePaths = [];
  const result = validateGoalPlan(request(), inventory(), input);
  assert.equal(result.status, "needs-owner-decision");
  assert.equal(result.tasks.length, 1);
  assert.ok(result.blockers.some(value => value.includes("No source files were inspected")));
  assert.ok(result.unverifiedAreas.some(value => value.includes("change files lack inspected-source evidence")));
  assert.equal(result.tasks[0].card.changePaths[0], ORDER);
  assert.throws(() => validateGoalPlan(request(), inventory(), plan()), /Invalid bounded Onay goal plan/);
});

test("inspected unrelated source does not prove proposed change coverage", () => {
  const input = plan(); input.tasks[0].evidencePaths = [TEST];
  const result = validateGoalPlan(request(), inventory(), input, [TEST]);
  assert.equal(result.status, "needs-owner-decision");
  assert.ok(result.blockers.some(value => value.includes("each proposed change file")));
});

test("false evidence claims and fabricated inventory files fail closed", () => {
  const input = plan(); input.tasks[0].evidencePaths = [CONTROLLER];
  assert.throws(() => validateGoalPlan(request(), inventory(), input, [ORDER, TEST]), /Invalid bounded Onay goal plan/);
  assert.throws(() => validateGoalPlan(request(), inventory(), plan(), ["mobile/tezjet-app/lib/invented.ts"]), /Invalid bounded Onay goal plan/);
  assert.throws(() => validateGoalPlan(request(), inventory(), plan(), [ORDER, ORDER]), /Invalid bounded Onay goal plan/);
});

test("new files, workflows, configuration and schemas produce no executable tasks", () => {
  for (const path of ["mobile/tezjet-app/lib/new.ts", ".github/workflows/ci.yml", "package.json",
    "artifacts/api-server/migrations/001.sql"]) {
    const input = plan(); input.tasks[0].changePaths = [path];
    const result = validateGoalPlan(request(), inventory(), input, [ORDER, TEST]);
    assert.equal(result.status, "needs-owner-decision");
    assert.deepEqual(result.tasks, []);
    assert.ok(result.blockers.some(value => value.includes("unsupported scope")));
  }
});

test("cross-profile and oversized small-task cards preserve task-card limits", () => {
  for (const patch of [{ changePaths: [CONTROLLER] }, { goal: "g".repeat(1190) }]) {
    const input = plan(); Object.assign(input.tasks[0], patch);
    const result = validateGoalPlan(request(), inventory(), input, [ORDER, TEST]);
    assert.equal(result.status, "needs-owner-decision");
    assert.deepEqual(result.tasks, []);
  }
});

test("model cannot override immutable SHA, provider, repository, authority or task ID", () => {
  for (const key of ["baseSha", "provider", "repository", "branch", "writesEnabled", "requiredActors", "legalEnabled"]) {
    const input = plan(); Object.assign(input.tasks[0], { [key]: "override" });
    assert.throws(() => validateGoalPlan(request(), inventory(), input, [ORDER, TEST]), /Invalid bounded Onay goal plan/);
  }
  const input = plan(); input.tasks[0].id = "invented-id";
  assert.throws(() => validateGoalPlan(request(), inventory(), input, [ORDER, TEST]), /Invalid bounded Onay goal plan/);
});

test("acyclic dependent tasks keep stable host identities", () => {
  const input = { ...plan(), tasks: [task(1), task(2)] };
  input.tasks[1].dependsOn = [input.tasks[0].id];
  const result = validateGoalPlan(request(), inventory(), input, [ORDER, TEST]);
  assert.equal(result.status, "planned");
  assert.deepEqual(result.tasks[1].dependsOn, [deriveGoalTaskId(request(), 1)]);
});

test("cycles, unknown dependencies and duplicated dependencies are rejected", () => {
  for (const variant of ["cycle", "unknown", "duplicate"]) {
    const input = { ...plan(), tasks: [task(1), task(2)] };
    if (variant === "cycle") { input.tasks[0].dependsOn = [input.tasks[1].id]; input.tasks[1].dependsOn = [input.tasks[0].id]; }
    if (variant === "unknown") input.tasks[0].dependsOn = [deriveGoalTaskId(request(), 6)];
    if (variant === "duplicate") input.tasks[1].dependsOn = [input.tasks[0].id, input.tasks[0].id];
    assert.throws(() => validateGoalPlan(request(), inventory(), input, [ORDER, TEST]), /Invalid bounded Onay goal plan/);
  }
});

test("model blockers are retained and empty work cannot be called planned", () => {
  const input = plan(); input.blockers = ["Владелец должен подтвердить правила тарификации."];
  const result = validateGoalPlan(request(), inventory(), input, [ORDER, TEST]);
  assert.equal(result.status, "needs-owner-decision");
  assert.ok(result.blockers.includes(input.blockers[0]));
  const empty = validateGoalPlan(request(), inventory(), { tasks: [], blockers: [], unverifiedAreas: [] }, [ORDER]);
  assert.equal(empty.status, "needs-owner-decision");
});

test("model status claims, missing criteria, excess batches and secret notes are rejected", () => {
  for (const input of [{ ...plan(), status: "completed" }, { ...plan(), tasks: Array.from({ length: 7 }, () => task()) },
    { ...plan(), blockers: ["Private credential ghp_" + "x".repeat(24)] }]) {
    assert.throws(() => validateGoalPlan(request(), inventory(), input, [ORDER, TEST]), /Invalid bounded Onay goal plan/);
  }
  const input = plan(); input.tasks[0].acceptanceCriteria = [];
  assert.throws(() => validateGoalPlan(request(), inventory(), input, [ORDER, TEST]), /Invalid bounded Onay goal plan/);
});

test("prepared requests are revalidated and result arrays do not retain model-owned references", () => {
  const prepared = prepareGoalRequest(request());
  assert.throws(() => validateGoalPlan({ ...prepared, repository: "other/repo" } as never, inventory(), plan(), [ORDER, TEST]), /Invalid Onay owner goal/);
  assert.throws(() => validateGoalPlan({ ...prepared, fingerprint: "b".repeat(64) }, inventory(), plan(), [ORDER, TEST]), /Invalid Onay owner goal/);
  const input = plan(); const result = validateGoalPlan(prepared, inventory(), input, [ORDER, TEST]);
  input.tasks[0].changePaths[0] = "different.ts";
  input.tasks[0].evidencePaths[0] = "different.ts";
  assert.equal(result.tasks[0].card.changePaths[0], ORDER);
  assert.equal(result.tasks[0].evidencePaths[0], ORDER);
});

test("bounded blocker/unverified summaries retain explicit omitted counts", () => {
  const input = plan(); input.tasks[0].evidencePaths = [];
  input.blockers = Array.from({ length: 12 }, (_, index) => "Owner decision is still required for item " + index + ".");
  input.unverifiedAreas = Array.from({ length: 12 }, (_, index) => "Additional unknown product behavior item " + index + ".");
  const result = validateGoalPlan(request(), inventory(), input);
  assert.equal(result.status, "needs-owner-decision");
  assert.ok(result.blockers.length <= 12 && result.unverifiedAreas.length <= 12);
  assert.ok(result.blockers.some(value => /\d+ additional blockers omitted/.test(value)));
  assert.ok(result.unverifiedAreas.some(value => /\d+ additional unverified areas omitted/.test(value)));
  assert.ok(result.unverifiedAreas.some(value => value.includes("not a complete product roadmap")));
  assert.ok([...result.blockers, ...result.unverifiedAreas].every(value => value.length <= 240));
});
