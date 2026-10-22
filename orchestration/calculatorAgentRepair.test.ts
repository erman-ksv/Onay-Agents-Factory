import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCalculatorSnapshot, type CalculatorSnapshotReader, type CalculatorTreeEntry } from "../github/calculatorSnapshot.js";
import { prepareCalculatorRoleChanges, validateCalculatorAssessment } from "../commander/calculatorTeam.js";
import { createCalculatorPlan } from "./calculatorPlan.js";
import { calculatorProposalDigest } from "./calculatorExecutionEvidence.js";
import { createCalculatorModelTeam } from "./calculatorModelTeam.js";
import { createCalculatorAgentRepairTeam, type CalculatorAgentRepairHost } from "./calculatorAgentRepair.js";
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
  assert.deepEqual(team.checkpointCharge(), team.snapshot().aggregateCharge);
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
