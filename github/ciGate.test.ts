import assert from "node:assert/strict";
import testCase, { type TestContext } from "node:test";
import { checkCiGate, evaluateCiJobs, getCiFailureContext, waitForCiGate, type CiJob } from "./ciGate.js";
import { buildWorkflowRunsQuery, filterWorkflowRunsBySha, GitHubClient } from "./githubClient.js";
import type { WorkflowRun } from "./githubClient.js";

const runs: WorkflowRun[] = [
  { id: 1, name: "CI", status: "completed", conclusion: "success", html_url: "https://example.test/run/1" },
];

function job(name: string, conclusion: string | null, status = "completed"): CiJob {
  return { name, status, conclusion, run_id: 1 };
}

testCase("CI gate passes when every required job is successful", () => {
  const result = evaluateCiJobs(runs, [
    job("test", "success"),
    job("check", "success"),
    job("lint", "success"),
    job("typecheck", "success"),
  ], ["test", "check", "lint", "typecheck"]);
  assert.equal(result.status, "passed");
});

testCase("CI gate fails when a required job fails", () => {
  const result = evaluateCiJobs(runs, [
    job("test", "success"),
    job("check", "failure"),
    job("lint", "success"),
    job("typecheck", "success"),
  ], ["test", "check", "lint", "typecheck"]);
  assert.equal(result.status, "failed");
});

testCase("CI gate stays pending when a required job is missing", () => {
  const result = evaluateCiJobs(runs, [
    job("test", "success"),
    job("typecheck", "success"),
  ], ["test", "check", "lint", "typecheck"]);
  assert.equal(result.status, "pending");
});

testCase("CI gate stays pending while a required job is running", () => {
  const result = evaluateCiJobs(runs, [
    job("test", "success"),
    job("check", null, "in_progress"),
    job("lint", "success"),
    job("typecheck", "success"),
  ], ["test", "check", "lint", "typecheck"]);
  assert.equal(result.status, "pending");
});

testCase("Onay's combined typecheck and API test job satisfies the configured gate", () => {
  const result = evaluateCiJobs(
    runs,
    [job("Typecheck and API tests", "success")],
    ["Typecheck and API tests"],
  );
  assert.equal(result.status, "passed");
});

testCase("Onay's combined job fails the gate if API tests fail", () => {
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

testCase("CI does not confuse typecheck, pretest, or misleading suffixed names with required jobs", () => {
  for (const [actual, required] of [["typecheck", "check"], ["pretest", "test"], ["test disabled", "test"], ["test", " "]]) {
    assert.equal(evaluateCiJobs(runs, [job(actual, "success")], [required]).status, "pending");
  }
});

testCase("CI accepts exact case-insensitive names and requires every matrix entry to succeed", () => {
  assert.equal(evaluateCiJobs(runs, [job("TYPECHECK", "success")], ["typecheck"]).status, "passed");
  const matrix = [job("test (Node 20)", "success"), job("test (Node 22)", "failure")];
  assert.equal(evaluateCiJobs(runs, matrix, ["test"]).status, "failed");
});

testCase("CI rejects unrelated jobs and jobs without workflow provenance", () => {
  for (const runId of [undefined, 999]) {
    assert.equal(evaluateCiJobs(runs, [{ ...job("test", "success"), run_id: runId }], ["test"]).status, "pending");
  }
});

testCase("CI rejects successful jobs from a different commit or stale run attempt", () => {
  const exactRun = { ...runs[0]!, head_sha: "a".repeat(40), run_attempt: 2 };
  const validJob = { ...job("test", "success"), run_attempt: 2, head_sha: exactRun.head_sha };
  for (const candidate of [
    { ...validJob, head_sha: "b".repeat(40) },
    { ...validJob, run_attempt: 1 },
    { ...validJob, run_attempt: undefined },
  ]) {
    assert.equal(evaluateCiJobs([exactRun], [candidate], ["test"]).status, "pending");
  }
  assert.equal(evaluateCiJobs([exactRun], [validJob, { ...validJob, run_attempt: 1, conclusion: "failure" }], ["test"]).status, "passed");
});

testCase("CI cannot use steps from unrelated jobs or another matrix entry", () => {
  const step = (name: string) => ({ name, status: "completed", conclusion: "success" });
  const incompleteJob = { ...job("typecheck", "success"), steps: [step("Typecheck")] };
  assert.equal(evaluateCiJobs(runs, [incompleteJob, { ...job("upload", "success"), steps: [step("Test")] }],
    ["typecheck"], ["Typecheck", "Test"]).status, "pending");
  assert.equal(evaluateCiJobs(runs, [
    { ...incompleteJob, name: "typecheck (Node 20)" },
    { ...incompleteJob, name: "typecheck (Node 22)", steps: [step("Typecheck"), step("Test")] },
  ], ["typecheck"], ["Typecheck", "Test"]).status, "pending");
});

testCase("CI does not pass skipped or pending required jobs and steps", () => {
  assert.equal(evaluateCiJobs(runs, [job("test", "skipped")], ["test"]).status, "failed");
  for (const [status, conclusion, expected] of [
    ["completed", "skipped", "failed"], ["in_progress", null, "pending"],
  ] as const) {
    assert.equal(evaluateCiJobs(runs, [{ ...job("test", "success"), steps: [{ name: "Test", status, conclusion }] }],
      ["test"], ["Test"]).status, expected);
  }
});

function allowRepository(t: TestContext) {
  const repository = "erman-ksv/Onay-Agents-Factory";
  const previous = process.env.AGENT_ALLOWED_REPOSITORIES;
  process.env.AGENT_ALLOWED_REPOSITORIES = repository;
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_ALLOWED_REPOSITORIES;
    else process.env.AGENT_ALLOWED_REPOSITORIES = previous;
  });
  return repository;
}

testCase("branch-only CI checks resolve current head and reject historical green evidence", async t => {
  const repository = allowRepository(t);
  const sha = "a".repeat(40);
  t.mock.method(GitHubClient.prototype, "getCommitSha", async (ref: string) => {
    assert.equal(ref, "feature");
    return sha;
  });
  t.mock.method(GitHubClient.prototype, "getWorkflowRuns", async (ref: string, expectedSha?: string) => {
    assert.equal(ref, "feature");
    assert.equal(expectedSha, sha);
    return [{ ...runs[0]!, head_sha: "b".repeat(40) }];
  });
  const getJobs = t.mock.method(GitHubClient.prototype, "getWorkflowJobs", async () => ({ jobs: [] }));
  assert.equal((await checkCiGate({ branch: "feature", repository, requiredNames: ["test"] })).status, "no-runs");
  assert.equal(getJobs.mock.callCount(), 0);
});

testCase("CI wait pins branch head once and fetches the exact workflow attempt", async t => {
  const repository = allowRepository(t);
  const sha = "a".repeat(40);
  const head = t.mock.method(GitHubClient.prototype, "getCommitSha", async () => sha);
  t.mock.method(GitHubClient.prototype, "getWorkflowRuns", async (_ref: string, expectedSha?: string) => {
    assert.equal(expectedSha, sha);
    return [{ ...runs[0]!, head_sha: sha, run_attempt: 3 }];
  });
  t.mock.method(GitHubClient.prototype, "getWorkflowJobs", async (runId: number, attempt?: number) => {
    assert.equal(runId, 1);
    assert.equal(attempt, 3);
    return { jobs: [{ id: 1, html_url: "", ...job("test", "success"), run_attempt: 3, head_sha: sha }] };
  });
  assert.equal((await waitForCiGate({ branch: "feature", repository, requiredNames: ["test"] })).status, "passed");
  assert.equal(head.mock.callCount(), 1);
});

testCase("CI rejects symbolic or abbreviated candidate SHAs before fetching runs", async t => {
  const repository = allowRepository(t);
  const fetchRuns = t.mock.method(GitHubClient.prototype, "getWorkflowRuns", async () => []);
  for (const headSha of ["main", "abc123", ""]) {
    await assert.rejects(checkCiGate({ branch: "feature", repository, headSha }), /immutable commit SHA/);
  }
  assert.equal(fetchRuns.mock.callCount(), 0);
});

testCase("repair context retains required job and step gates on an overall green workflow", async t => {
  const repository = allowRepository(t);
  const sha = "a".repeat(40);
  t.mock.method(GitHubClient.prototype, "getWorkflowRuns", async () => [{ ...runs[0]!, head_sha: sha }]);
  t.mock.method(GitHubClient.prototype, "getWorkflowJobs", async () => ({ jobs: [{
    id: 1, html_url: "", ...job("typecheck", "success"), head_sha: sha,
    steps: [{ name: "Typecheck", number: 1, status: "completed", conclusion: "success" }],
  }] }));
  const result = await getCiFailureContext("feature", sha, ["typecheck"], { repository, requiredStepNames: ["Typecheck", "Test"] });
  assert.equal(result.gate.status, "pending");
  assert.equal(result.failures.length, 1);
});
