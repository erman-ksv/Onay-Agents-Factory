import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AI_MODE_STATUS, COMMANDER_EXIT_CODES, commanderExitCode } from "./exitCode.js";

test("maps Commander statuses to exit codes", () => {
  assert.equal(commanderExitCode("completed"), 0);
  assert.equal(commanderExitCode("blocked"), 10);
  assert.equal(commanderExitCode("needs-review"), 11);
  assert.equal(commanderExitCode("unexpected"), COMMANDER_EXIT_CODES.unhandledError);
  assert.equal(commanderExitCode("ci-passed"), 0);
  for (const status of ["ci-repair", "test-evidence-blocked", "no-change"]) {
    assert.equal(commanderExitCode(status), COMMANDER_EXIT_CODES.blocked);
  }
  assert.equal(commanderExitCode("ci-blocked"), COMMANDER_EXIT_CODES.needsReview);
});

test("CLI exits with 10 when no AI provider key is configured", () => {
  const env: NodeJS.ProcessEnv = { ...process.env, AGENT_FACTORY_MODE: "deterministic" };
  delete env.GEMINI_API_KEY;
  delete env.OPENAI_API_KEY;
  delete env.OPENROUTER_API_KEY;

  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "commander/commander.ts", "Fix a bug in Onay-Agents-Factory"],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env,
      encoding: "utf8",
      timeout: 90_000,
    },
  );

  assert.ifError(child.error);
  const marker = '{\n  "commander": "Onay Commander"';
  const start = child.stdout.lastIndexOf(marker);
  assert.notEqual(start, -1, child.stdout + child.stderr);

  const report = JSON.parse(child.stdout.slice(start)) as { summary?: { status?: string } };
  assert.equal(report.summary?.status, "blocked");
  assert.equal(child.status, COMMANDER_EXIT_CODES.blocked, child.stderr);
});

test("AI mode never reports success without readiness checks", () => {
  assert.equal(AI_MODE_STATUS, "needs-review");
  assert.notEqual(commanderExitCode(AI_MODE_STATUS), 0);
});

test("CLI blocks a missing explicitly selected provider without falling back", () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT_FACTORY_PROVIDER: "openai",
    GEMINI_API_KEY: "test-gemini-key-must-not-be-printed",
  };
  delete env.OPENAI_API_KEY;
  delete env.AGENT_FACTORY_MODE;
  const child = spawnSync(process.execPath, ["--import", "tsx", "commander/commander.ts", "Audit Onay-Agents-Factory"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), env, encoding: "utf8", timeout: 30_000,
  });
  assert.ifError(child.error);
  const marker = '{\n  "commander": "Onay Commander"';
  const start = child.stdout.lastIndexOf(marker);
  assert.notEqual(start, -1, child.stdout + child.stderr);
  const report = JSON.parse(child.stdout.slice(start)) as { mode: string; result: { status: string; reasons: string[] } };
  assert.equal(report.mode, "ai");
  assert.equal(report.result.status, "blocked");
  assert.match(report.result.reasons.join(" "), /OPENAI_API_KEY/);
  assert.equal(child.status, COMMANDER_EXIT_CODES.blocked, child.stderr);
  assert.ok(!child.stdout.includes(env.GEMINI_API_KEY!));
  assert.ok(!child.stderr.includes(env.GEMINI_API_KEY!));
});
