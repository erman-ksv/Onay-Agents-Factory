import assert from "node:assert/strict";
import test from "node:test";
import { createCloudflareCompatibleFetch, normalizeCloudflareChatPayload } from "./cloudflareCompatibility.js";
import { configureModelProvider } from "./modelProvider.js";
import { selectProviderConfig } from "./providerConfig.js";

const url = "https://api.cloudflare.com/client/v4/accounts/" + "a".repeat(32) + "/ai/v1/chat/completions";
const req = (fetcher: typeof fetch, payload: unknown, endpoint = url) => fetcher(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer offline" },
  body: JSON.stringify(payload),
});
const msg = (content: unknown = "hello") => ({ role: "user", content });

test("Cloudflare is explicit only and never inherits Groq, Gemini or other keys", () => {
  const env = { CLOUDFLARE_API_TOKEN: " offline-key ", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32) };
  assert.deepEqual(selectProviderConfig(env), { provider: "none" });
  assert.deepEqual(selectProviderConfig({ ...env, AGENT_FACTORY_PROVIDER: "groq" }), { provider: "none" });
  assert.deepEqual(selectProviderConfig({ ...env, AGENT_FACTORY_PROVIDER: "cloudflare" }), {
    provider: "cloudflare", apiKey: "offline-key",
    model: "@cf/zai-org/glm-4.7-flash",
    baseURL: "https://api.cloudflare.com/client/v4/accounts/" + "a".repeat(32) + "/ai/v1",
  });
  assert.deepEqual(selectProviderConfig({ AGENT_FACTORY_PROVIDER: "cloudflare", GEMINI_API_KEY: "something" }), { provider: "none" });
});

test("Cloudflare rejects invalid account IDs and unapproved models without echoing secrets", () => {
  for (const input of [
    { CLOUDFLARE_ACCOUNT_ID: "bad-secret", CLOUDFLARE_API_TOKEN: "offline-key" },
    { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_API_TOKEN: "offline-key", CLOUDFLARE_MODEL: "@cf/paid-secret-model" },
  ]) {
    assert.throws(() => selectProviderConfig({ AGENT_FACTORY_PROVIDER: "cloudflare", ...input }), error =>
      error instanceof Error && !error.message.includes("offline-key") && !error.message.includes("bad-secret") &&
      !error.message.includes("paid-secret-model"));
  }
});

test("normalizes SDK text arrays and developer instructions without changing tool calls", () => {
  const payload = normalizeCloudflareChatPayload({
    model: "@cf/zai-org/glm-4.7-flash", messages: [
      { role: "developer", content: [{ type: "text", text: "instructions" }] },
      { role: "user", content: [{ type: "text", text: "part one" }, { type: "text", text: "part two" }] },
      { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "test_onay", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call-1", content: "OK" },
    ],
    max_completion_tokens: 5000, tools: [{ type: "function", function: { name: "test_onay" } }],
  });
  assert.deepEqual((payload.messages as Array<Record<string, unknown>>).map(m => m.role),
    ["system", "user", "assistant", "tool"]);
  assert.equal((payload.messages as Array<Record<string, unknown>>)[1].content, "part one\npart two");
  assert.equal((payload.messages as Array<Record<string, unknown>>)[2].content, "");
  assert.equal((payload.messages as Array<Record<string, unknown>>)[3].tool_call_id, "call-1");
  assert.equal(payload.max_tokens, 1024);
  assert.equal(Object.hasOwn(payload, "max_completion_tokens"), false);
  assert.equal((payload.tools as unknown[]).length, 1);
});

test("rejects non-text multimodal parts and unsafe completion counts without network access", async () => {
  let calls = 0;
  const wrapped = createCloudflareCompatibleFetch(async () => { calls++; return new Response("unused"); });
  for (const payload of [
    { messages: [msg([{ type: "image_url", image_url: { url: "private" } }])] },
    { messages: [msg({ type: "text", text: "unsupported" })] },
    { messages: [msg("ok")], n: 2 },
    { messages: [] },
    { messages: [msg("ok")], max_tokens: -1 },
  ]) {
    assert.equal((await req(wrapped, payload)).status, 400);
  }
  assert.equal(calls, 0);
});

test("normalization keeps the original key and path, strips content-length, and caps output", async () => {
  let calls = 0;
  const wrapped = createCloudflareCompatibleFetch(async (input) => {
    calls++;
    const request = new Request(input);
    assert.equal(request.url, url);
    assert.equal(request.headers.get("authorization"), "Bearer offline");
    assert.equal(request.headers.get("content-length"), null);
    const payload = await request.json();
    assert.equal(payload.max_tokens, 4);
    assert.equal(payload.messages[0].content, "hello");
    return Response.json({ choices: [{ message: { role: "assistant", content: "OK" } }] });
  });
  const response = await req(wrapped, { model: "@cf/zai-org/glm-4.7-flash", messages: [msg()], max_tokens: 4 });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test("Cloudflare local quota limits requests, rejects extra requests without transport", async () => {
  let calls = 0;
  const wrapped = createCloudflareCompatibleFetch(async () => { calls++; return Response.json({ ok: true }); },
    { maxRequests: 2 });
  assert.equal((await req(wrapped, { messages: [msg()] })).status, 200);
  assert.equal((await req(wrapped, { messages: [msg()] })).status, 200);
  const stopped = await req(wrapped, { messages: [msg()] });
  assert.equal(stopped.status, 429);
  assert.equal(calls, 2);
});

test("Cloudflare provider 429 is sanitized and permanently stops the run", async () => {
  let calls = 0;
  const wrapped = createCloudflareCompatibleFetch(async () => {
    calls++;
    return new Response("provider-token-private", { status: 429, headers: { "x-secret": "provider-token-private" } });
  });
  const first = await req(wrapped, { messages: [msg()] });
  assert.equal(first.status, 429);
  assert.equal(first.headers.get("x-secret"), null);
  assert.equal((await first.text()).includes("private"), false);
  assert.equal((await req(wrapped, { messages: [msg()] })).status, 429);
  assert.equal(calls, 1);
});

test("Cloudflare byte cap and non-chat endpoints are rejected before transport", async () => {
  let calls = 0;
  const wrapped = createCloudflareCompatibleFetch(async () => { calls++; return new Response("unused"); },
    { maxRequestBytes: 60 });
  assert.equal((await req(wrapped, { messages: [msg()] }, url.replace("chat/completions", "responses"))).status, 400);
  assert.equal((await req(wrapped, { messages: [msg("x".repeat(300))] })).status, 400);
  assert.equal(calls, 0);
});

test("Cloudflare provider uses OpenAI-compatible Chat Completions, without retries", () => {
  const env = {
    AGENT_FACTORY_PROVIDER: "cloudflare", CLOUDFLARE_API_TOKEN: "offline", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  };
  const configured = configureModelProvider(env as NodeJS.ProcessEnv, { fetch: async () => Response.json({ ok: true }) });
  assert.equal(configured.provider, "cloudflare");
  if (configured.provider !== "cloudflare") return;
  assert.equal(configured.model, "@cf/zai-org/glm-4.7-flash");
});
