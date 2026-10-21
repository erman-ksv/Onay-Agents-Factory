import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
import { CALCULATOR_ACCEPTANCE, calculatorPlanTaskId } from "./calculatorPlan.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { openCalculatorWorkspace, loadCalculatorWorkspaceTask } from "./calculatorWorkspace.js";
import type { CalculatorSnapshotReader, CalculatorTreeEntry } from "../github/calculatorSnapshot.js";
import { createCalculatorModelTeam } from "./calculatorModelTeam.js";
import { calculatorProposalDigest, type CalculatorProposalTests } from "./calculatorExecutionEvidence.js";
import { runCalculatorExecution, type CalculatorExecutionTools } from "./calculatorExecution.js";

const A = "a".repeat(40), B = "b".repeat(40), D = "d".repeat(40);
const owner = { version: 1, id: "execution-pilot", goal: "Create the agreed complete calculator website with module and browser tests.",
  baseRef: "feat/calculator-pilot-bootstrap", baseSha: A, provider: "gemini" };
const env = { AGENT_FACTORY_TARGET_PROFILE: "calculator", AGENT_FACTORY_PROVIDER: "gemini", GEMINI_API_KEY: "fixture-key",
  CALCULATOR_MODEL_LIVE_APPROVED: "ONE_FREE_BOUNDED_RUN", ONAY_TEAM_FREE_TIER_CONFIRMED: "true", AGENT_FACTORY_LEGAL_ENABLED: "false" };
const digest = (content: string) => createHash("sha1").update("blob " + Buffer.byteLength(content) + "\0" + content).digest("hex");
async function fixture(config: { rejectFirstReview?: boolean; rejectAllReviews?: boolean; rateLimitRepair?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "calculator-execution-")), store = new CalculatorPlanStore(directory, owner);
  const id = (n: number) => calculatorPlanTaskId(owner, n);
  const plan = store.initialize({ tasks: [
    { id: id(1), role: "coder", goal: "Implement arithmetic and module tests.", acceptanceIds: CALCULATOR_ACCEPTANCE.slice(0, 7).map(item => item.id),
      paths: ["src/calculator.mjs", "test/calculator.test.mjs"], dependsOn: [] },
    { id: id(2), role: "frontend", goal: "Implement responsive calculator controls.", acceptanceIds: CALCULATOR_ACCEPTANCE.slice(7).map(item => item.id),
      paths: ["index.html", "styles.css", "src/app.mjs"], dependsOn: [id(1)] },
    { id: id(3), role: "frontend", goal: "Test keyboard and button interaction.", acceptanceIds: ["keyboard"], paths: ["test/ui.test.mjs"], dependsOn: [id(2)] },
  ], blockers: [], unverifiedAreas: [] });
  let head = A, generations = 0, publishes = 0, checks = 0, ciReads = 0;
  const requests: Array<{ role: string; packet: Record<string, unknown> }> = [];
  let candidateTree: CalculatorTreeEntry[] = [];
  const reader: CalculatorSnapshotReader = {
    getHead: async () => head,
    readCommit: async hash => ({ sha: hash, treeSha: hash, parents: hash === A ? [] : [A] }),
    readTree: async hash => ({ sha: hash, truncated: false, tree: hash === A ? [] : candidateTree }),
    readBlob: async () => { throw new Error("fixture has no original source"); },
  };
  const team = createCalculatorModelTeam(owner, env, async (_url, init) => {
    const body = JSON.parse(String(init?.body)), instructions: string = body.messages[0].content;
    const role = instructions.includes("You are the coder ") ? "coder" :
      instructions.includes("You are the reviewer ") ? "reviewer" : instructions.includes("You are the security ") ? "security" : "tester";
    const packet = JSON.parse(body.messages[1].content); requests.push({ role, packet });
    let output: unknown;
    if (role === "coder") {
      generations++;
      if (generations === 2 && config.rateLimitRepair) return new Response("private upstream source", { status: 429 });
      output = { summary: "Implement scoped arithmetic and tests", changes: [
        { operation: "create", path: "src/calculator.mjs", content: "export const value = " + generations + ";", message: "Add arithmetic" },
        { operation: "create", path: "test/calculator.test.mjs", content: "import test from 'node:test'; test('fixture', () => {});", message: "Add tests" },
      ] };
    } else {
      const fail = role === "reviewer" && (config.rejectAllReviews || (config.rejectFirstReview && generations === 1));
      output = { ready: !fail, summary: fail ? "Arithmetic does not satisfy the shown task yet." : "Shown changes are scoped; host tests remain required.",
        findings: [], unverifiedAreas: ["Host runtime tests were not executed by this model."] };
    }
    return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(output) } }] });
  });
  const tools: CalculatorExecutionTools = {
    checkProposal: async input => { checks++; return { repository: plan.owner.repository, taskId: input.task.id, baseSha: A,
      proposalDigest: input.proposalDigest, status: "passed", testsExecuted: true, failures: [] }; },
    publish: async input => {
      publishes++; assert.equal(input.expectedSha, A); assert.equal(input.branch, plan.branch);
      candidateTree = [ { path: "src", sha: D, type: "tree", mode: "040000" }, { path: "test", sha: D, type: "tree", mode: "040000" },
        ...input.changes.files.map(file => ({ path: file.path, sha: digest(file.content), type: "blob", mode: "100644" })) ];
      head = B;
      return { branch: plan.branch, headSha: B, number: 1, url: "https://github.com/" + plan.owner.repository + "/pull/1" };
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
  return { execution: "offline-test" as const, store, plan, team, tools, workspace, reader, requests, candidateTree: () => candidateTree,
    move: (hash: string) => { head = hash; }, counts: () => ({ generations, publishes, checks, ciReads }),
    receipt: () => { const result = store.taskReceipt(plan, plan.tasks[0]); try { return result.inspectExisting(); } finally { result.close(); } },
    cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test("claimed task drives actual model-adapter calls, checks and exact-candidate CI without whole-app completion", async () => {
  const f = await fixture();
  try {
    const original = f.tools.checkProposal;
    f.tools.checkProposal = async input => { assert.equal(f.receipt()?.status, "running"); return original(input); };
    const result = await runCalculatorExecution(f.workspace, f);
    assert.equal(result.status, "candidate-verified"); assert.equal(result.candidateTestsExecuted, true);
    assert.equal(result.proposalTestsExecuted, true); assert.equal(result.wholeAppCompleted, false); assert.equal(result.finalCalculatorCiVerified, false);
    assert.deepEqual(f.requests.map(item => item.role), ["coder", "security", "reviewer", "tester"]);
    assert.deepEqual(f.counts(), { generations: 1, publishes: 1, checks: 1, ciReads: 1 });
    assert.equal(f.receipt()?.status, "needs-review"); assert.equal(f.receipt()?.publication?.headSha, B);
    assert.ok(!JSON.stringify(result).includes("export const"));
    const again = await runCalculatorExecution(f.workspace, f); assert.equal(again.status, "blocked");
    assert.equal(f.counts().generations, 1);
  } finally { f.cleanup(); }
});
test("a failed independent review returns a precise repair using the same ledger and reruns all gates", async () => {
  const f = await fixture({ rejectFirstReview: true });
  try {
    const result = await runCalculatorExecution(f.workspace, f);
    assert.equal(result.status, "candidate-verified"); assert.equal(result.attempts, 2); assert.equal(result.repairs, 1);
    assert.equal(f.team.snapshot().modelBudget.attemptedRequests, 8); assert.equal(f.team.snapshot().repairedTasks, 1);
    const repair = f.requests.filter(item => item.role === "coder")[1].packet.repair as { issues: string[]; previousChanges: unknown };
    assert.ok(repair.issues.some(issue => issue.includes("reviewer:"))); assert.ok(repair.previousChanges);
    assert.ok(f.receipt()?.stages.some(stage => stage.stage === "checks_failed_1" && stage.status === "blocked"));
    assert.ok(f.receipt()?.stages.some(stage => stage.stage === "repair_2" && stage.status === "passed"));
  } finally { f.cleanup(); }
});
test("failed host tests can request one repair; missing execution evidence cannot", async t => {
  for (const name of ["failed", "unverified", "forged-digest", "stale-base", "false-executed", "secret-diagnostic"]) await t.test(name, async () => {
    const f = await fixture();
    try {
      const original = f.tools.checkProposal; let calls = 0;
      f.tools.checkProposal = async input => {
        calls++; const base = await original(input);
        if (calls > 1) return base;
        const result: CalculatorProposalTests = { ...base, status: name === "unverified" ? "unverified" : "failed", testsExecuted: name !== "unverified" && name !== "false-executed", failures: ["Expected arithmetic result was not observed."] };
        if (name === "forged-digest") return { ...result, proposalDigest: "0".repeat(64) };
        if (name === "stale-base") return { ...result, baseSha: D };
        if (name === "secret-diagnostic") return { ...result, failures: ["ghp_" + "A".repeat(32)] };
        return result;
      };
      const result = await runCalculatorExecution(f.workspace, f);
      assert.equal(result.status, name === "failed" ? "candidate-verified" : "blocked");
      assert.equal(f.counts().generations, name === "failed" ? 2 : 1);
      assert.equal(f.counts().publishes, name === "failed" ? 1 : 0);
    } finally { f.cleanup(); }
  });
});
test("repair exhaustion and HTTP 429 stop durably without publication or task replay", async t => {
  for (const name of ["exhausted", "429"]) await t.test(name, async () => {
    const f = await fixture({ rejectAllReviews: true, rateLimitRepair: name === "429" });
    try {
      const result = await runCalculatorExecution(f.workspace, f);
      assert.equal(result.status, "blocked"); assert.equal(result.repairs, 1); assert.equal(f.counts().generations, 2);
      assert.equal(f.counts().publishes, 0); assert.equal(f.receipt()?.status, "blocked");
      await runCalculatorExecution(f.workspace, f); assert.equal(f.counts().generations, 2);
      assert.ok(!JSON.stringify(result).includes("private upstream source"));
    } finally { f.cleanup(); }
  });
});
test("unconfigured tools fail before claim or model consumption", async () => {
  const f = await fixture();
  try {
    const result = await runCalculatorExecution(f.workspace, { ...f, tools: {} as CalculatorExecutionTools });
    assert.equal(result.status, "blocked"); assert.equal(f.receipt(), undefined); assert.equal(f.counts().generations, 0);
  } finally { f.cleanup(); }
});
test("head movement during a model or host check stops before publication", async t => {
  for (const name of ["model", "host"]) await t.test(name, async () => {
    const f = await fixture();
    try {
      if (name === "model") { const original = f.team.generate; f.team = Object.freeze({ ...f.team, generate: async (...args: Parameters<typeof original>) => { const changes = await original(...args); f.move(D); return changes; } }); }
      else { const original = f.tools.checkProposal; f.tools.checkProposal = async input => { const result = await original(input); f.move(D); return result; }; }
      const result = await runCalculatorExecution(f.workspace, f);
      assert.equal(result.status, "blocked"); assert.equal(f.counts().publishes, 0); assert.equal(f.receipt()?.status, "blocked");
    } finally { f.cleanup(); }
  });
});
test("uncertain publication retains a needs-review receipt and forbids retry", async () => {
  const f = await fixture();
  try {
    f.tools.publish = async () => { throw new Error("unknown upstream response containing private source"); };
    const result = await runCalculatorExecution(f.workspace, f);
    assert.equal(result.status, "needs-review"); assert.equal(f.receipt()?.status, "needs-review");
    await runCalculatorExecution(f.workspace, f); assert.equal(f.counts().generations, 1);
  } finally { f.cleanup(); }
});
test("wrong parent/blob or unexpected source/workflow changes reject a published candidate", async t => {
  for (const name of ["parent", "blob", "workflow", "missing-directory", "moved-head", "foreign-pr", "protected-branch", "delete-original", "modify-original"]) await t.test(name, async () => {
    const f = await fixture();
    try {
      if (name === "delete-original" || name === "modify-original") {
        const old = f.reader.readTree;
        f.reader.readTree = async hash => hash === A ? { sha: A, truncated: false, tree: [{ path: "README.md", sha: D, type: "blob", mode: "100644" }] } : old(hash);
      }
      const original = f.tools.publish;
      f.tools.publish = async input => {
        const candidate = await original(input);
        if (name === "parent") { const old = f.reader.readCommit; f.reader.readCommit = async hash => ({ ...await old(hash), parents: hash === B ? [D] : [] }); }
        if (name === "blob") f.candidateTree().find(entry => entry.path === "src/calculator.mjs")!.sha = D;
        if (name === "workflow") f.candidateTree().push({ path: ".github/workflows/evil.yml", sha: D, type: "blob", mode: "100644" });
        if (name === "missing-directory") f.candidateTree().splice(0, 1);
        if (name === "moved-head") f.move(D);
        if (name === "modify-original") f.candidateTree().push({ path: "README.md", sha: B, type: "blob", mode: "100644" });
        if (name === "protected-branch") return { ...candidate, branch: "main" };
        return name === "foreign-pr" ? { ...candidate, url: "https://github.com/erman-ksv/Onay/pull/1" } : candidate;
      };
      const result = await runCalculatorExecution(f.workspace, f);
      assert.equal(result.status, name === "foreign-pr" || name === "protected-branch" ? "needs-review" : "blocked");
      assert.equal(result.candidateTestsExecuted, false); assert.equal(f.counts().ciReads, 0);
    } finally { f.cleanup(); }
  });
});
test("CI pending, failed, stale, foreign or skipped never produce verified-candidate status", async t => {
  for (const name of ["pending", "failed", "stale", "foreign", "skipped", "wrong-attempt", "missing-step"]) await t.test(name, async () => {
    const f = await fixture();
    try {
      const original = f.tools.ci;
      f.tools.ci = async input => {
        const result = await original(input);
        if (name === "pending") result.runs[0].status = "in_progress";
        if (name === "failed") result.runs[0].conclusion = "failure";
        if (name === "stale") result.runs[0].head_sha = A;
        if (name === "foreign") result.runs[0].html_url = "https://github.com/erman-ksv/Onay/actions/runs/17";
        if (name === "skipped") result.jobs[0].steps![1].conclusion = "skipped";
        if (name === "wrong-attempt") result.jobs[0].run_attempt = 2;
        if (name === "missing-step") result.jobs[0].steps!.pop();
        return result;
      };
      const result = await runCalculatorExecution(f.workspace, f);
      assert.notEqual(result.status, "candidate-verified"); assert.equal(result.candidateTestsExecuted, false);
      assert.equal(f.counts().ciReads, 1);
    } finally { f.cleanup(); }
  });
});
test("live execution still requires explicit host write authorization and repository scope", async t => {
  for (const key of ["CALCULATOR_EXECUTION_LIVE_APPROVED", "AGENT_FACTORY_ENABLE_GITHUB_WRITES", "AGENT_FACTORY_LEGAL_ENABLED", "AGENT_ALLOWED_REPOSITORIES"]) await t.test(key, async () => {
    const f = await fixture();
    try {
      const approved = { ...env, CALCULATOR_EXECUTION_LIVE_APPROVED: "RUN_ONE_FREE_CALCULATOR_TASK", AGENT_FACTORY_ENABLE_GITHUB_WRITES: "true",
        AGENT_ALLOWED_REPOSITORIES: CALCULATOR_PROFILE.repository, [key]: "" };
      const result = await runCalculatorExecution(f.workspace, { ...f, execution: "live", env: approved });
      assert.equal(result.status, "blocked"); assert.equal(f.receipt(), undefined); assert.equal(f.counts().generations, 0);
    } finally { f.cleanup(); }
  });
});
test("repair rejects forged proposals, wrong digests and additional attempts before another HTTP request", async t => {
  for (const name of ["forged", "digest", "empty", "extra-attempt"]) await t.test(name, async () => {
    const f = await fixture();
    try {
      const snapshot = await loadCalculatorWorkspaceTask(f.workspace, f.plan.tasks[0].id);
      const original = await f.team.generate(f.plan, f.plan.tasks[0].id, snapshot);
      let previous = original;
      if (name === "extra-attempt") previous = await f.team.repair(f.plan, f.plan.tasks[0].id, snapshot,
        { previous, proposalDigest: calculatorProposalDigest(previous), issues: ["The observed test result needs correction."] });
      await assert.rejects(() => f.team.repair(f.plan, f.plan.tasks[0].id, snapshot, {
        previous: name === "forged" ? JSON.parse(JSON.stringify(previous)) : previous,
        proposalDigest: name === "digest" ? "0".repeat(64) : calculatorProposalDigest(previous),
        issues: name === "empty" ? [] : ["The observed test result needs correction."],
      }));
      assert.equal(f.counts().generations, name === "extra-attempt" ? 2 : 1);
    } finally { f.cleanup(); }
  });
});
test("a host failure cannot forward a full private original through repair diagnostics", async () => {
  const f = await fixture();
  try {
    const source = "export const value = 41; // original-only-data", hash = createHash("sha256").update(source).digest("hex");
    f.reader.readTree = async () => ({ sha: A, truncated: false, tree: [
      { path: "src", sha: D, type: "tree", mode: "040000" },
      { path: "src/calculator.mjs", sha: digest(source), type: "blob", mode: "100644" },
    ] });
    f.reader.readBlob = async () => ({ sha: digest(source), encoding: "base64", content: Buffer.from(source).toString("base64") });
    let calls = 0;
    const team = createCalculatorModelTeam(owner, env, async () => {
      calls++; return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ summary: "Adjust scoped value", changes: [
        { operation: "patch", path: "src/calculator.mjs", sourceSha256: hash, edits: [{ before: "value = 41", after: "value = 42" }], message: "Adjust value" },
      ] }) } }] });
    });
    // The commit tree identity must agree with its readCommit link.
    f.reader.readCommit = async () => ({ sha: A, treeSha: A, parents: [] });
    const snapshot = await loadCalculatorWorkspaceTask(f.workspace, f.plan.tasks[0].id);
    const changes = await team.generate(f.plan, f.plan.tasks[0].id, snapshot);
    await assert.rejects(() => team.repair(f.plan, f.plan.tasks[0].id, snapshot, {
      previous: changes, proposalDigest: calculatorProposalDigest(changes), issues: [source],
    }));
    assert.equal(calls, 1);
  } finally { f.cleanup(); }
});

test("host zero-repair limit blocks a rejected review or failed host check without regeneration", async t => {
  for (const trigger of ["reviewer", "host-tests"]) await t.test(trigger, async () => {
    const f = await fixture({ rejectFirstReview: trigger === "reviewer" });
    try {
      let repairs = 0;
      const originalRepair = f.team.repair;
      f.team = Object.freeze({ ...f.team, repair: async (...args: Parameters<typeof originalRepair>) => {
        repairs++; return originalRepair(...args);
      } });
      if (trigger === "host-tests") {
        const originalCheck = f.tools.checkProposal;
        f.tools.checkProposal = async input => ({ ...await originalCheck(input), status: "failed", testsExecuted: true,
          failures: ["Expected arithmetic result was not observed."] });
      }
      const result = await runCalculatorExecution(f.workspace, { ...f, maxRepairs: 0 });
      assert.equal(result.status, "blocked"); assert.equal(result.reasonCode, "repair_limit_reached");
      assert.equal(result.attempts, 1); assert.equal(result.repairs, 0); assert.equal(repairs, 0);
      assert.deepEqual(f.requests.map(item => item.role), ["coder", "security", "reviewer", "tester"]);
      assert.equal(f.counts().generations, 1); assert.equal(f.counts().publishes, 0); assert.equal(f.counts().ciReads, 0);
      assert.equal(f.receipt()!.status, "blocked");
      assert.equal(f.receipt()!.stages.some(stage => stage.stage === "repair_2"), false);
    } finally { f.cleanup(); }
  });
});

test("host zero-repair limit still permits a successful first candidate through all four roles", async () => {
  const f = await fixture();
  try {
    const result = await runCalculatorExecution(f.workspace, { ...f, maxRepairs: 0 });
    assert.equal(result.status, "candidate-verified"); assert.equal(result.attempts, 1); assert.equal(result.repairs, 0);
    assert.equal(result.proposalTestsExecuted, true); assert.equal(result.candidateTestsExecuted, true);
    assert.deepEqual(f.requests.map(item => item.role), ["coder", "security", "reviewer", "tester"]);
    assert.deepEqual(f.counts(), { generations: 1, publishes: 1, checks: 1, ciReads: 1 });
  } finally { f.cleanup(); }
});

test("invalid host repair limits fail before a task claim or model call", async t => {
  for (const value of [2, -1, "0", null]) await t.test(String(value), async () => {
    const f = await fixture();
    try {
      const result = await runCalculatorExecution(f.workspace, { ...f, maxRepairs: value as 0 | 1 });
      assert.equal(result.status, "blocked"); assert.equal(f.receipt(), undefined);
      assert.deepEqual(f.requests, []); assert.deepEqual(f.counts(), { generations: 0, publishes: 0, checks: 0, ciReads: 0 });
    } finally { f.cleanup(); }
  });
});

test("explicit restoration reuses the full existing gates without a new Coder call", async () => {
  const f = await fixture();
  try {
    const task = f.plan.tasks[0], snapshot = await loadCalculatorWorkspaceTask(f.workspace, task.id);
    const saved = await f.team.generate(f.plan, task.id, snapshot), roles: string[] = [];
    const team = createCalculatorModelTeam(owner, env, async (_url, init) => {
      const instructions = JSON.parse(String(init?.body)).messages[0].content as string;
      const role = ["security", "reviewer", "tester"].find(value => instructions.includes("You are the " + value + " "));
      assert.ok(role); roles.push(role);
      return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        ready: true, summary: "Scoped evidence reviewed; host tests remain necessary.", findings: [], unverifiedAreas: [] }) } }] });
    });
    const result = await runCalculatorExecution(f.workspace, { ...f, team, maxRepairs: 0,
      restoreProposal: (plan, id, fresh) => team.restoreProposal(plan, id, fresh, saved, calculatorProposalDigest(saved)) });
    assert.equal(result.status, "candidate-verified"); assert.equal(result.proposalTestsExecuted, true);
    assert.equal(result.candidateTestsExecuted, true); assert.equal(result.repairs, 0);
    assert.deepEqual(roles, ["security", "reviewer", "tester"]);
    assert.equal(team.snapshot().generatedTasks, 0); assert.equal(team.snapshot().restoredTasks, 1);
    assert.deepEqual(f.counts(), { generations: 1, checks: 1, publishes: 1, ciReads: 1 });
    assert.ok(f.receipt()?.stages.some(stage => stage.stage === "restore_proposal_1" && stage.status === "passed"));
    assert.ok(!f.receipt()?.stages.some(stage => stage.stage === "generate_1"));
  } finally { f.cleanup(); }
});

test("a restoration entry cannot enable repairs, claim invalid configuration or bypass fresh validation", async t => {
  for (const scenario of ["repair-enabled", "bad-callback", "restore-failed", "changed-base"]) await t.test(scenario, async () => {
    const f = await fixture();
    try {
      const task = f.plan.tasks[0], saved = await f.team.generate(f.plan, task.id, await loadCalculatorWorkspaceTask(f.workspace, task.id));
      const restore = () => {
        if (scenario === "restore-failed") throw Error("PRIVATE_RESTORE_ERROR");
        return scenario === "changed-base" ? { ...saved, baseSha: D } : saved;
      };
      const result = await runCalculatorExecution(f.workspace, { ...f, maxRepairs: scenario === "repair-enabled" ? 1 : 0,
        restoreProposal: scenario === "bad-callback" ? 3 as unknown as typeof restore : restore });
      assert.equal(result.status, "blocked"); assert.equal(result.proposalTestsExecuted, false);
      assert.deepEqual(f.requests.map(request => request.role), ["coder"]);
      assert.deepEqual(f.counts(), { generations: 1, checks: 0, publishes: 0, ciReads: 0 });
      if (scenario === "repair-enabled" || scenario === "bad-callback") assert.equal(f.receipt(), undefined);
      else assert.ok(f.receipt()?.stages.some(stage => stage.stage === "restore_proposal_1" && stage.status === "blocked"));
      assert.ok(!JSON.stringify(result).includes("PRIVATE_RESTORE_ERROR"));
    } finally { f.cleanup(); }
  });
});

test("saved validated Security and Reviewer stages restore without HTTP and only Tester executes", async () => {
  const f = await fixture();
  try {
    const task = f.plan.tasks[0], snapshot = await loadCalculatorWorkspaceTask(f.workspace, task.id);
    const saved = await f.team.generate(f.plan, task.id, snapshot), prior = [];
    for (const role of ["security", "reviewer"] as const) prior.push(await f.team.assess(role, f.plan, task.id, saved));
    const roles: string[] = [], stages: string[] = [];
    const team = createCalculatorModelTeam(owner, env, async (_url, init) => {
      const instructions = JSON.parse(String(init?.body)).messages[0].content as string;
      assert.ok(instructions.includes("You are the tester ")); roles.push("tester");
      return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        ready: true, summary: "Scoped test design reviewed; actual host tests are still required.", findings: [], unverifiedAreas: [] }) } }] });
    });
    const result = await runCalculatorExecution(f.workspace, { ...f, team, maxRepairs: 0,
      restoreProposal: (plan, id, fresh) => team.restoreProposal(plan, id, fresh, saved, calculatorProposalDigest(saved), prior),
      restoreAssessments: (plan, id, changes) => team.restoredAssessmentPrefix(plan, id, changes),
      checkpoint: event => { if (event.status === "passed") stages.push(event.stage); } });
    assert.equal(result.status, "candidate-verified"); assert.equal(result.proposalTestsExecuted, true);
    assert.equal(result.candidateTestsExecuted, true); assert.equal(result.repairs, 0);
    assert.deepEqual(roles, ["tester"]); assert.deepEqual(f.requests.map(value => value.role), ["coder", "security", "reviewer"]);
    assert.ok(stages.includes("restore_security_1")); assert.ok(stages.includes("restore_reviewer_1"));
    assert.ok(stages.includes("tester_1")); assert.ok(!stages.includes("security_1")); assert.ok(!stages.includes("reviewer_1"));
    assert.deepEqual(f.counts(), { generations: 1, checks: 1, publishes: 1, ciReads: 1 });
  } finally { f.cleanup(); }
});

test("restored assessments require an explicit proposal restore and cannot enable repairs", async t => {
  for (const mode of ["missing-proposal", "repair-enabled", "non-function"]) await t.test(mode, async () => {
    const f = await fixture();
    try {
      const callback = () => [];
      const result = await runCalculatorExecution(f.workspace, { ...f, maxRepairs: mode === "repair-enabled" ? 1 : 0,
        ...(mode !== "missing-proposal" ? { restoreProposal: async () => { throw Error("must not restore"); } } : {}),
        restoreAssessments: mode === "non-function" ? 3 as unknown as typeof callback : callback });
      assert.equal(result.status, "blocked"); assert.equal(f.receipt(), undefined);
      assert.equal(f.requests.length, 0); assert.deepEqual(f.counts(), { generations: 0, checks: 0, publishes: 0, ciReads: 0 });
    } finally { f.cleanup(); }
  });
});
