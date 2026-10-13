import assert from "node:assert/strict";
import test from "node:test";
import { setTracingDisabled } from "@openai/agents";
import { createCoderAgent, generateChanges } from "./coder.js";

setTracingDisabled(true);
const result = { summary: "Verified configuration", files: [{ path: "example.ts", content: "export const fixed = true;", message: "Fix example" }] };

test("Coder uses a fresh per-invocation provider and restores the native API after Gemini", async t => {
  const requests: Array<{ url: string; key: string; body: Record<string, unknown> }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ url, key: headers.get("authorization") ?? "", body });
    const output = JSON.stringify(result);
    const response = url.endsWith("/chat/completions") ? {
      id: "chat-test", object: "chat.completion", created: 1, model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: output }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    } : {
      id: "resp-test", object: "response", created_at: 1, status: "completed", model: body.model,
      output: [{ id: "msg-test", type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: output, annotations: [] }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2,
        input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
    };
    return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
  });

  assert.deepEqual(await generateChanges("Fix example", "example context", {
    AGENT_FACTORY_PROVIDER: "gemini", GEMINI_API_KEY: "gemini-test-key", GEMINI_MODEL: "gemini-test-model",
  }), result);
  assert.deepEqual(await generateChanges("Fix example", "example context", {
    AGENT_FACTORY_PROVIDER: "openai", OPENAI_API_KEY: "openai-test-key", OPENAI_MODEL: "openai-test-model",
    GEMINI_API_KEY: "unused-gemini-key",
  }), result);

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(requests[0].key, "Bearer gemini-test-key");
  assert.equal(requests[0].body.model, "gemini-test-model");
  assert.equal(requests[1].url, "https://api.openai.com/v1/responses");
  assert.equal(requests[1].key, "Bearer openai-test-key");
  assert.equal(requests[1].body.model, "openai-test-model");
});

test("Coder rejects a missing selected key before SDK execution, even after another provider was configured", async t => {
  createCoderAgent({ AGENT_FACTORY_PROVIDER: "gemini", GEMINI_API_KEY: "gemini-test-key" });
  let networkCalls = 0;
  t.mock.method(globalThis, "fetch", async () => { networkCalls++; throw new Error("Unexpected network request"); });
  await assert.rejects(generateChanges("Fix example", "context", {
    AGENT_FACTORY_PROVIDER: "openai", GEMINI_API_KEY: "another-gemini-key",
  }), /selected OpenAI provider requires OPENAI_API_KEY/);
  await assert.rejects(generateChanges("Fix example", "context", {
    AGENT_FACTORY_PROVIDER: "gemini", OPENAI_API_KEY: "openai-test-key",
  }), /selected Gemini provider requires GEMINI_API_KEY/);
  assert.equal(networkCalls, 0);
});

test("Coder resolves the runtime environment when the legacy two-argument call is made", async t => {
  const previous = {
    AGENT_FACTORY_PROVIDER: process.env.AGENT_FACTORY_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.AGENT_FACTORY_PROVIDER = "openai";
  delete process.env.OPENAI_API_KEY;
  process.env.GEMINI_API_KEY = "ambient-key-must-not-be-used";
  await assert.rejects(generateChanges("Fix example", "context"), /selected OpenAI provider requires OPENAI_API_KEY/);
});

test("Coder applies the optional OpenAI model without overriding the SDK default when absent", () => {
  assert.equal(createCoderAgent({ AGENT_FACTORY_PROVIDER: "openai", OPENAI_API_KEY: "test-key", OPENAI_MODEL: " selected-model " }).model, "selected-model");
  assert.notEqual(createCoderAgent({ AGENT_FACTORY_PROVIDER: "openai", OPENAI_API_KEY: "test-key", OPENAI_MODEL: " " }).model, "selected-model");
});
