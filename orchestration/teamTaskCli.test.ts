import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, symlinkSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTeamTaskCli, runTeamTaskCli } from "./teamTaskCli.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "onay-cli-"));
  const task = join(root, "task.json"), state = join(root, "state"), output = join(root, "report");
  writeFileSync(task, JSON.stringify({
    version: 1, id: "passenger-validation", profile: "mobile", provider: "cloudflare",
    goal: "Исправить проверку количества пассажиров.",
    acceptanceCriteria: ["Количество пассажиров проверяется до запроса."],
    baseRef: "main", baseSha: "a".repeat(40), changePaths: ["mobile/tezjet-app/lib/orders.ts"], contextPaths: [],
  }));
  const args = (mode: string) => ["--task", task, "--state-dir", state, "--mode", mode, "--output-dir", output];
  return { root, task, state, output, args, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("CLI accepts only exact bounded arguments and absolute paths", () => {
  const valid = ["--task", "/tmp/task.json", "--state-dir", "/tmp/state", "--mode", "plan", "--output-dir", "/tmp/out"];
  assert.equal(parseTeamTaskCli(valid).mode, "plan");
  for (const args of [
    [...valid, "--publish", "true"], [...valid, "--mode", "run"], valid.slice(0, -1),
    valid.map(value => value === "plan" ? "forever" : value),
    valid.map(value => value === "/tmp/task.json" ? "relative.json" : value),
  ]) assert.throws(() => parseTeamTaskCli(args));
});

test("plan needs no SDK or keys and makes no network calls or task receipt", async () => {
  const f = fixture(), previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Network forbidden."); };
  try {
    const result = await runTeamTaskCli(f.args("plan"), {});
    assert.equal(result.code, 0); assert.equal(calls, 0);
    assert.equal((result.report as { githubWrites: boolean }).githubWrites, false);
    const saved = JSON.parse(readFileSync(join(f.output, "report.json"), "utf8"));
    assert.equal(saved.baseSha, "a".repeat(40));
    assert.ok(saved.requiredActors.includes("frontend"));
    assert.ok(saved.requiredActors.includes("tester"));
    assert.equal(readdirSync(f.root).includes("state"), false);
  } finally { globalThis.fetch = previous; f.close(); }
});

test("run without explicit approval refuses before SDK import or transport", async () => {
  const f = fixture(), previous = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Network forbidden."); };
  try {
    await assert.rejects(runTeamTaskCli(f.args("run"), {}), /not explicitly approved/);
    assert.equal(readdirSync(f.state).length, 0);
  } finally { globalThis.fetch = previous; f.close(); }
});

test("verify with writes enabled is refused without transport", async () => {
  const f = fixture();
  try {
    await assert.rejects(runTeamTaskCli(f.args("verify"), {
      GITHUB_TOKEN: "offline-fixture-key", AGENT_FACTORY_LEGAL_ENABLED: "false",
      AGENT_FACTORY_ENABLE_GITHUB_WRITES: "true",
    }), /Verification needs read access/);
  } finally { f.close(); }
});

test("symlink and oversized task cards are rejected", async () => {
  const f = fixture();
  try {
    const target = join(f.root, "target.json");
    writeFileSync(target, readFileSync(f.task));
    rmSync(f.task); symlinkSync(target, f.task);
    await assert.rejects(runTeamTaskCli(f.args("plan"), {}));
    rmSync(f.task); writeFileSync(f.task, " ".repeat(8_193));
    await assert.rejects(runTeamTaskCli(f.args("plan"), {}), /bounded regular JSON/);
  } finally { f.close(); }
});

test("an untrusted output symlink cannot overwrite another directory", async () => {
  const f = fixture();
  try {
    const target = join(f.root, "private");
    mkdirSync(target); symlinkSync(target, f.output);
    await assert.rejects(runTeamTaskCli(f.args("plan"), {}));
    assert.deepEqual(readdirSync(target), []);
  } finally { f.close(); }
});
