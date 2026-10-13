import assert from "node:assert/strict";
import test from "node:test";
import { summarizeExecution } from "./summary.js";
import type { AgentStepResult } from "./executor.js";

function result(agent: string, status: AgentStepResult["status"], output?: unknown): AgentStepResult {
  return { agent, objective: "test summary", status, output };
}

const candidateOptions = {
  expectedSha: "a".repeat(40), repository: "erman-ksv/TezJet", ref: "fix/candidate",
  requiredNames: ["typecheck"], requiredStepNames: ["Test"],
};
function trustedEvidence() {
  return {
    testsExecuted: true, status: "passed", ...candidateOptions,
    evidence: [{ runId: 1, runAttempt: 2, headSha: candidateOptions.expectedSha, conclusion: "success" }],
    checks: [{ runId: 1, runAttempt: 2, jobName: "typecheck", name: "Test", status: "completed", conclusion: "success" }],
    jobs: [{ name: "typecheck", run_id: 1, run_attempt: 2, head_sha: candidateOptions.expectedSha, status: "completed", conclusion: "success",
      steps: [{ name: "Test", status: "completed", conclusion: "success" }] }],
  };
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

test("blocks an explicit independent review rejection", () => {
  const summary = summarizeExecution([
    result("security", "completed", { proposedChanges: { status: "clean" } }),
    result("reviewer", "completed", { ready: false }),
  ]);

  assert.equal(summary.status, "blocked");
  assert.equal(summary.canPublish, false);
});

test("blocks proposed-change security findings", () => {
  const summary = summarizeExecution([
    result("security", "completed", { proposedChanges: { status: "findings" } }),
    result("reviewer", "completed", { ready: true }),
  ]);

  assert.equal(summary.status, "blocked");
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
    result("tester", "completed", { testsExecuted: true, executionEvidence: trustedEvidence() }),
    result("security", "completed", { proposedChanges: { status: "clean" }, repository: { status: "clean" } }),
    result("reviewer", "completed", { ready: true }),
  ], candidateOptions);

  assert.equal(summary.status, "completed");
  assert.equal(summary.canPublish, true);
  assert.equal(summary.testsExecuted, true);
  assert.equal(summary.failed, 0);
  assert.equal(summary.skipped, 0);
});

function verifiedExecution(): AgentStepResult[] {
  return [
    result("tester", "completed", { testsExecuted: true, executionEvidence: trustedEvidence() }),
    result("security", "completed", { proposedChanges: { status: "clean" }, repository: { status: "clean" } }),
    result("reviewer", "completed", { ready: true, findings: [] }),
  ];
}

test("repository findings cannot be hidden by a clean proposed-change scan", () => {
  const execution = verifiedExecution();
  execution[1] = result("security", "completed", { proposedChanges: { status: "clean" }, repository: { status: "findings" } });
  assert.equal(summarizeExecution(execution).status, "blocked");
});

test("missing repository scan keeps a result unverified", () => {
  const execution = verifiedExecution();
  execution[1] = result("security", "completed", { proposedChanges: { status: "clean" } });
  assert.equal(summarizeExecution(execution).status, "needs-review");
});

test("a tester boolean cannot override failed or different-commit evidence", () => {
  const execution = verifiedExecution();
  execution[0] = result("tester", "completed", { testsExecuted: true, executionEvidence: { ...trustedEvidence(), status: "failed" } });
  assert.equal(summarizeExecution(execution).status, "blocked");
  assert.equal(summarizeExecution(verifiedExecution(), { ...candidateOptions, expectedSha: "b".repeat(40) }).status, "blocked");
});

test("completion requires independently pinned candidate metadata", () => {
  assert.equal(summarizeExecution(verifiedExecution()).canPublish, false);
  for (const mismatch of [{ repository: "someone/other" }, { ref: "main" }]) {
    assert.equal(summarizeExecution(verifiedExecution(), { ...candidateOptions, ...mismatch }).status, "blocked");
  }
});

test("missing workflow attempt or job commit cannot prove completion", () => {
  const missingAttempt = trustedEvidence();
  Reflect.deleteProperty(missingAttempt.evidence[0], "runAttempt");
  const missingJobCommit = trustedEvidence();
  Reflect.deleteProperty(missingJobCommit.jobs[0], "head_sha");
  for (const evidence of [missingAttempt, missingJobCommit]) {
    const execution = verifiedExecution();
    execution[0] = result("tester", "completed", { testsExecuted: true, executionEvidence: evidence });
    assert.equal(summarizeExecution(execution, candidateOptions).canPublish, false);
  }
});

test("fabricated flags, invalid SHAs and missing run evidence cannot complete", () => {
  for (const override of [{ expectedSha: "candidate-commit" }, { evidence: [] }, { checks: [] }, { jobs: [] }]) {
    const execution = verifiedExecution();
    execution[0] = result("tester", "completed", { testsExecuted: true, executionEvidence: { ...trustedEvidence(), ...override } });
    assert.equal(summarizeExecution(execution, candidateOptions).canPublish, false);
  }
});

test("checks from another run attempt or a skipped test cannot prove completion", () => {
  for (const override of [{ runId: 2 }, { runAttempt: 1 }, { conclusion: "skipped" }, { name: "Checkout" }]) {
    const execution = verifiedExecution();
    const evidence = trustedEvidence();
    execution[0] = result("tester", "completed", { testsExecuted: true, executionEvidence: {
      ...evidence, checks: [{ ...evidence.checks[0], ...override }],
    } });
    assert.equal(summarizeExecution(execution, candidateOptions).canPublish, false);
  }
});

test("all explicitly required test steps must have successful evidence", () => {
  assert.equal(summarizeExecution(verifiedExecution(), { ...candidateOptions, requiredStepNames: ["Typecheck", "Test"] }).canPublish, false);
});

test("an unrelated successful Test step cannot hide a skipped test in a required job", () => {
  const execution = verifiedExecution();
  const evidence = trustedEvidence();
  evidence.jobs = [
    { name: "typecheck (Node20)", run_id: 1, run_attempt: 2, head_sha: candidateOptions.expectedSha, status: "completed", conclusion: "success", steps: [
      { name: "Typecheck", status: "completed", conclusion: "success" },
      { name: "Test", status: "completed", conclusion: "skipped" },
    ] },
    { name: "upload", run_id: 1, run_attempt: 2, head_sha: candidateOptions.expectedSha, status: "completed", conclusion: "success", steps: [
      { name: "Test", status: "completed", conclusion: "success" },
    ] },
  ];
  evidence.checks = evidence.jobs.flatMap(job => job.steps.map(step => ({
    ...step, jobName: job.name, runId: job.run_id, runAttempt: job.run_attempt,
  })));
  execution[0] = result("tester", "completed", { testsExecuted: true, executionEvidence: evidence });
  assert.equal(summarizeExecution(execution, { ...candidateOptions, requiredStepNames: ["Typecheck", "Test"] }).canPublish, false);
});

test("testsExecuted without execution evidence cannot complete", () => {
  const execution = verifiedExecution();
  execution[0] = result("tester", "completed", { testsExecuted: true });
  assert.equal(summarizeExecution(execution).status, "needs-review");
});

test("high review findings override a contradictory ready boolean", () => {
  const execution = verifiedExecution();
  execution[2] = result("reviewer", "completed", { ready: true, findings: [{ severity: "high" }] });
  assert.equal(summarizeExecution(execution).status, "blocked");
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

