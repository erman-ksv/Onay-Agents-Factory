import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCalculatorPlan } from "./calculatorPlan.js";
import { createCalculatorRepairAdmission, createCalculatorRemotelyAdmittedRepairTeam } from "./calculatorAgentRepairAdmission.js";

const saved = JSON.parse(readFileSync(new URL("./fixtures/calculatorStep7SavedPlan.json", import.meta.url), "utf8"));
const plan = createCalculatorPlan(saved.request, saved.proposal), task = plan.tasks[1]!;
const A = "a".repeat(40), R = "b".repeat(40), OTHER = "c".repeat(40);
const FACTORY = "erman-ksv/Onay-Agents-Factory", TARGET = "erman-ksv/Onay-Factory-Calculator";
const authority = Object.freeze({ runtimeSha: R, sourceCiRunId: 123 });
const env = { GITHUB_REPOSITORY: FACTORY, GITHUB_RUN_ATTEMPT: "1", GITHUB_TOKEN: "factory-fixture-token",
  CALCULATOR_GITHUB_TOKEN: "target-fixture-token", CALCULATOR_AGENT_REPAIR_APPROVED: "ONE_SEPARATELY_BOUNDED_AGENT_CORRECTION",
  AGENT_FACTORY_LEGAL_ENABLED: "false", ONAY_TEAM_FREE_TIER_CONFIRMED: "true" };
const source = Object.freeze({ taskId: task.id, planFingerprint: plan.fingerprint, baseSha: A,
  proposalDigest: "d".repeat(64), sourceManifestSha256: "e".repeat(64),
  priorCharge: Object.freeze({ attemptedRequests: 9, totalRequestBytes: 76839, reservedRunTokens: 27199, elapsedMs: 374346 }),
  httpInFlight: false as const, publicationStarted: false as const });

function server() {
  const refs = new Map<string, string>(), calls: { method: string; url: string; body: unknown }[] = [];
  const state = { head: A, ci: "success", ciStatus: "completed", attempt: 1, jobStep: "success", totalJobs: 1,
    postStatus: 201, readbackMismatch: false, timeoutAfterCreate: false, mutateAfterCreate: false, failReads: false };
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET", headers = new Headers(init?.headers);
    calls.push({ method, url: url.href, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    assert.equal(url.origin, "https://api.github.com"); assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    const factory = url.pathname.startsWith("/repos/" + FACTORY + "/");
    assert.equal(headers.get("Authorization"), "Bearer " + (factory ? env.GITHUB_TOKEN : env.CALCULATOR_GITHUB_TOKEN));
    if (state.failReads && method === "GET") return new Response("unavailable", { status: 503 });
    const endpoint = decodeURIComponent(url.pathname.replace("/repos/" + (factory ? FACTORY : TARGET), ""));
    if (!factory) {
      assert.equal(method, "GET"); assert.equal(endpoint, "/git/ref/heads/" + plan.branch);
      return Response.json({ ref: "refs/heads/" + plan.branch, object: { type: "commit", sha: state.head } });
    }
    if (endpoint === "/actions/runs/123") return Response.json({ id: 123, head_sha: R, run_attempt: state.attempt,
      status: state.ciStatus, conclusion: state.ci, path: ".github/workflows/ci.yml", event: "push",
      repository: { full_name: FACTORY }, head_repository: { full_name: FACTORY } });
    if (endpoint === "/actions/runs/123/attempts/1/jobs") return Response.json({ total_count: state.totalJobs, jobs: [{
      name: "typecheck", run_id: 123, run_attempt: 1, head_sha: R, status: "completed", conclusion: "success",
      steps: ["Typecheck", "Test"].map(name => ({ name, status: "completed", conclusion: state.jobStep })),
    }] });
    if (endpoint.startsWith("/git/ref/heads/state/calculator-agent-repair/")) {
      const ref = "refs/heads/" + endpoint.slice("/git/ref/heads/".length), sha = refs.get(ref);
      return sha ? Response.json({ ref, object: { type: "commit", sha: state.readbackMismatch ? OTHER : sha } }) : new Response(null, { status: 404 });
    }
    assert.equal(endpoint, "/git/refs"); assert.equal(method, "POST");
    const body = JSON.parse(String(init?.body));
    assert.match(body.ref, /^refs\/heads\/state\/calculator-agent-repair\/[a-f0-9]{64}$/);
    assert.equal(body.sha, R); assert.deepEqual(Object.keys(body).sort(), ["ref", "sha"]);
    if (refs.has(body.ref)) return new Response(null, { status: 422 });
    if (state.postStatus !== 201) return new Response("fixture rejection", { status: state.postStatus });
    refs.set(body.ref, body.sha);
    if (state.mutateAfterCreate) state.head = OTHER;
    if (state.timeoutAfterCreate) throw Error("fixture lost response after creation");
    return Response.json({ ref: body.ref, object: { type: "commit", sha: R } }, { status: 201 });
  };
  return { refs, calls, state, transport };
}
test("one admitted correction is durably claimed in Factory only after exact-SHA CI and current target checks", async () => {
  const s = server(), admission = createCalculatorRepairAdmission(authority, env, s.transport);
  const permit = await admission.admit(plan, task, source);
  assert.equal(permit.runtimeSha, R); assert.equal(s.refs.size, 1); assert.ok(Object.isFrozen(permit));
  await admission.assertCurrent(permit);
  const posts = s.calls.filter(c => c.method === "POST"); assert.equal(posts.length, 1);
  assert.ok(posts.every(c => c.url.startsWith("https://api.github.com/repos/" + FACTORY + "/")));
  assert.ok(s.calls.slice(0, s.calls.indexOf(posts[0]!)).some(c => c.url.includes("/attempts/1/jobs")));
  assert.ok(!JSON.stringify(posts).includes("fixture-token")); assert.ok(!JSON.stringify(posts).includes(source.proposalDigest));
  await assert.rejects(() => admission.admit(plan, task, source)); assert.equal(s.refs.size, 1);
});
test("a process restart or changed proposal cannot obtain another correction at the same task and SHA", async () => {
  const s = server();
  await createCalculatorRepairAdmission(authority, env, s.transport).admit(plan, task, source);
  await assert.rejects(() => createCalculatorRepairAdmission(authority, env, s.transport).admit(plan, task, source));
  await assert.rejects(() => createCalculatorRepairAdmission(authority, env, s.transport).admit(plan, task, {
    ...source, proposalDigest: "f".repeat(64), sourceManifestSha256: "0".repeat(64),
  }));
  assert.equal(s.calls.filter(c => c.method === "POST").length, 1);
});
test("two simultaneous processes cannot both acquire the same corrective phase", async () => {
  const s = server();
  const results = await Promise.allSettled([1, 2].map(() => createCalculatorRepairAdmission(authority, env, s.transport).admit(plan, task, source)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1); assert.equal(s.refs.size, 1);
});
test("queued, failed, repeated or incomplete CI and stale target refuse before a remote write", async t => {
  for (const patch of [{ ciStatus: "queued" }, { ci: "failure" }, { attempt: 2 }, { jobStep: "skipped" },
    { totalJobs: 2 }, { head: OTHER }, { failReads: true }]) await t.test(JSON.stringify(patch), async () => {
      const s = server(); Object.assign(s.state, patch);
      await assert.rejects(() => createCalculatorRepairAdmission(authority, env, s.transport).admit(plan, task, source));
      assert.equal(s.calls.filter(c => c.method === "POST").length, 0);
    });
});
test("HTTP 429/conflict, uncertain creation, changed readback or target movement never retry admission", async t => {
  for (const patch of [{ postStatus: 429 }, { postStatus: 422 }, { timeoutAfterCreate: true },
    { readbackMismatch: true }, { mutateAfterCreate: true }]) await t.test(JSON.stringify(patch), async () => {
      const s = server(); Object.assign(s.state, patch);
      const admission = createCalculatorRepairAdmission(authority, env, s.transport);
      await assert.rejects(() => admission.admit(plan, task, source));
      await assert.rejects(() => admission.admit(plan, task, source));
      assert.equal(s.calls.filter(c => c.method === "POST").length, 1);
      if (patch.timeoutAfterCreate || patch.readbackMismatch || patch.mutateAfterCreate) assert.equal(s.refs.size, 1);
    });
});
test("a serialized permit or changed/deleted remote barrier cannot authorize model transport", async t => {
  for (const mode of ["clone", "head-moved", "deleted", "barrier-moved"] as const) await t.test(mode, async () => {
    const s = server(), admission = createCalculatorRepairAdmission(authority, env, s.transport);
    const permit = await admission.admit(plan, task, source);
    if (mode === "head-moved") s.state.head = OTHER;
    if (mode === "deleted") s.refs.clear();
    if (mode === "barrier-moved") s.refs.set(permit.ref, OTHER);
    await assert.rejects(() => admission.assertCurrent(mode === "clone" ? { ...permit } : permit));
    await assert.rejects(() => admission.assertCurrent(permit));
    assert.equal(s.calls.filter(c => c.method === "POST").length, 1);
  });
});
test("missing host approval, persistence, trusted loader or unsettled saved source cannot admit", async () => {
  const s = server();
  for (const patch of [{ CALCULATOR_AGENT_REPAIR_APPROVED: undefined }, { GITHUB_RUN_ATTEMPT: "2" },
    { AGENT_FACTORY_LEGAL_ENABLED: "true" }, { GITHUB_TOKEN: "" }, { CALCULATOR_GITHUB_TOKEN: "" }])
    assert.throws(() => createCalculatorRepairAdmission(authority, { ...env, ...patch }, s.transport));
  assert.throws(() => createCalculatorRemotelyAdmittedRepairTeam(saved.request, env, authority, {} as never, { checkpoints: {} }));
  for (const patch of [{ httpInFlight: true }, { publicationStarted: true }, { priorCharge: { ...source.priorCharge, attemptedRequests: 0 } }])
    await assert.rejects(() => createCalculatorRepairAdmission(authority, env, s.transport).admit(plan, task, { ...source, ...patch } as never));
  assert.equal(s.calls.length, 0);
});
