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

test("requires review when tests were discovered but not actually executed", () => {
  const summary = summarizeExecution([
    result("tester", "completed", { executionEvidence: "Test commands were discovered, not executed by this agent." }),
    result("security", "completed", { proposedChanges: { status: "clean" } }),
    result("reviewer", "completed", { ready: true }),
  ]);

  assert.equal(summary.status, "needs-review");
  assert.equal(summary.testsExecuted, false);
  assert.equal(summary.canPublish, false);
});

test("allows publish only with completed agents, executed tests, ready review, and clean security", () => {
  const summary = summarizeExecution([
    result("tester", "completed", { testsExecuted: true, evidence: { command: "pnpm test", conclusion: "success" } }),
    result("security", "completed", { proposedChanges: { status: "clean" } }),
    result("reviewer", "completed", { ready: true }),
  ]);

  assert.equal(summary.status, "completed");
  assert.equal(summary.canPublish, true);
  assert.equal(summary.testsExecuted, true);
  assert.equal(summary.failed, 0);
  assert.equal(summary.skipped, 0);
});

test("proposal-only Commander cannot complete from successful base-branch tests", () => {
  const summary = summarizeExecution([
    result("coder", "completed", { files: [{ path: "src/change.ts", content: "export const proposed = true;" }] }),
    result("tester", "completed", { testsExecuted: true, executionEvidence: { expectedSha: "base-commit", status: "passed" } }),
    result("security", "completed", { proposedChanges: { status: "clean" } }),
    result("reviewer", "completed", { ready: true }),
  ], { proposalOnly: true });
  assert.equal(summary.status, "needs-review");
  assert.equal(summary.canPublish, false);
});

