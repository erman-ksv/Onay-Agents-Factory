import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CALCULATOR_ACCEPTANCE, calculatorPlanTaskId } from "./calculatorPlan.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { openCalculatorWorkspace } from "./calculatorWorkspace.js";
import type { CalculatorSnapshotReader, CalculatorTreeEntry } from "../github/calculatorSnapshot.js";
import { createCalculatorModelTeam } from "./calculatorModelTeam.js";
import { runCalculatorExecution, type CalculatorExecutionCheckpointEvent, type CalculatorExecutionTools } from "./calculatorExecution.js";
import { createCalculatorExecutionCheckpointStore, type CalculatorExecutionCheckpointPayload } from "./calculatorExecutionCheckpoint.js";

const A = "a".repeat(40), B = "b".repeat(40), D = "d".repeat(40);
const owner = { version: 1, id: "persistence-pilot", goal: "Create the agreed complete calculator website with module and browser tests.",
  baseRef: "feat/calculator-pilot-bootstrap", baseSha: A, provider: "gemini" };
const env = { AGENT_FACTORY_TARGET_PROFILE: "calculator", AGENT_FACTORY_PROVIDER: "gemini", GEMINI_API_KEY: "fixture-key",
  CALCULATOR_MODEL_LIVE_APPROVED: "ONE_FREE_BOUNDED_RUN", ONAY_TEAM_FREE_TIER_CONFIRMED: "true", AGENT_FACTORY_LEGAL_ENABLED: "false" };
const blob = (content: string) => createHash("sha1").update("blob " + Buffer.byteLength(content) + "\0" + content).digest("hex");

/** Actual executor, role preparation, task claims and private filesystem store.
 * Provider responses and publication/CI are bounded local fixtures, not live proof.
 */
async function fixture(config: { rejectFirstReview?: boolean } = {}) {
  const parent = mkdtempSync(join(tmpdir(), "calculator-persistence-"));
  mkdirSync(join(parent, "state"), { mode: 0o700 });
  const store = new CalculatorPlanStore(join(parent, "state"), owner), id = (n: number) => calculatorPlanTaskId(owner, n);
  const plan = store.initialize({ tasks: [
    { id: id(1), role: "coder", goal: "Implement arithmetic and module tests.", acceptanceIds: CALCULATOR_ACCEPTANCE.slice(0, 7).map(item => item.id),
      paths: ["src/calculator.mjs", "test/calculator.test.mjs"], dependsOn: [] },
    { id: id(2), role: "frontend", goal: "Implement responsive calculator controls.", acceptanceIds: CALCULATOR_ACCEPTANCE.slice(7).map(item => item.id),
      paths: ["index.html", "styles.css", "src/app.mjs"], dependsOn: [id(1)] },
    { id: id(3), role: "frontend", goal: "Test keyboard and button interaction.", acceptanceIds: ["keyboard"], paths: ["test/ui.test.mjs"], dependsOn: [id(2)] },
  ], blockers: [], unverifiedAreas: [] });
  const directory = join(parent, "execution-private"), privateStore = createCalculatorExecutionCheckpointStore(directory, {
    repository: plan.owner.repository, goalId: owner.id, ownerFingerprint: plan.owner.ownerFingerprint,
    planFingerprint: plan.fingerprint, taskId: id(1), branch: plan.branch, baseSha: A, bootstrapSha: A,
    runtimeConfigDigest: "e".repeat(64),
  });
  let head = A, generations = 0, publishes = 0, checks = 0, ciReads = 0;
  const requests: string[] = [], events: CalculatorExecutionCheckpointEvent[] = [];
  let beforeRole: ((role: string) => void) | undefined, beforeSave: ((event: CalculatorExecutionCheckpointEvent) => void) | undefined;
  let candidateTree: CalculatorTreeEntry[] = [];
  const reader: CalculatorSnapshotReader = {
    getHead: async () => head,
    readCommit: async sha => ({ sha, treeSha: sha, parents: sha === A ? [] : [A] }),
    readTree: async sha => ({ sha, truncated: false, tree: sha === A ? [] : candidateTree }),
    readBlob: async () => { throw new Error("fixture has no existing source"); },
  };
  const team = createCalculatorModelTeam(owner, env, async (_url, init) => {
    const body = JSON.parse(String(init?.body)), instructions: string = body.messages[0].content;
    const role = instructions.includes("You are the coder ") ? "coder" : instructions.includes("You are the reviewer ") ? "reviewer" :
      instructions.includes("You are the security ") ? "security" : "tester";
    beforeRole?.(role); requests.push(role);
    const fail = role === "reviewer" && config.rejectFirstReview && generations === 1;
    const output = role === "coder" ? { summary: "Implement scoped arithmetic and tests", changes: [
      { operation: "create", path: "src/calculator.mjs", content: "export const value = " + (++generations) + ";", message: "Add arithmetic" },
      { operation: "create", path: "test/calculator.test.mjs", content: "import test from 'node:test'; test('fixture', () => {});", message: "Add tests" },
    ] } : { ready: !fail, summary: fail ? "First proposal needs arithmetic correction." : "Shown changes are scoped; host tests remain required.",
      findings: fail ? [{ severity: "high", message: "First arithmetic proposal is incomplete.", evidenceRefs: [] }] : [],
      unverifiedAreas: ["Host runtime tests were not executed by this model."] };
    return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(output) } }] });
  });
  const tools: CalculatorExecutionTools = {
    checkProposal: async input => { checks++; return { repository: plan.owner.repository, taskId: input.task.id, baseSha: A,
      proposalDigest: input.proposalDigest, status: "passed", testsExecuted: true, failures: [] }; },
    publish: async input => {
      publishes++; candidateTree = [{ path: "src", sha: D, type: "tree", mode: "040000" }, { path: "test", sha: D, type: "tree", mode: "040000" },
        ...input.changes.files.map(file => ({ path: file.path, sha: blob(file.content), type: "blob", mode: "100644" }))];
      head = B; return { branch: plan.branch, headSha: B, number: 1, url: "https://github.com/" + plan.owner.repository + "/pull/1" };
    },
    ci: async () => {
      ciReads++; return { repository: plan.owner.repository, branch: plan.branch, candidateSha: B,
        runs: [{ id: 17, name: "Calculator task CI", status: "completed", conclusion: "success", head_sha: B, run_attempt: 1,
          html_url: "https://github.com/" + plan.owner.repository + "/actions/runs/17" }],
        jobs: [{ name: "Calculator task CI", status: "completed", conclusion: "success", run_id: 17, run_attempt: 1, head_sha: B,
          steps: ["Syntax", "Task tests"].map(name => ({ name, status: "completed", conclusion: "success" })) }] };
    },
  };
  const workspace = await openCalculatorWorkspace(store, reader, plan.branch, A);
  function checkpoint(event: CalculatorExecutionCheckpointEvent) {
    beforeSave?.(event);
    const { taskId: _taskId, ...payload } = event;
    privateStore.save({ ...payload, modelState: { attemptedRequests: requests.length, totalRequestBytes: requests.length * 100,
      reservedRunTokens: requests.length * 1000, elapsedMs: requests.length * 10 }, httpInFlight: false });
    events.push(structuredClone(event));
  }
  return { execution: "offline-test" as const, team, tools, workspace, plan, checkpoint, privateStore, directory, events, requests,
    setBeforeRole: (callback: typeof beforeRole) => { beforeRole = callback; },
    setBeforeSave: (callback: typeof beforeSave) => { beforeSave = callback; },
    counts: () => ({ generations, publishes, checks, ciReads }),
    receipt: () => { const receipt = store.taskReceipt(plan, plan.tasks[0]); try { return receipt.inspectExisting(); } finally { receipt.close(); } },
    cleanup: () => { privateStore.close(); rmSync(parent, { recursive: true, force: true }); } };
}

test("proposal and each specialist output are durable before the next role executes", async () => {
  const f = await fixture();
  try {
    f.setBeforeRole(role => {
      if (role === "coder") return;
      const saved = f.privateStore.read()!;
      assert.equal(saved.status, "running"); assert.equal(saved.stage, role + "_1");
      assert.equal(saved.proposal!.files[0].content, "export const value = 1;");
      assert.deepEqual(saved.assessments.map(value => value.role), role === "security" ? [] : role === "reviewer" ? ["security"] : ["security", "reviewer"]);
      const previous = role === "security" ? "generate_1" : role === "reviewer" ? "security_1" : "reviewer_1";
      assert.ok(f.events.some(event => event.stage === previous && event.status === "passed"));
    });
    const result = await runCalculatorExecution(f.workspace, f);
    assert.equal(result.status, "candidate-verified"); assert.equal(result.wholeAppCompleted, false);
    assert.deepEqual(f.requests, ["coder", "security", "reviewer", "tester"]);
    assert.deepEqual(f.privateStore.read()!.assessments.map(value => value.role), ["security", "reviewer", "tester"]);
    const metadata = JSON.stringify(f.privateStore.inspect());
    assert.equal(metadata.includes("export const value"), false); assert.equal(metadata.includes("Shown changes are scoped"), false);
    assert.equal(JSON.stringify(result).includes("export const"), false);
  } finally { f.cleanup(); }
});

test("Reviewer admission failure retains the proposal and Security result without replay", async () => {
  const f = await fixture();
  try {
    const assess = f.team.assess;
    f.team = Object.freeze({ ...f.team, assess: async (...args: Parameters<typeof assess>) => {
      if (args[0] === "reviewer") throw new Error("fixture admission refusal before provider transport");
      return assess(...args);
    } });
    const result = await runCalculatorExecution(f.workspace, f), saved = f.privateStore.read()!;
    assert.equal(result.status, "blocked"); assert.equal(saved.status, "blocked"); assert.equal(saved.stage, "reviewer_1");
    assert.equal(saved.proposal!.files[0].content, "export const value = 1;");
    assert.deepEqual(saved.assessments.map(value => value.role), ["security"]);
    assert.equal(saved.modelState.attemptedRequests, 2); assert.equal(f.receipt()!.status, "blocked");
    await runCalculatorExecution(f.workspace, f);
    assert.deepEqual(f.requests, ["coder", "security"]); assert.equal(f.counts().publishes, 0);
  } finally { f.cleanup(); }
});

test("a failed stage checkpoint stops before the next model and keeps the durable task barrier", async t => {
  for (const stage of ["load_current_source", "generate_1", "security_1"]) await t.test(stage, async () => {
    const f = await fixture();
    try {
      f.setBeforeSave(event => {
        if (event.stage === stage && event.status === (stage === "load_current_source" ? "running" : "passed"))
          throw new Error("fixture checkpoint write failed");
      });
      const result = await runCalculatorExecution(f.workspace, f);
      assert.equal(result.status, "blocked"); assert.equal(f.receipt()!.status, "blocked");
      assert.deepEqual(f.requests, stage === "load_current_source" ? [] : stage === "generate_1" ? ["coder"] : ["coder", "security"]);
      assert.equal(f.counts().publishes, 0); assert.equal(f.counts().checks, 0);
      const count = f.requests.length; await runCalculatorExecution(f.workspace, f); assert.equal(f.requests.length, count);
    } finally { f.cleanup(); }
  });
});

test("publication write-ahead persistence is mandatory before the mutation callback", async () => {
  const f = await fixture();
  try {
    f.setBeforeSave(event => {
      if (event.stage === "publish_candidate" && event.publicationStarted && event.status === "running")
        throw new Error("fixture cannot persist publication boundary");
    });
    const result = await runCalculatorExecution(f.workspace, f);
    assert.notEqual(result.status, "candidate-verified"); assert.equal(f.counts().publishes, 0); assert.equal(f.counts().ciReads, 0);
    assert.equal(f.counts().checks, 1); assert.equal(f.privateStore.read()!.publicationStarted, true);
    await runCalculatorExecution(f.workspace, f); assert.equal(f.counts().publishes, 0);
  } finally { f.cleanup(); }
});

test("an actual private directory replacement stops before Reviewer and preserves the previous capsule", async () => {
  const f = await fixture(), moved = f.directory + "-original";
  try {
    f.setBeforeSave(event => {
      if (event.stage === "security_1" && event.status === "passed") {
        renameSync(f.directory, moved); mkdirSync(f.directory, { mode: 0o700 });
      }
    });
    const result = await runCalculatorExecution(f.workspace, f);
    assert.equal(result.status, "blocked"); assert.equal(f.receipt()!.status, "blocked");
    assert.deepEqual(f.requests, ["coder", "security"]); assert.equal(f.counts().publishes, 0);
    const previous = JSON.parse(readFileSync(join(moved, f.plan.tasks[0].id + ".execution.json"), "utf8")).payload;
    assert.equal(previous.stage, "security_1"); assert.equal(previous.status, "running");
    assert.equal(previous.proposal.files[0].content, "export const value = 1;"); assert.deepEqual(previous.assessments, []);
    assert.throws(() => f.privateStore.inspect());
    await runCalculatorExecution(f.workspace, f); assert.deepEqual(f.requests, ["coder", "security"]);
  } finally { f.cleanup(); }
});

test("malformed specialist output is blocked before a passed assessment checkpoint", async () => {
  const f = await fixture();
  try {
    const assess = f.team.assess;
    f.team = Object.freeze({ ...f.team, assess: async (...args: Parameters<typeof assess>) => {
      const value = await assess(...args); return { ...value, testsExecuted: true as unknown as false };
    } });
    const result = await runCalculatorExecution(f.workspace, f);
    assert.equal(result.status, "blocked"); assert.equal(f.privateStore.read()!.assessments.length, 0);
    assert.equal(f.events.some(event => event.stage === "security_1" && event.status === "passed"), false);
    assert.deepEqual(f.requests, ["coder", "security"]); assert.equal(f.counts().publishes, 0);
  } finally { f.cleanup(); }
});

test("uncertain publication retains the write-ahead flag and cannot publish twice", async () => {
  const f = await fixture();
  try {
    let mutations = 0;
    f.tools.publish = async () => { mutations++; throw new Error("fixture transport result unknown"); };
    const result = await runCalculatorExecution(f.workspace, f);
    assert.equal(result.status, "needs-review"); assert.equal(f.privateStore.read()!.publicationStarted, true);
    assert.equal(f.privateStore.read()!.status, "blocked");
    assert.deepEqual(f.privateStore.read()!.assessments.map(value => value.role), ["security", "reviewer", "tester"]);
    await runCalculatorExecution(f.workspace, f); assert.equal(mutations, 1);
  } finally { f.cleanup(); }
});

test("bounded repair preserves the first proposal and review findings in private history", async () => {
  const f = await fixture({ rejectFirstReview: true });
  try {
    const result = await runCalculatorExecution(f.workspace, f);
    assert.equal(result.status, "candidate-verified", JSON.stringify({ result, events: f.events.map(({stage,status}) => ({stage,status})), diagnostic: f.team.diagnostic() }));
    assert.equal(result.repairs, 1); assert.equal(result.attempts, 2);
    assert.equal(f.privateStore.read()!.attempt, 2); assert.equal(f.privateStore.read()!.proposal!.files[0].content, "export const value = 2;");
    assert.deepEqual(f.privateStore.read()!.assessments.map(value => value.role), ["security", "reviewer", "tester"]);
    assert.ok(f.events.some(event => event.attempt === 2 && event.stage === "repair_2" && event.status === "running" &&
      event.proposal!.files[0].content === "export const value = 1;"));
    assert.ok(f.events.some(event => event.attempt === 2 && event.stage === "repair_2" && event.status === "passed" &&
      event.proposal!.files[0].content === "export const value = 2;" && event.assessments.length === 0));
    // Private history is intentionally inspected only by this trusted host test.
    const capsule = JSON.parse(readFileSync(join(f.directory, f.plan.tasks[0].id + ".execution.json"), "utf8")) as {
      history: Array<{ payload: CalculatorExecutionCheckpointPayload }>;
    };
    assert.ok(capsule.history.some(({ payload }) => payload.attempt === 1 && payload.proposal?.files[0].content === "export const value = 1;" &&
      payload.assessments.some(assessment => assessment.role === "reviewer" &&
        assessment.findings.some(finding => finding.message === "First arithmetic proposal is incomplete."))));
    assert.equal(f.privateStore.inspect()!.modelState.attemptedRequests, 8);
  } finally { f.cleanup(); }
});
