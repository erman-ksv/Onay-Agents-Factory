import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CALCULATOR_ACCEPTANCE, calculatorPlanTaskId } from "./calculatorPlan.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { openCalculatorWorkspace } from "./calculatorWorkspace.js";
import { createCalculatorModelTeam, type CalculatorRejectedAssessment } from "./calculatorModelTeam.js";
import { runCalculatorExecution, type CalculatorExecutionCheckpointEvent } from "./calculatorExecution.js";
import { createCalculatorExecutionCheckpointStore, type CalculatorExecutionCheckpointPayload, type CalculatorExecutionCheckpointIdentity } from "./calculatorExecutionCheckpoint.js";
import { calculatorProposalDigest } from "./calculatorExecutionEvidence.js";
import { CALCULATOR_RUNTIME_ERROR, createCalculatorRuntimeAssessmentRejection, type CalculatorRuntimeAssessmentContext } from "./calculatorRuntime.js";

const A = "a".repeat(40), B = "b".repeat(40);
const roles = ["security", "reviewer", "tester"] as const;
const owner = { version: 1, id: "rejection-runtime", goal: "Create the complete agreed calculator with independent tests and keyboard support.",
  baseRef: "feat/calculator-pilot-bootstrap", baseSha: A, provider: "groq" };
const env = { AGENT_FACTORY_TARGET_PROFILE: "calculator", AGENT_FACTORY_PROVIDER: "groq", GROQ_API_KEY: "fixture-key",
  CALCULATOR_MODEL_LIVE_APPROVED: "ONE_FREE_BOUNDED_RUN", ONAY_TEAM_FREE_TIER_CONFIRMED: "true", AGENT_FACTORY_LEGAL_ENABLED: "false" };
const rejectedResult = { ready: true, summary: "PRIVATE_REJECTED_RESULT_MARKER", findings: [],
  unverifiedAreas: Array.from({ length: 9 }, (_, index) => "Unknown shown area " + index) };

async function fixture(options: { role?: typeof roles[number]; writerFailure?: boolean; checkpointFailure?: boolean; missingContext?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "calculator-rejection-runtime-")), directory = join(root, "private");
  mkdirSync(directory, { mode: 0o700 }); mkdirSync(join(root, "state"), { mode: 0o700 });
  const store = new CalculatorPlanStore(join(root, "state"), owner);
  const id = (number: number) => calculatorPlanTaskId(owner, number);
  const plan = store.initialize({ tasks: [
    { id: id(1), role: "coder", goal: "Implement arithmetic and module tests.", acceptanceIds: CALCULATOR_ACCEPTANCE.slice(0, 7).map(item => item.id),
      paths: ["src/calculator.mjs", "test/calculator.test.mjs"], dependsOn: [] },
    { id: id(2), role: "frontend", goal: "Implement responsive keyboard controls.", acceptanceIds: CALCULATOR_ACCEPTANCE.slice(7).map(item => item.id),
      paths: ["index.html", "styles.css", "src/app.mjs"], dependsOn: [id(1)] },
    { id: id(3), role: "frontend", goal: "Test keyboard and button behavior.", acceptanceIds: ["keyboard"], paths: ["test/ui.test.mjs"], dependsOn: [id(2)] },
  ], blockers: [], unverifiedAreas: [] });
  const identity: CalculatorExecutionCheckpointIdentity = { repository: plan.owner.repository, goalId: owner.id,
    ownerFingerprint: plan.owner.ownerFingerprint, planFingerprint: plan.fingerprint, taskId: id(1), branch: plan.branch,
    baseSha: A, bootstrapSha: A, runtimeConfigDigest: "c".repeat(64) };
  const writer = createCalculatorExecutionCheckpointStore(directory, identity), badRole = options.role ?? "tester";
  const fileName = id(1) + "-" + badRole + "-rejected.execution.json";
  if (options.writerFailure) writeFileSync(join(directory, fileName), "Earlier private evidence must stay unchanged.\n", { mode: 0o600 });
  let active: CalculatorExecutionCheckpointPayload = { attempt: 1, stage: "load_current_source", status: "running", assessments: [],
    modelState: { attemptedRequests: 0, totalRequestBytes: 0, reservedRunTokens: 0, elapsedMs: 0 }, httpInFlight: false, publicationStarted: false };
  let context: CalculatorRuntimeAssessmentContext | undefined, checks = 0, publishes = 0, returnedPersistence = 0;
  const requests: string[] = []; let now = 0;
  let team: ReturnType<typeof createCalculatorModelTeam>;
  const handler = createCalculatorRuntimeAssessmentRejection({ directory, context: () => options.missingContext ? undefined : context,
    charge: () => team.checkpointCharge()!, persistReturned: charge => {
      returnedPersistence++;
      if (options.checkpointFailure) throw new Error("PRIVATE_CHECKPOINT_FAILURE_BODY");
      writer.save({ ...active, status: "blocked", httpInFlight: false, modelState: charge });
      active = { ...active, status: "blocked", httpInFlight: false, modelState: charge };
    } });
  team = createCalculatorModelTeam(owner, env, async (_url, init) => {
    const instructions = JSON.parse(String(init?.body)).messages[0].content as string;
    const role = instructions.includes("You are the coder ") ? "coder" : roles.find(value => instructions.includes("You are the " + value + " "))!;
    requests.push(role);
    const result = role === "coder" ? { summary: "Implement scoped arithmetic and tests", changes: [
      { operation: "create", path: "src/calculator.mjs", content: "export const answer = 42;", message: "Add arithmetic" },
      { operation: "create", path: "test/calculator.test.mjs", content: "export const checks = true;", message: "Add checks" },
    ] } : role === badRole ? rejectedResult : { ready: true, summary: "The shown changes are scoped; host tests remain necessary.", findings: [], unverifiedAreas: [] };
    return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(result) } }],
      usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } });
  }, { now: () => now, wait: async milliseconds => { now += milliseconds; } }, undefined, { beforeRequest: charge => {
    writer.save({ ...active, modelState: charge, httpInFlight: true });
    active = { ...active, modelState: charge, httpInFlight: true };
    if (active.proposal) context = { identity, proposal: active.proposal, expectedRole: active.stage.split("_")[0] as typeof badRole,
      kind: "task", stage: active.stage, attempt: active.attempt, status: active.status, httpInFlight: true };
  }, afterAssessmentRejected: handler });
  const checkpoint = (event: CalculatorExecutionCheckpointEvent) => {
    active = { attempt: event.attempt, stage: event.stage, status: event.status, ...(event.proposal ? { proposal: event.proposal } : {}),
      assessments: event.assessments, modelState: team.checkpointCharge()!, publicationStarted: event.publicationStarted,
      httpInFlight: event.status === "passed" ? false : active.httpInFlight };
    writer.save(active);
  };
  const workspace = await openCalculatorWorkspace(store, { getHead: async () => A, readCommit: async () => ({ sha: A, treeSha: A, parents: [] }),
    readTree: async () => ({ sha: A, truncated: false, tree: [] }), readBlob: async () => { throw Error("unused"); } }, plan.branch, A);
  return { root, directory, fileName, identity, plan, team, writer, handler, requests,
    active: () => active, returnedPersistence: () => returnedPersistence, counts: () => ({ checks, publishes }),
    execute: () => runCalculatorExecution(workspace, { team, checkpoint, execution: "offline-test", maxRepairs: 0,
      tools: { checkProposal: async () => { checks++; throw Error("must not execute tests after invalid assessment"); },
        publish: async () => { publishes++; throw Error("must not publish"); }, ci: async () => { throw Error("must not read CI"); } } }),
    cleanup: () => { writer.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("actual model adapter, runtime hook and private writer retain invalid replies without passing a specialist", async t => {
  for (const [index, role] of roles.entries()) await t.test(role, async () => {
    const f = await fixture({ role });
    try {
      const result = await f.execute(), saved = f.writer.read()!, metadata = f.writer.inspect()!;
      assert.equal(result.status, "blocked"); assert.deepEqual(f.requests, ["coder", ...roles.slice(0, index + 1)]);
      assert.deepEqual(saved.assessments.map(value => value.role), roles.slice(0, index));
      assert.equal(saved.status, "blocked"); assert.equal(saved.httpInFlight, false);
      assert.equal(saved.modelState.attemptedRequests, index + 2); assert.equal(f.returnedPersistence(), 1);
      assert.deepEqual(f.counts(), { checks: 0, publishes: 0 });
      const evidence = JSON.parse(readFileSync(join(f.directory, f.fileName), "utf8"));
      assert.deepEqual(evidence.result, rejectedResult); assert.equal(evidence.validationCode, "unverified_areas_limit");
      assert.equal(evidence.identity.proposalDigest, calculatorProposalDigest(saved.proposal!));
      assert.equal(evidence.evidenceValidation, "unvalidated"); assert.equal(evidence.assessmentAccepted, false);
      assert.equal(evidence.resumeAuthorized, false); assert.equal(evidence.publicationAuthorized, false);
      assert.deepEqual(metadata.completedRoles, roles.slice(0, index));
      assert.equal(JSON.stringify(metadata).includes("PRIVATE_REJECTED_RESULT_MARKER"), false);
      assert.equal(f.team.diagnostic().reasonCode, "assessment_validation_failed");
      assert.equal(f.team.diagnostic().assessmentRole, role); assert.equal(f.team.diagnostic().validationCode, "unverified_areas_limit");
      await assert.rejects(() => f.team.assess(role, f.plan, f.identity.taskId, saved.proposal!));
      assert.equal(f.requests.length, index + 2);
    } finally { f.cleanup(); }
  });
});

test("forensic persistence failure is terminal and retains the prior HTTP uncertainty and assessment prefix", async () => {
  const f = await fixture({ writerFailure: true });
  try {
    assert.equal((await f.execute()).status, "blocked");
    assert.equal(f.team.diagnostic().reasonCode, "assessment_rejection_persistence_failed");
    assert.equal(f.returnedPersistence(), 0); assert.equal(f.writer.read()!.httpInFlight, true);
    assert.deepEqual(f.writer.read()!.assessments.map(value => value.role), ["security", "reviewer"]);
    assert.equal(readFileSync(join(f.directory, f.fileName), "utf8"), "Earlier private evidence must stay unchanged.\n");
    assert.deepEqual(f.requests, ["coder", "security", "reviewer", "tester"]); assert.deepEqual(f.counts(), { checks: 0, publishes: 0 });
  } finally { f.cleanup(); }
});

test("failure after private capture preserves the result but cannot falsely clear an unsaved checkpoint", async () => {
  const f = await fixture({ checkpointFailure: true });
  try {
    assert.equal((await f.execute()).status, "blocked"); assert.equal(f.returnedPersistence(), 1);
    assert.equal(f.team.diagnostic().reasonCode, "assessment_rejection_persistence_failed");
    assert.equal(f.writer.read()!.httpInFlight, true);
    assert.deepEqual(JSON.parse(readFileSync(join(f.directory, f.fileName), "utf8")).result, rejectedResult);
    assert.equal(JSON.stringify(f.team.diagnostic()).includes("PRIVATE_CHECKPOINT_FAILURE_BODY"), false);
    await assert.rejects(() => f.handler({ role: "tester", result: rejectedResult, validationCode: "unverified_areas_limit" }), { message: CALCULATOR_RUNTIME_ERROR });
    assert.equal(f.returnedPersistence(), 1);
  } finally { f.cleanup(); }
});

test("missing or mismatched trusted context never invents a private task binding", async () => {
  const f = await fixture({ missingContext: true });
  try {
    assert.equal((await f.execute()).status, "blocked"); assert.equal(f.returnedPersistence(), 0);
    assert.ok(!readdirSync(f.directory).includes(f.fileName)); assert.equal(f.writer.read()!.httpInFlight, true);
    assert.equal(f.team.diagnostic().reasonCode, "assessment_rejection_persistence_failed");
  } finally { f.cleanup(); }
});

test("dependency rejection keeps its budget-only checkpoint and binds forensic evidence to the observed task", async () => {
  const f = await fixture();
  try {
    await f.execute(); const proposal = f.writer.read()!.proposal!;
    const root = join(f.root, "dependency"); mkdirSync(root, { mode: 0o700 });
    const charge = { attemptedRequests: 3, totalRequestBytes: 3000, reservedRunTokens: 2000, elapsedMs: 20 };
    const runtimeIdentity = { ...f.identity, taskId: "runtime-dependency", baseSha: B };
    const writer = createCalculatorExecutionCheckpointStore(root, runtimeIdentity);
    const active: CalculatorExecutionCheckpointPayload = { attempt: 1, stage: "dependency_tester", status: "running", assessments: [],
      modelState: charge, httpInFlight: true, publicationStarted: false }; writer.save(active);
    try {
      const capture = createCalculatorRuntimeAssessmentRejection({ directory: root,
        context: () => ({ identity: { ...f.identity, baseSha: B }, proposal, expectedRole: "tester", kind: "dependency", stage: active.stage,
          attempt: 1, status: "running", httpInFlight: true }), charge: () => charge,
        persistReturned: state => { writer.save({ ...active, status: "blocked", httpInFlight: false, modelState: state }); } });
      await capture({ role: "tester", result: rejectedResult, validationCode: "unverified_areas_limit" });
      const saved = writer.read()!; assert.equal(saved.proposal, undefined); assert.deepEqual(saved.assessments, []);
      assert.equal(saved.httpInFlight, false); assert.equal(saved.status, "blocked");
      const record = JSON.parse(readFileSync(join(root, f.fileName), "utf8"));
      assert.equal(record.identity.taskId, f.identity.taskId); assert.equal(record.identity.baseSha, B);
      assert.equal(record.identity.proposalDigest, calculatorProposalDigest(proposal));
    } finally { writer.close(); }
  } finally { f.cleanup(); }
});
