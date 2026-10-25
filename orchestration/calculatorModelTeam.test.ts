import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
import { prepareCalculatorRoleChanges, validateCalculatorAssessment } from "../commander/calculatorTeam.js";
import { calculatorProposalDigest } from "./calculatorExecutionEvidence.js";
import { loadCalculatorSnapshot } from "../github/calculatorSnapshot.js";
import { CALCULATOR_ACCEPTANCE, calculatorPlanTaskId, createCalculatorPlan } from "./calculatorPlan.js";
import { CALCULATOR_MODEL_ERROR, createCalculatorModelTeam, type CalculatorPriorModelCharge,
  type CalculatorRejectedAssessment, CALCULATOR_REJECTED_ASSESSMENT_MAX_BYTES } from "./calculatorModelTeam.js";

const A = "a".repeat(40), B = "b".repeat(40);
const owner = { version: 1, id: "model-pilot", goal: "Create the agreed complete calculator website with arithmetic and browser acceptance tests.",
  baseRef: "feat/calculator-pilot-bootstrap", baseSha: A, provider: "gemini" };
const environment = { AGENT_FACTORY_TARGET_PROFILE: "calculator", AGENT_FACTORY_PROVIDER: "gemini", GEMINI_API_KEY: "fixture-key",
  CALCULATOR_MODEL_LIVE_APPROVED: "ONE_FREE_BOUNDED_RUN", ONAY_TEAM_FREE_TIER_CONFIRMED: "true", AGENT_FACTORY_LEGAL_ENABLED: "false" };
function proposal() {
  const id = (n: number) => calculatorPlanTaskId(owner, n);
  return { tasks: [
    { id: id(1), role: "coder", goal: "Implement arithmetic and its module tests.", acceptanceIds: CALCULATOR_ACCEPTANCE.slice(0, 7).map(item => item.id),
      paths: ["src/calculator.mjs", "test/calculator.test.mjs"], dependsOn: [] },
    { id: id(2), role: "frontend", goal: "Implement accessible responsive controls.", acceptanceIds: CALCULATOR_ACCEPTANCE.slice(7).map(item => item.id),
      paths: ["index.html", "styles.css", "src/app.mjs"], dependsOn: [id(1)] },
    { id: id(3), role: "frontend", goal: "Test keyboard and button interaction.", acceptanceIds: ["keyboard"], paths: ["test/ui.test.mjs"], dependsOn: [id(2)] },
  ], blockers: [], unverifiedAreas: [] };
}
const plan = createCalculatorPlan(owner, proposal()), task = plan.tasks[0];
const generated = { summary: "Add isolated arithmetic", changes: [{ operation: "create", path: "src/calculator.mjs", content: "export const add = (a, b) => a + b;", message: "Add arithmetic" }] };
const response = (content: unknown, finish = "stop") => Response.json({ choices: [{ finish_reason: finish, message: { role: "assistant", content: JSON.stringify(content) } }] });
const refusal = (error: unknown) => error instanceof Error && error.message === CALCULATOR_MODEL_ERROR;
async function snapshot(source?: string) {
  const blobSha = source === undefined ? B : createHash("sha1").update("blob " + Buffer.byteLength(source) + "\0" + source).digest("hex");
  return loadCalculatorSnapshot({ repository: CALCULATOR_PROFILE.repository, baseRef: plan.branch, baseSha: A, changePaths: task.paths }, {
    getHead: async () => A, readCommit: async () => ({ sha: A, treeSha: B }),
    readTree: async () => ({ sha: B, truncated: false, tree: source === undefined ? [] : [
      { path: "src", sha: B, type: "tree", mode: "040000" },
      { path: "src/calculator.mjs", sha: blobSha, type: "blob", mode: "100644" },
    ] }), readBlob: async () => ({ sha: blobSha, encoding: "base64", content: Buffer.from(source ?? "").toString("base64") }),
  });
}

test("missing explicit free-mode consent, credentials or matching provider stops before HTTP", async t => {
  for (const key of ["AGENT_FACTORY_TARGET_PROFILE", "CALCULATOR_MODEL_LIVE_APPROVED", "ONAY_TEAM_FREE_TIER_CONFIRMED", "AGENT_FACTORY_LEGAL_ENABLED", "GEMINI_API_KEY", "AGENT_FACTORY_PROVIDER"]) await t.test(key, () => {
    let calls = 0;
    assert.throws(() => createCalculatorModelTeam(owner, { ...environment, [key]: "" }, async () => { calls++; return response({}); }), refusal);
    assert.equal(calls, 0);
  });
  assert.throws(() => createCalculatorModelTeam(owner, { ...environment, AGENT_FACTORY_PROVIDER: "openai", OPENAI_API_KEY: "fixture" }), refusal);
});
test("Commander uses the actual fixed endpoint, validates the plan and cannot silently replan", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const mutableOwner = { ...owner }, mutableEnv = { ...environment };
  const team = createCalculatorModelTeam(mutableOwner, mutableEnv, async (url, init) => {
    assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error");
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return response(proposal());
  });
  mutableOwner.goal = "Unrelated changed instructions after construction."; mutableEnv.GEMINI_API_KEY = "changed-fixture";
  const result = await team.plan(); assert.equal(result.fingerprint, plan.fingerprint);
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(calls[0].body.stream, false); assert.equal(calls[0].body.n, 1);
  assert.equal(calls[0].body.tools, undefined); assert.ok(JSON.stringify(calls).includes(owner.goal));
  await assert.rejects(() => team.plan(), refusal); assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify(team.snapshot()).includes("fixture-key"));
});
test("Coder prepares validated new files and independent specialists receive complete change evidence", async () => {
  const seen: string[] = [];
  const team = createCalculatorModelTeam(owner, environment, async (_url, init) => {
    const body = JSON.parse(String(init?.body)); seen.push(body.messages[0].content);
    if (seen.length === 1) return response(generated);
    const packet = JSON.parse(body.messages[1].content);
    assert.equal(packet.completeChangedText.changes[0].content, generated.changes[0].content);
    assert.deepEqual(Object.keys(packet.completeChangedText), ["changes"]);
    assert.equal(packet.task.dependsOn, undefined);
    assert.ok(packet.completeChangedText.changes[0].contentSha256);
    assert.equal(packet.baseSha, A);
    assert.deepEqual(packet.allowedEvidenceRefs, ["changes@" + A]);
    assert.ok(packet.unverifiedAreas.includes("No runtime tests or browser checks have executed"));
    for (const area of ["Unshown unchanged source", "Independent review", "Exact-candidate runtime CI", "Browser acceptance"])
      assert.ok(packet.unverifiedAreas.includes(area));
    assert.equal(new Set(packet.unverifiedAreas).size, packet.unverifiedAreas.length);
    assert.ok(packet.acceptance.some((item: { scenario: string }) => item.scenario === "2 + 3 = 5"));
    return response({ ready: true, summary: "The shown arithmetic change is scoped.", findings: [], unverifiedAreas: ["No runtime tests executed."] });
  });
  const changes = await team.generate(plan, task.id, await snapshot());
  assert.equal(changes.files[0].content, generated.changes[0].content);
  for (const role of ["security", "reviewer", "tester"] as const) {
    const assessment = await team.assess(role, plan, task.id, changes);
    assert.equal(assessment.role, role); assert.equal(assessment.testsExecuted, false);
    assert.equal(assessment.publicationAuthorized, false); assert.ok(assessment.ready);
  }
  assert.equal(seen.length, 4); assert.ok(seen[0].includes("coder")); assert.ok(seen[1].includes("security"));
  assert.equal(team.snapshot().modelBudget.attemptedRequests, 4);
  assert.equal(team.snapshot().testsExecuted, false); assert.equal(team.snapshot().legalEnabled, false);
});
test("private originals remain in host memory and exact patches reconstruct the result", async () => {
  const source = "export const value = 1;\n// PRIVATE_UNSHOWN_TAIL\n";
  const hash = createHash("sha256").update(source).digest("hex"); let sent = "";
  const team = createCalculatorModelTeam(owner, environment, async (_url, init) => {
    sent = String(init?.body);
    return response({ summary: "Adjust the shown value", changes: [{ operation: "patch", path: "src/calculator.mjs", sourceSha256: hash,
      edits: [{ before: "value = 1", after: "value = 2" }], message: "Adjust value" }] });
  });
  const result = await team.generate(plan, task.id, await snapshot(source));
  assert.ok(result.files[0].content.includes("value = 2")); assert.ok(result.files[0].content.includes("PRIVATE_UNSHOWN_TAIL"));
  assert.ok(!sent.includes("PRIVATE_UNSHOWN_TAIL")); assert.ok(sent.includes(hash)); assert.ok(sent.includes("Remaining original source is omitted"));
});
test("HTTP 429, upstream errors and malformed replies stop the entire team without retry", async t => {
  for (const name of ["429", "500", "truncated", "invalid-json", "tool-call", "huge-response", "secret", "network"]) await t.test(name, async () => {
    let calls = 0;
    const team = createCalculatorModelTeam(owner, environment, async () => {
      calls++;
      if (name === "network") throw new Error("private upstream body and fixture-key");
      if (name === "429" || name === "500") return new Response("private upstream body", { status: Number(name) });
      if (name === "truncated") return response(generated, "length");
      if (name === "invalid-json") return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "not JSON" } }] });
      if (name === "tool-call") return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "{}", tool_calls: [] } }] });
      if (name === "huge-response") return new Response("x".repeat(65_537));
      return response({ summary: "ghp_" + "A".repeat(32) });
    });
    const snap = await snapshot();
    await assert.rejects(() => team.generate(plan, task.id, snap), refusal);
    await assert.rejects(() => team.plan(), refusal); assert.equal(calls, 1); assert.equal(team.snapshot().stopped, true);
    assert.ok(!JSON.stringify(team.snapshot()).includes("private upstream body"));
  });
});
test("forged proposals and unknown paths never reach an independent specialist", async () => {
  let calls = 0; const team = createCalculatorModelTeam(owner, environment, async () => { calls++; return response(generated); });
  const changes = await team.generate(plan, task.id, await snapshot());
  await assert.rejects(() => team.assess("reviewer", plan, task.id, JSON.parse(JSON.stringify(changes))), refusal);
  assert.equal(calls, 1);
});
test("role/path mismatch and malformed Commander coverage cannot produce a successful task", async () => {
  let calls = 0;
  const team = createCalculatorModelTeam(owner, environment, async () => { calls++; return response({ ...generated,
    changes: [{ ...generated.changes[0], path: "index.html" }] }); });
  const snap = await snapshot();
  await assert.rejects(() => team.generate(plan, task.id, snap), refusal); assert.equal(calls, 1);
  const incomplete = createCalculatorModelTeam(owner, environment, async () => response({ tasks: [], blockers: [], unverifiedAreas: [] }));
  assert.equal((await incomplete.plan()).status, "blocked");
});
test("Groq applies its TPM ledger and a rate limit stops the whole team without retry", async () => {
  const groqOwner = { ...owner, provider: "groq" }; let calls = 0;
  const team = createCalculatorModelTeam(groqOwner, { ...environment, AGENT_FACTORY_PROVIDER: "groq", GROQ_API_KEY: "fixture-key" }, async () => {
    calls++; return new Response("do not retain upstream", { status: 429 });
  });
  await assert.rejects(() => team.plan(), refusal); await assert.rejects(() => team.plan(), refusal);
  assert.equal(calls, 1); assert.equal(team.snapshot().contextBudget?.attemptedRequests, 1);
});
test("Groq completes a small Coder and three independent assessments within unchanged budgets", async () => {
  const groqOwner = { ...owner, provider: "groq" };
  const original = proposal(), ids = new Map(original.tasks.map((item, index) => [item.id, calculatorPlanTaskId(groqOwner, index + 1)]));
  const groqPlan = createCalculatorPlan(groqOwner, { ...original, tasks: original.tasks.map(item => ({ ...item,
    id: ids.get(item.id), dependsOn: item.dependsOn.map(id => ids.get(id)) })) });
  let now = 0; const waits: number[] = [], sentAt: number[] = [];
  const team = createCalculatorModelTeam(groqOwner, { ...environment, AGENT_FACTORY_PROVIDER: "groq", GROQ_API_KEY: "fixture-key" }, async () => {
    sentAt.push(now);
    const content = sentAt.length === 1 ? generated : { ready: true, summary: "Scoped review only.", findings: [], unverifiedAreas: ["No actual tests ran."] };
    const completion = sentAt.length === 1 ? 300 : 80;
    return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 1000, completion_tokens: completion, total_tokens: 1000 + completion } });
  }, { now: () => now, wait: async milliseconds => { assert.ok(milliseconds > 0 && milliseconds <= 15000); waits.push(milliseconds); now += milliseconds; } });
  const changes = await team.generate(groqPlan, groqPlan.tasks[0].id, await snapshot());
  for (const role of ["security", "reviewer", "tester"] as const) {
    try { assert.equal((await team.assess(role, groqPlan, groqPlan.tasks[0].id, changes)).ready, true); }
    catch { assert.fail(JSON.stringify({ role, now, sentAt, waits, snapshot: team.snapshot() })); }
  }
  assert.equal(sentAt.length, 4); assert.ok(waits.length > 0); assert.ok(now < 120000);
  assert.equal(team.snapshot().contextBudget?.attemptedRequests, 4); assert.equal(team.snapshot().modelBudget.attemptedRequests, 4);
  assert.ok(team.snapshot().contextBudget!.reservedRunTokens <= 16000); assert.ok(team.snapshot().contextBudget!.reservedWindowTokens <= 6000);
});
test("Groq never discounts missing, excessive or inconsistent transport usage", async t => {
  for (const usage of [undefined, { prompt_tokens: 1000, completion_tokens: 10, total_tokens: 999 },
    { prompt_tokens: 1000, completion_tokens: 1201, total_tokens: 2201 }, { prompt_tokens: 100000, completion_tokens: 10, total_tokens: 100010 },
    { prompt_tokens: 1000, completion_tokens: 10, total_tokens: 1010, completion_tokens_details: { reasoning_tokens: 11 } }]) await t.test(JSON.stringify(usage) ?? "missing", async () => {
    const groqOwner = { ...owner, provider: "groq" }, original = proposal();
    const ids = new Map(original.tasks.map((item, index) => [item.id, calculatorPlanTaskId(groqOwner, index + 1)]));
    const groqPlan = createCalculatorPlan(groqOwner, { ...original, tasks: original.tasks.map(item => ({ ...item, id: ids.get(item.id), dependsOn: item.dependsOn.map(id => ids.get(id)) })) });
    let bytes = 0;
    const team = createCalculatorModelTeam(groqOwner, { ...environment, AGENT_FACTORY_PROVIDER: "groq", GROQ_API_KEY: "fixture-key" }, async (_url, init) => {
      bytes = Buffer.byteLength(String(init?.body));
      return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(generated) } }], usage });
    });
    await team.generate(groqPlan, groqPlan.tasks[0].id, await snapshot());
    assert.equal(team.snapshot().contextBudget!.reservedRunTokens, Math.ceil(bytes / 3) + 256 + 1200);
  });
});
test("Groq 429 remains terminal with pacing enabled and never sleeps or retries", async () => {
  let calls = 0, waits = 0;
  const team = createCalculatorModelTeam({ ...owner, provider: "groq" }, { ...environment, AGENT_FACTORY_PROVIDER: "groq", GROQ_API_KEY: "fixture-key" },
    async () => { calls++; return new Response("private upstream data", { status: 429 }); }, { now: () => 0, wait: async () => { waits++; } });
  await assert.rejects(() => team.plan(), refusal); await assert.rejects(() => team.plan(), refusal);
  assert.equal(calls, 1); assert.equal(waits, 0); assert.equal(team.snapshot().contextBudget!.attemptedRequests, 1);
});
test("a repeated developer or specialist invocation cannot consume another request", async () => {
  let calls = 0;
  const team = createCalculatorModelTeam(owner, environment, async () => {
    calls++; return calls === 1 ? response(generated) : response({ ready: true, summary: "Scoped review only.", findings: [], unverifiedAreas: [] });
  });
  const snap = await snapshot(), changes = await team.generate(plan, task.id, snap);
  await team.assess("reviewer", plan, task.id, changes);
  await assert.rejects(() => team.assess("reviewer", plan, task.id, changes), refusal);
  await assert.rejects(() => team.generate(plan, task.id, snap), refusal);
  assert.equal(calls, 2);
});
test("Cloudflare remains pinned to the approved account endpoint and normalizes output budget", async () => {
  const cloudOwner = { ...owner, provider: "cloudflare" }; let calls = 0;
  const team = createCalculatorModelTeam(cloudOwner, { ...environment, AGENT_FACTORY_PROVIDER: "cloudflare",
    CLOUDFLARE_API_TOKEN: "fixture-key", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32) }, async (url, init) => {
    calls++; assert.equal(url instanceof Request ? url.url : String(url), "https://api.cloudflare.com/client/v4/accounts/" + "a".repeat(32) + "/ai/v1/chat/completions");
    const body = JSON.parse(String(init?.body)); assert.equal(body.model, "@cf/zai-org/glm-4.7-flash");
    assert.ok((body.max_tokens ?? body.max_completion_tokens) <= 1024);
    return response({ tasks: [], blockers: [], unverifiedAreas: [] });
  });
  assert.equal((await team.plan()).status, "blocked"); assert.equal(calls, 1);
});
test("a forged cross-owner plan is rejected before sending source to a model", async () => {
  let calls = 0;
  const team = createCalculatorModelTeam(owner, environment, async () => { calls++; return response(generated); });
  const snap = await snapshot();
  await assert.rejects(() => team.generate({ ...plan, fingerprint: "0".repeat(64) }, task.id, snap), refusal);
  assert.equal(calls, 0);
});
test("failure diagnostics expose only host codes, status and counts without upstream text or replay", async t => {
  const cases = [
    ["401", "model_http_rejected", 401], ["403", "model_http_rejected", 403], ["429", "model_rate_limited", 429],
    ["500", "model_http_rejected", 500], ["length", "model_output_truncated", 200],
    ["envelope", "model_response_invalid", 200], ["unsafe-finish", "model_response_invalid", 200],
    ["json", "model_json_invalid", 200], ["plan", "model_plan_invalid", 200], ["network", "model_http_rejected", 502],
  ] as const;
  for (const [name, code, status] of cases) await t.test(name, async () => {
    let calls = 0; const sentinel = "PRIVATE_UPSTREAM_SOURCE_AND_KEY";
    const team = createCalculatorModelTeam(owner, environment, async () => {
      calls++;
      if (name === "network") throw Error(sentinel);
      if (/^\d+$/.test(name)) return new Response(sentinel, { status: Number(name) });
      if (name === "length") return response({ private: sentinel }, "length");
      if (name === "envelope") return Response.json({ private: sentinel });
      if (name === "unsafe-finish") return response({}, sentinel);
      if (name === "json") return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: sentinel } }] });
      return response({ tasks: sentinel });
    });
    await assert.rejects(() => team.plan(), refusal);
    const diagnostic = team.diagnostic(); assert.equal(diagnostic.reasonCode, code);
    assert.equal(diagnostic.httpStatus, name === "401" || name === "403" || name === "500" ? 502 : status);
    assert.equal(diagnostic.providerHttpStatus, name === "network" ? undefined : status);
    assert.equal(diagnostic.httpRequestsAttempted, 1); assert.ok(!JSON.stringify(diagnostic).includes(sentinel));
    assert.ok(!JSON.stringify(diagnostic).includes("fixture-key"));
    await assert.rejects(() => team.plan(), refusal); assert.equal(calls, 1); assert.deepEqual(team.diagnostic(), diagnostic);
  });
});
test("a later transport failure never inherits the previous successful provider status", async () => {
  let calls = 0;
  const team = createCalculatorModelTeam(owner, environment, async () => {
    calls++; if (calls === 1) return response(generated);
    throw Error("PRIVATE_NETWORK_ERROR");
  });
  const changes = await team.generate(plan, task.id, await snapshot());
  await assert.rejects(() => team.assess("security", plan, task.id, changes), refusal);
  assert.equal(team.diagnostic().httpStatus, 502); assert.equal(team.diagnostic().providerHttpStatus, undefined);
  assert.equal(team.diagnostic().finishReason, undefined); assert.equal(team.diagnostic().httpRequestsAttempted, 2);
});

test("reviewed Groq JSON mode uses low reasoning without raising output or dropping role instructions", async () => {
  let body: any;
  const groqOwner = { ...owner, provider: "groq" };
  const team = createCalculatorModelTeam(groqOwner, { ...environment, AGENT_FACTORY_PROVIDER: "groq", GROQ_API_KEY: "fixture-key" }, async (_url, init) => {
    body = JSON.parse(String(init?.body)); return new Response("blocked", { status: 429 });
  });
  await assert.rejects(() => team.plan());
  assert.equal(body.reasoning_effort, "low"); assert.deepEqual(body.response_format, { type: "json_object" });
  assert.match(body.messages[0].content, /Return one JSON object/);
  assert.equal(body.max_completion_tokens, 1200); assert.ok(body.messages[0].content.includes("No role may directly write GitHub"));
});
test("host recovery prior charge reduces remaining budgets, is visible, and 429 remains terminal", async () => {
  const groqOwner = { ...owner, provider: "groq" }, env = { ...environment, AGENT_FACTORY_PROVIDER: "groq", GROQ_API_KEY: "fixture-key" };
  const prior = { attemptedRequests: 1, totalRequestBytes: 24000, reservedRunTokens: 6000, elapsedMs: 30000 }; let calls = 0;
  const team = createCalculatorModelTeam(groqOwner, env, async () => { calls++; return new Response("private source", { status: 429 }); }, {}, prior);
  await assert.rejects(() => team.plan()); await assert.rejects(() => team.plan()); assert.equal(calls, 1);
  assert.equal(team.snapshot().aggregatePlanningCharge?.attemptedRequests, 2);
  assert.ok(team.snapshot().aggregatePlanningCharge!.totalRequestBytes > 24000);
  assert.ok(team.snapshot().aggregatePlanningCharge!.reservedRunTokens > 6000);
  assert.ok(team.snapshot().aggregatePlanningCharge!.elapsedMs >= 30000);
  assert.equal(team.snapshot().modelBudget.remainingRequests, 14);
  const exhausted = createCalculatorModelTeam(groqOwner, env, async () => { calls++; return response({}); }, {}, { ...prior, reservedRunTokens: 14000 });
  await assert.rejects(() => exhausted.plan()); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(team.snapshot()).includes('private source'));
  for (const raw of [{ ...prior, elapsedMs: 120000 }, { ...prior, attemptedRequests: 16 }, { ...prior, totalRequestBytes: 192000 }, { ...prior, reservedRunTokens: -1 }])
    assert.throws(() => createCalculatorModelTeam(groqOwner, env, undefined, {}, raw));
});

test("two failed planning charges leave only the original remaining tokens/time and cannot reset them", async () => {
  const groqOwner = { ...owner, provider: "groq" }, env = { ...environment, AGENT_FACTORY_PROVIDER: "groq", GROQ_API_KEY: "fixture-key" };
  const prior = { attemptedRequests: 2, totalRequestBytes: 48000, reservedRunTokens: 12000, elapsedMs: 60000 }; let calls = 0;
  const team = createCalculatorModelTeam(groqOwner, env, async () => { calls++; return new Response("no echo", { status: 429 }); }, {}, prior);
  await assert.rejects(() => team.plan()); assert.equal(calls, 1);
  assert.equal(team.snapshot().aggregatePlanningCharge?.attemptedRequests, 3);
  assert.ok(team.snapshot().aggregatePlanningCharge!.reservedRunTokens <= 16000);
  let now = 0;
  const expired = createCalculatorModelTeam(groqOwner, env, async () => { calls++; return response({}); }, { now: () => now }, prior);
  now = 60001; await assert.rejects(() => expired.plan()); assert.equal(calls, 1);
  assert.equal(expired.snapshot().modelBudget.failureCode, "task_timeout");
});

function groqCheckpointFixture() {
  const groqOwner = { ...owner, provider: "groq" }, original = proposal();
  const ids = new Map(original.tasks.map((item, index) => [item.id, calculatorPlanTaskId(groqOwner, index + 1)]));
  const groqPlan = createCalculatorPlan(groqOwner, { ...original, tasks: original.tasks.map(item => ({ ...item,
    id: ids.get(item.id), dependsOn: item.dependsOn.map(id => ids.get(id)) })) });
  return { groqOwner, groqPlan, env: { ...environment, AGENT_FACTORY_PROVIDER: "groq", GROQ_API_KEY: "fixture-key" } };
}

test("checkpoint charges are persisted after both reservations and before each real transport", async () => {
  const { groqOwner, groqPlan, env } = groqCheckpointFixture();
  let now = 0, calls = 0;
  const charges: CalculatorPriorModelCharge[] = [], ordering: string[] = [];
  const team = createCalculatorModelTeam(groqOwner, env, async (_url, init) => {
    calls++; ordering.push("http" + calls);
    const charge = charges.at(-1)!;
    assert.equal(charge.attemptedRequests, calls);
    assert.ok(charge.totalRequestBytes >= Buffer.byteLength(String(init?.body)));
    assert.ok(charge.reservedRunTokens >= Math.ceil(Buffer.byteLength(String(init?.body)) / 3) + 256 + 1200);
    return response(calls === 1 ? generated : { ready: true, summary: "Scoped review only.", findings: [], unverifiedAreas: [] });
  }, { now: () => now, wait: async milliseconds => { now += milliseconds; } }, undefined, {
    beforeRequest: async charge => {
      assert.ok(Object.isFrozen(charge));
      assert.equal(calls + 1, charge.attemptedRequests);
      assert.ok(!JSON.stringify(charge).includes("fixture-key"));
      charges.push(charge); ordering.push("persist" + charges.length);
    },
  });
  assert.deepEqual(team.checkpointCharge(), { attemptedRequests: 0, totalRequestBytes: 0, reservedRunTokens: 0, elapsedMs: 0 });
  const changes = await team.generate(groqPlan, groqPlan.tasks[0].id, await snapshot());
  await team.assess("security", groqPlan, groqPlan.tasks[0].id, changes);
  assert.deepEqual(ordering, ["persist1", "http1", "persist2", "http2"]);
  assert.equal(team.checkpointCharge()!.attemptedRequests, 2);
  assert.equal(team.diagnostic().httpRequestsSent, 2);
  assert.equal(team.checkpointCharge()!.reservedRunTokens, team.snapshot().contextBudget!.reservedRunTokens);
});

test("failed checkpoint persistence charges the reservation but sends no HTTP and never replays", async () => {
  const { groqOwner, groqPlan, env } = groqCheckpointFixture();
  let calls = 0, saves = 0;
  const team = createCalculatorModelTeam(groqOwner, env, async () => { calls++; return response(generated); }, { now: () => 0 }, undefined, {
    beforeRequest: () => { saves++; throw Error("PRIVATE_CHECKPOINT_SOURCE_AND_KEY"); },
  });
  await assert.rejects(async () => team.generate(groqPlan, groqPlan.tasks[0].id, await snapshot()), refusal);
  assert.equal(calls, 0); assert.equal(saves, 1);
  assert.equal(team.checkpointCharge()!.attemptedRequests, 1);
  assert.ok(team.checkpointCharge()!.reservedRunTokens > 1200);
  assert.equal(team.diagnostic().reasonCode, "model_checkpoint_persistence_failed");
  assert.equal(team.diagnostic().httpRequestsAttempted, 1); assert.equal(team.diagnostic().httpRequestsSent, 0);
  assert.ok(!JSON.stringify(team.diagnostic()).includes("PRIVATE_CHECKPOINT_SOURCE_AND_KEY"));
  await assert.rejects(() => team.assess("security", groqPlan, groqPlan.tasks[0].id, {} as never), refusal);
  assert.equal(calls, 0); assert.equal(saves, 1);
});

test("a checkpoint wait cannot outlive the original task deadline and send afterwards", async () => {
  const { groqOwner, groqPlan, env } = groqCheckpointFixture();
  let now = 0, calls = 0;
  const team = createCalculatorModelTeam(groqOwner, env, async () => { calls++; return response(generated); }, { now: () => now }, undefined, {
    beforeRequest: () => { now = 120001; },
  });
  await assert.rejects(async () => team.generate(groqPlan, groqPlan.tasks[0].id, await snapshot()), refusal);
  assert.equal(calls, 0); assert.equal(team.diagnostic().httpRequestsSent, 0);
  assert.equal(team.snapshot().modelBudget.failureCode, "task_timeout");
  assert.equal(team.checkpointCharge()!.elapsedMs, 120001);
});

test("checkpoint charge carries all prior usage instead of resetting it", async () => {
  const { groqOwner, env } = groqCheckpointFixture();
  const prior = { attemptedRequests: 2, totalRequestBytes: 48000, reservedRunTokens: 12000, elapsedMs: 60000 };
  let saved: CalculatorPriorModelCharge | undefined, calls = 0;
  const team = createCalculatorModelTeam(groqOwner, env, async (_url, init) => {
    calls++; assert.ok(saved); assert.equal(saved.attemptedRequests, 3);
    assert.equal(saved.totalRequestBytes, 48000 + Buffer.byteLength(String(init?.body)));
    assert.ok(saved.reservedRunTokens > 12000); assert.equal(saved.elapsedMs, 60000);
    return new Response("ignored upstream body", { status: 429 });
  }, { now: () => 0 }, prior, { beforeRequest: charge => { saved = charge; } });
  await assert.rejects(() => team.plan(), refusal);
  assert.equal(calls, 1); assert.deepEqual(team.checkpointCharge(), saved);
  assert.equal(team.diagnostic().httpRequestsSent, 1);
});

test("model admission diagnostics preserve the exact local run limit without source, transport or a retry", async () => {
  const { groqOwner, env } = groqCheckpointFixture(); let calls = 0;
  const team = createCalculatorModelTeam(groqOwner, env, async () => { calls++; return response({}); }, { now: () => 0 },
    { attemptedRequests: 1, totalRequestBytes: 24000, reservedRunTokens: 14000, elapsedMs: 30000 });
  await assert.rejects(() => team.plan(), refusal);
  const diagnostic = team.diagnostic();
  assert.equal(diagnostic.reasonCode, "model_admission_failed");
  assert.equal(diagnostic.admission?.code, "run_budget_exceeded");
  assert.equal(diagnostic.admission.runTokenLimit, 2000);
  assert.equal(diagnostic.admission.remainingRunTokens, 2000);
  assert.equal(diagnostic.admission.remainingTaskMs, 90000);
  assert.ok(diagnostic.admission.requestBytes > 0);
  assert.ok(!JSON.stringify(diagnostic).includes(groqOwner.goal));
  assert.ok(!JSON.stringify(diagnostic).includes("fixture-key"));
  assert.equal(diagnostic.httpRequestsAttempted, 0); assert.equal(diagnostic.httpRequestsSent, 0);
  await assert.rejects(() => team.plan(), refusal); assert.equal(calls, 0);
  assert.deepEqual(team.diagnostic(), diagnostic);
});

test("a provider without provable Groq accounting cannot execute a checkpointed live request", async () => {
  let calls = 0, saves = 0;
  const team = createCalculatorModelTeam(owner, environment, async () => { calls++; return response(generated); }, {}, undefined, {
    beforeRequest: () => { saves++; },
  });
  assert.equal(team.checkpointCharge(), undefined);
  await assert.rejects(async () => team.generate(plan, task.id, await snapshot()), refusal);
  assert.equal(calls, 0); assert.equal(saves, 0);
  assert.equal(team.diagnostic().reasonCode, "model_checkpoint_persistence_failed");
});

test("invalid returned assessments retain exact field codes and private JSON without authority or another HTTP call", async t => {
  const pass = { ready: true, summary: "The shown changes are scoped.", findings: [], unverifiedAreas: [] };
  const cases = [
    ["schema_invalid", { ...pass, extra: "PRIVATE_ASSESSMENT" }],
    ["summary_invalid", { ...pass, summary: "PRIVATE_ASSESSMENT\nnot one line" }],
    ["summary_character_limit", { ...pass, summary: "x".repeat(601) }],
    ["unverified_areas_limit", { ...pass, unverifiedAreas: Array.from({ length: 9 }, () => "PRIVATE_ASSESSMENT") }],
    ["finding_ref_not_supplied", { ...pass, findings: [{ severity: "low", message: "A scoped concern.", evidenceRefs: ["src/calculator.mjs"] }] }],
  ] as const;
  for (const [code, output] of cases) await t.test(code, async () => {
    let calls = 0;
    const captured: CalculatorRejectedAssessment[] = [];
    const team = createCalculatorModelTeam(owner, environment, async () => response(++calls === 1 ? generated : output), {}, undefined, {
      afterAssessmentRejected: rejection => { captured.push(rejection); },
    });
    const changes = await team.generate(plan, task.id, await snapshot());
    await assert.rejects(() => team.assess("security", plan, task.id, changes), refusal);
    const diagnostic = team.diagnostic();
    assert.equal(diagnostic.reasonCode, "assessment_validation_failed");
    assert.equal(diagnostic.assessmentRole, "security"); assert.equal(diagnostic.validationCode, code);
    assert.equal(diagnostic.httpStatus, 200); assert.equal(diagnostic.finishReason, "stop");
    assert.equal(diagnostic.httpRequestsSent, 2); assert.equal(team.snapshot().stopped, true);
    assert.equal(captured.length, 1); assert.equal(captured[0].role, "security"); assert.equal(captured[0].validationCode, code);
    assert.deepEqual(captured[0].result, output); assert.notEqual(captured[0].result, output);
    assert.ok(Object.isFrozen(captured[0])); assert.ok(Object.isFrozen(captured[0].result));
    assert.ok(Object.isFrozen((captured[0].result as typeof pass).findings));
    assert.ok(!JSON.stringify(diagnostic).includes("PRIVATE_ASSESSMENT"));
    assert.ok(!JSON.stringify(diagnostic).includes("src/calculator.mjs"));
    assert.ok(!JSON.stringify(diagnostic).includes("fixture-key"));
    await assert.rejects(() => team.assess("reviewer", plan, task.id, changes), refusal);
    assert.equal(calls, 2); assert.equal(captured.length, 1); assert.deepEqual(team.diagnostic(), diagnostic);
  });
});

test("rejection persistence starts after the terminal latch and cannot return an assessment approval", async () => {
  let calls = 0, hooks = 0;
  let reenter: () => Promise<unknown> = async () => undefined;
  const output = { ready: true, summary: "Unexpected schema.", findings: [], unverifiedAreas: [], publicationAuthorized: true };
  const team = createCalculatorModelTeam(owner, environment, async () => response(++calls === 1 ? generated : output), {}, undefined, {
    afterAssessmentRejected: async rejection => {
      hooks++; assert.equal(team.snapshot().stopped, true); assert.equal(team.diagnostic().reasonCode, "assessment_validation_failed");
      await assert.rejects(reenter, refusal);
      assert.throws(() => { (rejection.result as { ready: boolean }).ready = false; }, TypeError);
      return { ready: true } as never; // Callback output is untrusted data, never authority.
    },
  });
  const changes = await team.generate(plan, task.id, await snapshot());
  reenter = () => team.assess("reviewer", plan, task.id, changes);
  await assert.rejects(() => team.assess("security", plan, task.id, changes), refusal);
  assert.equal(calls, 2); assert.equal(hooks, 1); assert.equal(team.diagnostic().reasonCode, "assessment_validation_failed");
});

test("a private rejection hook failure has a fixed terminal code with no upstream error text or replay", async () => {
  let calls = 0, hooks = 0;
  const team = createCalculatorModelTeam(owner, environment, async () => response(++calls === 1 ? generated : { invalid: true }), {}, undefined, {
    afterAssessmentRejected: () => { hooks++; throw Error("PRIVATE_HOOK_SOURCE_AND_KEY"); },
  });
  const changes = await team.generate(plan, task.id, await snapshot());
  await assert.rejects(() => team.assess("tester", plan, task.id, changes), refusal);
  assert.equal(team.diagnostic().reasonCode, "assessment_rejection_persistence_failed");
  assert.equal(team.diagnostic().assessmentRole, "tester"); assert.equal(team.diagnostic().validationCode, "schema_invalid");
  assert.ok(!JSON.stringify(team.diagnostic()).includes("PRIVATE_HOOK_SOURCE_AND_KEY"));
  await assert.rejects(() => team.assess("tester", plan, task.id, changes), refusal);
  assert.equal(calls, 2); assert.equal(hooks, 1);
});

test("transport/JSON failures and valid declined findings do not invoke the rejection-data hook", async t => {
  for (const kind of ["http", "json", "secret", "declined"] as const) await t.test(kind, async () => {
    let calls = 0, hooks = 0;
    const team = createCalculatorModelTeam(owner, environment, async () => {
      if (++calls === 1) return response(generated);
      if (kind === "http") return new Response("PRIVATE_UPSTREAM_BODY", { status: 429 });
      if (kind === "json") return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "not-json" } }] });
      if (kind === "secret") return response({ ready: true, summary: "ghp_" + "A".repeat(32), findings: [], unverifiedAreas: [] });
      return response({ ready: false, summary: "A real blocker remains.", findings: [{ severity: "high", message: "Shown requirement is missing.",
        evidenceRefs: ["changes@" + A] }], unverifiedAreas: [] });
    }, {}, undefined, { afterAssessmentRejected: () => { hooks++; } });
    const changes = await team.generate(plan, task.id, await snapshot());
    if (kind === "declined") assert.equal((await team.assess("reviewer", plan, task.id, changes)).ready, false);
    else await assert.rejects(() => team.assess("reviewer", plan, task.id, changes), refusal);
    assert.equal(hooks, 0); assert.equal(calls, 2);
    assert.equal(team.diagnostic().validationCode, undefined);
  });
});

test("private rejection data preserves oversized-validator JSON and bounded numeric canonical expansion", async () => {
  let calls = 0;
  let captured: CalculatorRejectedAssessment | undefined;
  // 1e20 is legal four-byte JSON but its parsed number expands to 21 bytes when
  // serialized. The transport content still fits its unchanged 16000-byte cap.
  const raw = '{"unexpected":[' + Array.from({ length: 2500 }, () => "1e20").join(",") + "]}";
  assert.ok(Buffer.byteLength(raw) < 16000);
  const team = createCalculatorModelTeam(owner, environment, async () => {
    if (++calls === 1) return response(generated);
    return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: raw } }] });
  }, {}, undefined, { afterAssessmentRejected: rejection => { captured = rejection; } });
  const changes = await team.generate(plan, task.id, await snapshot());
  await assert.rejects(() => team.assess("security", plan, task.id, changes), refusal);
  assert.ok(captured); assert.ok(Buffer.byteLength(JSON.stringify(captured.result)) > 16000);
  assert.ok(Buffer.byteLength(JSON.stringify(captured.result)) <= CALCULATOR_REJECTED_ASSESSMENT_MAX_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(captured)) <= 100000);
  assert.equal(team.diagnostic().reasonCode, "assessment_validation_failed"); assert.equal(calls, 2);
});

test("a response above the assessment JSON ceiling remains available as private rejected data", async () => {
  const refs = Array.from({ length: 16 }, (_, i) => "source:" + "x".repeat(175) + i);
  const output = { ready: true, summary: "A bounded response with excess total JSON.", findings: Array.from({ length: 4 }, () => ({
    severity: "low", message: "x".repeat(400), evidenceRefs: refs })), unverifiedAreas: [] };
  const bytes = Buffer.byteLength(JSON.stringify(output)); assert.ok(bytes > 12000 && bytes < 16000);
  let calls = 0, captured: CalculatorRejectedAssessment | undefined;
  const team = createCalculatorModelTeam(owner, environment, async () => response(++calls === 1 ? generated : output), {}, undefined, {
    afterAssessmentRejected: value => { captured = value; },
  });
  const changes = await team.generate(plan, task.id, await snapshot());
  await assert.rejects(() => team.assess("reviewer", plan, task.id, changes), refusal);
  assert.ok(captured); assert.equal(captured.validationCode, "json_byte_limit"); assert.deepEqual(captured.result, output);
  assert.equal(team.diagnostic().validationCode, "json_byte_limit"); assert.equal(calls, 2);
});

test("private capture refuses raw or escaped provider/Actions credentials without exposing them in diagnostics", async t => {
  for (const prefix of ["gsk_", "ghs_", "ghp_", "fixture-key"]) for (const escaped of [false, true]) await t.test(prefix + (escaped ? " escaped" : " raw"), async () => {
    const secret = prefix === "fixture-key" ? prefix : prefix + "A".repeat(32);
    let calls = 0, captures = 0;
    const raw = JSON.stringify({ ready: true, summary: "Unexpected field.", findings: [], unverifiedAreas: [], extra: secret });
    const content = escaped ? raw.replace(secret, [...secret].map(character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0")).join("")) : raw;
    const team = createCalculatorModelTeam(owner, environment, async () => {
      if (++calls === 1) return response(generated);
      return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] });
    }, {}, undefined, { afterAssessmentRejected: () => { captures++; } });
    const changes = await team.generate(plan, task.id, await snapshot());
    await assert.rejects(() => team.assess("security", plan, task.id, changes), refusal);
    assert.equal(captures, 0); assert.equal(calls, 2); assert.equal(team.snapshot().stopped, true);
    const diagnostic = team.diagnostic();
    assert.ok(!JSON.stringify(diagnostic).includes(secret)); assert.ok(!JSON.stringify(diagnostic).includes(content));
    if (prefix !== "ghp_" || escaped) assert.equal(diagnostic.reasonCode, "assessment_rejection_persistence_failed");
    await assert.rejects(() => team.assess("reviewer", plan, task.id, changes), refusal); assert.equal(calls, 2);
  });
});

const restoreOutput = { summary: "Restore arithmetic and its required tests", changes: [
  ...generated.changes,
  { operation: "create", path: "test/calculator.test.mjs", content: "import test from 'node:test'; test('addition', () => {});", message: "Add scoped module tests" },
] };
async function restoreFixture() {
  const fresh = await snapshot(), prepared = prepareCalculatorRoleChanges(task.role, restoreOutput, fresh);
  return { fresh, prepared, saved: JSON.parse(JSON.stringify(prepared)), digest: calculatorProposalDigest(prepared) };
}

test("host restore rebuilds a branded saved proposal without Coder HTTP and preserves all three independent reviews", async () => {
  const f = await restoreFixture(), seen: string[] = [];
  const team = createCalculatorModelTeam(owner, environment, async (_url, init) => {
    const body = JSON.parse(String(init?.body)), packet = JSON.parse(body.messages[1].content);
    const role = body.messages[0].content.match(/You are the (security|reviewer|tester) /)?.[1];
    assert.ok(role); seen.push(role);
    assert.deepEqual(packet.allowedEvidenceRefs, ["changes@" + A]);
    assert.deepEqual(packet.completeChangedText.changes, JSON.parse(f.prepared.reviewEvidence).changes);
    return response({ ready: true, summary: "The supplied saved proposal is scoped.", findings: [], unverifiedAreas: ["Host tests remain unverified."] });
  });
  const restored = team.restoreProposal(plan, task.id, f.fresh, f.saved, f.digest);
  assert.equal(seen.length, 0); assert.equal(team.snapshot().modelBudget.attemptedRequests, 0);
  assert.equal(team.diagnostic().httpRequestsSent, 0);
  assert.equal(team.snapshot().generatedTasks, 0); assert.equal(team.snapshot().restoredTasks, 1);
  assert.notEqual(restored, f.saved); assert.notEqual(restored, f.prepared);
  assert.deepEqual(restored, f.prepared); assert.equal(calculatorProposalDigest(restored), f.digest);
  assert.ok(Object.isFrozen(restored)); assert.ok(Object.isFrozen(restored.files));
  assert.ok(restored.files.every(file => Object.isFrozen(file))); assert.ok(Object.isFrozen(restored.gates));
  f.saved.files[0].content = "Mutated only after the private artifact was verified.";
  assert.equal(restored.files[0].content, f.prepared.files[0].content);
  for (const role of ["security", "reviewer", "tester"] as const)
    assert.equal((await team.assess(role, plan, task.id, restored)).ready, true);
  assert.deepEqual(seen, ["security", "reviewer", "tester"]);
  assert.equal(team.diagnostic().httpRequestsSent, 3);
  assert.equal(team.snapshot().testsExecuted, false); assert.equal(team.snapshot().publicationAuthorized, false);
});

test("restore rejects unbranded snapshots and tampered private evidence before HTTP with a terminal latch", async t => {
  const mutations: Array<[string, (saved: any) => void]> = [
    ["file-content", saved => { saved.files[0].content += " changed"; }],
    ["evidence-content", saved => { const evidence = JSON.parse(saved.reviewEvidence); evidence.changes[0].content += " changed"; saved.reviewEvidence = JSON.stringify(evidence); }],
    ["evidence-metadata", saved => { const evidence = JSON.parse(saved.reviewEvidence); evidence.baseSha = B; saved.reviewEvidence = JSON.stringify(evidence); }],
    ["evidence-unknown-fields", saved => { const evidence = JSON.parse(saved.reviewEvidence); evidence.approved = true; saved.reviewEvidence = JSON.stringify(evidence); }],
    ["gates", saved => { saved.gates.publicationAuthorized = true; }],
    ["repository", saved => { saved.repository = "someone/else"; }],
    ["branch", saved => { saved.baseRef = owner.baseRef; }],
    ["sha", saved => { saved.baseSha = B; }],
    ["path", saved => { saved.files[0].path = "outside.mjs"; }],
    ["message-type", saved => { saved.files[0].message = 123; }],
    ["message-secret", saved => { saved.files[0].message = "ghp_" + "A".repeat(32); }],
    ["unknown-fields", saved => { saved.approved = true; }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, async () => {
    const f = await restoreFixture(); mutate(f.saved); let calls = 0;
    const team = createCalculatorModelTeam(owner, environment, async () => { calls++; return response({}); });
    assert.throws(() => team.restoreProposal(plan, task.id, f.fresh, f.saved, f.digest), refusal);
    assert.equal(calls, 0); assert.equal(team.snapshot().stopped, true);
    assert.throws(() => team.restoreProposal(plan, task.id, f.fresh, f.prepared, f.digest), refusal);
    await assert.rejects(() => team.plan(), refusal); assert.equal(calls, 0);
  });
  for (const name of ["snapshot-brand", "digest", "plan", "completed-prefix"] as const) await t.test(name, async () => {
    const f = await restoreFixture(); let calls = 0;
    const team = createCalculatorModelTeam(owner, environment, async () => { calls++; return response({}); });
    const complete = validateCalculatorAssessment("security", { ready: true, summary: "A previously returned assessment.", findings: [], unverifiedAreas: [] }, ["changes@" + A]);
    assert.throws(() => team.restoreProposal(name === "plan" ? { ...plan, fingerprint: "0".repeat(64) } : plan, task.id,
      name === "snapshot-brand" ? JSON.parse(JSON.stringify(f.fresh)) : f.fresh, f.saved,
      name === "digest" ? "0".repeat(64) : f.digest, name === "completed-prefix" ? [complete] : []), refusal);
    assert.equal(calls, 0); assert.equal(team.snapshot().stopped, true);
  });
});

test("restore requires every absent task file and reconstructs patches against the fresh branded source", async t => {
  await t.test("missing required absent companion", async () => {
    const fresh = await snapshot(), partial = prepareCalculatorRoleChanges(task.role, generated, fresh); let calls = 0;
    const team = createCalculatorModelTeam(owner, environment, async () => { calls++; return response({}); });
    assert.throws(() => team.restoreProposal(plan, task.id, fresh, partial, calculatorProposalDigest(partial)), refusal);
    assert.equal(calls, 0);
  });
  await t.test("fresh source hash differs", async () => {
    const old = "export const value = 1;\n// Original private companion source.\n";
    const original = await snapshot(old), fresh = await snapshot(old.replace("value = 1", "value = 9"));
    const prepared = prepareCalculatorRoleChanges(task.role, { summary: "Adjust arithmetic and add required tests", changes: [
      { operation: "patch", path: "src/calculator.mjs", sourceSha256: createHash("sha256").update(old).digest("hex"),
        edits: [{ before: "value = 1", after: "value = 2" }], message: "Adjust arithmetic" }, restoreOutput.changes[1],
    ] }, original);
    let calls = 0;
    const team = createCalculatorModelTeam(owner, environment, async () => { calls++; return response({}); });
    assert.throws(() => team.restoreProposal(plan, task.id, fresh, JSON.parse(JSON.stringify(prepared)), calculatorProposalDigest(prepared)), refusal);
    assert.equal(calls, 0);
  });
});

test("a restored capability rejects Coder, repair, plan, observation and another restore before HTTP", async t => {
  for (const action of ["generate", "repair", "plan", "observe", "restore"] as const) await t.test(action, async () => {
    const f = await restoreFixture(); let calls = 0;
    const team = createCalculatorModelTeam(owner, environment, async () => { calls++; return response({}); });
    const restored = team.restoreProposal(plan, task.id, f.fresh, f.saved, f.digest);
    if (action === "generate") await assert.rejects(() => team.generate(plan, task.id, f.fresh), refusal);
    if (action === "repair") await assert.rejects(() => team.repair(plan, task.id, f.fresh,
      { previous: restored, proposalDigest: f.digest, issues: ["A host-observed task concern."] }), refusal);
    if (action === "plan") await assert.rejects(() => team.plan(), refusal);
    if (action === "observe") assert.throws(() => team.observeCommitted(plan, task.id, f.fresh, f.fresh), refusal);
    if (action === "restore") assert.throws(() => team.restoreProposal(plan, task.id, f.fresh, f.saved, f.digest), refusal);
    assert.equal(calls, 0); assert.equal(team.snapshot().stopped, true);
    await assert.rejects(() => team.assess("security", plan, task.id, restored), refusal); assert.equal(calls, 0);
  });
});

test("restored assessment roles cannot skip or repeat the pending strict prefix", async t => {
  for (const afterSecurity of [false, true]) await t.test(afterSecurity ? "cannot skip reviewer" : "cannot skip security", async () => {
    const f = await restoreFixture(); let calls = 0;
    const team = createCalculatorModelTeam(owner, environment, async () => {
      calls++; return response({ ready: true, summary: "The supplied saved proposal is scoped.", findings: [], unverifiedAreas: [] });
    });
    const restored = team.restoreProposal(plan, task.id, f.fresh, f.saved, f.digest);
    if (afterSecurity) await team.assess("security", plan, task.id, restored);
    await assert.rejects(() => team.assess(afterSecurity ? "tester" : "reviewer", plan, task.id, restored), refusal);
    assert.equal(calls, afterSecurity ? 1 : 0); assert.equal(team.snapshot().stopped, true);
  });
});

function savedAssessmentPrefix() {
  return JSON.parse(JSON.stringify((["security", "reviewer"] as const).map(role => validateCalculatorAssessment(role, {
    ready: true, summary: "The exact saved proposal is scoped.", findings: [], unverifiedAreas: ["Host tests remain unverified."],
  }, ["changes@" + A]))));
}

test("a restored ready Security/Reviewer prefix is canonical private evidence and only Tester sends HTTP", async () => {
  const f = await restoreFixture(), savedPrefix = savedAssessmentPrefix(), roles: string[] = [];
  const team = createCalculatorModelTeam(owner, environment, async (_url, init) => {
    const body = JSON.parse(String(init?.body)); roles.push(body.messages[0].content.match(/You are the (\w+) /)![1]);
    return response({ ready: true, summary: "The scoped test design is covered.", findings: [], unverifiedAreas: ["Host tests are still required."] });
  });
  const restored = team.restoreProposal(plan, task.id, f.fresh, f.saved, f.digest, savedPrefix);
  const prefix = team.restoredAssessmentPrefix(plan, task.id, restored);
  assert.deepEqual(prefix, savedPrefix); assert.notEqual(prefix, savedPrefix); assert.notEqual(prefix[0], savedPrefix[0]);
  assert.equal(team.restoredAssessmentPrefix(plan, task.id, restored), prefix);
  assert.ok(Object.isFrozen(prefix));
  for (const assessment of prefix) {
    assert.ok(Object.isFrozen(assessment)); assert.ok(Object.isFrozen(assessment.findings)); assert.ok(Object.isFrozen(assessment.unverifiedAreas));
    assert.equal(assessment.testsExecuted, false); assert.equal(assessment.publicationAuthorized, false);
  }
  savedPrefix[0].summary = "Untrusted later mutation.";
  assert.notEqual(prefix[0].summary, savedPrefix[0].summary);
  assert.equal(team.diagnostic().httpRequestsSent, 0); assert.equal(team.snapshot().generatedTasks, 0);
  assert.equal(team.snapshot().restoredTasks, 1); assert.equal((await team.assess("tester", plan, task.id, restored)).ready, true);
  assert.deepEqual(roles, ["tester"]); assert.equal(team.diagnostic().httpRequestsSent, 1);
});

test("restored enriched prefix rejects authority, evidence, disclosure and order tampering without partial registration", async t => {
  const cases: Array<[string, (prefix: any[]) => unknown[]]> = [
    ["one role", prefix => prefix.slice(0, 1)], ["three roles", prefix => [...prefix, prefix[1]]],
    ["reverse order", prefix => prefix.reverse()], ["duplicate security", prefix => [prefix[0], prefix[0]]],
    ["ready false", prefix => { prefix[0].ready = false; return prefix; }],
    ["execution authority", prefix => { prefix[0].testsExecuted = true; return prefix; }],
    ["publication authority", prefix => { prefix[1].publicationAuthorized = true; return prefix; }],
    ["completion authority", prefix => { prefix[1].overallTaskCompletionVerified = true; return prefix; }],
    ["extra field", prefix => { prefix[0].approved = true; return prefix; }],
    ["missing field", prefix => { delete prefix[0].testsExecuted; return prefix; }],
    ["unknown evidence", prefix => { prefix[0].findings = [{ severity: "low", message: "A scoped concern.", evidenceRefs: ["changes@" + B], evidenceStatus: "supplied" }]; return prefix; }],
    ["wrong evidence status", prefix => { prefix[0].findings = [{ severity: "low", message: "A scoped concern.", evidenceRefs: ["changes@" + A], evidenceStatus: "missing" }]; return prefix; }],
    ["blocker hidden by ready", prefix => { prefix[0].findings = [{ severity: "blocker", message: "An unresolved blocker.", evidenceRefs: ["changes@" + A], evidenceStatus: "supplied" }]; return prefix; }],
    ["valid high decline", prefix => { prefix[0] = validateCalculatorAssessment("security", { ready: true, summary: "A serious concern remains.", findings: [{ severity: "high", message: "Required behavior is absent.", evidenceRefs: ["changes@" + A] }], unverifiedAreas: [] }, ["changes@" + A]); return prefix; }],
    ["missing disclosure", prefix => { prefix[1].unverifiedAreas.pop(); return prefix; }],
    ["changed disclosure", prefix => { prefix[1].unverifiedAreas[prefix[1].unverifiedAreas.length - 1] += " changed"; return prefix; }],
    ["excess original areas", prefix => { prefix[0].unverifiedAreas = [...Array.from({ length: 9 }, () => "Unknown scope."), prefix[0].unverifiedAreas.at(-1)]; return prefix; }],
    ["newline in original area", prefix => { prefix[0].unverifiedAreas[0] = "Unknown\nscope."; return prefix; }],
    ["extra finding field", prefix => { prefix[0].findings = [{ severity: "low", message: "A scoped concern.", evidenceRefs: ["changes@" + A], evidenceStatus: "supplied", approved: true }]; return prefix; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const f = await restoreFixture(); let calls = 0;
    const team = createCalculatorModelTeam(owner, environment, async () => { calls++; return response({}); });
    assert.throws(() => team.restoreProposal(plan, task.id, f.fresh, f.saved, f.digest, mutate(savedAssessmentPrefix())), refusal);
    assert.equal(calls, 0); assert.equal(team.snapshot().restoredTasks, 0); assert.equal(team.snapshot().stopped, true);
    assert.throws(() => team.restoredAssessmentPrefix(plan, task.id, f.prepared), refusal);
  });
});

test("only the exact host-owned disclosure suffix is removed and original duplicate disclosures survive", async () => {
  const f = await restoreFixture();
  const raw = { ready: true, summary: "A low finding remains explicitly unverified.", findings: [{ severity: "low", message: "More evidence would help.", evidenceRefs: [] as string[] }], unverifiedAreas: [] as string[] };
  const ownedTail = validateCalculatorAssessment("security", raw, ["changes@" + A]).unverifiedAreas;
  assert.equal(ownedTail.length, 2);
  const security = validateCalculatorAssessment("security", { ...raw, unverifiedAreas: [...ownedTail] }, ["changes@" + A]);
  const saved = savedAssessmentPrefix(); saved[0] = JSON.parse(JSON.stringify(security));
  const team = createCalculatorModelTeam(owner, environment, async () => response({ ready: true, summary: "Scoped checks covered.", findings: [], unverifiedAreas: [] }));
  const restored = team.restoreProposal(plan, task.id, f.fresh, f.saved, f.digest, saved);
  const prefix = team.restoredAssessmentPrefix(plan, task.id, restored);
  assert.deepEqual(prefix[0].unverifiedAreas, [...ownedTail, ...ownedTail]);
  assert.equal(prefix[0].findings[0].evidenceStatus, "missing"); assert.equal(prefix[0].ready, true);
  assert.equal(team.diagnostic().httpRequestsSent, 0);
});

test("a cached assessment prefix belongs only to its exact restored proposal and plan/task identity", async t => {
  for (const name of ["clone", "unregistered", "wrong task", "wrong plan"] as const) await t.test(name, async () => {
    const f = await restoreFixture(); let calls = 0;
    const team = createCalculatorModelTeam(owner, environment, async () => { calls++; return response({}); });
    const restored = team.restoreProposal(plan, task.id, f.fresh, f.saved, f.digest, savedAssessmentPrefix());
    assert.throws(() => team.restoredAssessmentPrefix(name === "wrong plan" ? { ...plan, fingerprint: "0".repeat(64) } : plan,
      name === "wrong task" ? plan.tasks[1].id : task.id,
      name === "clone" ? JSON.parse(JSON.stringify(restored)) : name === "unregistered" ? f.prepared : restored), refusal);
    assert.equal(calls, 0); assert.equal(team.snapshot().stopped, true);
  });
});

test("restored completed roles and Tester cannot be replayed, while empty-prefix legacy restore remains available", async t => {
  for (const role of ["security", "reviewer", "tester"] as const) await t.test(role, async () => {
    const f = await restoreFixture(); let calls = 0;
    const team = createCalculatorModelTeam(owner, environment, async () => { calls++; return response({ ready: true, summary: "Scoped checks covered.", findings: [], unverifiedAreas: [] }); });
    const restored = team.restoreProposal(plan, task.id, f.fresh, f.saved, f.digest, savedAssessmentPrefix());
    if (role === "tester") await team.assess("tester", plan, task.id, restored);
    await assert.rejects(() => team.assess(role, plan, task.id, restored), refusal);
    assert.equal(calls, role === "tester" ? 1 : 0);
  });
  const f = await restoreFixture(); let calls = 0;
  const team = createCalculatorModelTeam(owner, environment, async () => { calls++; return response({ ready: true, summary: "Scoped checks covered.", findings: [], unverifiedAreas: [] }); });
  const restored = team.restoreProposal(plan, task.id, f.fresh, f.saved, f.digest, []);
  assert.deepEqual(team.restoredAssessmentPrefix(plan, task.id, restored), []);
  assert.ok(Object.isFrozen(team.restoredAssessmentPrefix(plan, task.id, restored)));
  await team.assess("security", plan, task.id, restored); assert.equal(calls, 1);
});

import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {authorizeProjectBudget,reconcileProjectBudgetHistory,projectBudgetApprovalDigest,type AuthorizedProjectTaskScope} from './projectBudgetAuthorization.js';
import {createProjectModelBudgetFileStore} from './projectModelBudgetFileStore.js';
import {createProjectBudgetedCalculatorTeam} from './projectBudgetedCalculatorTeam.js';
async function authorizedProjectFixture(allowance=10,mode='development'){
 const x=groqCheckpointFixture(),dir=mkdtempSync(join(tmpdir(),'project-team-'));let wall=Date.parse('2026-10-25T12:00:00Z');
 const identity={projectId:x.groqPlan.owner.id,repository:x.groqPlan.owner.repository,planFingerprint:x.groqPlan.fingerprint,ownerFingerprint:x.groqPlan.owner.ownerFingerprint,taskIds:x.groqPlan.tasks.map(t=>t.id)};
 const history={version:1 as const,projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,observations:['planning',...identity.taskIds].map(scopeId=>({scopeId,kind:'cumulative-scope-total' as const,charge:{requests:1,requestBytes:100,reservedTokens:500},evidenceSha256:'c'.repeat(64)}))},h=reconcileProjectBudgetHistory(history,identity);
 const document={version:1,kind:'authorize-project-model-budget',mode,grant:{version:1,projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,grantId:'offline-project-role-grant',maxRequests:h.charge.requests+allowance,maxRequestBytes:24000,maxTotalRequestBytes:200000,maxReservedTokens:96000,historical:h.charge,historicalEvidenceSha256:h.digest,provider:'groq',freeTierConfirmed:true,legalEnabled:false},expiresAt:new Date(wall+86400000).toISOString()};
 const comment:any={id:1,user:{login:'erman-ksv',type:'User'},author_association:'OWNER',issue_url:'https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/75',html_url:'https://github.com/erman-ksv/Onay-Agents-Factory/pull/75#issuecomment-1',created_at:'2026-10-25T11:00:00Z',updated_at:'2026-10-25T11:00:00Z',body:JSON.stringify(document)};
 const controller=await authorizeProjectBudget({identity,history,decision:{issueNumber:75,commentId:1,bodySha256:projectBudgetApprovalDigest(document)},token:'offline-owner-read-token',store:createProjectModelBudgetFileStore(dir),transport:async()=>Response.json(comment),now:()=>wall});await controller.initialize();let clock=0;
 return {...x,controller,comment,setWall:(v:number)=>{wall=v;},historical:h.charge,timing:{now:()=>clock,wait:async(ms:number)=>{clock+=ms;}},scope:(taskId=x.groqPlan.tasks[0]!.id,execution='run-one')=>controller.taskScope(taskId,execution),cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
test('project mode requires a verified one-use capability and cannot opt out through configuration',async()=>{const f=await authorizedProjectFixture();try{
 let sends=0;const transport:typeof fetch=async()=>{sends++;return response({});};const scope=await f.scope();
 for(const mode of ['off','optional',''])assert.throws(()=>createProjectBudgetedCalculatorTeam(f.groqOwner,{...f.env,AGENT_FACTORY_PROJECT_BUDGET_MODE:mode},scope,transport),refusal);
 assert.throws(()=>createCalculatorModelTeam(f.groqOwner,{...f.env,AGENT_FACTORY_PROJECT_BUDGET_MODE:'required'},transport),refusal);
 assert.throws(()=>createProjectBudgetedCalculatorTeam(f.groqOwner,f.env,{...scope} as AuthorizedProjectTaskScope,transport),refusal);
 createProjectBudgetedCalculatorTeam(f.groqOwner,f.env,scope,transport,f.timing);assert.throws(()=>createProjectBudgetedCalculatorTeam(f.groqOwner,f.env,scope,transport),refusal);assert.equal(sends,0);
 }finally{f.cleanup();}});
test('Coder, Security, Reviewer and Tester all reserve through one authenticated project ledger',async()=>{const f=await authorizedProjectFixture();try{
 let sends=0;const team=createProjectBudgetedCalculatorTeam(f.groqOwner,f.env,await f.scope(),async(_url,init)=>{
  sends++;assert.equal((await f.controller.inspect()).used.requests,f.historical.requests+sends);const body=String(init?.body);assert.ok(!body.includes('authorize-project-model-budget'));assert.ok(!body.includes('offline-owner-read-token'));assert.ok(!body.includes('offline-project-role-grant'));
  return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(sends===1?generated:{ready:true,summary:'Scoped independent fixture',findings:[],unverifiedAreas:['No actual app test executed']})}}],usage:{prompt_tokens:1000,completion_tokens:80,total_tokens:1080}});
 },f.timing);
 const changes=await team.generate(f.groqPlan,f.groqPlan.tasks[0]!.id,await snapshot());for(const role of ['security','reviewer','tester'] as const)assert.equal((await team.assess(role,f.groqPlan,f.groqPlan.tasks[0]!.id,changes)).ready,true);
 assert.equal(sends,4);assert.equal((await f.controller.inspect()).used.requests,f.historical.requests+4);
 }finally{f.cleanup();}});
test('Commander planning and Frontend use the same required project boundary',async()=>{const f=await authorizedProjectFixture();try{
 let sends=0;const commander=createProjectBudgetedCalculatorTeam(f.groqOwner,f.env,await f.scope('planning','planning-run'),async()=>{sends++;return response(f.groqPlan.proposal);},f.timing);assert.equal((await commander.plan()).fingerprint,f.groqPlan.fingerprint);
 const task=f.groqPlan.tasks[1]!,ui=await loadCalculatorSnapshot({repository:CALCULATOR_PROFILE.repository,baseRef:f.groqPlan.branch,baseSha:A,changePaths:task.paths},{getHead:async()=>A,readCommit:async()=>({sha:A,treeSha:B}),readTree:async()=>({sha:B,truncated:false,tree:[]}),readBlob:async()=>{throw Error('No source');}});
 const frontend=createProjectBudgetedCalculatorTeam(f.groqOwner,f.env,await f.scope(task.id,'frontend-run'),async()=>{sends++;return response({summary:'Offline UI routing fixture',changes:task.paths.map(path=>({operation:'create',path,content:path.endsWith('.html')?'<!doctype html><title>Fixture</title>':path.endsWith('.css')?'body{color:black}':'export const ready=true;',message:'Offline UI fixture'}))});},f.timing);await frontend.generate(f.groqPlan,task.id,ui);assert.equal(sends,2);assert.equal((await f.controller.inspect()).used.requests,f.historical.requests+2);
 }finally{f.cleanup();}});
test('a fresh team cannot bypass exhausted project allowance with a fresh local budget',async()=>{const f=await authorizedProjectFixture(1);try{
 let sends=0;const transport:typeof fetch=async()=>{sends++;return response(generated);};const first=createProjectBudgetedCalculatorTeam(f.groqOwner,f.env,await f.scope(),transport,f.timing);await first.generate(f.groqPlan,f.groqPlan.tasks[0]!.id,await snapshot());
 const second=createProjectBudgetedCalculatorTeam(f.groqOwner,f.env,await f.scope(f.groqPlan.tasks[0]!.id,'run-two'),transport,f.timing);await assert.rejects(async()=>second.generate(f.groqPlan,f.groqPlan.tasks[0]!.id,await snapshot()),refusal);assert.equal(sends,1);
 }finally{f.cleanup();}});
test('owner revocation after creation stops HTTP and prevents later specialist traffic',async()=>{const f=await authorizedProjectFixture();try{
 let sends=0;const team=createProjectBudgetedCalculatorTeam(f.groqOwner,f.env,await f.scope(),async()=>{sends++;return response(generated);},f.timing);f.comment.updated_at='2026-10-25T11:02:00Z';await assert.rejects(async()=>team.generate(f.groqPlan,f.groqPlan.tasks[0]!.id,await snapshot()),refusal);assert.equal(sends,0);assert.equal((await f.controller.inspect()).used.requests,f.historical.requests+1);
 }finally{f.cleanup();}});
test('a task-scoped team cannot plan or execute another task',async()=>{const f=await authorizedProjectFixture();try{let sends=0;const team=createProjectBudgetedCalculatorTeam(f.groqOwner,f.env,await f.scope(),async()=>{sends++;return response(generated);},f.timing);await assert.rejects(()=>team.plan(),refusal);await assert.rejects(async()=>team.generate(f.groqPlan,f.groqPlan.tasks[1]!.id,await snapshot()),refusal);assert.equal(sends,0);}finally{f.cleanup();}});

test('owner-approved read-only mode cannot plan, generate or repair source',async()=>{const f=await authorizedProjectFixture(3,'read-only-review');try{let sends=0;const team=createProjectBudgetedCalculatorTeam(f.groqOwner,f.env,await f.scope(),async()=>{sends++;return response(generated);},f.timing);await assert.rejects(()=>team.plan(),refusal);await assert.rejects(async()=>team.generate(f.groqPlan,f.groqPlan.tasks[0]!.id,await snapshot()),refusal);assert.equal(sends,0);}finally{f.cleanup();}});

test('expiry during checkpoint persistence still stops the provider after a valid native approval read',async()=>{const f=await authorizedProjectFixture();try{let sends=0;const team=createProjectBudgetedCalculatorTeam(f.groqOwner,f.env,await f.scope(),async()=>{sends++;return response(generated);},f.timing,{beforeRequest:()=>{f.setWall(Date.parse('2026-10-27T12:00:00Z'));}});await assert.rejects(async()=>team.generate(f.groqPlan,f.groqPlan.tasks[0]!.id,await snapshot()),refusal);assert.equal(sends,0);}finally{f.cleanup();}});

import {createCalculatorProjectRuntimeTeam,prepareCalculatorProjectRuntimeHost} from './calculatorProjectRuntimeTeam.js';
test('project runtime rejects JSON-cloned controller, accessors and budget opt-out before model HTTP',async()=>{const f=await authorizedProjectFixture();try{
 assert.throws(()=>prepareCalculatorProjectRuntimeHost({controller:JSON.parse(JSON.stringify(f.controller)),executionId:'offline-runtime'}),refusal);
 let reads=0;const accessor=Object.defineProperty({executionId:'offline-runtime'},'controller',{enumerable:true,get(){reads++;return f.controller;}});
 assert.throws(()=>prepareCalculatorProjectRuntimeHost(accessor),refusal);assert.equal(reads,0);
 for(const mode of ['off','optional',''])await assert.rejects(()=>createCalculatorProjectRuntimeTeam(f.groqOwner,f.groqPlan,{...f.env,AGENT_FACTORY_PROJECT_BUDGET_MODE:mode},{controller:f.controller,executionId:'offline-runtime'}),refusal);
 }finally{f.cleanup();}});
async function runtimeUiSnapshot(f:Awaited<ReturnType<typeof authorizedProjectFixture>>){const task=f.groqPlan.tasks[1]!;return loadCalculatorSnapshot({repository:CALCULATOR_PROFILE.repository,baseRef:f.groqPlan.branch,baseSha:A,changePaths:task.paths},{getHead:async()=>A,readCommit:async()=>({sha:A,treeSha:B}),readTree:async()=>({sha:B,truncated:false,tree:[]}),readBlob:async()=>{throw Error('No source');}});}
function runtimeUiChanges(f:Awaited<ReturnType<typeof authorizedProjectFixture>>){return {summary:'Offline frontend routing fixture',changes:f.groqPlan.tasks[1]!.paths.map(path=>({operation:'create',path,content:path.endsWith('.html')?'<!doctype html><title>Fixture</title>':path.endsWith('.css')?'body{color:black}':'export const ready=true;',message:'Offline fixture'}))};}
test('runtime dependency scope and successor scope share historical budget and cumulative checkpoints',async()=>{const f=await authorizedProjectFixture();try{
 let sends=0;const checkpoints:number[]=[];const team=await createCalculatorProjectRuntimeTeam(f.groqOwner,f.groqPlan,f.env,{controller:f.controller,executionId:'offline-router'},{timing:f.timing,checkpoints:{beforeRequest:c=>{checkpoints.push(c.attemptedRequests);}},transport:async()=>{sends++;assert.equal((await f.controller.inspect()).used.requests,f.historical.requests+sends);return response(sends===1?generated:runtimeUiChanges(f));}});
 await team.generate(f.groqPlan,f.groqPlan.tasks[0]!.id,await snapshot());await team.generate(f.groqPlan,f.groqPlan.tasks[1]!.id,await runtimeUiSnapshot(f));
 assert.equal(sends,2);assert.deepEqual(checkpoints,[1,2]);assert.equal(team.checkpointCharge().attemptedRequests,2);
 const live=await f.controller.inspect();assert.equal(live.used.reservedTokens,f.historical.reservedTokens+team.checkpointCharge().reservedRunTokens);
 }finally{f.cleanup();}});
test('fresh runtime after restart cannot bypass exhausted project requests',async()=>{const f=await authorizedProjectFixture(1);try{
 let sends=0;const options={timing:f.timing,transport:async()=>{sends++;return response(generated);}};
 const first=await createCalculatorProjectRuntimeTeam(f.groqOwner,f.groqPlan,f.env,{controller:f.controller,executionId:'runtime-one'},options);await first.generate(f.groqPlan,f.groqPlan.tasks[0]!.id,await snapshot());
 const second=await createCalculatorProjectRuntimeTeam(f.groqOwner,f.groqPlan,f.env,{controller:f.controller,executionId:'runtime-two'},options);await assert.rejects(async()=>second.generate(f.groqPlan,f.groqPlan.tasks[1]!.id,await runtimeUiSnapshot(f)),refusal);assert.equal(sends,1);
 }finally{f.cleanup();}});
test('runtime stops all task clients on Groq 429 without retrying or refunding',async()=>{const f=await authorizedProjectFixture();try{
 let sends=0;const team=await createCalculatorProjectRuntimeTeam(f.groqOwner,f.groqPlan,f.env,{controller:f.controller,executionId:'offline-rate-limit'},{timing:f.timing,transport:async()=>{sends++;return new Response('PRIVATE_UPSTREAM',{status:429});}});
 await assert.rejects(async()=>team.generate(f.groqPlan,f.groqPlan.tasks[0]!.id,await snapshot()),refusal);await assert.rejects(async()=>team.generate(f.groqPlan,f.groqPlan.tasks[1]!.id,await runtimeUiSnapshot(f)),refusal);
 assert.equal(sends,1);assert.equal((await f.controller.inspect()).used.requests,f.historical.requests+1);assert.ok(!JSON.stringify(team.diagnostic()).includes('PRIVATE_UPSTREAM'));
 }finally{f.cleanup();}});
test('runtime checkpoints retain all role charges and failure stops the next task',async()=>{const f=await authorizedProjectFixture();try{
 let sends=0;const aggregate:number[]=[];const team=await createCalculatorProjectRuntimeTeam(f.groqOwner,f.groqPlan,f.env,{controller:f.controller,executionId:'offline-persistence'},{timing:f.timing,checkpoints:{beforeRequest:c=>{aggregate.push(c.attemptedRequests);if(c.attemptedRequests===2)throw Error('private persistence failure');}},transport:async()=>{sends++;return response(generated);}});
 const changes=await team.generate(f.groqPlan,f.groqPlan.tasks[0]!.id,await snapshot());await assert.rejects(()=>team.assess('security',f.groqPlan,f.groqPlan.tasks[0]!.id,changes),refusal);await assert.rejects(async()=>team.generate(f.groqPlan,f.groqPlan.tasks[1]!.id,await runtimeUiSnapshot(f)),refusal);
 assert.equal(sends,1);assert.deepEqual(aggregate,[1,2]);assert.equal((await f.controller.inspect()).used.requests,f.historical.requests+2);
 }finally{f.cleanup();}});
test('zero remaining project allowance permits inspection but no runtime request',async()=>{const f=await authorizedProjectFixture(0);try{
 let sends=0;const team=await createCalculatorProjectRuntimeTeam(f.groqOwner,f.groqPlan,f.env,{controller:f.controller,executionId:'offline-no-allowance'},{timing:f.timing,transport:async()=>{sends++;return response(generated);}});
 assert.equal((await f.controller.inspect()).remaining.requests,0);await assert.rejects(async()=>team.generate(f.groqPlan,f.groqPlan.tasks[0]!.id,await snapshot()),refusal);assert.equal(sends,0);
 }finally{f.cleanup();}});

test('dependency Security Reviewer Tester and successor Frontend retain one runtime request ceiling',async()=>{const f=await authorizedProjectFixture();try{
 let sends=0;const aggregate:number[]=[];const team=await createCalculatorProjectRuntimeTeam(f.groqOwner,f.groqPlan,f.env,{controller:f.controller,executionId:'offline-dependency-roles'},{timing:f.timing,preset:'calculator-frontend-2048-four-roles',checkpoints:{beforeRequest:c=>{aggregate.push(c.attemptedRequests);}},transport:async()=>{sends++;return response(sends<=3?{ready:true,summary:'Offline scoped inspection',findings:[],unverifiedAreas:['No actual app tests executed']}:runtimeUiChanges(f));}});
 const task=f.groqPlan.tasks[0]!,sources=new Map(task.paths.map(path=>[path,path==='src/calculator.mjs'?'export const add=(a,b)=>a+b;':'import test from "node:test";test("fixture",()=>{});']));
 const entries=[{path:'src',type:'tree',mode:'040000',sha:B},{path:'test',type:'tree',mode:'040000',sha:B},...[...sources].map(([path,content])=>({path,type:'blob',mode:'100644',sha:createHash('sha1').update('blob '+Buffer.byteLength(content)+'\0'+content).digest('hex')}))];
 const current=await loadCalculatorSnapshot({repository:CALCULATOR_PROFILE.repository,baseRef:f.groqPlan.branch,baseSha:B,changePaths:task.paths},{getHead:async()=>B,readCommit:async()=>({sha:B,treeSha:A}),readTree:async()=>({sha:A,truncated:false,tree:entries}),readBlob:async sha=>{const e=entries.find(e=>e.type==='blob'&&e.sha===sha)!;return {sha,encoding:'base64',content:Buffer.from(sources.get(e.path)!).toString('base64')};}});
 const observed=team.observeCommitted(f.groqPlan,task.id,await snapshot(),current);for(const role of ['security','reviewer','tester'] as const)assert.equal((await team.assess(role,f.groqPlan,task.id,observed)).ready,true);
 const next=f.groqPlan.tasks[1]!,changes=await team.generate(f.groqPlan,next.id,await runtimeUiSnapshot(f));assert.equal(sends,4);assert.deepEqual(aggregate,[1,2,3,4]);
 await assert.rejects(()=>team.assess('security',f.groqPlan,next.id,changes),refusal);assert.equal(sends,4);assert.equal((await f.controller.inspect()).used.requests,f.historical.requests+5);
 }finally{f.cleanup();}});
