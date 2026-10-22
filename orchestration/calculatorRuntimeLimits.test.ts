import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGroqBudgetedFetch, createProviderContextBudget } from "../commander/providerContextBudget.js";
import { createTaskModelBudgetFetch } from "./taskModelBudget.js";
import { createCalculatorExecutionCheckpointStore, type CalculatorExecutionCheckpointPayload } from "./calculatorExecutionCheckpoint.js";
import { CALCULATOR_RUNTIME_ERROR, createCalculatorRuntimeRequestCheckpoint, prepareCalculatorRuntimeHostLimits,
  runCalculatorRuntime, type CalculatorRuntimeHostLimits } from "./calculatorRuntime.js";
import type { CalculatorPriorModelCharge } from "./calculatorModelTeam.js";

const limits = { maxRequests: 4, maxRunBytes: 96000, maxRepairs: 0 } as const;
const refusal = { message: CALCULATOR_RUNTIME_ERROR };

test("host execution limits accept only the reviewed lowering and refuse before any state claim", async t => {
  assert.equal(prepareCalculatorRuntimeHostLimits(undefined), undefined);
  assert.deepEqual(prepareCalculatorRuntimeHostLimits(limits), limits);
  assert.ok(Object.isFrozen(prepareCalculatorRuntimeHostLimits(limits)));
  const directory = mkdtempSync(join(tmpdir(), "calculator-limit-input-")), state = join(directory, "never-created");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const raw of [null, [], { ...limits, maxRequests: 5 }, { ...limits, maxRunBytes: 96001 },
    { ...limits, maxRepairs: 1 }, { maxRequests: 4, maxRepairs: 0 }, { ...limits, reset: true }]) {
    assert.throws(() => prepareCalculatorRuntimeHostLimits(raw), refusal);
    await assert.rejects(() => runCalculatorRuntime(undefined, undefined, state, "run", {}, raw as CalculatorRuntimeHostLimits), refusal);
    assert.equal(existsSync(state), false);
  }
  await assert.rejects(() => runCalculatorRuntime(undefined, undefined, state, "plan", {}, limits), refusal);
  assert.equal(existsSync(state), false);
});

test("the fifth reserved request is durably refused before actual HTTP without discarding its charge", async t => {
  const directory = mkdtempSync(join(tmpdir(), "calculator-limit-http-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createCalculatorExecutionCheckpointStore(directory, {
    repository: "erman-ksv/Onay-Factory-Calculator", goalId: "limited-run", taskId: "limited-task",
    ownerFingerprint: "a".repeat(64), planFingerprint: "b".repeat(64), branch: "feat/calculator-agent/limited-run",
    baseSha: "c".repeat(40), bootstrapSha: "c".repeat(40), runtimeConfigDigest: "d".repeat(64),
  });
  t.after(() => store.close());
  const context = createProviderContextBudget({ now: () => 0, reservedOutputTokens: 1200 });
  let httpRequests = 0, persisted = 0;
  const gate = createCalculatorRuntimeRequestCheckpoint(limits, (charge, admitted) => {
    const payload: CalculatorExecutionCheckpointPayload = { attempt: 1, stage: "bounded_request",
      status: admitted ? "running" : "blocked", modelState: charge, httpInFlight: admitted,
      publicationStarted: false, assessments: [] };
    store.save(payload); persisted++;
    assert.equal(httpRequests, Math.min(4, charge.attemptedRequests - 1));
  });
  const budget = createTaskModelBudgetFetch({ now: () => 0 }, async () => {
    const task = budget.snapshot();
    await gate({ attemptedRequests: task.attemptedRequests, totalRequestBytes: task.totalRequestBytes,
      elapsedMs: task.elapsedMs, reservedRunTokens: context.snapshot().reservedRunTokens });
    httpRequests++; return Response.json({ ok: true });
  });
  const request = createGroqBudgetedFetch(context, budget.fetch);
  const init = { method: "POST", body: JSON.stringify({ max_completion_tokens: 1200, messages: [{ role: "user", content: "Bounded fixture." }] }) };
  for (let number = 1; number <= 4; number++) {
    const response = await request("https://api.groq.com/openai/v1/chat/completions", init);
    assert.equal(response.status, 200); await response.json();
    // Successful bounded usage settlement frees TPM, never request/byte history.
    assert.equal(context.settleUsage(number, 1, 1), true);
  }
  const refused = await request("https://api.groq.com/openai/v1/chat/completions", init);
  assert.equal(refused.ok, false); await refused.text();
  assert.equal(httpRequests, 4); assert.equal(persisted, 5);
  const final = store.read()!;
  assert.equal(final.status, "blocked"); assert.equal(final.httpInFlight, false);
  assert.equal(final.modelState.attemptedRequests, 5);
  assert.equal(final.modelState.totalRequestBytes, budget.snapshot().totalRequestBytes);
  assert.ok(final.modelState.reservedRunTokens > 1200);
  await request("https://api.groq.com/openai/v1/chat/completions", init);
  assert.equal(httpRequests, 4); assert.equal(persisted, 5);
});

test("byte overage is preserved as a local refusal and a caught gate cannot be reopened", async () => {
  const charges: Array<{ charge: CalculatorPriorModelCharge; admitted: boolean }> = [];
  const gate = createCalculatorRuntimeRequestCheckpoint(limits, (charge, admitted) => { charges.push({ charge, admitted }); });
  const overage = { attemptedRequests: 4, totalRequestBytes: 96001, reservedRunTokens: 9000, elapsedMs: 1000 };
  await assert.rejects(() => gate(overage), refusal);
  assert.deepEqual(charges, [{ charge: overage, admitted: false }]);
  await assert.rejects(() => gate({ ...overage, totalRequestBytes: 96000 }), refusal);
  assert.equal(charges.length, 1);
});

test("checkpoint persistence failure is terminal before a bounded request can be admitted", async () => {
  let saves = 0;
  const gate = createCalculatorRuntimeRequestCheckpoint(limits, async () => { saves++; throw Error("PRIVATE_FAILURE"); });
  const charge = { attemptedRequests: 1, totalRequestBytes: 100, reservedRunTokens: 1500, elapsedMs: 1 };
  await assert.rejects(() => gate(charge), refusal);
  await assert.rejects(() => gate(charge), refusal);
  assert.equal(saves, 1);
});
