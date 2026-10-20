import test from "node:test";
import assert from "node:assert/strict";
import { CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
import { evaluateCiJobs } from "./ciGate.js";
import { CALCULATOR_CI_ERROR, createCalculatorCiReader, type CalculatorWorkflowPin } from "./calculatorCi.js";

const repository: string = CALCULATOR_PROFILE.repository, branch = "feat/calculator-agent/ci-reader-pilot";
const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40), D = "d".repeat(40);
const pin: CalculatorWorkflowPin = { id: 3, path: ".github/workflows/calculator-task-ci.yml", blobSha: C };
const env = { AGENT_FACTORY_TARGET_PROFILE: "calculator", AGENT_ALLOWED_REPOSITORIES: repository, GITHUB_TOKEN: "fixture-credential" };
const input = { repository, branch, candidateSha: A };
const refused = (error: unknown) => error instanceof Error && error.message === CALCULATOR_CI_ERROR;
function run(id = 11, workflowId = 3) {
  return { id, workflow_id: workflowId, path: workflowId === 3 ? pin.path : ".github/workflows/untrusted.yml", name: "Calculator task CI",
    status: "completed", conclusion: "success", head_sha: A, head_branch: branch, run_attempt: 2, event: "push",
    html_url: "https://github.com/" + repository + "/actions/runs/" + id,
    repository: { full_name: repository }, head_repository: { full_name: repository } };
}
function job(id = 101, runId = 11) {
  return { id, run_id: runId, run_attempt: 2, head_sha: A, name: "Calculator task CI", status: "completed", conclusion: "success",
    html_url: "https://github.com/" + repository + "/actions/runs/" + runId + "/job/" + id,
    steps: [{ number: 1, name: "Syntax", status: "completed", conclusion: "success" },
      { number: 2, name: "Task tests", status: "completed", conclusion: "success" }] };
}
function fixture() {
  const calls: Array<{ url: URL; init?: RequestInit }> = [], runs = [run()], jobs = [job()];
  const get = async (url: URL): Promise<unknown> => {
    const endpoint = url.pathname.replace("/repos/" + repository, "");
    if (endpoint.startsWith("/git/ref/heads/")) return { ref: "refs/heads/" + branch, object: { sha: A, type: "commit" } };
    if (endpoint === "/git/commits/" + A) return { sha: A, tree: { sha: B } };
    if (endpoint === "/git/trees/" + B) return { sha: B, truncated: false, tree: [
      { path: ".github", type: "tree", mode: "040000", sha: D }, { path: ".github/workflows", type: "tree", mode: "040000", sha: D },
      { path: pin.path, type: "blob", mode: "100644", sha: C }] };
    if (endpoint === "/actions/workflows/3") return { id: 3, path: pin.path, state: "active" };
    if (endpoint === "/actions/runs") {
      const page = Number(url.searchParams.get("page")), size = Number(url.searchParams.get("per_page"));
      return { total_count: runs.length, workflow_runs: runs.slice((page - 1) * size, page * size) };
    }
    const latest = /^\/actions\/runs\/(\d+)$/.exec(endpoint);
    if (latest) return runs.find(value => value.id === Number(latest[1]));
    const attempt = /^\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs$/.exec(endpoint);
    if (attempt) {
      const selected = jobs.filter(value => value.run_id === Number(attempt[1]));
      const page = Number(url.searchParams.get("page")), size = Number(url.searchParams.get("per_page"));
      return { total_count: selected.length, jobs: selected.slice((page - 1) * size, page * size) };
    }
    throw new Error("Unexpected fixture endpoint");
  };
  let resolve: (url: URL) => Promise<unknown> = get;
  const transport: typeof fetch = async (url, init) => {
    const parsed = new URL(String(url)); calls.push({ url: parsed, init });
    return Response.json(await resolve(parsed));
  };
  return { calls, runs, jobs, get, transport, override: (handler: typeof get) => { resolve = handler; } };
}

test("fixed-target CI tool pins workflow blobs, fresh attempts and exact head, using only GET", async () => {
  const f = fixture(), mutablePin = { ...pin }, mutableEnv = { ...env };
  const read = createCalculatorCiReader({ trustedWorkflows: [mutablePin] }, mutableEnv, f.transport);
  mutablePin.blobSha = D; mutableEnv.GITHUB_TOKEN = "different-fixture";
  const result = await read(input);
  assert.equal(evaluateCiJobs(result.runs, result.jobs, ["Calculator task CI"], ["Syntax", "Task tests"]).status, "passed");
  assert.equal(result.provenance.workflowPins[0].blobSha, C); assert.deepEqual(result.provenance.verifiedRunIds, [11]);
  assert.equal(result.jobs[0].run_attempt, 2); assert.ok(f.calls.some(call => call.url.pathname.endsWith("/attempts/2/jobs")));
  assert.ok(f.calls.every(call => call.url.origin === "https://api.github.com" && call.url.pathname.startsWith("/repos/" + repository + "/") && call.init?.method === "GET" && call.init?.redirect === "error"));
  assert.ok(!JSON.stringify(result).includes("fixture-credential"));
});
test("configuration and input authority fail before network calls", async t => {
  for (const name of ["profile", "token", "allowlist", "no-pins", "wrong-pin-path", "duplicate-pin", "bad-pin-sha", "missing-task-pin", "repository", "branch", "sha"]) await t.test(name, async () => {
    const f = fixture();
    const invalidEnv = { ...env }, pins = [{ ...pin }];
    if (name === "profile") invalidEnv.AGENT_FACTORY_TARGET_PROFILE = "onay";
    if (name === "token") invalidEnv.GITHUB_TOKEN = "";
    if (name === "allowlist") invalidEnv.AGENT_ALLOWED_REPOSITORIES = "erman-ksv/Onay";
    if (name === "no-pins") pins.length = 0;
    if (name === "wrong-pin-path") pins[0].path = ".github/workflows/evil.yml";
    if (name === "duplicate-pin") pins.push({ ...pin });
    if (name === "bad-pin-sha") pins[0].blobSha = "short";
    if (name === "missing-task-pin") pins[0].path = ".github/workflows/calculator-final-ci.yml";
    const candidate = { ...input };
    if (name === "repository") candidate.repository = "erman-ksv/Onay";
    if (name === "branch") candidate.branch = "main";
    if (name === "sha") candidate.candidateSha = "short";
    if (["repository", "branch", "sha"].includes(name)) await assert.rejects(() => createCalculatorCiReader({ trustedWorkflows: pins }, invalidEnv, f.transport)(candidate), refused);
    else assert.throws(() => createCalculatorCiReader({ trustedWorkflows: pins }, invalidEnv, f.transport), refused);
    assert.equal(f.calls.length, 0);
  });
});
test("untrusted workflow with matching job names cannot prove task CI", async () => {
  const f = fixture(); f.runs.splice(0, 1, run(21, 8));
  const result = await createCalculatorCiReader({ trustedWorkflows: [pin] }, env, f.transport)(input);
  assert.equal(result.runs.length, 1); assert.equal(result.jobs.length, 0);
  assert.equal(evaluateCiJobs(result.runs, result.jobs, ["Calculator task CI"], ["Syntax", "Task tests"]).status, "pending");
  assert.ok(!f.calls.some(call => call.url.pathname.includes("/attempts/")));
});
test("an unrelated failed workflow cannot be masked by a successful trusted workflow", async () => {
  const f = fixture(); f.runs.push({ ...run(21, 8), conclusion: "failure" });
  const result = await createCalculatorCiReader({ trustedWorkflows: [pin] }, env, f.transport)(input);
  assert.equal(evaluateCiJobs(result.runs, result.jobs, ["Calculator task CI"], ["Syntax", "Task tests"]).status, "failed");
});
test("complete empty results honestly report no runs", async () => {
  const f = fixture(); f.runs.length = 0;
  const result = await createCalculatorCiReader({ trustedWorkflows: [pin] }, env, f.transport)(input);
  assert.equal(result.runs.length, 0); assert.equal(result.jobs.length, 0);
  assert.equal(evaluateCiJobs(result.runs, result.jobs, ["Calculator task CI"]).status, "no-runs");
});
test("pagination exhausts every run page and the exact attempt job pages", async () => {
  const f = fixture(); f.runs.splice(0, 1, run(), ...Array.from({ length: 20 }, (_, index) => run(30 + index, 8)));
  f.jobs.splice(0, 1, ...Array.from({ length: 101 }, (_, index) => job(101 + index)));
  const result = await createCalculatorCiReader({ trustedWorkflows: [pin] }, env, f.transport)(input);
  assert.equal(result.runs.length, 21); assert.equal(result.jobs.length, 101);
  assert.ok(f.calls.some(call => call.url.pathname === "/repos/" + repository + "/actions/runs" && call.url.searchParams.get("page") === "2"));
  assert.ok(f.calls.some(call => call.url.pathname.endsWith("/attempts/2/jobs") && call.url.searchParams.get("page") === "2"));
});
test("incomplete, changing, excessive or duplicated pagination never becomes evidence", async t => {
  for (const name of ["short", "changing-total", "too-many-runs", "duplicate-run", "missing-total", "duplicate-job", "too-many-jobs"]) await t.test(name, async () => {
    const f = fixture(); let runReads = 0;
    if (name === "duplicate-run") f.runs.push({ ...run() });
    if (name === "duplicate-job") f.jobs.push({ ...job() });
    f.override(async url => {
      const data = await f.get(url);
      if (url.pathname.endsWith("/actions/runs")) {
        runReads++;
        if (name === "short") return { total_count: 2, workflow_runs: [run()] };
        if (name === "changing-total") return { total_count: runReads === 1 ? 21 : 22, workflow_runs: Array.from({ length: 20 }, (_, index) => run(100 + index, 8)) };
        if (name === "too-many-runs") return { total_count: 101, workflow_runs: [] };
        if (name === "missing-total") return { workflow_runs: [run()] };
      }
      if (name === "too-many-jobs" && url.pathname.endsWith("/jobs")) return { total_count: 501, jobs: [] };
      return data;
    });
    await assert.rejects(() => createCalculatorCiReader({ trustedWorkflows: [pin] }, env, f.transport)(input), refused);
  });
});
test("commit, tree, workflow metadata and blob provenance are required", async t => {
  for (const name of ["commit", "tree", "truncated", "missing-workflow", "symlink", "wrong-blob", "directory", "workflow-id", "workflow-path", "disabled"]) await t.test(name, async () => {
    const f = fixture();
    f.override(async url => {
      const data = await f.get(url) as Record<string, unknown>;
      if (url.pathname.includes("/git/commits/") && name === "commit") return { ...data, sha: D };
      if (url.pathname.includes("/git/trees/")) {
        const tree = data.tree as Array<Record<string, unknown>>;
        if (name === "tree") return { ...data, sha: D };
        if (name === "truncated") return { ...data, truncated: true };
        if (name === "missing-workflow") return { ...data, tree: tree.filter(entry => entry.path !== pin.path) };
        if (name === "symlink") return { ...data, tree: tree.map(entry => entry.path === pin.path ? { ...entry, mode: "120000" } : entry) };
        if (name === "wrong-blob") return { ...data, tree: tree.map(entry => entry.path === pin.path ? { ...entry, sha: D } : entry) };
        if (name === "directory") return { ...data, tree: tree.filter(entry => entry.path !== ".github/workflows") };
      }
      if (url.pathname.endsWith("/actions/workflows/3")) {
        if (name === "workflow-id") return { ...data, id: 4 };
        if (name === "workflow-path") return { ...data, path: ".github/workflows/evil.yml" };
        if (name === "disabled") return { ...data, state: "disabled_manually" };
      }
      return data;
    });
    await assert.rejects(() => createCalculatorCiReader({ trustedWorkflows: [pin] }, env, f.transport)(input), refused);
  });
});
test("wrong target, branch, SHA, attempt and changing heads are refused", async t => {
  for (const name of ["run-repo", "head-repo", "branch", "sha", "run-url", "missing-attempt", "merge-ref-event", "pull-request-target", "rerun", "status-change", "job-attempt", "job-sha", "job-run", "job-url", "head-moved", "new-run"]) await t.test(name, async () => {
    const f = fixture(); let runReads = 0, headReads = 0, lists = 0;
    f.override(async url => {
      const data = await f.get(url) as Record<string, unknown>;
      if (url.pathname.includes("/git/ref/heads/")) { headReads++; if (name === "head-moved" && headReads > 1) return { ...data, object: { sha: D, type: "commit" } }; }
      if (url.pathname.endsWith("/actions/runs")) {
        lists++;
        if (name === "new-run" && lists > 1) return { total_count: 2, workflow_runs: [run(), run(99, 8)] };
      }
      if (url.pathname.endsWith("/actions/runs/11") || url.pathname.endsWith("/actions/runs")) {
        const wrong = { ...run() } as Record<string, unknown>;
        if (name === "run-repo") wrong.repository = { full_name: "erman-ksv/Onay" };
        if (name === "head-repo") wrong.head_repository = { full_name: "attacker/fork" };
        if (name === "branch") wrong.head_branch = "main";
        if (name === "sha") wrong.head_sha = D;
        if (name === "run-url") wrong.html_url = "https://github.com/erman-ksv/Onay/actions/runs/11";
        if (name === "missing-attempt") delete wrong.run_attempt;
        if (name === "merge-ref-event") wrong.event = "pull_request";
        if (name === "pull-request-target") wrong.event = "pull_request_target";
        if (url.pathname.endsWith("/actions/runs/11")) {
          runReads++;
          if (name === "rerun" && runReads > 1) wrong.run_attempt = 3;
          if (name === "status-change" && runReads > 1) wrong.status = "in_progress";
          return wrong;
        }
        return { total_count: 1, workflow_runs: [wrong] };
      }
      if (url.pathname.endsWith("/jobs")) {
        const wrong = { ...job() };
        if (name === "job-attempt") wrong.run_attempt = 1;
        if (name === "job-sha") wrong.head_sha = D;
        if (name === "job-run") wrong.run_id = 99;
        if (name === "job-url") wrong.html_url = "https://github.com/attacker/fork/runs/101";
        return { total_count: 1, jobs: [wrong] };
      }
      return data;
    });
    await assert.rejects(() => createCalculatorCiReader({ trustedWorkflows: [pin] }, env, f.transport)(input), refused);
  });
});
test("HTTP errors, redirects, oversized bodies and transport failures never expose upstream data or retry", async t => {
  for (const name of ["403", "429", "500", "redirect", "huge", "transport"]) await t.test(name, async () => {
    let calls = 0;
    const read = createCalculatorCiReader({ trustedWorkflows: [pin] }, env, async () => {
      calls++;
      if (name === "transport") throw new Error("fixture-credential private provider body");
      if (name === "huge") return new Response("x".repeat(1_048_577));
      return new Response("fixture-credential private provider body", { status: name === "redirect" ? 302 : Number(name) });
    });
    await assert.rejects(() => read(input), refused); assert.equal(calls, 1);
  });
});
test("an exact host-approved bootstrap base receives complete pinned provenance verification", async () => {
  const f = fixture(), baseRef = "feat/calculator-pilot-bootstrap", base = { ref: baseRef, sha: A };
  f.runs.length = 0;
  f.override(async url => {
    if (url.pathname.includes("/git/ref/heads/")) return { ref: "refs/heads/" + baseRef, object: { sha: A, type: "commit" } };
    return f.get(url);
  });
  const read = createCalculatorCiReader({ trustedWorkflows: [pin], approvedBase: base }, env, f.transport);
  base.ref = "feat/changed-after-construction"; base.sha = D;
  const result = await read({ ...input, branch: baseRef });
  assert.equal(result.branch, baseRef); assert.equal(result.candidateSha, A);
  assert.equal(result.provenance.workflowPins[0].blobSha, C); assert.equal(result.runs.length, 0);
  assert.ok(f.calls.some(call => call.url.pathname.endsWith("/actions/workflows/3")));
  assert.ok(f.calls.some(call => call.url.pathname.includes("/git/trees/")));
  assert.equal(f.calls.filter(call => call.url.pathname.includes("/git/ref/heads/")).length, 2);
});
test("bootstrap exception never permits another ref or SHA", async t => {
  for (const candidate of [{ ref: "feat/calculator-pilot-bootstrap", sha: D }, { ref: "feat/other-bootstrap", sha: A }]) await t.test(candidate.ref + ":" + candidate.sha[0], async () => {
    const f = fixture();
    const read = createCalculatorCiReader({ trustedWorkflows: [pin], approvedBase: { ref: "feat/calculator-pilot-bootstrap", sha: A } }, env, f.transport);
    await assert.rejects(() => read({ repository, branch: candidate.ref, candidateSha: candidate.sha }), refused);
    assert.equal(f.calls.length, 0);
  });
});
test("constructor rejects protected, alternate-spelling or malformed approved bases before HTTP", () => {
  const f = fixture();
  for (const base of [{ ref: "main", sha: A }, { ref: "master", sha: A }, { ref: "refs/heads/feat/bootstrap", sha: A },
    { ref: "feat/../main", sha: A }, { ref: "feat/bootstrap", sha: "short" }])
    assert.throws(() => createCalculatorCiReader({ trustedWorkflows: [pin], approvedBase: base }, env, f.transport), refused);
  assert.equal(f.calls.length, 0);
});
