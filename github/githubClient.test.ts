import assert from "node:assert/strict";
import test from "node:test";
import { GitHubClient } from "./githubClient.js";

const client = () => new GitHubClient({ repository: "erman-ksv/TezJet", token: "fixture-token" });
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

test("workflow pagination retains failures beyond the first page", async t => {
  const requested: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    requested.push(url);
    const second = url.includes("&page=2");
    return response({ total_count: 2, workflow_runs: [{ id: second ? 2 : 1, status: "completed", conclusion: second ? "failure" : "success" }] });
  });
  const runs = await client().getWorkflowRuns("fix/candidate", "a".repeat(40));
  assert.deepEqual(runs.map(run => run.conclusion), ["success", "failure"]);
  assert.equal(requested.length, 2);
  assert.match(requested[1], /head_sha=a{40}&page=2/);
});

test("incomplete workflow evidence cannot establish a green gate", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => response({ total_count: 2, workflow_runs: requests++ ? [] : [{ id: 1 }] }));
  await assert.rejects(() => client().getWorkflowRuns("fix/candidate"), /incomplete workflow run evidence/);
});

test("workflow search limit is reported rather than silently truncating evidence", async t => {
  t.mock.method(globalThis, "fetch", async () => response({ total_count: 1_001, workflow_runs: [] }));
  await assert.rejects(() => client().getWorkflowRuns("fix/candidate"), /1,000-result search limit/);
});

test("job pagination pins the requested run attempt and retains later failed jobs", async t => {
  const requested: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    requested.push(url);
    const second = url.includes("&page=2");
    return response({ total_count: 2, jobs: [{ id: second ? 2 : 1, run_id: 7, run_attempt: 3, conclusion: second ? "failure" : "success" }] });
  });
  const result = await client().getWorkflowJobs(7, 3);
  assert.deepEqual(result.jobs.map(job => job.conclusion), ["success", "failure"]);
  assert.equal(requested.length, 2);
  assert.match(requested[0], /runs\/7\/attempts\/3\/jobs\?per_page=100$/);
});

test("incomplete job evidence fails closed", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => response({ total_count: 2, jobs: requests++ ? [] : [{ id: 1 }] }));
  await assert.rejects(() => client().getWorkflowJobs(7), /incomplete workflow job evidence/);
});

test("invalid workflow run IDs are rejected before making requests", async t => {
  t.mock.method(globalThis, "fetch", async () => { assert.fail("Invalid run must not be queried"); });
  await assert.rejects(() => client().getWorkflowJobs(0), /positive workflow run ID/);
  await assert.rejects(() => client().getWorkflowJobs(7, Number.NaN), /positive workflow run ID/);
});
