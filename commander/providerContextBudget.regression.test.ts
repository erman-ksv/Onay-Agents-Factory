import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { Agent, Runner, tool } from "@openai/agents";
import { z } from "zod";
import { configureModelProvider } from "./modelProvider.js";
import { generateChanges } from "../agents/backend/coder.js";
import {
  createGroqBudgetedFetch,
  createProviderContextBudget,
  extractProviderFailure,
  providerContextBudgetOptionsFromEnv,
  safeRetryAfter,
  type ProviderContextBudget,
} from "./providerContextBudget.js";

const endpoint = "https://example.invalid/chat/completions";
const body = JSON.stringify({ model: "fixture-model", messages: [{ role: "user", content: "small" }] });
const send = (fetcher: typeof fetch, requestBody = body) => fetcher(endpoint, {
  method: "POST", headers: { "content-type": "application/json" }, body: requestBody,
});
const problem = async (response: Response) => extractProviderFailure(await response.json());

test("Groq SDK failure preserves safe Retry-After and does not replay a successful tool", async () => {
  let httpCalls = 0;
  let toolCalls = 0;
  const budget = createProviderContextBudget({ maxTokensPerMinute: 20000 });
  const provider = configureModelProvider({ AGENT_FACTORY_PROVIDER: "groq", GROQ_API_KEY: "offline-fixture-key",
    GROQ_MODEL: "fixture-model" }, { contextBudget: budget, fetch: async () => {
    httpCalls++;
    if (httpCalls === 1) return new Response(JSON.stringify({ id: "fixture-completion", object: "chat.completion", created: 1,
      model: "fixture-model", choices: [{ index: 0, finish_reason: "tool_calls", message: {
        role: "assistant", content: null, tool_calls: [{ id: "fixture-call", type: "function",
          function: { name: "offline_tool", arguments: "{}" } }],
      } }] }), { headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ error: { message: "private-source-and-secret-marker" } }), {
      status: 429, headers: { "content-type": "application/json", "retry-after": "12", "x-request-id": "private-source-and-secret-marker" },
    });
  } });
  assert.equal(provider.provider, "groq");
  if (provider.provider !== "groq") return;
  assert.equal(provider.contextBudget, budget);
  const agent = new Agent({ name: "Offline budget fixture", model: "fixture-model", instructions: "Use the offline tool once.",
    tools: [tool({ name: "offline_tool", description: "Offline counter", parameters: z.object({}),
      execute: () => { toolCalls++; return "done"; } })] });
  const runner = new Runner({ modelProvider: provider.modelProvider });
  await assert.rejects(runner.run(agent, "small"), error => {
    assert.ok(error instanceof OpenAI.RateLimitError);
    const failure = extractProviderFailure(error);
    assert.equal(failure?.code, "rate_limited");
    assert.equal(failure?.retryAfter, "12");
    assert.equal((error.message + JSON.stringify(error) + JSON.stringify(failure)).includes("private-source-and-secret-marker"), false);
    return true;
  });
  assert.equal(httpCalls, 2);
  assert.equal(toolCalls, 1);
  assert.equal(budget.snapshot().attemptedRequests, 2);
});

test("Groq SDK Commander and Coder charge the same run budget before Coder transport", async () => {
  const env = { AGENT_FACTORY_PROVIDER: "groq", GROQ_API_KEY: "offline-fixture-key", GROQ_MODEL: "fixture-model" };
  const context = "Selected repository evidence only.";
  let httpCalls = 0;
  const transport: typeof fetch = async () => {
    httpCalls++;
    return new Response(JSON.stringify({ id: "fixture-completion", object: "chat.completion", created: 1,
      model: "fixture-model", choices: [{ index: 0, finish_reason: "stop", message: {
        role: "assistant", content: '{"summary":"offline fixture","files":[]}',
      } }] }), { headers: { "content-type": "application/json" } });
  };
  const runCommander = async (budget: ProviderContextBudget) => {
    const provider = configureModelProvider(env, { contextBudget: budget, fetch: transport });
    assert.equal(provider.provider, "groq");
    if (provider.provider !== "groq") throw new Error("Offline fixture provider is unavailable.");
    const runner = new Runner({ modelProvider: provider.modelProvider });
    return runner.run(new Agent({ name: "Offline Commander", model: "fixture-model", instructions: "Return a brief result." }), "small");
  };
  // Calibrate against the actual SDK envelope, without assuming its JSON layout.
  const probe = createProviderContextBudget({ maxRunTokens: 20000, maxTokensPerMinute: 20000, reservedOutputTokens: 128 });
  await runCommander(probe);
  const commanderTokens = probe.snapshot().reservedRunTokens;
  await generateChanges("small", context, env, { contextBudget: probe, fetch: transport });
  const combinedTokens = probe.snapshot().reservedRunTokens;
  const coderTokens = combinedTokens - commanderTokens;
  assert.ok(commanderTokens < combinedTokens - 1);
  assert.ok(coderTokens < combinedTokens - 1);

  const shared = createProviderContextBudget({ maxRunTokens: combinedTokens - 1,
    maxTokensPerMinute: 20000, reservedOutputTokens: 128 });
  await runCommander(shared);
  await assert.rejects(generateChanges("small", context, env, { contextBudget: shared, fetch: transport }), error => {
    assert.equal(extractProviderFailure(error)?.code, "run_budget_exceeded");
    return true;
  });
  assert.equal(shared.failure?.code, "run_budget_exceeded");
  assert.equal(shared.snapshot().attemptedRequests, 1);
  assert.equal(shared.snapshot().reservedRunTokens, commanderTokens);
  assert.equal(httpCalls, 3, "Calibration sends twice; the bounded run sends only Commander.");
});

test("Groq SDK does not retry transient or authorization HTTP failures", async t => {
  for (const status of [401, 408, 409, 503]) await t.test(String(status), async () => {
    let calls = 0;
    const provider = configureModelProvider({ AGENT_FACTORY_PROVIDER: "groq", GROQ_API_KEY: "offline-fixture-key",
      GROQ_MODEL: "fixture-model" }, { fetch: async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: "Offline provider fixture failure." } }), {
        status, headers: { "content-type": "application/json", "retry-after-ms": "0" },
      });
    } });
    assert.equal(provider.provider, "groq");
    if (provider.provider !== "groq") return;
    const runner = new Runner({ modelProvider: provider.modelProvider });
    await assert.rejects(runner.run(new Agent({ name: "Offline failure fixture", model: "fixture-model" }), "small"), error =>
      error instanceof OpenAI.APIError && error.status === status);
    assert.equal(calls, 1);
  });
});

test("Groq configuration validates locally without echoing supplied values; non-Groq is unchanged", () => {
  assert.deepEqual(providerContextBudgetOptionsFromEnv({ GROQ_CONTEXT_BUDGET_TOKENS: " 6000 ", GROQ_MAX_REQUEST_BYTES: "24000" }),
    { maxContextTokens: 6000, maxRequestBytes: 24000 });
  for (const value of ["secret-config-marker", "-1", "0", "1.5", "Infinity", "9007199254740992"]) {
    assert.throws(() => providerContextBudgetOptionsFromEnv({ GROQ_RUN_BUDGET_TOKENS: value }), error =>
      error instanceof Error && !error.message.includes(value));
  }
  const provider = configureModelProvider({ AGENT_FACTORY_PROVIDER: "openai", OPENAI_API_KEY: "offline-fixture-key",
    GROQ_CONTEXT_BUDGET_TOKENS: "invalid-unused-groq-setting" });
  assert.equal(provider.provider, "openai");
  assert.equal("contextBudget" in provider, false);
});
