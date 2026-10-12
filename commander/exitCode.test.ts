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
});

test("CLI exits with 10 when no AI provider key is configured", () => {
  const env: NodeJS.ProcessEnv = { ...process.env, AGENT_FACTORY_MODE: "deterministic" };
  delete env.GEMINI_API_KEY;
  delete env.OPENAI_API_KEY;

  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "commander/commander.ts", "Fix a bug in TezJet-Agent-Factory"],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env,
      encoding: "utf8",
      timeout: 90_000,
    },
  );

  assert.ifError(child.error);
  const marker = '{\n  "commander": "TezJet Commander"';
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
