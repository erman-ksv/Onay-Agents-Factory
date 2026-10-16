import assert from "node:assert/strict";
import test from "node:test";
import { discoverTestScripts, evaluateTestExecutionEvidence } from "./agent.js";
import type { WorkflowRun } from "../../github/githubClient.js";
import type { CiJob } from "../../github/ciGate.js";

test("discovers test, check, lint, and type scripts", () => {
  const result = discoverTestScripts(JSON.stringify({
    scripts: {
      test: "vitest run",
      typecheck: "tsc --noEmit",
      lint: "eslint .",
      build: "vite build",
      dev: "vite",
    },
  }));

  assert.equal(result.validJson, true);
  assert.deepEqual(result.scripts, [
    "test: vitest run",
    "typecheck: tsc --noEmit",
    "lint: eslint .",
  ]);
});

test("reports valid package JSON with no matching scripts", () => {
  const result = discoverTestScripts(JSON.stringify({ scripts: { build: "vite build" } }));

  assert.equal(result.validJson, true);
  assert.deepEqual(result.scripts, []);
});

test("handles malformed package JSON without throwing", () => {
  const result = discoverTestScripts("{not json");

  assert.equal(result.validJson, false);
  assert.deepEqual(result.scripts, []);
});

const expectedSha = "a".repeat(40);
const otherSha = "b".repeat(40);
const run = (headSha: string, status = "completed", conclusion: string | null = "success"): WorkflowRun => ({
  id: 42,
  name: "Onay CI",
  status,
  conclusion,
  head_sha: headSha,
  html_url: "https://example.test/actions/runs/42",
});
const jobs: CiJob[] = [{ run_id: 42, name: "Typecheck and API tests", status: "completed", conclusion: "success" }];
const factoryJobs: CiJob[] = [{ run_id: 42, name: "typecheck", status: "completed", conclusion: "success", steps: [
  { name: "Typecheck", status: "completed", conclusion: "success" },
  { name: "Test", status: "completed", conclusion: "success" },
] }];

test("accepts successful required CI evidence only for the exact expected SHA", () => {
  const result = evaluateTestExecutionEvidence([run(expectedSha)], jobs, expectedSha);
  assert.equal(result.testsExecuted, true);
  assert.equal(result.status, "passed");
  assert.equal(result.evidence[0]?.headSha, expectedSha);
});

test("does not accept successful CI evidence from a different SHA", () => {
  const result = evaluateTestExecutionEvidence([run(otherSha)], jobs, expectedSha);
  assert.equal(result.testsExecuted, false);
  assert.equal(result.status, "sha-mismatch");
  assert.match(result.notes[0] ?? "", /exact expected commit SHA/);
});

test("does not accept CI while the workflow is still running", () => {
  const result = evaluateTestExecutionEvidence([run(expectedSha, "in_progress", null)], jobs, expectedSha);
  assert.equal(result.testsExecuted, false);
  assert.equal(result.status, "pending");
});

test("does not accept CI when the required test job is missing", () => {
  const result = evaluateTestExecutionEvidence([run(expectedSha)], [], expectedSha);
  assert.equal(result.testsExecuted, false);
  assert.equal(result.status, "pending");
});

test("does not accept a failed required test job", () => {
  const result = evaluateTestExecutionEvidence(
    [run(expectedSha)],
    [{ run_id: 42, name: "Typecheck and API tests", status: "completed", conclusion: "failure" }],
    expectedSha,
  );
  assert.equal(result.testsExecuted, false);
  assert.equal(result.status, "failed");
});

test("reports individual CI step evidence for typecheck and test", () => {
  const result = evaluateTestExecutionEvidence([run(expectedSha)], factoryJobs, expectedSha, ["typecheck"], ["Typecheck", "Test"]);
  assert.equal(result.testsExecuted, true);
  assert.deepEqual(result.checks.map(check => [check.name, check.conclusion]), [
    ["Typecheck", "success"],
    ["Test", "success"],
  ]);
});

test("does not pass when a required CI step is missing", () => {
  const result = evaluateTestExecutionEvidence([run(expectedSha)], [
    { run_id: 42, name: "typecheck", status: "completed", conclusion: "success", steps: [
      { name: "Typecheck", status: "completed", conclusion: "success" },
    ] },
  ], expectedSha, ["typecheck"], ["Typecheck", "Test"]);
  assert.equal(result.testsExecuted, false);
  assert.equal(result.status, "pending");
});

test("does not pass when the Test step failed even if job evidence is inconsistent", () => {
  const result = evaluateTestExecutionEvidence([run(expectedSha)], [
    { run_id: 42, name: "typecheck", status: "completed", conclusion: "success", steps: [
      { name: "Typecheck", status: "completed", conclusion: "success" },
      { name: "Test", status: "completed", conclusion: "failure" },
    ] },
  ], expectedSha, ["typecheck"], ["Typecheck", "Test"]);
  assert.equal(result.testsExecuted, false);
  assert.equal(result.status, "failed");
});
