import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A variable URL keeps this JS CLI test separate from production TS imports.
const moduleUrl = new URL("../scripts/calculator-after-ci-observe.mjs", import.meta.url);
const { observeCalculatorAfterCi } = await import(moduleUrl.href) as {
  observeCalculatorAfterCi: (env: NodeJS.ProcessEnv, transport: typeof fetch) => Promise<Record<string, unknown>>;
};
const REPO = "erman-ksv/Onay-Factory-Calculator", FACTORY = "erman-ksv/Onay-Agents-Factory";
const BRANCH = "feat/calculator-agent/calculator-pilot-step7-v1";
const SHA = "5c4bc71b3119a50d2ca7ce1dbdf12bcaa000ce75", BASE = "2c1218f2b020962ad93adf68d902a847271a7e72";
const RUN = 39610242811, JOB = 119256919001, WORKFLOW = 390241255;
const PATH = ".github/workflows/calculator-task-ci.yml", PIN = "45fae4a292a04e89a631ad7ff2469a3af7265e70";
const ERROR = { message: "calculator_after_ci_observation_unverified_no_execution" };
const env = { GITHUB_REPOSITORY: FACTORY, CALCULATOR_GITHUB_TOKEN: "fixture-token-never-log",
  GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feat/step8-test", GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SHA: "f".repeat(40), GITHUB_RUN_ID: "111" };
type Step = { number: number; name: string; status: string; conclusion: string };
type Job = { id: number; name: string; run_id: number; run_attempt: number; head_sha: string; html_url: string;
  status: string; conclusion: string; steps?: Step[] };
type Run = { id: number; workflow_id: number; path: string; head_sha: string; head_branch: string; run_attempt: number;
  event: string; status: string; conclusion: string; repository: { full_name: string }; head_repository: { full_name: string }; html_url: string };
type Entry = { path: string; sha: string; type: string; mode: string };
type Fixture = ReturnType<typeof fixture>;
function fixture() {
  const run: Run = { id: RUN, workflow_id: WORKFLOW, path: PATH, head_sha: SHA, head_branch: BRANCH,
    run_attempt: 1, event: "push", status: "completed", conclusion: "success", repository: { full_name: REPO },
    head_repository: { full_name: REPO }, html_url: `https://github.com/${REPO}/actions/runs/${RUN}` };
  const jobs: Job[] = [{ id: JOB, name: "Calculator task CI", run_id: RUN, run_attempt: 1, head_sha: SHA,
    html_url: `https://github.com/${REPO}/actions/runs/${RUN}/job/${JOB}`, status: "completed", conclusion: "success",
    steps: [{ number: 1, name: "Syntax", status: "completed", conclusion: "success" },
      { number: 2, name: "Task tests", status: "completed", conclusion: "success" }] },
  { id: JOB + 1, name: "Workflow registration only", run_id: RUN, run_attempt: 1, head_sha: SHA,
    html_url: `https://github.com/${REPO}/actions/runs/${RUN}/job/${JOB + 1}`,
    status: "completed", conclusion: "skipped" }];
  const entries: Entry[] = [{ path: ".github", sha: "a".repeat(40), type: "tree", mode: "040000" },
    { path: ".github/workflows", sha: "b".repeat(40), type: "tree", mode: "040000" },
    { path: PATH, sha: PIN, type: "blob", mode: "100644" }];
  return { run, jobs, entries, ref: SHA, parents: [BASE], workflow: { id: WORKFLOW, path: PATH, state: "active" },
    listed: [] as Run[], truncated: false };
}
function transport(f: Fixture, mutate?: (path: string, call: number) => void, response?: (path: string) => Response | undefined) {
  let calls = 0;
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input, options) => {
    const url = String(input); calls++; requests.push(url);
    assert.ok(url.startsWith(`https://api.github.com/repos/${REPO}/`));
    assert.equal(options?.method, "GET"); assert.equal(options?.redirect, "error");
    assert.equal(options?.body, undefined); assert.ok(options?.signal);
    assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer " + env.CALCULATOR_GITHUB_TOKEN);
    const path = url.slice(`https://api.github.com/repos/${REPO}`.length);
    mutate?.(path, calls);
    const override = response?.(path); if (override) return override;
    if (path.startsWith("/git/ref/heads/")) return Response.json({ ref: "refs/heads/" + BRANCH, object: { type: "commit", sha: f.ref } });
    if (path.startsWith("/git/commits/")) {
      const sha = path.slice("/git/commits/".length);
      return Response.json({ sha, tree: { sha }, parents: (sha === SHA ? f.parents : []).map(parent => ({ sha: parent })) });
    }
    if (path.startsWith("/git/trees/")) return Response.json({ sha: path.slice("/git/trees/".length).split("?")[0],
      truncated: f.truncated, tree: f.entries });
    if (path === "/actions/workflows/" + WORKFLOW) return Response.json(f.workflow);
    if (path.startsWith("/actions/runs?")) return Response.json({ total_count: 1 + f.listed.length, workflow_runs: [f.run, ...f.listed] });
    if (path === `/actions/runs/${RUN}`) return Response.json(f.run);
    if (path === `/actions/runs/${RUN}/attempts/1/jobs?per_page=100&page=1`) return Response.json({ total_count: f.jobs.length, jobs: f.jobs });
    throw Error("Unexpected read-only observation endpoint");
  };
  return { fetcher, requests, calls: () => calls };
}

test("late CI observation uses only bounded read APIs and grants no execution authority", async () => {
  const f = fixture(), http = transport(f);
  const result = await observeCalculatorAfterCi(env, http.fetcher);
  assert.equal(result.status, "observed-exact-candidate-ci-passed");
  assert.equal(result.testsExecuted, true); assert.equal(result.requests, 13); assert.equal(http.calls(), 13);
  for (const name of ["executionAuthorized", "automaticEventSubscription", "modelsRun", "writesPerformed", "priorReceiptsChanged", "wholeAppCompleted"])
    assert.equal(result[name], false);
  assert.equal(result.observationOnly, true);
  assert.ok(!JSON.stringify(result).includes(env.CALCULATOR_GITHUB_TOKEN));
  assert.ok(http.requests.every(url => !/artifacts|blobs|contents|dispatch|chat|completions/.test(url)));
});

test("untrusted launch context is refused before the first HTTP read", async t => {
  const variants = [{ GITHUB_REPOSITORY: "other/repo" }, { CALCULATOR_GITHUB_TOKEN: "" }, { GITHUB_EVENT_NAME: "pull_request_target" },
    { GITHUB_REF: "refs/heads/main" }, { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_SHA: "main" }, { GITHUB_RUN_ID: "0" }];
  for (const variation of variants) await t.test(Object.keys(variation)[0], async () => {
    const http = transport(fixture());
    await assert.rejects(() => observeCalculatorAfterCi({ ...env, ...variation }, http.fetcher), ERROR);
    assert.equal(http.calls(), 0);
  });
});

test("wrong candidate, origin, workflow, attempt, jobs and skipped tests cannot pass", async t => {
  const cases: [string, (f: Fixture) => void][] = [
    ["moved branch", f => { f.ref = "a".repeat(40); }],
    ["wrong run SHA", f => { f.run.head_sha = BASE; }],
    ["fork origin", f => { f.run.head_repository.full_name = "attacker/fork"; }],
    ["wrong repository", f => { f.run.repository.full_name = "other/repo"; }],
    ["wrong branch", f => { f.run.head_branch = "main"; }],
    ["wrong workflow id", f => { f.run.workflow_id++; }],
    ["wrong workflow path", f => { f.run.path = ".github/workflows/fake.yml"; }],
    ["wrong run attempt", f => { f.run.run_attempt = 2; }],
    ["pull request run", f => { f.run.event = "pull_request"; }],
    ["pending run", f => { f.run.status = "in_progress"; f.run.conclusion = ""; }],
    ["failed run", f => { f.run.conclusion = "failure"; }],
    ["untrusted workflow blob", f => { f.entries[2].sha = BASE; }],
    ["symlink workflow", f => { f.entries[2].mode = "120000"; }],
    ["truncated tree", f => { f.truncated = true; }],
    ["wrong candidate parent", f => { f.parents = ["a".repeat(40)]; }],
    ["merge candidate", f => { f.parents.push("a".repeat(40)); }],
    ["inactive workflow", f => { f.workflow.state = "disabled_manually"; }],
    ["wrong job SHA", f => { f.jobs[0].head_sha = BASE; }],
    ["wrong job attempt", f => { f.jobs[0].run_attempt = 2; }],
    ["skipped job", f => { f.jobs[0].conclusion = "skipped"; }],
    ["skipped required test", f => { f.jobs[0].steps![1].conclusion = "skipped"; }],
    ["missing required syntax", f => { f.jobs[0].steps!.shift(); }],
    ["duplicate required test", f => { f.jobs[0].steps!.push({ ...f.jobs[0].steps![1], number: 3 }); }],
    ["duplicate step number", f => { f.jobs[0].steps![1].number = 1; }],
    ["only registration", f => { f.jobs.shift(); }],
    ["different run of pinned workflow", f => { f.listed.push({ ...f.run, id: RUN + 1 }); }],
    ["duplicate listing", f => { f.listed.push({ ...f.run }); }],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const f = fixture(); mutate(f); const http = transport(f);
    await assert.rejects(() => observeCalculatorAfterCi(env, http.fetcher), ERROR);
    assert.ok(http.calls() <= 13);
  });
});

test("movement or changed CI evidence during the observation invalidates the result", async t => {
  for (const change of ["branch", "run", "jobs", "new run"]) await t.test(change, async () => {
    const f = fixture();
    const http = transport(f, (path, call) => {
      if (change === "branch" && call === 13) f.ref = BASE;
      if (change === "run" && call === 10) f.run.run_attempt = 2;
      if (change === "jobs" && call === 11) f.jobs[0].steps![1].conclusion = "skipped";
      if (change === "new run" && call === 12) f.listed.push({ ...f.run, id: RUN + 1 });
    });
    await assert.rejects(() => observeCalculatorAfterCi(env, http.fetcher), ERROR);
  });
});

test("HTTP failures, malformed JSON, and oversized bodies are refused without further reads", async t => {
  for (const name of ["unauthorized", "redirect", "malformed", "oversized"]) await t.test(name, async () => {
    const http = transport(fixture(), undefined, () => name === "unauthorized" ? new Response("unauthorized", { status: 401 }) :
      name === "redirect" ? new Response(null, { status: 302 }) : name === "malformed" ? new Response("not-json") : new Response(" ".repeat(1048577)));
    await assert.rejects(() => observeCalculatorAfterCi(env, http.fetcher));
    assert.equal(http.calls(), 1);
  });
});

test("observer workflow exposes no model keys and checks out only immutable Factory event source", () => {
  const workflow = readFileSync(new URL("../.github/workflows/calculator-after-ci-observe.yml", import.meta.url), "utf8");
  assert.ok(workflow.includes("ref: ${{ github.sha }}"));
  assert.ok(workflow.includes("sparse-checkout: scripts/calculator-after-ci-observe.mjs"));
  assert.ok(workflow.includes("persist-credentials: false"));
  assert.ok(workflow.includes("contents: read"));
  assert.equal((workflow.match(/secrets\./g) ?? []).length, 1);
  assert.ok(workflow.includes("secrets.CALCULATOR_GITHUB_TOKEN"));
  for (const forbidden of ["pull_request_target", "write", "GROQ_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "download-artifact", "npm install", "pnpm install", "workflow_dispatch", "repository_dispatch"])
    assert.ok(!workflow.includes(forbidden), forbidden);
});
