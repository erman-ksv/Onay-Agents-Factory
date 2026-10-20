import test from "node:test";
import assert from "node:assert/strict";
import { createProviderContextBudget, createGroqBudgetedFetch } from "../commander/providerContextBudget.js";
import { createTaskModelBudgetFetch } from "./taskModelBudget.js";
import { createCalculatorGroqPacer } from "./calculatorGroqPacing.js";

const body = JSON.stringify({ max_completion_tokens: 1200, messages: [{ role: "user", content: "x".repeat(3000) }] });
test("admission is read-only and accounting settles successful usage once", () => {
  let now = 0;
  const context = createProviderContextBudget({ reservedOutputTokens: 1200, now: () => now });
  assert.equal(context.reserve(2800, 1200), undefined);
  const before = context.snapshot();
  assert.deepEqual(context.preview(2000, 1200), { status: "wait", waitMs: 60000 });
  assert.deepEqual(context.snapshot(), before); assert.equal(context.failure, undefined);
  assert.equal(context.settleUsage(1, 5000, 20), false);
  assert.equal(context.settleUsage(1, 1000, 1201), false);
  assert.equal(context.settleUsage(1, 1000, 100), true);
  assert.equal(context.settleUsage(1, 1, 0), false);
  assert.equal(context.snapshot().reservedRunTokens, 1100); assert.equal(context.snapshot().attemptedRequests, 1);
  assert.equal(context.preview(2000, 1200).status, "ready");
  now = 60000;
  assert.equal(context.snapshot().reservedWindowTokens, 0); assert.equal(context.snapshot().reservedRunTokens, 1100);
});
test("pacing waits in bounded chunks before the sole new transport request", async () => {
  let now = 0, calls = 0; const waits: number[] = [];
  const context = createProviderContextBudget({ reservedOutputTokens: 1200, now: () => now });
  context.reserve(2800, 1200);
  const task = createTaskModelBudgetFetch({ now: () => now }, async () => { calls++; return Response.json({}); });
  const pace = createCalculatorGroqPacer(context, task, { now: () => now, wait: async milliseconds => { waits.push(milliseconds); now += milliseconds; } });
  await pace(body);
  assert.deepEqual(waits, [15000, 15000, 15000, 15000]); assert.equal(calls, 0);
  assert.equal(context.snapshot().attemptedRequests, 1);
  const fetch = createGroqBudgetedFetch(context, task.fetch);
  await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", body });
  assert.equal(calls, 1); assert.equal(context.snapshot().attemptedRequests, 2);
});
test("deadline refuses a wait that cannot finish; no request and no quota reset", async () => {
  let now = 119000, calls = 0, waits = 0;
  const context = createProviderContextBudget({ reservedOutputTokens: 1200, now: () => now }); context.reserve(2800, 1200);
  const task = createTaskModelBudgetFetch({ now: () => 0 }, async () => { calls++; return Response.json({}); });
  const before = context.snapshot();
  const pace = createCalculatorGroqPacer(context, { get failure() { return task.failure; }, snapshot: () => ({ ...task.snapshot(), elapsedMs: now }) },
    { now: () => now, wait: async milliseconds => { waits++; now += milliseconds; } });
  await assert.rejects(() => pace(body)); assert.equal(calls, 0); assert.equal(waits, 0); assert.deepEqual(context.snapshot(), before);
});
test("cumulative and per-request overflows fail without waiting or transport", async () => {
  const context = createProviderContextBudget({ reservedOutputTokens: 1200, maxRunTokens: 6000, now: () => 0 }); context.reserve(3500, 1200);
  let calls = 0, waits = 0;
  const task = createTaskModelBudgetFetch({ now: () => 0 }, async () => { calls++; return Response.json({}); });
  const pace = createCalculatorGroqPacer(context, task, { now: () => 0, wait: async () => { waits++; } });
  await assert.rejects(() => pace(body));
  await assert.rejects(() => pace(JSON.stringify({ max_completion_tokens: 1200, content: "x".repeat(24001) })));
  assert.equal(calls, 0); assert.equal(waits, 0); assert.equal(context.snapshot().attemptedRequests, 1);
});
test("terminal guard failure cannot be discounted or reopened by admission", async () => {
  const context = createProviderContextBudget({ reservedOutputTokens: 1200, now: () => 0 }); context.reserve(1000, 1200);
  assert.equal(context.reserve(5000, 1200)?.code, "context_budget_exceeded");
  assert.equal(context.settleUsage(1, 100, 0), false); assert.equal(context.preview(1, 1).status, "refused");
  let waits = 0;
  const task = createTaskModelBudgetFetch({}, async () => Response.json({}));
  await assert.rejects(() => createCalculatorGroqPacer(context, task, { wait: async () => { waits++; } })(body));
  assert.equal(waits, 0); assert.equal(context.snapshot().attemptedRequests, 1);
});
test("a backwards host clock never manufactures a new quota window", async () => {
  let now = 1000;
  const context = createProviderContextBudget({ reservedOutputTokens: 1200, now: () => now }); context.reserve(2800, 1200);
  const task = createTaskModelBudgetFetch({ now: () => now }, async () => Response.json({}));
  const pace = createCalculatorGroqPacer(context, task, { now: () => now, wait: async () => { now--; } });
  await assert.rejects(() => pace(body)); assert.equal(context.snapshot().attemptedRequests, 1);
});
