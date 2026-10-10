import assert from "node:assert/strict";
import test from "node:test";
import { summarizeExecution } from "./summary.js";
import type { AgentStepResult } from "./executor.js";

function result(agent: string, status: AgentStepResult["status"], output?: unknown): AgentStepResult {
  return { agent, objective: "test summary", status, output };
}

test("blocks publishing when any agent is failed or skipped", () => {
  const summary = summarizeExecution([
    result("explorer", "completed"),
    result("coder", "skipped"),
    result("security", "completed", { proposedChanges: { status: "clean" } }),
    result("reviewer", "completed", { ready: true }),
  ]);

  assert.equal(summary.status, "blocked");
  assert.equal(summary.canPublish, false);
  assert.equal(summary.skipped, 1);
});

test("requires review when all agents ran but review is not ready", () => {
  const summary = summarizeExecution([
    result("security", "completed", { proposedChanges: { status: "clean" } }),
    result("reviewer", "completed", { ready: false }),
  ]);

  assert.equal(summary.status, "needs-review");
  assert.equal(summary.canPublish, false);
});

test("requires review when proposed changes are not confirmed clean", () => {
  const summary = summarizeExecution([
    result("security", "completed", { proposedChanges: { status: "findings" } }),
    result("reviewer", "completed", { ready: true }),
  ]);

  assert.equal(summary.status, "needs-review");
  assert.equal(summary.proposedSecurityClean, false);
  assert.equal(summary.canPublish, false);
});

test("allows publish only when all agents completed, review is ready, and security is clean", () => {
  const summary = summarizeExecution([
    result("security", "completed", { proposedChanges: { status: "clean" } }),
    result("reviewer", "completed", { ready: true }),
  ]);

  assert.equal(summary.status, "completed");
  assert.equal(summary.canPublish, true);
  assert.equal(summary.failed, 0);
  assert.equal(summary.skipped, 0);
});
