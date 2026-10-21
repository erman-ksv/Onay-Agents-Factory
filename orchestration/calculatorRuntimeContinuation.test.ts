import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCalculatorSnapshot, type CalculatorSnapshot } from "../github/calculatorSnapshot.js";
import { prepareCalculatorRoleChanges } from "../commander/calculatorTeam.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { createCalculatorModelTeam } from "./calculatorModelTeam.js";
import { calculatorProposalDigest } from "./calculatorExecutionEvidence.js";
import { runCalculatorExecution, type CalculatorExecutionCheckpointEvent } from "./calculatorExecution.js";
import { openCalculatorWorkspace } from "./calculatorWorkspace.js";
import { CALCULATOR_RUNTIME_ERROR, createCalculatorRuntimeContinuationRestorer,
  createCalculatorRuntimeRequestCheckpoint } from "./calculatorRuntime.js";

const saved = JSON.parse(readFileSync(new URL("./fixtures/calculatorStep7SavedPlan.json", import.meta.url), "utf8"));
const env = { AGENT_FACTORY_TARGET_PROFILE: "calculator", AGENT_FACTORY_PROVIDER: "groq", GROQ_API_KEY: "fixture-key",
  CALCULATOR_MODEL_LIVE_APPROVED: "ONE_FREE_BOUNDED_RUN", ONAY_TEAM_FREE_TIER_CONFIRMED: "true", AGENT_FACTORY_LEGAL_ENABLED: "false" };
const refusal = { message: CALCULATOR_RUNTIME_ERROR };
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "calculator-runtime-restore-")), state = join(root, "state");
  mkdirSync(state, { mode: 0o700 });
  const store = new CalculatorPlanStore(state, saved.request), plan = store.initialize(saved.proposal), task = plan.tasks[0];
  const reader = { getHead: async () => plan.owner.baseSha,
    readCommit: async () => ({ sha: plan.owner.baseSha, treeSha: plan.owner.baseSha, parents: [] }),
    readTree: async () => ({ sha: plan.owner.baseSha, truncated: false, tree: [] }),
    readBlob: async () => { throw Error("unused"); } };
  const snapshot = await loadCalculatorSnapshot({ repository: plan.owner.repository, baseRef: plan.branch,
    baseSha: plan.owner.baseSha, changePaths: task.paths }, reader);
  const proposal = prepareCalculatorRoleChanges(task.role, { summary: "Scoped arithmetic and required tests", changes: [
    { operation: "create", path: "src/calculator.mjs", content: "export const answer = 42;", message: "Add scoped arithmetic" },
    { operation: "create", path: "test/calculator.test.mjs", content: "export const checks = true;", message: "Add required checks" },
  ] }, snapshot);
  return { root, store, plan, task, reader, snapshot, proposal,
    continuation: { proposal, proposalDigest: calculatorProposalDigest(proposal) },
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("runtime restoration accepts an equivalent reloaded plan, invokes no Coder and preserves three independent reviews", async () => {
  const f = await fixture();
  try {
    const roles: string[] = [], events: CalculatorExecutionCheckpointEvent[] = [], admitted: number[] = [];
    let now = 0, checks = 0, publishes = 0;
    const gate = createCalculatorRuntimeRequestCheckpoint({ maxRequests: 3, maxRunBytes: 72000, maxRepairs: 0 }, charge => {
      admitted.push(charge.attemptedRequests);
    });
    const team = createCalculatorModelTeam(saved.request, env, async (_url, init) => {
      const instructions = JSON.parse(String(init?.body)).messages[0].content as string;
      const role = ["security", "reviewer", "tester"].find(value => instructions.includes("You are the " + value + " "));
      assert.ok(role); roles.push(role);
      return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        ready: true, summary: "Shown proposal is scoped; actual tests remain unverified.", findings: [], unverifiedAreas: [] }) } }],
      usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } });
    }, { now: () => now, wait: async milliseconds => { now += milliseconds; } }, undefined, { beforeRequest: gate });
    const restore = createCalculatorRuntimeContinuationRestorer(f.continuation, f.plan, team);
    const workspace = await openCalculatorWorkspace(f.store, f.reader, f.plan.branch, f.plan.owner.baseSha);
    // The workspace reconstructs its own plan. Object identity must not be an authorization check.
    assert.notEqual(f.store.inspect(), f.plan);
    const report = await runCalculatorExecution(workspace, { team, maxRepairs: 0, execution: "offline-test", restoreProposal: restore,
      checkpoint: event => { events.push(event); }, tools: {
        checkProposal: async () => { checks++; throw Error("Host tests intentionally unavailable in this fixture."); },
        publish: async () => { publishes++; throw Error("Must not publish without tests."); }, ci: async () => { throw Error("Unused CI."); },
      } });
    assert.equal(report.status, "blocked"); assert.equal(report.repairs, 0); assert.equal(checks, 1); assert.equal(publishes, 0);
    assert.deepEqual(roles, ["security", "reviewer", "tester"]); assert.deepEqual(admitted, [1, 2, 3]);
    assert.equal(team.snapshot().generatedTasks, 0); assert.equal(team.snapshot().restoredTasks, 1);
    assert.equal(team.checkpointCharge()!.attemptedRequests, 3);
    assert.ok(events.some(event => event.stage === "restore_proposal_1" && event.status === "passed"));
    assert.ok(!events.some(event => event.stage === "generate_1"));
    assert.deepEqual(events.at(-1)!.assessments.map(value => value.role), ["security", "reviewer", "tester"]);
    assert.equal(events.at(-1)!.publicationStarted, false);
    assert.throws(() => restore(f.plan, f.task.id, f.snapshot), refusal);
    await assert.rejects(() => team.generate(f.plan, f.task.id, f.snapshot));
    assert.deepEqual(roles, ["security", "reviewer", "tester"]);
  } finally { f.cleanup(); }
});

test("runtime restoration is restricted to one first task at the original base and cannot reopen after a refusal", async t => {
  const f = await fixture();
  try {
    for (const scenario of ["other-task", "fingerprint", "owner", "branch", "base", "snapshot-base", "snapshot-ref", "paths"]) await t.test(scenario, () => {
      let calls = 0;
      const restore = createCalculatorRuntimeContinuationRestorer(f.continuation, f.plan,
        { restoreProposal: () => { calls++; return f.proposal; } });
      const plan = scenario === "fingerprint" ? { ...f.plan, fingerprint: "b".repeat(64) } :
        scenario === "owner" ? { ...f.plan, owner: { ...f.plan.owner, ownerFingerprint: "b".repeat(64) } } :
        scenario === "branch" ? { ...f.plan, branch: "feat/calculator-agent/other" } :
        scenario === "base" ? { ...f.plan, owner: { ...f.plan.owner, baseSha: "b".repeat(40) } } : f.plan;
      const snapshot: CalculatorSnapshot = scenario === "snapshot-base" ? { ...f.snapshot, baseSha: "b".repeat(40) } :
        scenario === "snapshot-ref" ? { ...f.snapshot, baseRef: f.plan.owner.baseRef } :
        scenario === "paths" ? { ...f.snapshot, changePaths: [f.task.paths[0]!] } : f.snapshot;
      assert.throws(() => restore(plan, scenario === "other-task" ? f.plan.tasks[1]!.id : f.task.id, snapshot), refusal);
      assert.throws(() => restore(f.plan, f.task.id, f.snapshot), refusal); assert.equal(calls, 0);
    });
  } finally { f.cleanup(); }
});
