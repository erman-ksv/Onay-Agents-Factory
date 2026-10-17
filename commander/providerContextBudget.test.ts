import assert from "node:assert/strict";
import test from "node:test";
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

test("Groq preflight includes reserved output in the context boundary", () => {
  const budget = createProviderContextBudget({ maxContextTokens: 1000, reservedOutputTokens: 400 });
  assert.equal(budget.reserve(600), undefined);
  assert.equal(budget.reserve(601)?.code, "context_budget_exceeded");
  assert.equal(budget.snapshot().attemptedRequests, 1);
  assert.equal(budget.snapshot().reservedRunTokens, 1000);
});

test("Groq rejects a 73k-byte request before any transport and does not retain source", async () => {
  let calls = 0;
  const budget = createProviderContextBudget();
  const guarded = createGroqBudgetedFetch(budget, async () => { calls++; return new Response("OK"); });
  const source = "source-private-marker:" + "x".repeat(73_000);
  const response = await send(guarded, JSON.stringify({ model: "fixture", messages: [{ role: "user", content: source }] }));
  assert.equal(response.status, 400);
  const failure = await problem(response);
  assert.equal(failure?.code, "request_bytes_exceeded");
  assert.ok((failure?.requestBytes ?? 0) > 73_000);
  assert.equal(JSON.stringify(failure).includes("source-private-marker"), false);
  assert.equal(calls, 0);
  assert.deepEqual(budget.snapshot(), { reservedRunTokens: 0, reservedWindowTokens: 0, attemptedRequests: 0 });
});

test("Groq counts instructions and tool schemas and rejects estimated context before transport", async () => {
  let calls = 0;
  const budget = createProviderContextBudget({ maxContextTokens: 1000, reservedOutputTokens: 200 });
  const guarded = createGroqBudgetedFetch(budget, async () => { calls++; return new Response("OK"); });
  const response = await send(guarded, JSON.stringify({ model: "fixture", messages: [{ role: "user", content: "small" }],
    tools: [{ type: "function", function: { name: "schema", description: "x".repeat(3000) } }] }));
  const failure = await problem(response);
  assert.equal(failure?.code, "context_budget_exceeded");
  assert.equal(failure?.reservedOutputTokens, 200);
  assert.ok((failure?.estimatedInputTokens ?? 0) > 1000);
  assert.equal(calls, 0);
});

test("Groq caps provider output and reserves the complete rewritten payload", async () => {
  const budget = createProviderContextBudget({ reservedOutputTokens: 100 });
  let actualBody = "";
  const guarded = createGroqBudgetedFetch(budget, async (_input, init) => {
    actualBody = String(init?.body);
    assert.equal(new Headers(init?.headers).has("content-length"), false);
    return new Response("OK");
  });
  const response = await guarded(endpoint, { method: "POST", headers: { "content-length": "99999" },
    body: JSON.stringify({ model: "fixture", messages: [], max_tokens: 9999, max_completion_tokens: 5000 }) });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(actualBody).max_completion_tokens, 100);
  assert.equal(Object.hasOwn(JSON.parse(actualBody), "max_tokens"), false);
  assert.equal(budget.snapshot().reservedRunTokens, Math.ceil(Buffer.byteLength(actualBody) / 3) + 256 + 100);
  await send(guarded, JSON.stringify({ model: "fixture", messages: [], max_tokens: 30 }));
  assert.equal(JSON.parse(actualBody).max_completion_tokens, 30);
});

test("Groq shared concurrent specialist transports cannot overspend the run budget", async () => {
  const budget = createProviderContextBudget({ maxContextTokens: 2000, maxRunTokens: 700,
    maxTokensPerMinute: 10000, reservedOutputTokens: 100 });
  let calls = 0;
  const transport: typeof fetch = async () => { calls++; return new Response("OK"); };
  const commander = createGroqBudgetedFetch(budget, transport);
  const specialist = createGroqBudgetedFetch(budget, transport);
  const results = await Promise.all([send(commander), send(specialist)]);
  assert.deepEqual(results.map(item => item.status), [200, 400]);
  assert.equal((await problem(results[1]))?.code, "run_budget_exceeded");
  assert.equal(calls, 1);
  assert.equal(budget.snapshot().attemptedRequests, 1);
});

test("Groq rolling TPM reservations expire but cumulative run spending does not", () => {
  let now = 0;
  const budget = createProviderContextBudget({ maxContextTokens: 1000, maxRunTokens: 700,
    maxTokensPerMinute: 500, reservedOutputTokens: 100, now: () => now });
  assert.equal(budget.reserve(100), undefined);
  assert.equal(budget.reserve(100), undefined);
  assert.equal(budget.snapshot().reservedWindowTokens, 400);
  now = 60_000;
  assert.equal(budget.reserve(100), undefined);
  assert.equal(budget.snapshot().reservedRunTokens, 600);
  assert.equal(budget.snapshot().reservedWindowTokens, 200);
  assert.equal(budget.reserve(100)?.code, "run_budget_exceeded");
});

test("Groq TPM rejection stops the run even after the window expires", () => {
  let now = 0;
  const budget = createProviderContextBudget({ maxTokensPerMinute: 1000, reservedOutputTokens: 100, now: () => now });
  assert.equal(budget.reserve(500), undefined);
  assert.equal(budget.reserve(500)?.code, "tpm_budget_exceeded");
  now = 60_000;
  assert.equal(budget.snapshot().reservedWindowTokens, 0);
  assert.equal(budget.reserve(1)?.code, "tpm_budget_exceeded");
  assert.equal(budget.snapshot().attemptedRequests, 1);
});

test("Groq malformed and multiple-completion payloads fail closed, while attempted HTTP failures retain spending", async () => {
  let calls = 0;
  const transport: typeof fetch = async () => { calls++; throw new Error("offline failure"); };
  for (const requestBody of ["not-json", "[]", JSON.stringify({ max_tokens: -1 }), JSON.stringify({ max_completion_tokens: "huge" }),
    JSON.stringify({ messages: [], n: 2 }), JSON.stringify({ messages: [], n: "1" })]) {
    const guarded = createGroqBudgetedFetch(createProviderContextBudget(), transport);
    assert.equal((await problem(await send(guarded, requestBody)))?.code, "invalid_budget_request");
  }
  assert.equal(calls, 0);
  const budget = createProviderContextBudget();
  const guarded = createGroqBudgetedFetch(budget, transport);
  await assert.rejects(send(guarded), /offline failure/);
  assert.equal(calls, 1);
  assert.equal(budget.snapshot().attemptedRequests, 1);
  assert.ok(budget.snapshot().reservedRunTokens > 0);
});

test("Groq Retry-After only preserves numeric and valid HTTP dates", () => {
  assert.equal(safeRetryAfter(" 15 "), "15");
  assert.equal(safeRetryAfter("0.5"), "0.5");
  assert.equal(safeRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT"), "Wed, 21 Oct 2015 07:28:00 GMT");
  for (const value of ["secret-provider-payload", "15\nsecret", "-2", "Infinity", "Wed, 99 Oct 2015 07:28:00 GMT"]) {
    assert.equal(safeRetryAfter(value), undefined);
  }
});

test("Groq HTTP 429 is sanitized without reading provider body or leaking headers", async () => {
  const raw = new Response("provider-source-secret", { status: 429,
    headers: { "retry-after": "9", "x-request-id": "source-private-marker" } });
  raw.text = async () => { throw new Error("must not read provider body"); };
  raw.json = async () => { throw new Error("must not parse provider body"); };
  raw.clone = () => { throw new Error("must not clone provider body"); };
  const budget = createProviderContextBudget();
  let calls = 0;
  const guarded = createGroqBudgetedFetch(budget, async () => { calls++; return raw; });
  const response = await send(guarded);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "9");
  assert.equal(response.headers.get("x-request-id"), null);
  const failure = await problem(response);
  assert.equal(failure?.code, "rate_limited");
  assert.equal(failure?.retryAfter, "9");
  assert.equal(failure?.retryable, false);
  assert.equal(JSON.stringify(failure).includes("secret"), false);
  assert.ok(budget.snapshot().reservedRunTokens > 0);
  const later = await send(createGroqBudgetedFetch(budget, async () => { calls++; return new Response("unexpected"); }));
  assert.equal(later.status, 429);
  assert.equal((await problem(later))?.retryAfter, "9");
  assert.equal(calls, 1);
  assert.equal(budget.failure?.code, "rate_limited");
});

test("Provider failure extraction ignores arbitrary provider messages and unknown metadata", () => {
  assert.equal(extractProviderFailure({ message: "raw-secret", error: { message: "raw-secret", code: "rate_limited" } }), undefined);
  const extracted = extractProviderFailure({ error: { providerFailure: { provider: "groq", code: "rate_limited",
    message: "raw-secret", retryAfter: "secret-header", source: "private-source", apiKey: "secret", requestedTokens: "secret" } } });
  assert.equal(extracted?.code, "rate_limited");
  assert.equal(extracted?.retryAfter, undefined);
  assert.equal(JSON.stringify(extracted).includes("secret"), false);
  assert.equal(JSON.stringify(extracted).includes("private-source"), false);
});
