import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALCULATOR_SUCCESSOR_TASK_BUDGET as preset, DEFAULT_TASK_MODEL_BUDGET, HARD_TASK_MODEL_BUDGET, createTaskModelBudgetFetch } from "./taskModelBudget.js";
import { createCalculatorGroqPacer } from "./calculatorGroqPacing.js";
import { createProviderContextBudget } from "../commander/providerContextBudget.js";
import { prepareCalculatorRuntimeHostLimits, runCalculatorRuntime } from "./calculatorRuntime.js";
import { createCalculatorModelTeam } from "./calculatorModelTeam.js";
const hostPreset = "calculator-successor-four-roles" as const;
const limits = { maxRequests: 4, maxRunBytes: 96000, maxRepairs: 0, hostPreset } as const;

test("successor deadline needs the exact host preset; original ceilings remain unchanged", () => {
  assert.equal(DEFAULT_TASK_MODEL_BUDGET.wallTimeMs, 120000);
  assert.equal(HARD_TASK_MODEL_BUDGET.wallTimeMs, 180000);
  assert.throws(() => createTaskModelBudgetFetch({ wallTimeMs: 300000 }));
  for (const key of Object.keys(preset) as (keyof typeof preset)[]) {
    assert.throws(() => createTaskModelBudgetFetch({ ...preset, hostPreset, [key]: preset[key] + 1 }));
    assert.throws(() => createTaskModelBudgetFetch({ ...preset, hostPreset, [key]: preset[key] - 1 }));
  }
  assert.throws(() => createTaskModelBudgetFetch({ hostPreset }));
});
test("successor can wait beyond the old deadline but still sends only four requests", async () => {
  let now = 0, calls = 0;
  const task = createTaskModelBudgetFetch({ ...preset, hostPreset, now: () => now }, async () => { calls++; return Response.json({}); });
  now = 150000;
  for (let i = 0; i < 4; i++) {
    const response = await task.fetch("https://model.invalid/v1/chat/completions", { method: "POST", body: JSON.stringify({ messages: [], max_completion_tokens: 1200 }) });
    assert.equal(response.status, 200); await response.text();
  }
  const refused = await task.fetch("https://model.invalid/v1/chat/completions", { method: "POST", body: "{}" });
  assert.equal(refused.status, 400); assert.equal(calls, 4); assert.equal(task.failure?.code, "request_limit");
});
test("successor stops at its own deadline without sending HTTP", async () => {
  let now = 0, calls = 0;
  const task = createTaskModelBudgetFetch({ ...preset, hostPreset, now: () => now }, async () => { calls++; return Response.json({}); });
  now = 300000;
  assert.equal((await task.fetch("https://model.invalid/", { method: "POST", body: "{}" })).status, 408);
  assert.equal(calls, 0);
});
test("Groq admission waits past two minutes only with the host successor preset", async () => {
  let now = 150000, waits = 0;
  const context = createProviderContextBudget({ now: () => now, reservedOutputTokens: 1200 }); context.reserve(2800, 1200);
  const task = createTaskModelBudgetFetch({ ...preset, hostPreset, now: () => 0 }, async () => Response.json({}));
  const timing = { now: () => now, wait: async (ms: number) => { now += ms; waits++; } };
  assert.throws(() => createCalculatorGroqPacer(context, task, timing, 300000));
  const clockedTask = { get failure() { return task.failure; }, snapshot: () => ({ ...task.snapshot(), elapsedMs: now }) };
  await createCalculatorGroqPacer(context, clockedTask, timing, 300000, hostPreset)(JSON.stringify({ max_completion_tokens: 1200, content: "x".repeat(3000) }));
  assert.equal(now, 210000); assert.equal(waits, 4); assert.equal(task.snapshot().attemptedRequests, 0);
});
test("runtime refuses the preset outside after-CI execution before state creation", async t => {
  assert.deepEqual(prepareCalculatorRuntimeHostLimits(limits), limits);
  for (const modified of [{ ...limits, hostPreset: "other" }, { ...limits, maxRequests: 5 }, { ...limits, maxRepairs: 1 }])
    assert.throws(() => prepareCalculatorRuntimeHostLimits(modified));
  const directory = mkdtempSync(join(tmpdir(), "successor-limit-")), state = join(directory, "no-state");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const mode of ["inspect", "plan", "run", "preflight"] as const) {
    await assert.rejects(() => runCalculatorRuntime(undefined, undefined, state, mode, {}, limits));
    assert.equal(existsSync(state), false);
  }
});
test("model team refuses applying successor allowance to a prior charged task or another provider", () => {
  const owner = { version: 1, id: "model-pilot", goal: "Create the agreed complete calculator website with arithmetic and browser acceptance tests.", baseRef: "feat/calculator-pilot-bootstrap", baseSha: "a".repeat(40), provider: "groq" };
  const env = { AGENT_FACTORY_TARGET_PROFILE: "calculator", AGENT_FACTORY_PROVIDER: "groq", GROQ_API_KEY: "fixture-key", CALCULATOR_MODEL_LIVE_APPROVED: "ONE_FREE_BOUNDED_RUN", ONAY_TEAM_FREE_TIER_CONFIRMED: "true", AGENT_FACTORY_LEGAL_ENABLED: "false" };
  assert.throws(() => createCalculatorModelTeam(owner, env, undefined, {}, { attemptedRequests: 1, totalRequestBytes: 1000, reservedRunTokens: 1000, elapsedMs: 1000 }, undefined, hostPreset));
  assert.throws(() => createCalculatorModelTeam({ ...owner, provider: "gemini" }, { ...env, AGENT_FACTORY_PROVIDER: "gemini", GEMINI_API_KEY: "fixture-key" }, undefined, {}, undefined, undefined, hostPreset));
});
