import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
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
