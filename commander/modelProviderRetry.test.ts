import assert from "node:assert/strict";
import test from "node:test";
import { GEMINI_TRANSIENT_MAX_RETRIES, configureModelProvider, createGeminiRateLimitedFetch, isGeminiDailyQuotaExhausted } from "./modelProvider.js";

test("Gemini provider configures bounded HTTP retries", () => {
  assert.equal(GEMINI_TRANSIENT_MAX_RETRIES, 4);
  const result = configureModelProvider({
    AGENT_FACTORY_PROVIDER: "gemini",
    GEMINI_API_KEY: "test-key-not-real",
    GEMINI_MODEL: "gemini-3.5-flash",
  });
  assert.equal(result.provider, "gemini");
  assert.equal(result.model, "gemini-3.5-flash");
});

test("OpenAI provider selection remains independent", () => {
  const result = configureModelProvider({
    AGENT_FACTORY_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key-not-real",
    OPENAI_MODEL: "test-model",
  });
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "test-model");
});

import OpenAI from "openai";

test("Gemini-compatible HTTP client retries 503 at request boundary without replaying agent tools", async () => {
  let httpCalls = 0;
  let toolExecutions = 0;
  const fetchStub: typeof fetch = async () => {
    httpCalls++;
    if (httpCalls <= 2) {
      return new Response(JSON.stringify({ error: { message: "temporary overload" } }), {
        status: 503, headers: { "content-type": "application/json", "retry-after-ms": "0" },
      });
    }
    return new Response(JSON.stringify({
      id: "test-completion", object: "chat.completion", created: 1, model: "gemini-3.5-flash",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "OK" } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new OpenAI({
    apiKey: "test-key-not-real",
    baseURL: "https://example.invalid/v1beta/openai/",
    maxRetries: GEMINI_TRANSIENT_MAX_RETRIES,
    fetch: fetchStub,
  });
  const result = await client.chat.completions.create({
    model: "gemini-3.5-flash", messages: [{ role: "user", content: "test" }],
  });
  // HTTP retries occur before the agent runner sees a successful model response.
  // The test deliberately performs no agent tool action during those retries.
  assert.equal(result.choices[0]?.message.content, "OK");
  assert.equal(httpCalls, 3);
  assert.equal(toolExecutions, 0);
});

test("Gemini-compatible HTTP client does not retry authorization errors", async () => {
  let httpCalls = 0;
  const client = new OpenAI({
    apiKey: "test-key-not-real",
    baseURL: "https://example.invalid/v1beta/openai/",
    maxRetries: GEMINI_TRANSIENT_MAX_RETRIES,
    fetch: async () => {
      httpCalls++;
      return new Response(JSON.stringify({ error: { message: "unauthorized" } }), {
        status: 401, headers: { "content-type": "application/json" },
      });
    },
  });
  await assert.rejects(client.chat.completions.create({
    model: "gemini-3.5-flash", messages: [{ role: "user", content: "test" }],
  }), error => error instanceof OpenAI.APIError && error.status === 401);
  assert.equal(httpCalls, 1);
});

test("Gemini rate limiter serializes concurrent HTTP attempts", async () => {
  const starts: number[] = [];
  const fetchStub: typeof fetch = async () => {
    starts.push(Date.now());
    return new Response("ok", { status: 200 });
  };
  const limited = createGeminiRateLimitedFetch(fetchStub, 20);
  await Promise.all([limited("https://example.invalid"), limited("https://example.invalid"), limited("https://example.invalid")]);
  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= 15);
  assert.ok(starts[2] - starts[1] >= 15);
});

test("Gemini rate limiter preserves fetch failures and continues queue", async () => {
  let calls = 0;
  const limited = createGeminiRateLimitedFetch(async () => {
    if (++calls === 1) throw new Error("temporary network failure");
    return new Response("ok", { status: 200 });
  }, 0);
  await assert.rejects(limited("https://example.invalid"), /temporary network failure/);
  const response = await limited("https://example.invalid");
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test("Gemini daily quota error is detected without exposing provider payload", () => {
  assert.equal(isGeminiDailyQuotaExhausted('{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}'), true);
  assert.equal(isGeminiDailyQuotaExhausted('{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}'), false);
});

test("Gemini daily quota exhaustion stops without SDK retry", async () => {
  let attempts = 0;
  const fetchStub: typeof fetch = async () => {
    attempts++;
    return new Response(JSON.stringify({ error: {
      code: 429, status: "RESOURCE_EXHAUSTED",
      details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }],
    } }), { status: 429, headers: { "content-type": "application/json" } });
  };
  const client = new OpenAI({
    apiKey: "test-key-not-real", baseURL: "https://example.invalid/v1beta/openai/",
    maxRetries: GEMINI_TRANSIENT_MAX_RETRIES,
    fetch: createGeminiRateLimitedFetch(fetchStub, 0),
  });
  await assert.rejects(client.chat.completions.create({
    model: "gemini-3.5-flash", messages: [{ role: "user", content: "test" }],
  }), /Gemini daily request quota exhausted/);
  assert.equal(attempts, 1);
});

test("Gemini only signals upstream daily quota once and blocks further outbound calls", async () => {
  let calls = 0, notifications = 0;
  const wrapped = createGeminiRateLimitedFetch(async () => {
    calls++;
    return Response.json({ error: { details: [{ violations: [
      { quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" },
    ] }] } }, { status: 429 });
  }, 0, () => { notifications++; });
  assert.equal((await wrapped("https://example.invalid")).status, 403);
  assert.equal((await wrapped("https://example.invalid")).status, 403);
  assert.equal(calls, 1);
  assert.equal(notifications, 1);
});
test("Gemini ordinary HTTP errors never signal daily quota", async () => {
  let notifications = 0;
  const wrapped = createGeminiRateLimitedFetch(async () =>
    Response.json({ error: { message: "temporary" } }, { status: 503 }), 0,
    () => { notifications++; });
  assert.equal((await wrapped("https://example.invalid")).status, 503);
  assert.equal(notifications, 0);
});
