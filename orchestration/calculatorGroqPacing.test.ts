import test from "node:test";
import assert from "node:assert/strict";
import { createProviderContextBudget, createGroqBudgetedFetch } from "../commander/providerContextBudget.js";
import { createTaskModelBudgetFetch } from "./taskModelBudget.js";
import { CalculatorModelAdmissionError, createCalculatorGroqPacer } from "./calculatorGroqPacing.js";

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

test("admission distinguishes context, cumulative, byte and invalid requests without source data", async t => {
  for (const kind of ["context", "run", "bytes", "json"] as const) await t.test(kind, async () => {
    const sentinel = "PRIVATE_SOURCE_SENTINEL";
    const context = createProviderContextBudget({ reservedOutputTokens: 1200, now: () => 0,
      ...(kind === "run" ? { maxRunTokens: 6000 } : {}) });
    if (kind === "run") context.reserve(3500, 1200);
    const task = createTaskModelBudgetFetch({ now: () => 0 }, async () => assert.fail("No HTTP is allowed"));
    const raw = kind === "json" ? sentinel : JSON.stringify({ max_completion_tokens: 1200,
      content: sentinel + "x".repeat(kind === "context" ? 14000 : kind === "bytes" ? 24001 : 3000) });
    const before = context.snapshot();
    await assert.rejects(() => createCalculatorGroqPacer(context, task, { now: () => 0 })(raw), error => {
      assert.ok(error instanceof CalculatorModelAdmissionError);
      assert.equal(error.diagnostic.code, { context: "context_budget_exceeded", run: "run_budget_exceeded",
        bytes: "request_bytes_exceeded", json: "invalid_budget_request" }[kind]);
      assert.equal(error.diagnostic.requestBytes, Buffer.byteLength(raw));
      assert.equal(error.diagnostic.reservedRunTokens, before.reservedRunTokens);
      assert.equal(error.diagnostic.remainingRunTokens, context.limits.maxRunTokens - before.reservedRunTokens);
      assert.equal(error.diagnostic.contextTokenLimit, 6000);
      assert.ok(!JSON.stringify(error.diagnostic).includes(sentinel));
      assert.ok(Object.isFrozen(error.diagnostic));
      return true;
    });
    assert.deepEqual(context.snapshot(), before);
    assert.equal(task.snapshot().attemptedRequests, 0);
  });
});

test("prior charge shortens the very same admission deadline without waiting or resetting quota", async () => {
  const context = createProviderContextBudget({ reservedOutputTokens: 1200, now: () => 0 });
  context.reserve(2800, 1200);
  const task = createTaskModelBudgetFetch({ wallTimeMs: 60000, now: () => 0 }, async () => assert.fail("No HTTP"));
  let waits = 0;
  const pace = createCalculatorGroqPacer(context, task, { now: () => 0, wait: async () => { waits++; } }, 60000);
  await assert.rejects(() => pace(body), error => {
    assert.ok(error instanceof CalculatorModelAdmissionError);
    assert.equal(error.diagnostic.code, "wait_exceeds_deadline");
    assert.equal(error.diagnostic.remainingTaskMs, 60000);
    assert.equal(error.diagnostic.waitMs, 60000);
    assert.equal(error.diagnostic.reservedWindowTokens, 4000);
    return true;
  });
  assert.equal(waits, 0); assert.equal(task.snapshot().attemptedRequests, 0);
});

test("spent task requests and run bytes cannot consume a TPM wait", async t => {
  for (const kind of ["requests", "bytes"] as const) await t.test(kind, async () => {
    const context = createProviderContextBudget({ reservedOutputTokens: 1200, now: () => 0 }); context.reserve(2800, 1200);
    const task = createTaskModelBudgetFetch({ now: () => 0 }, async () => assert.fail("No HTTP"));
    let waits = 0;
    await assert.rejects(() => createCalculatorGroqPacer(context, {
      get failure() { return task.failure; },
      snapshot: () => ({ ...task.snapshot(), ...(kind === "requests" ? { remainingRequests: 0 } : { remainingRunBytes: 1 }) }),
    }, { now: () => 0, wait: async () => { waits++; } })(body), error => {
      assert.ok(error instanceof CalculatorModelAdmissionError);
      assert.equal(error.diagnostic.code, kind === "requests" ? "task_request_limit" : "task_run_bytes_limit"); return true;
    });
    assert.equal(waits, 0); assert.equal(task.snapshot().attemptedRequests, 0);
  });
});

test("a failed host wait never copies its exception into admission diagnostics", async () => {
  const context = createProviderContextBudget({ reservedOutputTokens: 1200, now: () => 0 }); context.reserve(2800, 1200);
  const task = createTaskModelBudgetFetch({ now: () => 0 }, async () => assert.fail("No HTTP"));
  await assert.rejects(() => createCalculatorGroqPacer(context, task, { now: () => 0,
    wait: async () => { throw Error("PRIVATE_WAIT_SOURCE_AND_KEY"); } })(body), error => {
    assert.ok(error instanceof CalculatorModelAdmissionError); assert.equal(error.diagnostic.code, "wait_failed");
    assert.ok(!JSON.stringify(error.diagnostic).includes("PRIVATE_WAIT_SOURCE_AND_KEY")); return true;
  });
});
