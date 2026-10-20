import assert from "node:assert/strict";
import test from "node:test";
import {
  chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  renameSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TeamTaskStore } from "./teamTaskStore.js";

const identity = { id: "onay-task-1", fingerprint: "a".repeat(64) };
const publication = { branch: "feat/onay-small-fix", headSha: "b".repeat(40),
  url: "https://github.com/erman-ksv/Onay/pull/42", number: 42 };
function fixture(t: { after: (callback: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), "team-task-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, path: join(directory, identity.id + ".json"), lock: join(directory, identity.id + ".lock") };
}

test("claims once, records bounded metadata, and never replays a completed receipt", t => {
  const { directory, path, lock } = fixture(t);
  const store = new TeamTaskStore(directory, identity);
  assert.equal(store.claim(), "claimed");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(lock).mode & 0o777, 0o600);
  store.recordStage("explore", "running");
  store.recordStage("explore", "passed");
  store.recordPublication(publication);
  store.finish("completed", "verified_run");
  const copy = store.snapshot();
  copy.stages[0].status = "blocked";
  assert.equal(store.snapshot().stages[0].status, "passed");
  store.close();
  assert.equal(existsSync(lock), false);
  const previous = readFileSync(path, "utf8");
  const duplicate = new TeamTaskStore(directory, identity);
  assert.equal(duplicate.claim(), "already-recorded");
  assert.equal(duplicate.snapshot().status, "completed");
  assert.throws(() => duplicate.recordStage("code", "running"), /unavailable/);
  assert.throws(() => duplicate.finish("completed", "verified_run"), /unavailable/);
  duplicate.close();
  assert.equal(readFileSync(path, "utf8"), previous);
});

test("concurrent and stale locks block without deleting another worker's lock", t => {
  const { directory, lock } = fixture(t);
  const first = new TeamTaskStore(directory, identity);
  first.claim();
  const second = new TeamTaskStore(directory, identity);
  assert.throws(() => second.claim(), /cannot be claimed/);
  second.close();
  assert.equal(existsSync(lock), true);
  first.close();
  writeFileSync(lock, "", { mode: 0o600 });
  const stale = new TeamTaskStore(directory, identity);
  assert.throws(() => stale.claim(), /inspect its receipt and lock/);
  stale.close();
  assert.equal(existsSync(lock), true);
});

test("changed identity cannot adopt or overwrite a receipt", t => {
  const { directory, path } = fixture(t);
  const first = new TeamTaskStore(directory, identity);
  first.claim();
  first.close();
  const before = readFileSync(path, "utf8");
  const wrong = new TeamTaskStore(directory, { ...identity, fingerprint: "c".repeat(64) });
  assert.throws(() => wrong.claim(), /cannot be claimed/);
  assert.throws(() => wrong.snapshot(), /unavailable/);
  wrong.close();
  assert.equal(readFileSync(path, "utf8"), before);
});

test("an interrupted stage remains inspection-only even after normal lock cleanup", t => {
  const { directory } = fixture(t);
  const first = new TeamTaskStore(directory, identity);
  first.claim();
  first.recordStage("publish", "running");
  first.close();
  const resumed = new TeamTaskStore(directory, identity);
  assert.equal(resumed.claim(), "already-recorded");
  assert.deepEqual(resumed.snapshot().stages, [{ stage: "publish", status: "running" }]);
  assert.equal(resumed.snapshot().status, "running");
  assert.throws(() => resumed.recordPublication(publication), /unavailable/);
  resumed.close();
});

test("rejects traversal, extra identity payload, symlink roots and symlink ancestors", t => {
  const { directory } = fixture(t);
  for (const id of ["../escape", "goal with source", ".hidden", "x".repeat(65)]) {
    assert.throws(() => new TeamTaskStore(directory, { ...identity, id }), /directory or identity is invalid/);
  }
  assert.throws(() => new TeamTaskStore(directory, { ...identity, goal: "PRIVATE_GOAL" } as typeof identity), /identity is invalid/);
  assert.throws(() => new TeamTaskStore(directory + "/../" + directory.split("/").at(-1), identity), /identity is invalid/);
  const actual = join(directory, "actual");
  mkdirSync(actual, { mode: 0o700 });
  const alias = join(directory, "alias");
  symlinkSync(actual, alias);
  assert.throws(() => new TeamTaskStore(alias, identity), /directory or identity is invalid/);
  mkdirSync(join(actual, "nested"), { mode: 0o700 });
  assert.throws(() => new TeamTaskStore(join(alias, "nested"), identity), /directory or identity is invalid/);
});

test("rejects unsafe existing receipts and preserves symlink targets", t => {
  const { directory, path } = fixture(t);
  const target = join(directory, "private-target");
  writeFileSync(target, "PRIVATE_SOURCE", { mode: 0o600 });
  symlinkSync(target, path);
  const store = new TeamTaskStore(directory, identity);
  assert.throws(() => store.claim(), /cannot be claimed/);
  store.close();
  assert.equal(readFileSync(target, "utf8"), "PRIVATE_SOURCE");
  rmSync(path);
  writeFileSync(path, "{}", { mode: 0o644 });
  const permissive = new TeamTaskStore(directory, identity);
  assert.throws(() => permissive.claim(), /cannot be claimed/);
  permissive.close();
});

test("strict schema rejects receipts containing source or unknown properties", t => {
  const { directory, path } = fixture(t);
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, ...identity, status: "running", stages: [],
    source: "PRIVATE_SOURCE", goal: "PRIVATE_GOAL" }), { mode: 0o600 });
  const store = new TeamTaskStore(directory, identity);
  assert.throws(() => store.claim(), error => error instanceof Error &&
    !error.message.includes("PRIVATE") && /cannot be claimed/.test(error.message));
  store.close();
});

test("hard-linked receipts and symbolic locks fail without touching their targets", t => {
  const { directory, path, lock } = fixture(t);
  const target = join(directory, "shared-target");
  writeFileSync(target, JSON.stringify({ schemaVersion: 1, ...identity, status: "running", stages: [] }), { mode: 0o600 });
  linkSync(target, path);
  const linked = new TeamTaskStore(directory, identity);
  assert.throws(() => linked.claim(), /cannot be claimed/);
  linked.close();
  assert.equal(statSync(target).nlink, 2);
  rmSync(path);
  symlinkSync(target, lock);
  const symbolic = new TeamTaskStore(directory, identity);
  assert.throws(() => symbolic.claim(), /cannot be claimed/);
  symbolic.close();
  assert.equal(JSON.parse(readFileSync(target, "utf8")).status, "running");
});

test("invalid free text, publication queries and excessive stages never enter receipts", t => {
  const { directory, path } = fixture(t);
  const store = new TeamTaskStore(directory, identity);
  store.claim();
  assert.throws(() => store.recordStage("PRIVATE_SOURCE = secret", "running"), /metadata is invalid/);
  assert.throws(() => store.finish("blocked", "PRIVATE_GOAL secret"), /metadata is invalid/);
  assert.throws(() => store.recordPublication({ ...publication, url: publication.url + "?token=PRIVATE_SECRET" }), /metadata is invalid/);
  assert.throws(() => store.recordPublication({ ...publication, source: "PRIVATE_SOURCE" } as typeof publication), /metadata is invalid/);
  for (let index = 0; index < 32; index++) {
    store.recordStage("stage_" + index, "running");
    store.recordStage("stage_" + index, "passed");
  }
  assert.throws(() => store.recordStage("stage_33", "running"), /metadata is invalid/);
  store.finish("blocked", "stage_budget");
  store.close();
  assert.ok(!readFileSync(path, "utf8").includes("PRIVATE"));
});

test("stage transitions and completed verdict cannot bypass an unfinished stage", t => {
  const { directory } = fixture(t);
  const store = new TeamTaskStore(directory, identity);
  store.claim();
  assert.throws(() => store.recordStage("security", "passed"), /metadata is invalid/);
  store.recordStage("security", "running");
  assert.throws(() => store.finish("completed", "verified_run"), /metadata is invalid/);
  store.recordStage("security", "blocked");
  assert.throws(() => store.recordStage("security", "running"), /metadata is invalid/);
  assert.throws(() => store.finish("completed", "verified_run"), /metadata is invalid/);
  store.finish("blocked", "security_blocked");
  assert.throws(() => store.recordStage("test", "running"), /unavailable/);
  store.close();
});

test("persistence failure is fixed, terminal, and leaves no reusable successful outcome", t => {
  const { directory, path } = fixture(t);
  const store = new TeamTaskStore(directory, identity);
  store.claim();
  const original = readFileSync(path, "utf8");
  // Replacement of the pinned receipt inode must fail before overwriting it.
  renameSync(path, join(directory, "saved.json"));
  writeFileSync(path, "PRIVATE_DIAGNOSTIC", { mode: 0o600 });
  assert.throws(() => store.recordStage("explore", "running"), error => error instanceof Error &&
    error.message === "Team task persistence failed; execution must stop.");
  assert.throws(() => store.recordStage("test", "running"), /unavailable/);
  assert.throws(() => store.snapshot(), /unavailable/);
  assert.equal(readFileSync(path, "utf8"), "PRIVATE_DIAGNOSTIC");
  assert.equal(readFileSync(join(directory, "saved.json"), "utf8"), original);
  store.close();
  assert.ok(!readdirSync(directory).some(name => name.includes(".tmp.")));
});

test("changed root permissions stop persistence and broad writable roots are rejected", t => {
  const { directory } = fixture(t);
  const store = new TeamTaskStore(directory, identity);
  store.claim();
  chmodSync(directory, 0o777);
  assert.throws(() => store.recordStage("explore", "running"), /persistence failed/);
  assert.throws(() => new TeamTaskStore(directory, identity), /directory or identity is invalid/);
  assert.throws(() => store.close(), /persistence failed/);
  chmodSync(directory, 0o700);
});

test("read-only inspection of a missing receipt leaves the directory empty and task executable", t => {
  const { directory } = fixture(t);
  const inspector = new TeamTaskStore(directory, identity);
  assert.equal(inspector.inspectExisting(), undefined);
  assert.deepEqual(readdirSync(directory), []);
  inspector.close();
  assert.deepEqual(readdirSync(directory), []);
  const execution = new TeamTaskStore(directory, identity);
  assert.equal(execution.claim(), "claimed");
  execution.close();
});

test("read-only inspection preserves receipt bytes and returns a defensive metadata copy", t => {
  const { directory, path } = fixture(t);
  const execution = new TeamTaskStore(directory, identity);
  execution.claim();
  execution.recordStage("code", "running");
  execution.close();
  const before = readFileSync(path, "utf8");
  const inspector = new TeamTaskStore(directory, identity);
  const snapshot = inspector.inspectExisting()!;
  snapshot.stages[0].status = "passed";
  assert.equal(inspector.inspectExisting()!.stages[0].status, "running");
  inspector.close();
  assert.equal(readFileSync(path, "utf8"), before);
  assert.deepEqual(readdirSync(directory), [identity.id + ".json"]);
});

test("read-only inspection rejects symbolic receipts without creating locks or changing targets", t => {
  const { directory, path } = fixture(t);
  const target = join(directory, "target.json");
  writeFileSync(target, "PRIVATE_SOURCE", { mode: 0o600 });
  symlinkSync(target, path);
  const inspector = new TeamTaskStore(directory, identity);
  assert.throws(() => inspector.inspectExisting(), /^Error: Team task receipt cannot be safely inspected\.$/);
  inspector.close();
  assert.equal(readFileSync(target, "utf8"), "PRIVATE_SOURCE");
  assert.ok(!readdirSync(directory).some(name => name.endsWith(".lock")));
});
