import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prepareTezJetChange } from "./changeWorkflow.js";
import { checkCiGate, waitForCiGate } from "./ciGate.js";
import { GitHubClient } from "./githubClient.js";

const repository = "erman-ksv/TezJet-Agent-Factory";
const baseRef = "dev/agent-factory-core";
const baseSha = "a".repeat(40);
const candidateSha = "b".repeat(40);
const branch = "fix/verified-commander";
const input = {
  repository, baseRef, baseSha, branch,
  title: "Verify Commander execution",
  body: "Require real execution evidence.",
  files: [{ path: "commander/example.ts", content: "export const verified = true;", message: "Require execution evidence" }],
};

function allowRepository(t: TestContext) {
  const previous = process.env.AGENT_ALLOWED_REPOSITORIES;
  process.env.AGENT_ALLOWED_REPOSITORIES = repository;
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_ALLOWED_REPOSITORIES;
    else process.env.AGENT_ALLOWED_REPOSITORIES = previous;
  });
}

test("publication uses the allow-listed repository, pinned base SHA and requested PR base", async t => {
  allowRepository(t);
  const calls: unknown[][] = [];
  t.mock.method(GitHubClient.prototype, "createBranch", async function (this: GitHubClient, ...args: unknown[]) {
    calls.push(["branch", this.repository, ...args]);
  });
  t.mock.method(GitHubClient.prototype, "upsertFile", async function (this: GitHubClient, ...args: unknown[]) {
    calls.push(["write", this.repository, ...args]);
    return candidateSha;
  });
  t.mock.method(GitHubClient.prototype, "createPullRequest", async function (this: GitHubClient, ...args: unknown[]) {
    calls.push(["pr", this.repository, ...args]);
    return { html_url: "https://example.test/pull/1", number: 1, head: { sha: candidateSha } };
  });

  const result = await prepareTezJetChange(input);
  assert.equal(result.head_sha, candidateSha);
  assert.deepEqual(calls[0], ["branch", repository, branch, baseRef, baseSha]);
  assert.deepEqual(calls[1], ["write", repository, "commander/example.ts", "export const verified = true;", "Require execution evidence", branch]);
  assert.equal(calls[2][1], repository);
  assert.equal(calls[2][2], branch);
  assert.equal(calls[2].at(-1), baseRef);
});

test("publication fails closed when the PR head differs from the written candidate", async t => {
  allowRepository(t);
  t.mock.method(GitHubClient.prototype, "createBranch", async () => {});
  t.mock.method(GitHubClient.prototype, "upsertFile", async () => candidateSha);
  t.mock.method(GitHubClient.prototype, "createPullRequest", async () => ({
    html_url: "https://example.test/pull/1", number: 1, head: { sha: "c".repeat(40) },
  }));
  await assert.rejects(prepareTezJetChange(input), /head does not match/);
});

test("publication refuses a protected branch before branch creation or writes", async t => {
  allowRepository(t);
  const create = t.mock.method(GitHubClient.prototype, "createBranch", async () => {});
  const write = t.mock.method(GitHubClient.prototype, "upsertFile", async () => candidateSha);
  await assert.rejects(prepareTezJetChange({ ...input, branch: "main" }), /feature branch is required/);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(write.mock.callCount(), 0);
});

test("publication refuses invalid branch/base targets and symbolic base SHAs before GitHub access", async t => {
  const read = t.mock.method(GitHubClient.prototype, "getCommitSha", async () => baseSha);
  await assert.rejects(prepareTezJetChange({ ...input, branch: baseRef }), /must differ/);
  await assert.rejects(prepareTezJetChange({ ...input, branch: "refs/heads/main" }), /Invalid.*ref/);
  await assert.rejects(prepareTezJetChange({ ...input, baseRef: "main~1" }), /Invalid.*ref/);
  await assert.rejects(prepareTezJetChange({ ...input, baseSha: "main" }), /immutable commit SHA/);
  assert.equal(read.mock.callCount(), 0);
});

test("GitHub branch creation uses a pinned SHA without resolving a moving branch", async t => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Response("{}", { status: 201, headers: { "content-type": "application/json" } });
  });
  const github = new GitHubClient({ repository, token: "test-token" });
  await github.createBranch(branch, baseRef, baseSha);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `https://api.github.com/repos/${repository}/git/refs`);
  assert.equal(requests[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { ref: `refs/heads/${branch}`, sha: baseSha });
});

test("generic CI gates require the configured steps for the exact candidate SHA", async t => {
  allowRepository(t);
  const calls: unknown[][] = [];
  t.mock.method(GitHubClient.prototype, "getWorkflowRuns", async function (this: GitHubClient, ...args: unknown[]) {
    calls.push([this.repository, ...args]);
    return [{ id: 1, name: "CI", status: "completed", conclusion: "success", html_url: "https://example.test/run/1", head_sha: candidateSha }];
  });
  t.mock.method(GitHubClient.prototype, "getWorkflowJobs", async () => ({ jobs: [{
    id: 1, run_id: 1, head_sha: candidateSha, name: "typecheck", status: "completed", conclusion: "success", html_url: "https://example.test/job/1",
    steps: [{ name: "Typecheck", number: 1, status: "completed", conclusion: "success" }],
  }] }));
  const options = { repository, requiredStepNames: ["Typecheck", "Test"] };
  const result = await checkCiGate(branch, ["typecheck"], candidateSha, options);
  assert.equal(result.status, "pending");
  assert.deepEqual(calls, [[repository, branch, candidateSha]]);
});

test("CI wait forwards repository and step gates when checking a successful candidate", async t => {
  allowRepository(t);
  t.mock.method(GitHubClient.prototype, "getWorkflowRuns", async function (this: GitHubClient, ref: string, sha?: string) {
    assert.equal(this.repository, repository);
    assert.equal(ref, branch);
    assert.equal(sha, candidateSha);
    return [{ id: 1, name: "CI", status: "completed", conclusion: "success", html_url: "https://example.test/run/1", head_sha: candidateSha }];
  });
  t.mock.method(GitHubClient.prototype, "getWorkflowJobs", async () => ({ jobs: [{
    id: 1, run_id: 1, head_sha: candidateSha, name: "typecheck", status: "completed", conclusion: "success", html_url: "https://example.test/job/1",
    steps: ["Typecheck", "Test"].map((name, index) => ({ name, number: index + 1, status: "completed", conclusion: "success" })),
  }] }));
  const result = await waitForCiGate({ branch, repository, headSha: candidateSha, requiredNames: ["typecheck"], requiredStepNames: ["Typecheck", "Test"] });
  assert.equal(result.status, "passed");
});

test("CI refuses an unlisted repository before fetching evidence", async t => {
  allowRepository(t);
  const fetchRuns = t.mock.method(GitHubClient.prototype, "getWorkflowRuns", async () => []);
  await assert.rejects(checkCiGate({ branch, repository: "someone/unlisted", headSha: candidateSha }), /not allow-listed/);
  assert.equal(fetchRuns.mock.callCount(), 0);
});
