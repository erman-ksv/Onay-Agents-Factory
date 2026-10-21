import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGroqBudgetedFetch, createProviderContextBudget } from "../commander/providerContextBudget.js";
import { createTaskModelBudgetFetch } from "./taskModelBudget.js";
import { createCalculatorExecutionCheckpointStore, type CalculatorExecutionCheckpointPayload } from "./calculatorExecutionCheckpoint.js";
import { CALCULATOR_RUNTIME_ERROR, createCalculatorRuntimeRequestCheckpoint, prepareCalculatorRuntimeHostLimits,
  prepareCalculatorRuntimeContinuation, runCalculatorRuntime, type CalculatorRuntimeHostLimits } from "./calculatorRuntime.js";
import type { CalculatorPriorModelCharge } from "./calculatorModelTeam.js";

const limits = { maxRequests: 4, maxRunBytes: 96000, maxRepairs: 0 } as const;
const continuationLimits = { maxRequests: 3, maxRunBytes: 72000, maxRepairs: 0 } as const;
const testerLimits = { maxRequests: 1, maxRunBytes: 24000, maxRepairs: 0 } as const;
const continuedProposal = { repository: "erman-ksv/Onay-Factory-Calculator", files: [{ path: "src/calculator.mjs", content: "export const value = 1;\n" }] };
const continuation = () => ({ proposal: structuredClone(continuedProposal), proposalDigest: "a".repeat(64) });
const restoredAssessment = (role: "security" | "reviewer") => ({ role, ready: true,
  summary: "Stored independent assessment of the exact proposal.", findings: [], unverifiedAreas: ["Host tests remain unverified."],
  testsExecuted: false, overallTaskCompletionVerified: false, publicationAuthorized: false });
const restoredPrefix = () => [restoredAssessment("security"), restoredAssessment("reviewer")];
const testerContinuation = () => ({ ...continuation(), restoredAssessments: restoredPrefix() });
const owner = { version: 1, id: "bounded-continuation", goal: "Create the complete agreed static calculator with independent tests and responsive layout.",
  baseRef: "feat/calculator-pilot-bootstrap", baseSha: "b".repeat(40), provider: "groq" };
const refusal = { message: CALCULATOR_RUNTIME_ERROR };

test("host execution limits accept only the reviewed lowering and refuse before any state claim", async t => {
  assert.equal(prepareCalculatorRuntimeHostLimits(undefined), undefined);
  assert.deepEqual(prepareCalculatorRuntimeHostLimits(limits), limits);
  assert.deepEqual(prepareCalculatorRuntimeHostLimits(continuationLimits), continuationLimits);
  assert.deepEqual(prepareCalculatorRuntimeHostLimits(testerLimits), testerLimits);
  assert.ok(Object.isFrozen(prepareCalculatorRuntimeHostLimits(limits)));
  assert.ok(Object.isFrozen(prepareCalculatorRuntimeHostLimits(continuationLimits)));
  assert.ok(Object.isFrozen(prepareCalculatorRuntimeHostLimits(testerLimits)));
  const directory = mkdtempSync(join(tmpdir(), "calculator-limit-input-")), state = join(directory, "never-created");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const raw of [null, [], { ...limits, maxRequests: 5 }, { ...limits, maxRunBytes: 96001 },
    { ...limits, maxRequests: 3 }, { ...limits, maxRunBytes: 72000 }, { ...continuationLimits, maxRequests: 2 },
    { ...testerLimits, maxRunBytes: 72000 }, { ...continuationLimits, maxRunBytes: 24000 }, { ...limits, maxRunBytes: 24000 },
    { ...limits, maxRepairs: 1 }, { maxRequests: 4, maxRepairs: 0 }, { ...limits, reset: true }]) {
    assert.throws(() => prepareCalculatorRuntimeHostLimits(raw), refusal);
    await assert.rejects(() => runCalculatorRuntime(undefined, undefined, state, "run", {}, raw as CalculatorRuntimeHostLimits), refusal);
    assert.equal(existsSync(state), false);
  }
  await assert.rejects(() => runCalculatorRuntime(undefined, undefined, state, "plan", {}, limits), refusal);
  assert.equal(existsSync(state), false);
});

test("the fifth, fourth or second reserved request is durably refused under the matching allowance before HTTP", async t => {
  for (const cap of [limits, continuationLimits, testerLimits]) await t.test("maxRequests=" + cap.maxRequests, async context => {
  const directory = mkdtempSync(join(tmpdir(), "calculator-limit-http-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createCalculatorExecutionCheckpointStore(directory, {
    repository: "erman-ksv/Onay-Factory-Calculator", goalId: "limited-run", taskId: "limited-task",
    ownerFingerprint: "a".repeat(64), planFingerprint: "b".repeat(64), branch: "feat/calculator-agent/limited-run",
    baseSha: "c".repeat(40), bootstrapSha: "c".repeat(40), runtimeConfigDigest: "d".repeat(64),
  });
  context.after(() => store.close());
  const provider = createProviderContextBudget({ now: () => 0, reservedOutputTokens: 1200 });
  let httpRequests = 0, persisted = 0;
  const gate = createCalculatorRuntimeRequestCheckpoint(cap, (charge, admitted) => {
    const payload: CalculatorExecutionCheckpointPayload = { attempt: 1, stage: "bounded_request",
      status: admitted ? "running" : "blocked", modelState: charge, httpInFlight: admitted,
      publicationStarted: false, assessments: [] };
    store.save(payload); persisted++;
    assert.equal(httpRequests, Math.min(cap.maxRequests, charge.attemptedRequests - 1));
  });
  const budget = createTaskModelBudgetFetch({ now: () => 0 }, async () => {
    const task = budget.snapshot();
    await gate({ attemptedRequests: task.attemptedRequests, totalRequestBytes: task.totalRequestBytes,
      elapsedMs: task.elapsedMs, reservedRunTokens: provider.snapshot().reservedRunTokens });
    httpRequests++; return Response.json({ ok: true });
  });
  const request = createGroqBudgetedFetch(provider, budget.fetch);
  const init = { method: "POST", body: JSON.stringify({ max_completion_tokens: 1200, messages: [{ role: "user", content: "Bounded fixture." }] }) };
  for (let number = 1; number <= cap.maxRequests; number++) {
    const response = await request("https://api.groq.com/openai/v1/chat/completions", init);
    assert.equal(response.status, 200); await response.json();
    // Successful bounded usage settlement frees TPM, never request/byte history.
    assert.equal(provider.settleUsage(number, 1, 1), true);
  }
  const refused = await request("https://api.groq.com/openai/v1/chat/completions", init);
  assert.equal(refused.ok, false); await refused.text();
  assert.equal(httpRequests, cap.maxRequests); assert.equal(persisted, cap.maxRequests + 1);
  const final = store.read()!;
  assert.equal(final.status, "blocked"); assert.equal(final.httpInFlight, false);
  assert.equal(final.modelState.attemptedRequests, cap.maxRequests + 1);
  assert.equal(final.modelState.totalRequestBytes, budget.snapshot().totalRequestBytes);
  assert.ok(final.modelState.reservedRunTokens > 1200);
  await request("https://api.groq.com/openai/v1/chat/completions", init);
  assert.equal(httpRequests, cap.maxRequests); assert.equal(persisted, cap.maxRequests + 1);
  });
});

test("continuation envelope is detached, deeply frozen and retains only explicit bounded JSON", () => {
  const input = continuation(), prepared = prepareCalculatorRuntimeContinuation(input);
  assert.deepEqual(prepared, input); assert.notEqual(prepared, input); assert.notEqual(prepared!.proposal, input.proposal);
  assert.ok(Object.isFrozen(prepared)); assert.ok(Object.isFrozen(prepared!.proposal));
  assert.ok(Object.isFrozen((prepared!.proposal as typeof continuedProposal).files));
  assert.ok(Object.isFrozen((prepared!.proposal as typeof continuedProposal).files[0]));
  input.proposal.files[0].content = "caller mutation";
  assert.equal((prepared!.proposal as typeof continuedProposal).files[0].content, continuedProposal.files[0].content);
  assert.equal(prepareCalculatorRuntimeContinuation(undefined), undefined);
});

test("restored Security and Reviewer assessments retain an exact detached frozen prefix", () => {
  const input = testerContinuation(), prepared = prepareCalculatorRuntimeContinuation(input)!;
  assert.deepEqual(prepared, input); assert.notEqual(prepared.restoredAssessments, input.restoredAssessments);
  assert.ok(Object.isFrozen(prepared.restoredAssessments));
  assert.ok(prepared.restoredAssessments!.every(Object.isFrozen));
  input.restoredAssessments[0].summary = "mutated caller text";
  assert.equal((prepared.restoredAssessments![0] as ReturnType<typeof restoredAssessment>).summary,
    "Stored independent assessment of the exact proposal.");
  const legacy = { ...continuation(), restoredAssessments: [] };
  assert.deepEqual(prepareCalculatorRuntimeContinuation(legacy), legacy);
  assert.ok(Object.isFrozen(prepareCalculatorRuntimeContinuation(legacy)!.restoredAssessments));
});

test("restored assessment shape rejects partial, extra, reordered and foreign role prefixes", () => {
  const prefix = restoredPrefix();
  for (const restoredAssessments of [null, {}, "stored", [prefix[0]], [...prefix, prefix[1]],
    [...prefix].reverse(), [prefix[0], prefix[0]], [{ ...prefix[0], role: "coder" }, prefix[1]],
    [null, prefix[1]], [prefix[0], { ready: true }]]) {
    assert.throws(() => prepareCalculatorRuntimeContinuation({ ...continuation(), restoredAssessments }), refusal);
  }
});

test("continuation rejects unknown keys, invalid digests, nonplain data, cycles and accessors without invoking them", () => {
  let accesses = 0;
  const accessor = Object.defineProperty({}, "proposal", { enumerable: true, get() { accesses++; return continuedProposal; } });
  Object.defineProperty(accessor, "proposalDigest", { enumerable: true, value: "a".repeat(64) });
  const nestedAccessor = Object.defineProperty({}, "private", { enumerable: true, get() { accesses++; return "data"; } });
  const cycle: { self?: unknown } = {}; cycle.self = cycle;
  const prototype = Object.create({ injected: true }); prototype.files = [];
  for (const raw of [null, [], "continue", { ...continuation(), ignored: true }, { proposal: continuedProposal },
    { ...continuation(), proposalDigest: "A".repeat(64) }, { ...continuation(), proposalDigest: "a".repeat(40) },
    accessor, ...[null, [], "not an object", new Date(), prototype, cycle, nestedAccessor, { invalid: undefined },
      { invalid: Infinity }, { execute: () => "data" }].map(proposal => ({ proposal, proposalDigest: "a".repeat(64) }))]) {
    assert.throws(() => prepareCalculatorRuntimeContinuation(raw), refusal);
  }
  assert.equal(accesses, 0);
});

test("continuation envelope uses a UTF-8 byte ceiling rather than a character ceiling", () => {
  for (const prefix of [undefined, restoredPrefix()]) {
  const empty = { proposal: { note: "" }, proposalDigest: "a".repeat(64),
    ...(prefix ? { restoredAssessments: prefix } : {}) };
  const base = Buffer.byteLength(JSON.stringify(empty));
  const available = 100000 - base;
  const note = "я".repeat(Math.floor(available / 2)) + "A".repeat(available % 2);
  const input = { ...empty, proposal: { note } };
  assert.equal(Buffer.byteLength(JSON.stringify(input)), 100000);
  const prepared = prepareCalculatorRuntimeContinuation(input);
  assert.equal((prepared!.proposal as { note: string }).note, note);
  assert.ok(Buffer.byteLength(JSON.stringify(prepared)) <= 100000);
  assert.throws(() => prepareCalculatorRuntimeContinuation({ ...input, proposal: { note: note + "я" } }), refusal);
  }
});

test("invalid continuation/allowance pairs and non-run modes refuse before creating state", async t => {
  const root = mkdtempSync(join(tmpdir(), "calculator-continuation-input-")), state = join(root, "never-created");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cases = [
    { cap: continuationLimits, proposal: undefined, mode: "run" },
    { cap: limits, proposal: continuation(), mode: "run" },
    { cap: undefined, proposal: continuation(), mode: "run" },
    { cap: continuationLimits, proposal: continuation(), mode: "plan" },
    { cap: continuationLimits, proposal: continuation(), mode: "inspect" },
    { cap: continuationLimits, proposal: continuation(), mode: "preflight" },
    { cap: continuationLimits, proposal: { ...continuation(), unknown: true }, mode: "run" },
    { cap: testerLimits, proposal: undefined, mode: "run" },
    { cap: testerLimits, proposal: continuation(), mode: "run" },
    { cap: testerLimits, proposal: { ...continuation(), restoredAssessments: [] }, mode: "run" },
    { cap: continuationLimits, proposal: testerContinuation(), mode: "run" },
    { cap: limits, proposal: testerContinuation(), mode: "run" },
    { cap: testerLimits, proposal: testerContinuation(), mode: "plan" },
    { cap: testerLimits, proposal: testerContinuation(), mode: "inspect" },
    { cap: testerLimits, proposal: testerContinuation(), mode: "preflight" },
    { cap: testerLimits, proposal: { ...continuation(), restoredAssessments: restoredPrefix().slice(0, 1) }, mode: "run" },
    { cap: testerLimits, proposal: { ...continuation(), restoredAssessments: [...restoredPrefix(), restoredAssessment("reviewer")] }, mode: "run" },
    { cap: testerLimits, proposal: { ...continuation(), restoredAssessments: restoredPrefix().reverse() }, mode: "run" },
    { cap: testerLimits, proposal: { ...continuation(), restoredAssessments: [{ ...restoredAssessment("security"), role: "coder" }, restoredAssessment("reviewer")] }, mode: "run" },
  ];
  for (const entry of cases) {
    await assert.rejects(() => runCalculatorRuntime(owner, undefined, state,
      entry.mode as "run", {}, entry.cap, entry.proposal), refusal);
    assert.equal(existsSync(state), false);
  }
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
