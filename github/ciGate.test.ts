import assert from "node:assert/strict";
import testCase from "node:test";
import { evaluateCiJobs, type CiJob } from "./ciGate.js";
import { buildWorkflowRunsQuery, filterWorkflowRunsBySha } from "./githubClient.js";
import type { WorkflowRun } from "./githubClient.js";

const runs: WorkflowRun[] = [
  { id: 1, name: "CI", status: "completed", conclusion: "success", html_url: "https://example.test/run/1" },
];

function job(name: string, conclusion: string | null, status = "completed"): CiJob {
  return { name, status, conclusion };
}

testCase("CI gate passes when every required job is successful", () => {
  const result = evaluateCiJobs(runs, [
    job("test", "success"),
    job("check", "success"),
    job("lint", "success"),
    job("typecheck", "success"),
  ], ["test", "check", "lint", "type"]);
  assert.equal(result.status, "passed");
});

testCase("CI gate fails when a required job fails", () => {
  const result = evaluateCiJobs(runs, [
    job("test", "success"),
    job("check", "failure"),
    job("lint", "success"),
    job("typecheck", "success"),
  ], ["test", "check", "lint", "type"]);
  assert.equal(result.status, "failed");
});

testCase("CI gate stays pending when a required job is missing", () => {
  const result = evaluateCiJobs(runs, [
    job("test", "success"),
    job("typecheck", "success"),
  ], ["test", "check", "lint", "type"]);
  assert.equal(result.status, "pending");
});

testCase("CI gate stays pending while a required job is running", () => {
  const result = evaluateCiJobs(runs, [
    job("test", "success"),
    job("check", null, "in_progress"),
    job("lint", "success"),
    job("typecheck", "success"),
  ], ["test", "check", "lint", "type"]);
  assert.equal(result.status, "pending");
});

testCase("TezJet's combined typecheck and API test job satisfies the configured gate", () => {
  const result = evaluateCiJobs(
    runs,
    [job("Typecheck and API tests", "success")],
    ["Typecheck and API tests"],
  );
  assert.equal(result.status, "passed");
});

testCase("TezJet's combined job fails the gate if API tests fail", () => {
  const result = evaluateCiJobs(
    runs,
    [job("Typecheck and API tests", "failure")],
    ["Typecheck and API tests"],
  );
  assert.equal(result.status, "failed");
});

testCase("CI gate cannot pass when a different workflow run for the commit failed", () => {
  const mixedRuns: WorkflowRun[] = [
    ...runs,
    { id: 2, name: "Additional workflow", status: "completed", conclusion: "failure", html_url: "https://example.test/run/2" },
  ];
  const result = evaluateCiJobs(
    mixedRuns,
    [job("Typecheck and API tests", "success")],
    ["Typecheck and API tests"],
  );
  assert.equal(result.status, "failed");
});

testCase("CI gate remains pending while any workflow run for the commit is in progress", () => {
  const mixedRuns: WorkflowRun[] = [
    ...runs,
    { id: 2, name: "Additional workflow", status: "in_progress", conclusion: null, html_url: "https://example.test/run/2" },
  ];
  const result = evaluateCiJobs(
    mixedRuns,
    [job("Typecheck and API tests", "success")],
    ["Typecheck and API tests"],
  );
  assert.equal(result.status, "pending");
});


testCase("exact-SHA workflow lookup does not filter to the default branch", () => {
  assert.equal(
    buildWorkflowRunsQuery("main", "abc123"),
    "?per_page=20&head_sha=abc123",
  );
});

testCase("workflow lookup without SHA keeps the requested branch filter", () => {
  assert.equal(
    buildWorkflowRunsQuery("dev/feature", undefined),
    "?branch=dev%2Ffeature&per_page=20",
  );
});

testCase("exact-SHA CI gate rejects runs from other commits and runs without SHA evidence", () => {
  const result = filterWorkflowRunsBySha([
    { ...runs[0], head_sha: "ABC123" },
    { ...runs[0], id: 2, head_sha: "def456" },
    { ...runs[0], id: 3, head_sha: undefined },
  ], "abc123");
  assert.deepEqual(result.map(run => run.id), [1]);
});

testCase("CI run filtering keeps all runs when no exact SHA was requested", () => {
  const result = filterWorkflowRunsBySha([
    { ...runs[0], head_sha: "abc123" },
    { ...runs[0], id: 2, head_sha: "def456" },
  ]);
  assert.equal(result.length, 2);
});
