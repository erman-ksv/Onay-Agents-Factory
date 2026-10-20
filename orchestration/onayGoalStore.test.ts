import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OnayGoalStore, type GoalState } from "./onayGoalStore.js";

const goalId = "passenger-app-goal", fingerprint = "a".repeat(64);
const baseSha = "b".repeat(40);
function task(id: string, dependsOn: string[] = []): GoalState["tasks"][number] {
  return { id, status: "queued", dependsOn, card: {
    version: 1, id, goal: "Улучшить отображение состояния поездки пассажира.",
    acceptanceCriteria: ["Текущая поездка сохраняется при обновлении."], profile: "mobile", provider: "cloudflare",
    baseRef: "feat/owner-base", baseSha, changePaths: ["mobile/tezjet-app/lib/orders.ts"], contextPaths: [],
  } };
}
function state(): GoalState {
  return { version: 1, goalId, goalFingerprint: fingerprint, repository: "erman-ksv/Onay", baseRef: "feat/owner-base", baseSha,
    tasks: [task("passenger-state-one"), task("passenger-state-two", ["passenger-state-one"])],
    blockers: [], status: "planned", cycles: 0 };
}
function publication(id: string, number = 42) {
  return { branch: "feat/onay-agent/" + id, headSha: "c".repeat(40), number, url: "https://github.com/erman-ksv/Onay/pull/" + number };
}
function fixture(t: { after: (callback: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), "onay-goal-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, path: join(directory, goalId + ".goal.json"), lock: join(directory, goalId + ".goal.lock"),
    marker: join(directory, goalId + ".goal.identity.json"), store: () => new OnayGoalStore(directory, goalId, fingerprint) };
}

test("initial backlog is private, immutable across inspections, and pinned to goal identity", t => {
  const setup = fixture(t), store = setup.store();
  assert.equal(store.inspect(), undefined);
  assert.deepEqual(readdirSync(setup.directory), []);
  store.saveInitial(state());
  for (const path of [setup.path, setup.marker]) assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(existsSync(setup.lock), false);
  const copy = store.inspect()!;
  copy.tasks[0].card.goal = "Altered local copy without touching persisted metadata";
  assert.equal(store.inspect()!.tasks[0].card.goal, state().tasks[0].card.goal);
  store.close();
  const conflicting = new OnayGoalStore(setup.directory, goalId, "d".repeat(64));
  assert.throws(() => conflicting.inspect(), /manual reconciliation/);
  conflicting.close();
});

test("DAG tasks execute only after dependencies and cannot replay completed or blocked tasks", t => {
  const setup = fixture(t), store = setup.store(); store.saveInitial(state());
  const begun = store.beginCycle();
  assert.equal(begun.cycles, 1); assert.equal(begun.status, "running");
  store.updateTask("passenger-state-two", { reasonCode: "waiting_integration" });
  assert.equal(store.inspect()!.tasks[1].status, "queued");
  assert.equal(store.inspect()!.tasks[1].reasonCode, "waiting_integration");
  assert.throws(() => store.updateTask("passenger-state-two", { status: "running" }), /invalid/);
  store.updateTask("passenger-state-one", { status: "running" });
  assert.throws(() => store.updateTask("passenger-state-one", { status: "completed" }), /invalid/);
  store.updateTask("passenger-state-one", { status: "awaiting-ci", publication: publication("passenger-state-one") });
  store.updateTask("passenger-state-one", { publication: {
    number: 42, url: "https://github.com/erman-ksv/Onay/pull/42", headSha: "c".repeat(40), branch: "feat/onay-agent/passenger-state-one" } });
  assert.throws(() => store.updateTask("passenger-state-one", { status: "running" }), /invalid/);
  store.finishCycle();
  assert.equal(store.inspect()!.status, "waiting");
  store.beginCycle();
  store.updateTask("passenger-state-one", { status: "completed", reasonCode: "exact_ci_verified" });
  assert.throws(() => store.updateTask("passenger-state-one", { status: "running" }), /invalid/);
  store.updateTask("passenger-state-two", { status: "running" });
  store.updateTask("passenger-state-two", { status: "completed", publication: publication("passenger-state-two", 43) });
  store.finishCycle();
  assert.equal(store.inspect()!.status, "completed");
  assert.equal(store.inspect()!.cycles, 2);
  store.close();
  const duplicate = setup.store(); assert.throws(() => duplicate.beginCycle(), /cannot start/); duplicate.close();
});

test("exclusive cycle locks reject concurrent workers without removing their lock", t => {
  const setup = fixture(t), first = setup.store(); first.saveInitial(state()); first.beginCycle();
  const concurrent = setup.store(); assert.throws(() => concurrent.beginCycle(), /cannot start/); concurrent.close();
  assert.equal(existsSync(setup.lock), true);
  first.finishCycle(); first.close();
});

test("interrupted task and interrupted empty cycle are never automatically replayed", t => {
  for (const startTask of [true, false]) {
    const setup = fixture(t), first = setup.store(); first.saveInitial(state()); first.beginCycle();
    if (startTask) first.updateTask("passenger-state-one", { status: "running" });
    first.close();
    const resumed = setup.store();
    assert.throws(() => resumed.beginCycle(), /interrupted work/); resumed.close();
    assert.equal(JSON.parse(readFileSync(setup.path, "utf8")).status, "running");
  }
});

test("stale locks are never automatically deleted", t => {
  const setup = fixture(t), store = setup.store(); store.saveInitial(state());
  writeFileSync(setup.lock, "", { mode: 0o600 });
  assert.throws(() => store.beginCycle(), /cannot start/); store.close();
  assert.equal(existsSync(setup.lock), true);
});

test("missing state or identity marker requires reconciliation instead of recreating a backlog", t => {
  for (const remove of ["state", "marker"]) {
    const setup = fixture(t), first = setup.store(); first.saveInitial(state()); first.close();
    rmSync(remove === "state" ? setup.path : setup.marker);
    const resumed = setup.store(); assert.throws(() => resumed.inspect(), /manual reconciliation/);
    assert.throws(() => resumed.saveInitial(state()), /unavailable/); resumed.close();
  }
});

test("initial save never overwrites an existing plan or accepts model-supplied completion", t => {
  const setup = fixture(t), store = setup.store(); store.saveInitial(state()); const before = readFileSync(setup.path, "utf8");
  assert.throws(() => store.saveInitial(state()), /cannot be initialized/); store.close();
  assert.equal(readFileSync(setup.path, "utf8"), before);
  const other = fixture(t), forged = state(); forged.tasks[0].status = "completed"; forged.tasks[0].publication = publication(forged.tasks[0].id);
  const rejected = other.store(); assert.throws(() => rejected.saveInitial(forged), /cannot be initialized/); rejected.close();
  assert.deepEqual(readdirSync(other.directory), []);
});

test("invalid DAG, unknown dependencies, task scope and changed base SHA fail before initialization", t => {
  const variants: Array<(value: GoalState) => void> = [
    value => { value.tasks[0].dependsOn = [value.tasks[1].id]; },
    value => { value.tasks[0].dependsOn = ["unknown-task"]; },
    value => { value.tasks[0].dependsOn = [value.tasks[0].id]; },
    value => { value.tasks[1].card.baseSha = "d".repeat(40); },
    value => { value.tasks[1].card.changePaths = [".github/workflows/ci.yml"]; },
    value => { value.tasks[1].id = value.tasks[0].id; },
    value => { value.tasks = Array.from({ length: 7 }, (_, index) => task("task-item-" + index)); },
  ];
  for (const alter of variants) {
    const setup = fixture(t), store = setup.store(), value = state(); alter(value);
    assert.throws(() => store.saveInitial(value), /cannot be initialized/); store.close();
    assert.deepEqual(readdirSync(setup.directory), []);
  }
});

test("blockers remain explicit and prevent overall completion even if every task completes", t => {
  const setup = fixture(t), store = setup.store(), initial = state();
  initial.tasks = [initial.tasks[0]]; initial.blockers = ["Production SMS provider is not configured."];
  store.saveInitial(initial); store.beginCycle(); store.updateTask(initial.tasks[0].id, { status: "running" });
  store.updateTask(initial.tasks[0].id, { status: "completed", publication: publication(initial.tasks[0].id) });
  store.finishCycle(); assert.equal(store.inspect()!.status, "blocked");
  assert.deepEqual(store.inspect()!.blockers, initial.blockers); store.close();
});

test("cycle hard cap twelve blocks further model work", t => {
  const setup = fixture(t), store = setup.store(); store.saveInitial(state());
  for (let index = 0; index < 12; index++) { assert.equal(store.beginCycle().cycles, index + 1); store.finishCycle(); }
  assert.throws(() => store.beginCycle(), /cannot start/); store.close();
});

test("source payloads, secrets, unsafe reason codes and altered publication identities never persist", t => {
  const setup = fixture(t), store = setup.store(); store.saveInitial(state()); store.beginCycle();
  store.updateTask("passenger-state-one", { status: "running" });
  const before = readFileSync(setup.path, "utf8");
  assert.throws(() => store.updateTask("passenger-state-one", { source: "PRIVATE_SOURCE" } as never), /invalid/);
  assert.throws(() => store.updateTask("passenger-state-one", { reasonCode: "PRIVATE_SOURCE with spaces" }), /invalid/);
  assert.throws(() => store.updateTask("passenger-state-one", { status: "completed", publication: {
    ...publication("passenger-state-one"), url: "https://github.com/someone/other/pull/42" } }), /invalid/);
  assert.equal(readFileSync(setup.path, "utf8"), before);
  store.updateTask("passenger-state-one", { status: "blocked", reasonCode: "source_unavailable" }); store.finishCycle(); store.close();
  assert.ok(!readFileSync(setup.path, "utf8").includes("PRIVATE_SOURCE"));
  const secretFixture = fixture(t), secretStore = secretFixture.store(), secretState = state();
  secretState.blockers = ["Fixture ghp_" + "x".repeat(24)];
  assert.throws(() => secretStore.saveInitial(secretState), /cannot be initialized/); secretStore.close();
});

test("root traversal, symlinks, permissive files and hard links fail closed", t => {
  const setup = fixture(t);
  assert.throws(() => new OnayGoalStore(setup.directory, "../unsafe", fingerprint), /directory or identity/);
  const target = join(setup.directory, "target"); mkdirSync(target, { mode: 0o700 });
  const alias = join(setup.directory, "alias"); symlinkSync(target, alias);
  assert.throws(() => new OnayGoalStore(alias, goalId, fingerprint), /directory or identity/);
  const store = setup.store(); store.saveInitial(state()); store.close();
  chmodSync(setup.path, 0o644); const insecure = setup.store(); assert.throws(() => insecure.inspect(), /invalid/); insecure.close();
  chmodSync(setup.path, 0o600); linkSync(setup.path, join(setup.directory, "duplicate"));
  const linked = setup.store(); assert.throws(() => linked.inspect(), /invalid/); linked.close();
});

test("receipt replacement causes a fixed terminal persistence failure", t => {
  const setup = fixture(t), store = setup.store(); store.saveInitial(state()); store.beginCycle();
  renameSync(setup.path, join(setup.directory, "saved.json")); writeFileSync(setup.path, "PRIVATE_SOURCE", { mode: 0o600 });
  assert.throws(() => store.updateTask("passenger-state-one", { status: "running" }), /^Error: Onay goal persistence failed; stop and inspect the private state\.$/);
  assert.throws(() => store.updateTask("passenger-state-one", { status: "blocked" }), /unavailable/);
  store.close(); assert.equal(readFileSync(setup.path, "utf8"), "PRIVATE_SOURCE");
});
