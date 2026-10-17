import { buildSpecialistInstructions, SPECIALIST_REVIEW_CONTRACT, ROLE_SKILLS } from "../commander/skills.js";
import { Agent, Runner, setTracingDisabled } from "@openai/agents";
import { configureModelProvider } from "../commander/modelProvider.js";
import assert from "node:assert/strict";
import test from "node:test";
import { QUALIFICATION_CASES, buildQualificationPrompt, evaluateAssessment, parseAssessment, runQualification, QualificationFailure, safeFailureMetadata, qualificationEnvironment, createQualificationPacer, withQualificationDeadline, QualificationTimeoutError, qualificationModelSettings, qualificationProbeCase } from "./specialistQualification.js";

test("qualification covers every advisory role with faulty and corrected cases", () => {
  const roles = ["backend", "database", "frontend", "dispatch", "product", "ux", "legal", "devops"];
  assert.equal(QUALIFICATION_CASES.length, 16);
  assert.equal(new Set(QUALIFICATION_CASES.map(c => c.id)).size, 16);
  for (const role of roles) {
    assert.equal(QUALIFICATION_CASES.filter(c => c.role === role && c.expectedReady).length, 1);
    assert.equal(QUALIFICATION_CASES.filter(c => c.role === role && !c.expectedReady).length, 1);
  }
});
test("blanket approval, blanket rejection and vague blockers cannot qualify", () => {
  for (const c of QUALIFICATION_CASES) {
    if (!c.expectedReady) {
      assert.equal(evaluateAssessment(c, { ready: true, findings: [] }).passed, false);
      assert.equal(evaluateAssessment(c, { ready: false, findings: [{severity: "high", message: "Something needs improvement."}] }).passed, false);
    } else {
      assert.equal(evaluateAssessment(c, { ready: false, findings: [{severity: "high", message: "Rejected."}] }).passed, false);
      assert.equal(evaluateAssessment(c, { ready: true, findings: [{severity: "high", message: "Still blocked."}] }).passed, false);
    }
  }
});
test("blocker evidence must be severe and inside findings", () => {
  const c = QUALIFICATION_CASES.find(c => c.role === "backend" && !c.expectedReady)!;
  assert.equal(evaluateAssessment(c, {ready: false, findings: [], summary: "IDOR"}).passed, false);
  assert.equal(evaluateAssessment(c, {ready: false, findings: [{severity: "low", message: "IDOR"}]}).passed, false);
  assert.equal(evaluateAssessment(c, {ready: false, findings: [{severity: "high", message: "Missing owner authorization creates IDOR."}]}).passed, true);
});
test("malformed assessments fail closed and fenced valid JSON is accepted", () => {
  for (const value of [null, "", "{}", '{"ready":"false","findings":[]}', '{"ready":false,"findings":[{"severity":"critical","message":"bad"}]}', '{"ready":false,"findings":[{"severity":"high","message":""}]}']) {
    assert.throws(() => parseAssessment(value));
  }
  assert.equal(parseAssessment('\`\`\`json\n{"ready":true,"findings":[]}\n\`\`\`').ready, true);
});
test("model prompt contains fixture but excludes ground-truth fields", () => {
  for (const c of QUALIFICATION_CASES) {
    const prompt = buildQualificationPrompt(c);
    assert.ok(prompt.includes(c.scenario));
    assert.ok(!prompt.includes("expectedReady"));
    assert.ok(!prompt.includes("expectedFinding"));
  }
});
test("provider errors stop further calls and cannot produce a passing report", async () => {
  let calls = 0;
  await assert.rejects(runQualification(async () => { calls++; throw new Error("provider unavailable"); }));
  assert.equal(calls, 1);
});
test("every fixture must pass; a single false approval fails the overall result", async () => {
  const result = await runQualification(async () => '{"ready":true,"findings":[]}');
  assert.equal(result.passed, false);
  assert.equal(result.results.length, 16);
  assert.equal(result.results.filter(r => r.passed).length, 8);
});

test("diagnostics distinguish provider errors from malformed model responses without leaking secrets", async () => {
  const secret = "private-value-do-not-print";
  const upstream = Object.assign(new Error(secret), {
    name: "RateLimitError", status: 429, body: secret, headers: {authorization: secret},
  });
  await assert.rejects(runQualification(async () => { throw upstream; }), (error: unknown) => {
    assert.ok(error instanceof QualificationFailure);
    assert.equal(error.caseId, "backend-a");
    assert.equal(error.stage, "provider");
    assert.deepEqual(error.detail, {kind: "RateLimitError", httpStatus: 429});
    assert.ok(!JSON.stringify(error).includes(secret));
    return true;
  });
  for (const [raw, kind] of [["not JSON", "invalid-json"], ["{}", "invalid-schema"], [undefined, "missing-text"]] as const) {
    let calls = 0;
    await assert.rejects(runQualification(async () => { calls++; return raw; }), (error: unknown) => {
      assert.ok(error instanceof QualificationFailure);
      assert.equal(error.stage, "assessment");
      assert.equal(error.detail.kind, kind);
      return true;
    });
    assert.equal(calls, 1);
  }
  assert.deepEqual(safeFailureMetadata({name: secret, message: secret, status: secret}), {kind: "unknown"});
});

test("qualification honors explicit free OpenRouter and never falls back to Gemini", () => {
  const env = qualificationEnvironment({
    AGENT_FACTORY_PROVIDER: "openrouter", GEMINI_API_KEY: "gemini-fixture",
    OPENROUTER_API_KEY: "router-fixture", OPENROUTER_MODEL: "openrouter/free",
  });
  assert.equal(env.AGENT_FACTORY_PROVIDER, "openrouter");
  assert.equal(env.OPENROUTER_MODEL, "openrouter/free");
  assert.throws(() => qualificationEnvironment({
    AGENT_FACTORY_PROVIDER: "openrouter", GEMINI_API_KEY: "gemini-fixture",
  }), /key is missing/);
  assert.throws(() => qualificationEnvironment({
    AGENT_FACTORY_PROVIDER: "openrouter", OPENROUTER_API_KEY: "router-fixture",
    OPENROUTER_MODEL: "vendor/paid-model",
  }), /Paid routes are disabled/);
  assert.throws(() => qualificationEnvironment({
    AGENT_FACTORY_PROVIDER: "openai", OPENAI_API_KEY: "fixture",
  }), /only Gemini or free OpenRouter/);
  assert.equal(qualificationEnvironment({GEMINI_API_KEY: "fixture"}).AGENT_FACTORY_PROVIDER, "gemini");
});

test("pacing waits between cases without duplicating provider calls", async () => {
  const waits: number[] = [];
  const notices: number[] = [];
  const pace = createQualificationPacer(60000, async ms => { waits.push(ms); }, ms => notices.push(ms));
  let calls = 0;
  const result = await runQualification(async () => {
    await pace();
    calls++;
    return '{"ready":true,"findings":[]}';
  });
  assert.equal(calls, 16);
  assert.equal(waits.length, 15);
  assert.deepEqual(waits, Array(15).fill(60000));
  assert.deepEqual(notices, waits);
  assert.equal(result.passed, false); // Pacing cannot turn wrong answers green.
  assert.throws(() => createQualificationPacer(-1));
  assert.throws(() => createQualificationPacer(60001));
});
test("rate limit metadata remains safe and does not mistake unknown 429 for a daily cap", () => {
  const daily = safeFailureMetadata({status: 429, error: {metadata: {raw: "limit free-models-per-day; secret-value"}}});
  assert.equal(daily.limitKind, "daily-quota");
  const minute = safeFailureMetadata({status: 429, message: "limit free-models-per-min"});
  assert.equal(minute.limitKind, "per-minute");
  const upstream = safeFailureMetadata({status: 429, error: {metadata: {raw: "temporarily rate-limited upstream; secret-value"}}});
  assert.equal(upstream.limitKind, "upstream-capacity");
  assert.equal(safeFailureMetadata({status: 429}).limitKind, undefined);
  assert.ok(!JSON.stringify([daily, upstream]).includes("secret-value"));
  assert.equal(safeFailureMetadata({headers: new Headers({"retry-after":"60"})}).retryAfterSeconds, 60);
  assert.equal(safeFailureMetadata({headers: new Headers({"retry-after":"secret-value"})}).retryAfterSeconds, undefined);
});

test("deadline aborts a stalled request and prevents later qualification cases", async () => {
  let calls = 0;
  let aborted = false;
  let heartbeats = 0;
  await assert.rejects(runQualification(async () => {
    calls++;
    return withQualificationDeadline(signal => new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(signal.reason);
      }, {once: true});
    }), {timeoutMs: 50, heartbeatMs: 5, onProgress: () => { heartbeats++; }});
  }), (error: unknown) => {
    assert.ok(error instanceof QualificationFailure);
    assert.equal(error.caseId, "backend-a");
    assert.equal(error.detail.kind, "QualificationTimeoutError");
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(aborted, true);
  assert.ok(heartbeats > 0);
});
test("deadline returns successful responses and preserves immediate errors", async () => {
  assert.equal(await withQualificationDeadline(async signal => {
    assert.equal(signal.aborted, false);
    return "response";
  }, {timeoutMs: 50}), "response");
  const original = new Error("fixture failure");
  await assert.rejects(withQualificationDeadline(async () => { throw original; }), error => error === original);
  await assert.rejects(withQualificationDeadline(async () => "", {timeoutMs: 0}));
});
test("deadline stops a transport that ignores cancellation without starting another attempt", async () => {
  let calls = 0;
  await assert.rejects(withQualificationDeadline(async () => {
    calls++;
    return new Promise<string>(() => {});
  }, {timeoutMs: 10}), QualificationTimeoutError);
  assert.equal(calls, 1);
});

test("qualification tuning reaches the real SDK HTTP payload and stays scoped to Xing", async t => {
  setTracingDisabled(true);
  const bodies: Array<Record<string, unknown>> = [];
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    bodies.push(body);
    return new Response(JSON.stringify({
      id: "qualification-fixture", object: "chat.completion", created: 1, model: body.model,
      choices: [{index: 0, message: {role: "assistant", content: '{"ready":true,"findings":[]}'}, finish_reason: "stop"}],
      usage: {prompt_tokens: 10, completion_tokens: 10, total_tokens: 20},
    }), {status: 200, headers: {"content-type":"application/json"}});
  });
  const model = "xingchen-agi/xing4.0-29b-a4b:free";
  const provider = configureModelProvider({
    AGENT_FACTORY_PROVIDER: "openrouter", OPENROUTER_API_KEY: "offline-fixture",
    OPENROUTER_MODEL: model,
  });
  if (provider.provider !== "openrouter") throw new Error("Unexpected provider");
  const runner = new Runner({modelProvider: provider.modelProvider});
  const modelObject = await provider.modelProvider.getModel(model);
  const agent = new Agent({name: "Fixture", instructions: buildSpecialistInstructions("backend"), model: modelObject,
    modelSettings: qualificationModelSettings(provider.provider, model)});
  const response = await runner.run(agent, "Fixture only", {maxTurns: 1});
  assert.equal(parseAssessment(response.finalOutput).ready, true);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].max_tokens, 1024);
  assert.deepEqual(bodies[0].reasoning, {enabled: false});
  assert.equal(bodies[0].model, model);
  assert.ok((bodies[0].messages as Array<{content: unknown}>).some(message =>
    typeof message.content === "string" && message.content.includes(SPECIALIST_REVIEW_CONTRACT.trim())));
  assert.deepEqual(qualificationModelSettings("gemini", model), {});
  assert.deepEqual(qualificationModelSettings("openrouter", "vendor/other:free"), {});
});

test("shared specialist contract preserves domain skills and requires demonstrated blocker evidence", () => {
  for (const role of ["backend","database","frontend","dispatch","product","ux","legal","devops"] as const) {
    const instructions = buildSpecialistInstructions(role);
    assert.ok(instructions.startsWith(ROLE_SKILLS[role]));
    assert.ok(instructions.includes(SPECIALIST_REVIEW_CONTRACT));
    assert.ok(!instructions.includes("backend-b"));
    assert.ok(!instructions.includes("expectedReady"));
  }
});
test("single-case probes select existing fixtures without inventing cases or full qualification", () => {
  assert.equal(qualificationProbeCase(), undefined);
  for (const fixture of QUALIFICATION_CASES) assert.equal(qualificationProbeCase(fixture.id), fixture);
  assert.throws(() => qualificationProbeCase("unknown"), /Unknown/);
});
