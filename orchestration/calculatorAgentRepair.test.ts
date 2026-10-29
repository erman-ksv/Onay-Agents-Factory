import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCalculatorSnapshot, type CalculatorSnapshotReader, type CalculatorTreeEntry } from "../github/calculatorSnapshot.js";
import { prepareCalculatorRoleChanges, validateCalculatorAssessment } from "../commander/calculatorTeam.js";
import { createCalculatorPlan } from "./calculatorPlan.js";
import { calculatorProposalDigest } from "./calculatorExecutionEvidence.js";
import { createCalculatorModelTeam } from "./calculatorModelTeam.js";
import { createCalculatorAgentRepairTeam, type CalculatorAgentRepairHost } from "./calculatorAgentRepair.js";
import { createCalculatorRemotelyAdmittedRepairTeam } from "./calculatorAgentRepairAdmission.js";
import { inspectCalculatorRepairArchive, createCalculatorRepairArchiveLoader, type CalculatorRepairArchivePin } from "./calculatorAgentRepairArchive.js";
import { createCalculatorExecutionCheckpointStore, type CalculatorExecutionCheckpointIdentity } from "./calculatorExecutionCheckpoint.js";
import { createCalculatorRepairHost } from "./calculatorAgentRepairHost.js";
import type { CalculatorSandboxProcess } from "./calculatorSandbox.js";
import { collectCalculatorAssessmentEvidence, CALCULATOR_UI_BROWSER_SCENARIOS } from "./calculatorAssessmentEvidence.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { openCalculatorWorkspace } from "./calculatorWorkspace.js";
import { runCalculatorExecution } from "./calculatorExecution.js";
import { calculatorHostModelBudget } from "./taskModelBudget.js";
import { prepareCalculatorRuntimeHostLimits } from "./calculatorRuntime.js";

const saved = JSON.parse(readFileSync(new URL("./fixtures/calculatorStep7SavedPlan.json", import.meta.url), "utf8"));
const plan = createCalculatorPlan(saved.request, saved.proposal), task = plan.tasks[1]!;
const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
const env = { AGENT_FACTORY_TARGET_PROFILE: "calculator", AGENT_FACTORY_PROVIDER: "groq", GROQ_API_KEY: "fixture-key",
  CALCULATOR_MODEL_LIVE_APPROVED: "ONE_FREE_BOUNDED_RUN", ONAY_TEAM_FREE_TIER_CONFIRMED: "true", AGENT_FACTORY_LEGAL_ENABLED: "false" };
const priorCharge = Object.freeze({ attemptedRequests: 9, totalRequestBytes: 76839, reservedRunTokens: 27199, elapsedMs: 374346 });
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const blob = (s: string) => createHash("sha1").update("blob " + Buffer.byteLength(s) + "\0" + s).digest("hex");
const core = "export function calculate(left, operator, right) { return left + right; }";
const result = (content: unknown, withUsage = true) => Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }],
  ...(withUsage ? { usage: { prompt_tokens: 1800, completion_tokens: 600, total_tokens: 2400 } } : {}) });
async function fixture(originalIndex?: string) {
  const baseFiles = new Map([["src/calculator.mjs", core], ["test/calculator.test.mjs", "// previously verified dependency fixture"]]);
  if (originalIndex) baseFiles.set("index.html", originalIndex);
  let head = A; const allFiles = new Map(baseFiles);
  const reader: CalculatorSnapshotReader = {
    getHead: async () => head,
    readCommit: async sha => ({ sha, treeSha: sha, parents: sha === A ? [plan.owner.baseSha] : sha === B ? [A] : [] }),
    readTree: async sha => ({ sha, truncated: false, tree: [
      { path: "src", sha: C, type: "tree", mode: "040000" }, { path: "test", sha: C, type: "tree", mode: "040000" },
      ...[...(sha === B ? allFiles : baseFiles)].map(([path, s]) => ({ path, sha: blob(s), type: "blob", mode: "100644" })),
    ] as CalculatorTreeEntry[] }),
    readBlob: async sha => { const s = [...allFiles.values()].find(s => blob(s) === sha)!; return { sha, encoding: "base64", content: Buffer.from(s).toString("base64") }; },
  };
  const snapshot = await loadCalculatorSnapshot({ repository: plan.owner.repository, baseRef: plan.branch, baseSha: A, changePaths: task.paths }, reader);
  const dependency = await loadCalculatorSnapshot({ repository: plan.owner.repository, baseRef: plan.branch, baseSha: A, changePaths: ["src/calculator.mjs"] }, reader);
  const proposal = (repaired: boolean) => ({ summary: repaired ? "Agent corrects the saved module import" : "Saved UI with an incorrect module import", changes: task.paths.map(path => originalIndex && path === "index.html" ? {
    operation: "patch", path, sourceSha256: hash(originalIndex), edits: [{ before: "PRIVATE", after: "DISPLAY" }], message: "Patch bounded existing markup",
  } : ({
    operation: "create", path, message: "Task-scoped fixture file", content: path === "index.html" ? "<output>0</output>" : path === "styles.css" ? "output{display:block}" :
      repaired ? "import {calculate} from './calculator.mjs'; export const calculatePair=()=>calculate(2,'+',3);" : "import {calculate} from './wrong-module.mjs';",
  })) });
  const previous = prepareCalculatorRoleChanges("frontend", proposal(false), snapshot);
  const refs = ["changes@" + A, "host-checks@" + calculatorProposalDigest(previous)];
  const assessments = ["security", "reviewer", "tester"].map(role => validateCalculatorAssessment(role, {
    ready: role !== "reviewer", summary: role === "reviewer" ? "Module import is incorrect" : "No independent blocker in this scope",
    findings: role === "reviewer" ? [{ severity: "blocker", message: "The app imports wrong-module.mjs; the verified dependency is src/calculator.mjs.", evidenceRefs: [refs[0]] }] : [],
    unverifiedAreas: ["Real browser execution remains a host responsibility"],
  }, refs));
  const source = { taskId: task.id, planFingerprint: plan.fingerprint, baseSha: A, sourceManifestSha256: "d".repeat(64),
    proposal: previous, proposalDigest: calculatorProposalDigest(previous), assessments, dependencySnapshot: dependency, priorCharge, httpInFlight: false as const, publicationStarted: false as const };
  const host: CalculatorAgentRepairHost = {
    loadAuthenticatedFailure: async () => source,
    verifyRepairedProposal: async (_task, changes) => collectCalculatorAssessmentEvidence(task, changes, dependency, {
      checkProposal: async () => ({ repository: plan.owner.repository, taskId: task.id, baseSha: A, proposalDigest: calculatorProposalDigest(changes), status: "passed", testsExecuted: true, failures: [] }),
      checkBrowser: async input => ({ repository: plan.owner.repository, taskId: task.id, baseSha: A, proposalDigest: input.proposalDigest,
        dependencySha256: hash(core), status: "passed", testsExecuted: true, browser: "Chrome/155.0.8059.39", sandboxDisabled: false,
        pageErrors: 0, blockedRequests: 0, scenarios: CALCULATOR_UI_BROWSER_SCENARIOS }),
    }),
  };
  return { snapshot, dependency, previous, assessments, source, host, proposal, reader, publishFiles: (files: readonly { path: string; content: string }[]) => {
    for (const f of files) allFiles.set(f.path, f.content); head = B;
  } };
}
test("the developer receives full failed findings and supplies the correction; all three roles review the new digest", async () => {
  const f = await fixture(); let clock = 0; const roles: string[] = [];
  const team = createCalculatorAgentRepairTeam(saved.request, env, f.host, { timing: { now: () => clock, wait: async ms => { clock += ms; } },
    transport: async (_url, init) => {
      const body = JSON.parse(String(init?.body)), p = JSON.parse(body.messages[1].content);
      const role = /You are the (\w+) /.exec(body.messages[0].content)![1]; roles.push(role);
      if (role === "frontend") {
        assert.equal(body.max_completion_tokens, 2048);
        assert.equal(p.repair.specialistFeedback.length, 3);
        assert.equal(p.repair.specialistFeedback[1].findings[0].message, f.assessments[1].findings[0].message);
        assert.equal(p.repair.dependencyContract.path, "src/calculator.mjs");
        assert.equal(p.repair.dependencyContract.sourceSha256, hash(core));
        assert.equal(p.repair.dependencyContract.baseSha, A);
        assert.equal(p.repair.dependencyContract.signature, "calculate(left, operator, right)");
        assert.ok(!String(init?.body).includes(core));
        assert.deepEqual(p.repair.specialistFeedback[1].findings[0].evidenceRefs, ["changes@" + A]);
        assert.equal(p.repair.specialistFeedback[1].ready, false); return result(f.proposal(true));
      }
      assert.equal(body.max_completion_tokens, 1200); assert.notEqual(p.verifiedHostEvidence.proposalDigest, f.source.proposalDigest);
      return result({ ready: true, summary: "Fresh review of the agent correction", findings: [], unverifiedAreas: ["No overall app completion"] });
    } });
  const changes = await team.generate(plan, task.id, f.snapshot);
  assert.ok(changes.files.find(f => f.path === "src/app.mjs")!.content.includes("./calculator.mjs"));
  for (const role of ["security", "reviewer", "tester"] as const) assert.equal((await team.assess(role, plan, task.id, changes)).ready, true);
  assert.deepEqual(roles, ["frontend", "security", "reviewer", "tester"]);
  assert.equal(team.snapshot().repairedTasks, 1); assert.equal(team.snapshot().generatedTasks, 0);
  assert.deepEqual(team.snapshot().carriedPriorCharge, priorCharge); assert.equal(team.snapshot().aggregateCharge!.attemptedRequests, 13);
  assert.equal(team.snapshot().manualSourceEditsPerformed, false); assert.equal(team.snapshot().previousApprovalsTransferred, false);
  await assert.rejects(() => team.repair()); await assert.rejects(() => team.generate(plan, task.id, f.snapshot));
  assert.equal(roles.length, 4);
});
test("uncertain, published, stale or non-authenticated input cannot start a corrective model call", async t => {
  for (const patch of [{ httpInFlight: true }, { publicationStarted: true }, { baseSha: B }, { taskId: "other-task" },
    { planFingerprint: "0".repeat(64) }, { sourceManifestSha256: "not-a-hash" }, { priorCharge: { ...priorCharge, attemptedRequests: -1 } },
    { priorCharge: { ...priorCharge, attemptedRequests: 0 } }])
    await t.test(JSON.stringify(patch), async () => {
      const f = await fixture(); let calls = 0;
      const team = createCalculatorAgentRepairTeam(saved.request, env, { ...f.host, loadAuthenticatedFailure: async () => ({ ...f.source, ...patch }) as never },
        { transport: async () => { calls++; throw Error("must not call"); } });
      await assert.rejects(() => team.generate(plan, task.id, f.snapshot)); assert.equal(calls, 0);
    });
  assert.throws(() => createCalculatorAgentRepairTeam(saved.request, env, {} as CalculatorAgentRepairHost));
});
test("HTTP 429 consumes the attempt, preserves prior costs and never retries or invokes specialists", async () => {
  const f = await fixture(); let calls = 0;
  const team = createCalculatorAgentRepairTeam(saved.request, env, f.host, { transport: async () => { calls++; return new Response("rate limited", { status: 429 }); } });
  await assert.rejects(() => team.generate(plan, task.id, f.snapshot));
  await assert.rejects(() => team.generate(plan, task.id, f.snapshot)); assert.equal(calls, 1);
  assert.equal(team.snapshot().aggregateCharge!.attemptedRequests, 10); assert.deepEqual(team.snapshot().carriedPriorCharge, priorCharge);
});
test("stale JSON proof after an agent correction stops before specialist calls", async () => {
  const f = await fixture(); let calls = 0;
  const team = createCalculatorAgentRepairTeam(saved.request, env, { ...f.host, verifyRepairedProposal: async () => ({}) as never }, {
    transport: async () => { calls++; return result(f.proposal(true)); },
  });
  await assert.rejects(() => team.generate(plan, task.id, f.snapshot)); assert.equal(calls, 1);
  await assert.rejects(() => team.assess("security", plan, task.id, f.previous)); assert.equal(calls, 1);
});
test("unknown provider usage cannot expand the conservative budget to finish the repair cycle", async () => {
  const f = await fixture(); let clock = 0, calls = 0;
  const team = createCalculatorAgentRepairTeam(saved.request, env, f.host, { timing: { now: () => clock, wait: async ms => { clock += ms; } },
    transport: async (_url, init) => {
      calls++; const role = /You are the (\w+) /.exec(JSON.parse(String(init?.body)).messages[0].content)![1];
      return result(role === "frontend" ? f.proposal(true) : { ready: true, summary: "Fresh fixture assessment", findings: [], unverifiedAreas: [] }, false);
    } });
  const changes = await team.generate(plan, task.id, f.snapshot);
  await team.assess("security", plan, task.id, changes); await team.assess("reviewer", plan, task.id, changes);
  await assert.rejects(() => team.assess("tester", plan, task.id, changes));
  assert.equal(team.diagnostic().admission?.code, "run_budget_exceeded"); assert.equal(calls, 3);
  assert.deepEqual(team.snapshot().carriedPriorCharge, priorCharge);
  await assert.rejects(() => team.repair()); assert.equal(calls, 3);
});
test("the repair-only profile cannot plan, regenerate, approve old code or accept a serialized repair capability", async t => {
  for (const operation of ["plan", "generate", "old-assess", "cloned-repair", "missing-failure"] as const) await t.test(operation, async () => {
    const f = await fixture(); let calls = 0;
    const team = createCalculatorModelTeam(saved.request, env, async () => { calls++; return result({}); }, {}, undefined, undefined, "calculator-restored-repair-four-roles");
    if (operation === "plan") await assert.rejects(() => team.plan());
    else if (operation === "generate") await assert.rejects(() => team.generate(plan, task.id, f.snapshot));
    else {
      const restored = team.restoreProposal(plan, task.id, f.snapshot, f.previous, f.source.proposalDigest);
      if (operation === "old-assess") await assert.rejects(() => team.assess("security", plan, task.id, restored));
      else if (operation === "cloned-repair") {
        const request = team.importRepairFeedback(plan, task.id, restored, f.assessments, undefined, f.dependency);
        await assert.rejects(() => team.repair(plan, task.id, f.snapshot, JSON.parse(JSON.stringify(request))));
      } else {
        const ready = f.assessments.map(a => validateCalculatorAssessment(a.role, { ready: true, summary: "No failure", findings: [], unverifiedAreas: [] }, ["changes@" + A]));
        assert.throws(() => team.importRepairFeedback(plan, task.id, restored, ready, undefined, f.dependency));
      }
    }
    assert.equal(calls, 0);
  });
});
test("the normal executor keeps publication blocked when a fresh review rejects the agent correction", async () => {
  const f = await fixture(), directory = mkdtempSync(join(tmpdir(), "agent-repair-executor-")); let calls = 0, publishes = 0, clock = 0;
  try {
    const store = new CalculatorPlanStore(directory, saved.request), actualPlan = store.initialize(saved.proposal);
    const completed = store.taskReceipt(actualPlan, actualPlan.tasks[0]!);
    try { assert.equal(completed.claim(), "claimed"); completed.recordPublication({ branch: plan.branch, headSha: A, number: 1, url: "https://github.com/" + plan.owner.repository + "/pull/1" }); completed.finish("needs-review", "dependency_fixture_verified"); } finally { completed.close(); }
    const workspace = await openCalculatorWorkspace(store, f.reader, plan.branch, A);
    const team = createCalculatorAgentRepairTeam(saved.request, env, f.host, { timing: { now: () => clock, wait: async ms => { clock += ms; } },
      transport: async (_url, init) => {
        calls++; const body = JSON.parse(String(init?.body)), role = /You are the (\w+) /.exec(body.messages[0].content)![1];
        return result(role === "frontend" ? f.proposal(true) : { ready: role !== "reviewer", summary: role === "reviewer" ? "New independent blocker remains" : "Fresh scoped review", findings: [], unverifiedAreas: [] });
      } });
    const report = await runCalculatorExecution(workspace, { execution: "offline-test", maxRepairs: 0, team,
      verifyDependencies: async input => ({ repository: plan.owner.repository, planFingerprint: plan.fingerprint, taskId: input.task.id,
        candidateSha: A, currentSha: A, securityReady: true, independentReviewReady: true, taskChecksPassed: true, testsExecuted: true }),
      tools: { checkProposal: async () => { throw Error("must remain behind independent gates"); }, publish: async () => { publishes++; throw Error("must not publish"); }, ci: async () => { throw Error("no candidate"); } },
    });
    assert.equal(report.status, "blocked"); assert.equal(report.reasonCode, "repair_limit_reached"); assert.equal(publishes, 0); assert.equal(calls, 4);
    assert.equal(team.snapshot().repairedTasks, 1); assert.equal(report.wholeAppCompleted, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("agent repair completes the existing executor only after three fresh reviews, host checks and exact-SHA CI", async () => {
  const f = await fixture(), directory = mkdtempSync(join(tmpdir(), "agent-repair-success-"));
  let calls = 0, publishes = 0, hostChecks = 0, ciChecks = 0, clock = 0;
  try {
    const store = new CalculatorPlanStore(directory, saved.request), actualPlan = store.initialize(saved.proposal);
    const completed = store.taskReceipt(actualPlan, actualPlan.tasks[0]!);
    try { assert.equal(completed.claim(), "claimed"); completed.recordPublication({ branch: plan.branch, headSha: A, number: 1,
      url: "https://github.com/" + plan.owner.repository + "/pull/1" }); completed.finish("needs-review", "dependency_fixture_verified"); } finally { completed.close(); }
    const workspace = await openCalculatorWorkspace(store, f.reader, plan.branch, A);
    const team = createCalculatorAgentRepairTeam(saved.request, env, f.host, { timing: { now: () => clock, wait: async ms => { clock += ms; } },
      transport: async (_url, init) => {
        calls++; const role = /You are the (\w+) /.exec(JSON.parse(String(init?.body)).messages[0].content)![1];
        return result(role === "frontend" ? f.proposal(true) : { ready: true, summary: "Fresh independent assessment of the correction", findings: [], unverifiedAreas: [] });
      } });
    const report = await runCalculatorExecution(workspace, { execution: "offline-test", maxRepairs: 0, team,
      verifyDependencies: async input => ({ repository: plan.owner.repository, planFingerprint: plan.fingerprint, taskId: input.task.id,
        candidateSha: A, currentSha: A, securityReady: true, independentReviewReady: true, taskChecksPassed: true, testsExecuted: true }),
      tools: {
        checkProposal: async input => { hostChecks++; assert.equal(calls, 4); return { repository: plan.owner.repository, taskId: task.id,
          baseSha: A, proposalDigest: input.proposalDigest, status: "passed", testsExecuted: true, failures: [] }; },
        publish: async input => { publishes++; assert.equal(hostChecks, 1); assert.equal(input.expectedSha, A); f.publishFiles(input.changes.files);
          return { branch: plan.branch, headSha: B, number: 2, url: "https://github.com/" + plan.owner.repository + "/pull/2" }; },
        ci: async input => { ciChecks++; assert.equal(input.candidateSha, B); return { repository: plan.owner.repository, branch: plan.branch,
          candidateSha: B, runs: [{ id: 17, name: "Calculator task CI", status: "completed", conclusion: "success", head_sha: B, run_attempt: 1,
            html_url: "https://github.com/" + plan.owner.repository + "/actions/runs/17" }],
          jobs: [{ name: "Calculator task CI", status: "completed", conclusion: "success", run_id: 17, run_attempt: 1, head_sha: B,
            steps: ["Syntax", "Task tests"].map(name => ({ name, status: "completed", conclusion: "success" })) }] }; },
      },
    });
    assert.equal(report.status, "candidate-verified"); assert.equal(calls, 4); assert.equal(publishes, 1); assert.equal(ciChecks, 1);
    assert.equal(report.proposalTestsExecuted, true); assert.equal(report.candidateTestsExecuted, true); assert.equal(report.wholeAppCompleted, false);
    assert.equal(team.snapshot().repairedTasks, 1); assert.equal(team.snapshot().aggregateCharge!.attemptedRequests, 13);
    await runCalculatorExecution(workspace, { execution: "offline-test", maxRepairs: 0, team, tools: { checkProposal: async () => { throw Error("no replay"); },
      publish: async () => { publishes++; throw Error("no replay"); }, ci: async () => { throw Error("no replay"); } } });
    assert.equal(calls, 4); assert.equal(publishes, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("the new repair profile is fixed and cannot silently enter the normal runtime continuation", () => {
  const preset = calculatorHostModelBudget("calculator-restored-repair-four-roles");
  assert.equal(preset.maxRequests, 4); assert.equal(preset.maxOutputTokens, 2048); assert.equal(preset.wallTimeMs, 300000);
  assert.ok(Object.isFrozen(preset));
  assert.throws(() => prepareCalculatorRuntimeHostLimits({ maxRequests: 4, maxRunBytes: 96000, maxRepairs: 0,
    hostPreset: "calculator-restored-repair-four-roles" }));
});
test("a finding cannot smuggle a complete unchanged private original into the corrective prompt", async () => {
  const privateOriginal = "<output>PRIVATE original source must stay private</output>", f = await fixture(privateOriginal); let calls = 0;
  const team = createCalculatorModelTeam(saved.request, env, async () => { calls++; return result(f.proposal(true)); }, {}, undefined, undefined,
    "calculator-restored-repair-four-roles");
  const previous = team.restoreProposal(plan, task.id, f.snapshot, f.previous, f.source.proposalDigest);
  const feedback = f.assessments.map(a => a.role !== "reviewer" ? a : validateCalculatorAssessment("reviewer", {
    ready: false, summary: "Failed scoped review", findings: [{ severity: "blocker", message: "Quoted original: " + privateOriginal,
      evidenceRefs: ["changes@" + A] }], unverifiedAreas: [],
  }, ["changes@" + A]));
  const request = team.importRepairFeedback(plan, task.id, previous, feedback, undefined, f.dependency);
  await assert.rejects(() => team.repair(plan, task.id, f.snapshot, request)); assert.equal(calls, 0);
  assert.equal(team.checkpointCharge()!.attemptedRequests, 0);
});
test("missing or JSON-cloned dependency metadata fails before correction HTTP", async t => {
  const f = await fixture();
  for (const dependencySnapshot of [undefined, { ...f.dependency }, { ...f.dependency, baseSha: B }]) await t.test("unverified dependency", async () => {
    let calls = 0;
    const team = createCalculatorAgentRepairTeam(saved.request, env, { ...f.host,
      loadAuthenticatedFailure: async () => ({ ...f.source, dependencySnapshot }) as never }, {
      transport: async () => { calls++; return result(f.proposal(true)); },
    });
    await assert.rejects(() => team.generate(plan, task.id, f.snapshot)); assert.equal(calls, 0);
    assert.deepEqual(team.snapshot().carriedPriorCharge, priorCharge);
  });
});
test("full private dependency source quoted in a finding stays out of the model request", async () => {
  const f = await fixture(); let calls = 0;
  const team = createCalculatorModelTeam(saved.request, env, async () => { calls++; return result(f.proposal(true)); }, {}, undefined, undefined,
    "calculator-restored-repair-four-roles");
  const previous = team.restoreProposal(plan, task.id, f.snapshot, f.previous, f.source.proposalDigest);
  const feedback = f.assessments.map(a => a.role !== "reviewer" ? a : validateCalculatorAssessment("reviewer", {
    ready: false, summary: "Failed scoped review", findings: [{ severity: "blocker", message: "Unchanged source: " + core,
      evidenceRefs: ["changes@" + A] }], unverifiedAreas: [],
  }, ["changes@" + A]));
  const request = team.importRepairFeedback(plan, task.id, previous, feedback, undefined, f.dependency);
  await assert.rejects(() => team.repair(plan, task.id, f.snapshot, request)); assert.equal(calls, 0);
});
test("pre-HTTP persistence and exported checkpoints retain old plus newly reserved costs", async () => {
  const f = await fixture(); let calls = 0;
  const persisted: Readonly<Record<string, number>>[] = [];
  const team = createCalculatorAgentRepairTeam(saved.request, env, f.host, {
    checkpoints: { beforeRequest: state => {
      assert.equal(calls, 0); assert.equal(state.attemptedRequests, priorCharge.attemptedRequests + 1);
      assert.ok(state.totalRequestBytes > priorCharge.totalRequestBytes);
      assert.ok(state.reservedRunTokens > priorCharge.reservedRunTokens);
      assert.ok(Object.isFrozen(state)); persisted.push(state);
    } },
    transport: async () => { calls++; return result(f.proposal(true)); },
  });
  await team.generate(plan, task.id, f.snapshot);
  assert.equal(calls, 1); assert.equal(persisted.length, 1);
  assert.equal(team.checkpointCharge()!.attemptedRequests, priorCharge.attemptedRequests + 1);
  // Two consecutive timing snapshots may legitimately differ by 1+ ms.
  // Require exact cost accounting and monotonically retained elapsed time.
  const before = team.checkpointCharge()!, after = team.snapshot().aggregateCharge!;
  assert.equal(after.attemptedRequests, before.attemptedRequests);
  assert.equal(after.totalRequestBytes, before.totalRequestBytes);
  assert.equal(after.reservedRunTokens, before.reservedRunTokens);
  assert.ok(after.elapsedMs >= before.elapsedMs);
  assert.equal(team.snapshot().modelBudget.attemptedRequests, 1);
});
test("a failed cumulative checkpoint write prevents HTTP without refunding old or new charges", async () => {
  const f = await fixture(); let calls = 0, writes = 0;
  const team = createCalculatorAgentRepairTeam(saved.request, env, f.host, {
    checkpoints: { beforeRequest: state => {
      writes++; assert.equal(state.attemptedRequests, priorCharge.attemptedRequests + 1); throw Error("fixture disk failure");
    } }, transport: async () => { calls++; return result(f.proposal(true)); },
  });
  await assert.rejects(() => team.generate(plan, task.id, f.snapshot));
  assert.equal(calls, 0); assert.equal(writes, 1);
  assert.equal(team.diagnostic().reasonCode, "model_checkpoint_persistence_failed");
  assert.equal(team.checkpointCharge()!.attemptedRequests, priorCharge.attemptedRequests + 1);
  assert.deepEqual(team.snapshot().carriedPriorCharge, priorCharge);
  await assert.rejects(() => team.generate(plan, task.id, f.snapshot)); assert.equal(writes, 1);
});
test("unsafe cumulative arithmetic or a non-function persistence hook cannot reach HTTP", async () => {
  const f = await fixture(); let calls = 0;
  assert.throws(() => createCalculatorAgentRepairTeam(saved.request, env, f.host, {
    checkpoints: { beforeRequest: "not a function" } as never,
  }));
  const team = createCalculatorAgentRepairTeam(saved.request, env, {
    ...f.host, loadAuthenticatedFailure: async () => ({ ...f.source, priorCharge: { ...priorCharge, attemptedRequests: Number.MAX_SAFE_INTEGER } }),
  }, {
    checkpoints: { beforeRequest: () => { throw Error("overflow must fail before persistence"); } },
    transport: async () => { calls++; return result(f.proposal(true)); },
  });
  await assert.rejects(() => team.generate(plan, task.id, f.snapshot)); assert.equal(calls, 0);
});
function admissionFixture() {
  const factory = "erman-ksv/Onay-Agents-Factory", runtimeSha = "f".repeat(40);
  const liveEnv = { ...env, GITHUB_REPOSITORY: factory, GITHUB_RUN_ATTEMPT: "1", GITHUB_TOKEN: "factory-fixture",
    CALCULATOR_GITHUB_TOKEN: "target-fixture", CALCULATOR_AGENT_REPAIR_APPROVED: "ONE_SEPARATELY_BOUNDED_AGENT_CORRECTION" };
  let ref: string | undefined, head = A, posts = 0;
  const admissionTransport: typeof fetch = async (url, init) => {
    const path = decodeURIComponent(new URL(String(url)).pathname);
    if (path.includes("/" + plan.owner.repository + "/")) {
      assert.equal(init?.method, "GET"); return Response.json({ ref: "refs/heads/" + plan.branch, object: { type: "commit", sha: head } });
    }
    if (path.endsWith("/actions/runs/1")) return Response.json({ id: 1, head_sha: runtimeSha, run_attempt: 1,
      status: "completed", conclusion: "success", path: ".github/workflows/ci.yml", event: "push",
      repository: { full_name: factory }, head_repository: { full_name: factory } });
    if (path.endsWith("/attempts/1/jobs")) return Response.json({ total_count: 1, jobs: [{ name: "typecheck", run_id: 1,
      run_attempt: 1, head_sha: runtimeSha, status: "completed", conclusion: "success",
      steps: ["Typecheck", "Test"].map(name => ({ name, status: "completed", conclusion: "success" })),
    }] });
    if (init?.method === "POST") {
      posts++; assert.equal(posts, 1); ref = JSON.parse(String(init.body)).ref;
      return Response.json({ ref, object: { type: "commit", sha: runtimeSha } }, { status: 201 });
    }
    return ref ? Response.json({ ref, object: { type: "commit", sha: runtimeSha } }) : new Response(null, { status: 404 });
  };
  return { liveEnv, authority: { runtimeSha, sourceCiRunId: 1 }, admissionTransport,
    posted: () => posts, moveHead: () => { head = B; } };
}
test("the admitted team repairs via the model only after its remote barrier and cumulative persistence", async () => {
  const f = await fixture(), a = admissionFixture(); let clock = 0, calls = 0, writes = 0;
  const team = createCalculatorRemotelyAdmittedRepairTeam(saved.request, a.liveEnv, a.authority, f.host, {
    admissionTransport: a.admissionTransport, timing: { now: () => clock, wait: async ms => { clock += ms; } },
    checkpoints: { beforeRequest: state => { writes++; assert.equal(a.posted(), 1); assert.equal(state.attemptedRequests, 9 + writes); } },
    transport: async (_url, init) => {
      calls++; assert.equal(writes, calls); assert.equal(a.posted(), 1);
      const role = /You are the (\w+) /.exec(JSON.parse(String(init?.body)).messages[0].content)![1];
      return result(role === "frontend" ? f.proposal(true) : { ready: true, summary: "Fresh independent assessment", findings: [], unverifiedAreas: [] });
    },
  });
  const changes = await team.generate(plan, task.id, f.snapshot);
  for (const role of ["security", "reviewer", "tester"] as const) await team.assess(role, plan, task.id, changes);
  assert.equal(calls, 4); assert.equal(writes, 4); assert.equal(a.posted(), 1);
  assert.equal(team.checkpointCharge()!.attemptedRequests, 13);
  await assert.rejects(() => team.generate(plan, task.id, f.snapshot)); assert.equal(calls, 4);
});
test("target movement while persisting an admitted phase stops before any model HTTP", async () => {
  const f = await fixture(), a = admissionFixture(); let calls = 0, writes = 0;
  const team = createCalculatorRemotelyAdmittedRepairTeam(saved.request, a.liveEnv, a.authority, f.host, {
    admissionTransport: a.admissionTransport,
    checkpoints: { beforeRequest: () => { writes++; a.moveHead(); } },
    transport: async () => { calls++; return result(f.proposal(true)); },
  });
  await assert.rejects(() => team.generate(plan, task.id, f.snapshot));
  assert.equal(a.posted(), 1); assert.equal(writes, 1); assert.equal(calls, 0);
  assert.equal(team.checkpointCharge()!.attemptedRequests, 10);
  await assert.rejects(() => team.generate(plan, task.id, f.snapshot)); assert.equal(a.posted(), 1);
});
test("an unauthenticated archive failure stops before remote admission or any model HTTP", async () => {
  const f = await fixture(), a = admissionFixture(); let calls = 0;
  const team = createCalculatorRemotelyAdmittedRepairTeam(saved.request, a.liveEnv, a.authority, {
    ...f.host, loadAuthenticatedFailure: async () => { throw Error("fixture provenance mismatch"); },
  }, { admissionTransport: a.admissionTransport, checkpoints: { beforeRequest: () => {} },
    transport: async () => { calls++; return result(f.proposal(true)); } });
  await assert.rejects(() => team.generate(plan, task.id, f.snapshot)); assert.equal(a.posted(), 0); assert.equal(calls, 0);
});
function stoppedArchive(f: Awaited<ReturnType<typeof fixture>>, mode = "incremental") {
  const directory = mkdtempSync(join(tmpdir(), "agent-repair-archive-")), root = join(directory, "artifact");
  mkdirSync(root, { mode: 0o700 }); mkdirSync(join(root, "evidence"), { mode: 0o700 });
  const earlier = { attemptedRequests: 5, totalRequestBytes: 30000, reservedRunTokens: 12000, elapsedMs: 170000 };
  const current = mode === "cumulative" ? priorCharge : {
    attemptedRequests: 4, totalRequestBytes: 46839, reservedRunTokens: 15199, elapsedMs: 204346,
  };
  const files: { path: string; bytes: number; sha256: string }[] = [], phases: CalculatorRepairArchivePin["phases"][number][] = [];
  for (const [index, modelState] of [earlier, current].entries()) {
    const identity: CalculatorExecutionCheckpointIdentity = { repository: plan.owner.repository, goalId: plan.owner.id,
      ownerFingerprint: plan.owner.ownerFingerprint, planFingerprint: plan.fingerprint, taskId: task.id,
      branch: plan.branch, baseSha: A, bootstrapSha: plan.owner.baseSha, runtimeConfigDigest: String(index + 1).repeat(64) };
    const working = join(directory, "phase-" + index); mkdirSync(working, { mode: 0o700 });
    const writer = createCalculatorExecutionCheckpointStore(working, identity);
    try {
      writer.save({ attempt: 1, stage: index ? "execution_complete" : "generate_1", status: "blocked",
        ...(index ? { proposal: f.previous } : {}), assessments: index ? f.assessments : [], modelState,
        httpInFlight: !index || mode === "in-flight", publicationStarted: mode === "published" && !!index });
    } finally { writer.close(); }
    const bytes = readFileSync(join(working, task.id + ".execution.json")), path = "phase-" + index + ".json";
    writeFileSync(join(root, "evidence", path), bytes, { mode: 0o600 });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    files.push({ path, bytes: bytes.length, sha256 });
    phases.push({ path, sha256, identity, accounting: index && mode === "cumulative" ? "cumulative" : "incremental" });
  }
  const kind = "calculator-agent-repair-forensic", totalBytes = files.reduce((n, file) => n + file.bytes, 0);
  const manifest = JSON.stringify({ version: 1, kind, evidenceValidation: "unvalidated", resumeAuthorized: false,
    budgetResetAuthorized: false, fileCount: files.length, totalBytes, files, treeSha256: hash(JSON.stringify(files)) }) + "\n";
  writeFileSync(join(root, "manifest.json"), manifest, { mode: 0o600 });
  const pin: CalculatorRepairArchivePin = { manifestSha256: hash(manifest), kind, fileCount: files.length, totalBytes,
    sourcePath: "phase-1.json", phases, totalCharge: priorCharge };
  return { directory, root, pin };
}
test("the pinned loader preserves every private proposal/finding and old charge without granting execution", async () => {
  const f = await fixture(), a = stoppedArchive(f);
  try {
    const capability = inspectCalculatorRepairArchive(a.root, a.pin);
    assert.equal(capability.resumeAuthorized, false); assert.equal(capability.phaseCount, 2);
    assert.ok(!JSON.stringify(capability).includes("wrong-module")); assert.ok(!JSON.stringify(capability).includes("findings"));
    const loaded = await createCalculatorRepairArchiveLoader(capability, f.reader)(plan, task, f.snapshot);
    assert.deepEqual(loaded.proposal, f.previous); assert.deepEqual(loaded.assessments, f.assessments);
    assert.deepEqual(loaded.priorCharge, priorCharge); assert.equal(loaded.httpInFlight, false);
    assert.equal(loaded.dependencySnapshot.baseSha, A);
    assert.throws(() => createCalculatorRepairArchiveLoader({ ...capability }, f.reader));
    await assert.rejects(() => createCalculatorRepairArchiveLoader(capability, f.reader)(plan, task, f.snapshot));
  } finally { rmSync(a.directory, { recursive: true, force: true }); }
});
test("cumulative checkpoints keep the old charge instead of double-counting earlier phases", async () => {
  const f = await fixture(), a = stoppedArchive(f, "cumulative");
  try { assert.deepEqual(inspectCalculatorRepairArchive(a.root, a.pin).priorCharge, priorCharge); }
  finally { rmSync(a.directory, { recursive: true, force: true }); }
});
test("in-flight or published source failures cannot produce a repair archive capability", async t => {
  const f = await fixture();
  for (const mode of ["in-flight", "published"]) await t.test(mode, () => {
    const a = stoppedArchive(f, mode);
    try { assert.throws(() => inspectCalculatorRepairArchive(a.root, a.pin)); }
    finally { rmSync(a.directory, { recursive: true, force: true }); }
  });
});
test("missing, repeated or underreported historical charges fail closed", async t => {
  const f = await fixture();
  for (const mode of ["omitted", "duplicate", "underreported", "wrong-source", "bad-identity"] as const) await t.test(mode, () => {
    const a = stoppedArchive(f);
    try {
      const pin = structuredClone(a.pin);
      const changed = mode === "omitted" ? { ...pin, phases: pin.phases.slice(1) } :
        mode === "duplicate" ? { ...pin, phases: [pin.phases[0]!, ...pin.phases] } :
        mode === "underreported" ? { ...pin, totalCharge: { ...priorCharge, attemptedRequests: 4 } } :
        mode === "wrong-source" ? { ...pin, sourcePath: "phase-0.json" } :
        { ...pin, phases: [pin.phases[0]!, { ...pin.phases[1]!, identity: { ...pin.phases[1]!.identity, taskId: "other-task" } }] };
      assert.throws(() => inspectCalculatorRepairArchive(a.root, changed));
    } finally { rmSync(a.directory, { recursive: true, force: true }); }
  });
});
test("tampered, extra, symlinked or insecure archive files cannot supply private source", async t => {
  const f = await fixture();
  for (const mode of ["changed", "extra", "symlink", "permissions"] as const) await t.test(mode, () => {
    const a = stoppedArchive(f);
    try {
      const path = join(a.root, "evidence/phase-1.json");
      if (mode === "changed") writeFileSync(path, "{}\n");
      if (mode === "extra") writeFileSync(join(a.root, "evidence/extra.json"), "{}\n", { mode: 0o600 });
      if (mode === "symlink") { rmSync(path); symlinkSync(join(a.root, "evidence/phase-0.json"), path); }
      if (mode === "permissions") chmodSync(path, 0o666);
      assert.throws(() => inspectCalculatorRepairArchive(a.root, a.pin));
    } finally { rmSync(a.directory, { recursive: true, force: true }); }
  });
});
test("the loader rejects a stale snapshot or changed archive before remote admission/model calls", async t => {
  const f = await fixture();
  for (const mode of ["stale", "clone", "archive-changed"] as const) await t.test(mode, async () => {
    const a = stoppedArchive(f); let reads = 0;
    try {
      const cap = inspectCalculatorRepairArchive(a.root, a.pin);
      const loader = createCalculatorRepairArchiveLoader(cap, { ...f.reader, getHead: async ref => { reads++; return f.reader.getHead(ref); } });
      if (mode === "archive-changed") writeFileSync(join(a.root, "evidence/phase-1.json"), "{}\n");
      await assert.rejects(() => loader(plan, task, mode === "stale" ? { ...f.snapshot, baseSha: B } : mode === "clone" ? { ...f.snapshot } : f.snapshot));
      assert.equal(reads, 0);
    } finally { rmSync(a.directory, { recursive: true, force: true }); }
  });
});
test("a genuine pinned archive composes with remote admission and the agent-owned corrective call", async () => {
  const f = await fixture(), archive = stoppedArchive(f), a = admissionFixture(); let calls = 0, writes = 0;
  try {
    const cap = inspectCalculatorRepairArchive(archive.root, archive.pin);
    const team = createCalculatorRemotelyAdmittedRepairTeam(saved.request, a.liveEnv, a.authority,
      { ...f.host, loadAuthenticatedFailure: createCalculatorRepairArchiveLoader(cap, f.reader) }, {
        admissionTransport: a.admissionTransport, checkpoints: { beforeRequest: state => { writes++; assert.equal(state.attemptedRequests, 10); } },
        transport: async () => { calls++; assert.equal(writes, 1); return result(f.proposal(true)); },
      });
    const changes = await team.generate(plan, task.id, f.snapshot);
    assert.ok(changes.files.some(file => file.content.includes("./calculator.mjs")));
    assert.equal(a.posted(), 1); assert.equal(calls, 1); assert.equal(team.checkpointCharge()!.attemptedRequests, 10);
  } finally { rmSync(archive.directory, { recursive: true, force: true }); }
});
function isolatedHostFixture(mode = "ready") {
  const digest = "1".repeat(64), image = "node:22@sha256:" + digest;
  let dockerCommands = 0, browserChecks = 0, harnessChecks = 0;
  const processRunner: CalculatorSandboxProcess = async (args, options) => {
    dockerCommands++; assert.equal(options.env.GROQ_API_KEY, undefined); assert.equal(options.env.GITHUB_TOKEN, undefined);
    if (mode === "docker-unavailable") return { code: 1, stdout: "", stderr: "fixture unavailable" };
    if (args.includes("info")) return { code: 0, stdout: "27.1.0\n", stderr: "" };
    if (args.includes("inspect")) return { code: 0, stdout: JSON.stringify(["node@sha256:" + digest]), stderr: "" };
    if (args.includes("--version")) return { code: 0, stdout: "v22.13.0\n", stderr: "" };
    if (args.includes("/harness.mjs")) {
      harnessChecks++;
      assert.ok(args.includes("--network=none")); assert.ok(args.includes("--read-only")); assert.ok(args.includes("--cap-drop=ALL"));
      const mount = args.find(s => s.startsWith("--mount=type=bind,src=") && s.endsWith(",dst=/app,readonly"))!;
      const path = mount.slice("--mount=type=bind,src=".length, -",dst=/app,readonly".length);
      assert.ok(readFileSync(join(path, "src/app.mjs"), "utf8").includes("./calculator.mjs"));
      assert.equal(readFileSync(join(path, "src/calculator.mjs"), "utf8"), core);
      assert.ok(readFileSync(join(path, "test/calculator.test.mjs"), "utf8"));
      return { code: mode === "checks-fail" ? 1 : 0, stdout: JSON.stringify({ version: 1,
        checks: ["syntax", "fixed-arithmetic", "project-tests", "ui-structure"],
        status: mode === "checks-fail" ? "failed" : "passed", failures: mode === "checks-fail" ? ["ui-structure"] : [] }), stderr: "" };
    }
    assert.ok(args.includes("rm")); return { code: 0, stdout: "", stderr: "" };
  };
  const browser = {
    preflight: async () => ({ ready: mode !== "browser-unavailable", sandboxDisabled: false,
      networkIsolated: mode !== "browser-not-isolated", credentialsExcluded: true }) as never,
    check: async (input: { changes: { baseSha: string }; task: { id: string }; proposalDigest: string; dependencySha256: string; baseSources: ReadonlyMap<string, string> }) => {
      browserChecks++; assert.equal(input.baseSources.get("src/calculator.mjs"), core);
      return { repository: plan.owner.repository, taskId: task.id, baseSha: A, proposalDigest: input.proposalDigest,
        dependencySha256: input.dependencySha256, status: "passed" as const, testsExecuted: true as const,
        browser: "Chrome/155.0.8059.39", sandboxDisabled: false as const, pageErrors: 0 as const, blockedRequests: 0 as const,
        scenarios: CALCULATOR_UI_BROWSER_SCENARIOS };
    },
  };
  return { image, processRunner, browser, dockerCommands: () => dockerCommands,
    browserChecks: () => browserChecks, harnessChecks: () => harnessChecks };
}
test("the production host wires the pinned archive, Docker task checks and browser checks to the new agent digest", async () => {
  const f = await fixture(), archive = stoppedArchive(f), admission = admissionFixture(), isolation = isolatedHostFixture();
  let calls = 0, clock = 0;
  try {
    const cap = inspectCalculatorRepairArchive(archive.root, archive.pin);
    const host = createCalculatorRepairHost(cap, f.reader, { nodeImage: isolation.image, browser: isolation.browser }, env, isolation.processRunner);
    const team = createCalculatorRemotelyAdmittedRepairTeam(saved.request, admission.liveEnv, admission.authority, host, {
      admissionTransport: admission.admissionTransport, checkpoints: { beforeRequest: () => {} },
      timing: { now: () => clock, wait: async ms => { clock += ms; } }, transport: async (_url, init) => {
        calls++; assert.ok(isolation.dockerCommands() >= 3); assert.equal(admission.posted(), 1);
        const body = JSON.parse(String(init?.body)), role = /You are the (\w+) /.exec(body.messages[0].content)![1];
        if (role !== "frontend") {
          assert.equal(isolation.browserChecks(), 1);
          assert.equal(JSON.parse(body.messages[1].content).verifiedHostEvidence.proposalChecks.status, "passed");
        }
        return result(role === "frontend" ? f.proposal(true) : { ready: true, summary: "Fresh independent assessment", findings: [], unverifiedAreas: [] });
      },
    });
    const changes = await team.generate(plan, task.id, f.snapshot);
    for (const role of ["security", "reviewer", "tester"] as const) await team.assess(role, plan, task.id, changes);
    assert.equal(calls, 4); assert.equal(isolation.browserChecks(), 1); assert.equal(isolation.harnessChecks(), 1);
    assert.equal(team.checkpointCharge()!.attemptedRequests, 13);
    await assert.rejects(() => host.verifyRepairedProposal(task, changes, f.snapshot));
  } finally { rmSync(archive.directory, { recursive: true, force: true }); }
});
test("missing Docker/browser isolation refuses before remote admission and any model HTTP", async t => {
  const f = await fixture();
  for (const mode of ["docker-unavailable", "browser-unavailable", "browser-not-isolated"]) await t.test(mode, async () => {
    const archive = stoppedArchive(f), admission = admissionFixture(), isolation = isolatedHostFixture(mode); let calls = 0;
    try {
      const host = createCalculatorRepairHost(inspectCalculatorRepairArchive(archive.root, archive.pin), f.reader,
        { nodeImage: isolation.image, browser: isolation.browser }, env, isolation.processRunner);
      const team = createCalculatorRemotelyAdmittedRepairTeam(saved.request, admission.liveEnv, admission.authority, host, {
        admissionTransport: admission.admissionTransport, checkpoints: { beforeRequest: () => {} },
        transport: async () => { calls++; return result(f.proposal(true)); },
      });
      await assert.rejects(() => team.generate(plan, task.id, f.snapshot));
      assert.equal(calls, 0); assert.equal(admission.posted(), 0); assert.equal(isolation.browserChecks(), 0);
    } finally { rmSync(archive.directory, { recursive: true, force: true }); }
  });
});
test("actual isolated proposal-check failure blocks browser proof, specialists and publication", async () => {
  const f = await fixture(), archive = stoppedArchive(f), admission = admissionFixture(), isolation = isolatedHostFixture("checks-fail"); let calls = 0;
  try {
    const host = createCalculatorRepairHost(inspectCalculatorRepairArchive(archive.root, archive.pin), f.reader,
      { nodeImage: isolation.image, browser: isolation.browser }, env, isolation.processRunner);
    const team = createCalculatorRemotelyAdmittedRepairTeam(saved.request, admission.liveEnv, admission.authority, host, {
      admissionTransport: admission.admissionTransport, checkpoints: { beforeRequest: () => {} },
      transport: async () => { calls++; return result(f.proposal(true)); },
    });
    await assert.rejects(() => team.generate(plan, task.id, f.snapshot));
    assert.equal(calls, 1); assert.equal(isolation.browserChecks(), 0); assert.equal(isolation.harnessChecks(), 1);
    assert.equal(team.checkpointCharge()!.attemptedRequests, 10);
  } finally { rmSync(archive.directory, { recursive: true, force: true }); }
});

test('keyboard repair context can be inspected before admission without HTTP, reservations or reusable client state',async()=>{
 const f=await fixture(),keyboard=plan.tasks[2]!;
 const snapshot=await loadCalculatorSnapshot({repository:plan.owner.repository,baseRef:plan.branch,baseSha:A,changePaths:keyboard.paths},f.reader);
 const previous=prepareCalculatorRoleChanges('frontend',{summary:'Unpublished keyboard protocol fixture',changes:keyboard.paths.map(path=>({operation:'create',path,content:'export const fixture=1;',message:'Fixture'}))},snapshot);
 let calls=0;
 const team=createCalculatorModelTeam(saved.request,env,async()=>{calls++;throw Error('No HTTP permitted');},{},undefined,undefined,'calculator-restored-repair-four-roles');
 const restored=team.restoreProposal(plan,keyboard.id,snapshot,previous,calculatorProposalDigest(previous),[]);
 const request=team.importRepairFeedback(plan,keyboard.id,restored,f.assessments,undefined,f.dependency);
 const preview=await team.inspectRepairContext(plan,keyboard.id,snapshot,request);
 assert.equal(preview.status,'ready');assert.ok(preview.estimatedInputTokens+preview.reservedOutputTokens<=6000);
 assert.equal(calls,0);assert.equal(team.diagnostic().httpRequestsAttempted,0);assert.equal(team.diagnostic().httpRequestsSent,0);
 assert.equal(team.checkpointCharge()!.reservedRunTokens,0);
 await assert.rejects(()=>team.repair(plan,keyboard.id,snapshot,request));assert.equal(calls,0);
});
