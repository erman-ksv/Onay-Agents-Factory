import assert from "node:assert/strict";
import testCase from "node:test";
import { evaluateCiJobs, type CiJob } from "./ciGate.js";
import type { WorkflowRun } from "./githubClient.js";

const runs: WorkflowRun[] = [
  { id: 1, name: "CI", status: "completed", conclusion: "success", html_url: "https://example.test/run/1" },
];

function job(name: string, conclusion: string | null, status = "completed"): CiJob {
  return { name, status, conclusion };
}

testCase("CI gate passes only when every required job is successful", () => {
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
