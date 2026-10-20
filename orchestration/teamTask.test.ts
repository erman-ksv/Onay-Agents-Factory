import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { runTeamTask, teamTaskSummary, type TeamTaskDependencies } from "./teamTask.js";
import { prepareTeamTask, type TeamTaskCard } from "./teamTaskCard.js";
import { evaluateTestExecutionEvidence, type TestExecutionEvidence } from "../agents/tester/agent.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";
import { inspectProposedChanges } from "../agents/security/agent.js";

const repository = "erman-ksv/Onay";
const baseSha = "a".repeat(40);
const candidateSha = "b".repeat(40);
const path = "mobile/tezjet-app/lib/orders.ts";
const privateSource = "export const passengerOrderReady = false;\n" +
  Array.from({ length: 100 }, (_, index) => "// private unchanged body " + index + " " + "x".repeat(70)).join("\n") + "\n";
const changedSource = privateSource.replace("passengerOrderReady = false", "passengerOrderReady = true");
const liveApproved = {
  ONAY_TEAM_LIVE_APPROVED: "RUN_ONE_FREE_TASK", ONAY_TEAM_FREE_TIER_CONFIRMED: "true",
  AGENT_FACTORY_ENABLE_GITHUB_WRITES: "true", AGENT_FACTORY_LEGAL_ENABLED: "false",
};

function card(): TeamTaskCard {
  return {
    version: 1, id: "passenger-order-state", goal: "Исправить состояние заказа пассажира.",
    acceptanceCriteria: ["Существующая поездка сохраняется при обновлении экрана."],
    profile: "mobile", provider: "cloudflare", baseRef: "feat/owner-approved-base", baseSha,
    changePaths: [path], contextPaths: ["mobile/tezjet-app/package.json"],
  };
}
function fixture(t: { after: (callback: () => void) => void }, input = card(), overrides: Partial<TeamTaskDependencies> = {}) {
  const stateDirectory = mkdtempSync(join(tmpdir(), "team-task-engine-"));
  t.after(() => rmSync(stateDirectory, { recursive: true, force: true }));
  const task = prepareTeamTask(input);
  const calls: string[] = [];
  const contexts: string[] = [];
  const changedPath = input.changePaths[0];
  const evidence = (sha = candidateSha, ref = task.branch, mode: "passed" | "pending" | "failed" | "missing-step" = "passed"): TestExecutionEvidence => {
    const result = evaluateTestExecutionEvidence([{
      id: 42, run_attempt: 1, name: "Trusted required CI", status: mode === "pending" ? "in_progress" : "completed",
      conclusion: mode === "pending" ? null : mode === "failed" ? "failure" : "success",
      head_sha: sha, html_url: "https://github.com/erman-ksv/Onay/actions/runs/42",
    }], task.requiredCiNames.map(name => ({
      name, run_id: 42, run_attempt: 1, head_sha: sha, status: "completed", conclusion: "success",
      steps: task.requiredCiSteps.filter((_, index) => mode !== "missing-step" || index !== 0)
        .map(name => ({ name, status: "completed", conclusion: "success" })),
    })), sha, task.requiredCiNames, task.requiredCiSteps);
    return { ...result, repository, ref };
  };
  const dependencies: TeamTaskDependencies = {
    getHead: async () => { calls.push("getHead"); return baseSha; },
    getCandidateHead: async ref => { calls.push("getCandidateHead"); assert.equal(ref, task.branch); return candidateSha; },
    explore: async sha => {
      calls.push("explore"); assert.equal(sha, baseSha);
      return { repository, ref: sha, files: task.explorerPaths.map((filePath, index) => ({
        path: filePath, sha: String(index + 1).repeat(40),
        content: filePath === changedPath ? privateSource : JSON.stringify({ name: "onay-fixture", scripts: { test: "node --test" } }),
      })) };
    },
    generatePatch: async (context, sources) => {
      calls.push("generatePatch"); contexts.push(context);
      assert.deepEqual([...sources.keys()], task.changePaths);
      assert.equal(sources.get(changedPath), privateSource);
      return { summary: "Safe fixture edit", files: [{ path: changedPath, content: changedSource, message: "Update order state" }] };
    },
    assess: async (role, context) => { calls.push("assess:" + role); contexts.push(context); return { ready: true, findings: [] }; },
    review: files => { calls.push("review"); return reviewChangeSet({ goal: task.goal, files }); },
    scan: files => { calls.push("scan"); return inspectProposedChanges(files); },
    inspectSecurity: async sha => { calls.push("inspectSecurity"); assert.equal(sha, baseSha);
      return { agent: "security", repository, ref: sha, status: "clean", findings: [] }; },
    discoverTests: async () => { calls.push("discoverTests"); return { scripts: ["test: node --test"], validJson: true }; },
    publish: async (files, sha) => {
      calls.push("publish"); assert.equal(sha, baseSha);
      assert.deepEqual(files.map(file => file.path), [changedPath]);
      assert.equal(files[0].content, changedSource);
      return { head_sha: candidateSha, html_url: "https://github.com/erman-ksv/Onay/pull/42", number: 42 };
    },
    verify: async (sha, ref) => { calls.push("verify"); assert.equal(sha, candidateSha); assert.equal(ref, task.branch); return evidence(sha, ref); },
    ...overrides,
  };
  const execute = (env: NodeJS.ProcessEnv = {}, execution: "offline-test" | "live" = "offline-test") =>
    runTeamTask(input, { stateDirectory, env, dependencies, execution });
  const receipt = () => JSON.parse(readFileSync(join(stateDirectory, input.id + ".json"), "utf8"));
  return { stateDirectory, task, calls, contexts, dependencies, execute, evidence, receipt };
}

test("one Russian owner goal executes all mandatory actors in host gate order and exact-commit CI", async t => {
  const setup = fixture(t);
  const result = await setup.execute();
  assert.equal(result.status, "completed");
  assert.equal(result.reasonCode, "verified_candidate");
  assert.deepEqual(result.gates, { security: true, policyReview: true, testsExecuted: true, independentAdvice: true });
  assert.equal(result.baseSha, baseSha);
  assert.equal(result.testedSha, candidateSha);
  assert.deepEqual(result.changedPaths, [path]);
  assert.equal(result.legalReview, "disabled");
  assert.equal(result.mergePerformed, false);
  assert.equal(result.deploymentPerformed, false);
  assert.deepEqual(setup.calls, [
    "getHead", "explore", "inspectSecurity", "generatePatch",
    "assess:product", "assess:ux", "assess:frontend", "assess:backend", "assess:dispatch",
    "review", "assess:reviewer", "inspectSecurity", "scan", "getHead", "publish",
    "discoverTests", "verify", "getCandidateHead", "getCandidateHead",
  ]);
  assert.deepEqual(setup.receipt().stages.map((item: { stage: string }) => item.stage), [
    "explore_onay", "preflight_security", "code_onay", "product_assessment", "ux_assessment",
    "frontend_assessment", "backend_assessment", "dispatch_assessment", "review_onay_changes",
    "final_independent_review", "security_review", "publish_change_set", "test_onay",
  ]);
  assert.equal(setup.receipt().status, "completed");
});

test("backend profile executes database review even when Russian task contains no routing keywords", async t => {
  const input = card();
  input.profile = "backend";
  input.changePaths = ["artifacts/api-server/src/controllers/orderController.ts"];
  input.contextPaths = [];
  const setup = fixture(t, input);
  const result = await setup.execute();
  assert.equal(result.status, "completed");
  assert.deepEqual(setup.calls.filter(call => call.startsWith("assess:")), [
    "assess:product", "assess:backend", "assess:database", "assess:dispatch", "assess:reviewer",
  ]);
});

test("base SHA or Explorer scope mismatch stops before model generation or writes", async t => {
  for (const variant of ["base-sha", "explorer-scope", "explorer-ref"] as const) await t.test(variant, async t => {
    const setup = fixture(t);
    if (variant === "base-sha") setup.dependencies.getHead = async () => "c".repeat(40);
    else {
      const explore = setup.dependencies.explore;
      setup.dependencies.explore = async sha => {
        const result = await explore(sha);
        if (variant === "explorer-scope") result.files[0].path = "commander/unapproved.ts";
        else result.ref = "c".repeat(40);
        return result;
      };
    }
    const result = await setup.execute();
    assert.equal(result.status, "blocked");
    assert.equal(setup.calls.includes("generatePatch"), false);
    assert.equal(setup.calls.includes("publish"), false);
  });
});

test("preflight security blocks Coder before a clean repository scan is proven", async t => {
  const setup = fixture(t, card(), { inspectSecurity: async sha => ({ agent: "security", repository, ref: sha,
    status: "findings", findings: [{ path: "package.json", findings: ["Synthetic blocker"] }] }) });
  const result = await setup.execute();
  assert.equal(result.status, "blocked");
  assert.equal(setup.calls.includes("generatePatch"), false);
  assert.equal(setup.calls.includes("publish"), false);
});

test("each independent advisor and final Reviewer can block publication including ready with high findings", async t => {
  for (const role of ["product", "ux", "frontend", "backend", "dispatch", "reviewer"]) await t.test(role, async t => {
    const setup = fixture(t);
    setup.dependencies.assess = async (actor, context) => {
      setup.calls.push("assess:" + actor); setup.contexts.push(context);
      return actor === role ? { ready: true, findings: [{ severity: "high", message: "Synthetic unresolved acceptance blocker" }] }
        : { ready: true, findings: [] };
    };
    const result = await setup.execute();
    assert.equal(result.status, "blocked");
    assert.equal(result.gates.independentAdvice, false);
    assert.equal(setup.calls.includes("publish"), false);
  });
});

test("policy rejection, proposed security findings and out-of-scope proposals never publish", async t => {
  for (const variant of ["policy", "security", "scope"] as const) await t.test(variant, async t => {
    const setup = fixture(t);
    if (variant === "policy") setup.dependencies.review = () => ({ agent: "reviewer", ready: false,
      findings: [{ severity: "blocker", message: "Synthetic policy blocker" }] });
    if (variant === "security") setup.dependencies.scan = () => ({ agent: "security", status: "findings",
      findings: [{ path, line: 1, pattern: "fixture", message: "Synthetic security blocker" }] });
    if (variant === "scope") setup.dependencies.generatePatch = async () => ({ summary: "Invalid scope fixture",
      files: [{ path: "mobile/tezjet-app/lib/unapproved.ts", content: changedSource, message: "Unapproved path" }] });
    const result = await setup.execute();
    assert.equal(result.status, "blocked");
    assert.equal(setup.calls.includes("publish"), false);
  });
});

test("base branch movement before publication requires replanning and performs no write", async t => {
  const setup = fixture(t);
  let reads = 0;
  setup.dependencies.getHead = async () => ++reads === 1 ? baseSha : "c".repeat(40);
  const result = await setup.execute();
  assert.equal(result.status, "blocked");
  assert.equal(setup.calls.includes("publish"), false);
  assert.equal(result.publication, undefined);
});

test("pending, failed or incomplete exact CI cannot produce completed", async t => {
  for (const mode of ["pending", "failed", "missing-step"] as const) await t.test(mode, async t => {
    const setup = fixture(t);
    setup.dependencies.verify = async (sha, ref) => setup.evidence(sha, ref, mode);
    const result = await setup.execute();
    assert.equal(result.status, "needs-review");
    assert.equal(result.gates.testsExecuted, false);
    assert.equal(result.testedSha, undefined);
    assert.equal(result.publication?.headSha, candidateSha);
    assert.equal(setup.receipt().status, "needs-review");
  });
});

test("stale successful CI and a final candidate head change cannot produce completed", async t => {
  for (const variant of ["stale-ci", "test-head", "final-head"] as const) await t.test(variant, async t => {
    const setup = fixture(t);
    if (variant === "stale-ci") setup.dependencies.verify = async (_sha, ref) => setup.evidence("c".repeat(40), ref);
    else {
      let reads = 0;
      setup.dependencies.getCandidateHead = async () => ++reads >= (variant === "final-head" ? 2 : 1) ? "c".repeat(40) : candidateSha;
    }
    const result = await setup.execute();
    assert.equal(result.status, "needs-review");
    assert.equal(result.gates.testsExecuted, false);
    assert.equal(result.testedSha, undefined);
    assert.equal(result.publication?.headSha, candidateSha);
  });
});

test("an existing task receipt causes no model, Explorer or publication replay", async t => {
  const setup = fixture(t);
  assert.equal((await setup.execute()).status, "completed");
  const previousCalls = [...setup.calls];
  const previousReceipt = setup.receipt();
  const replay = await setup.execute();
  assert.equal(replay.status, "already-recorded");
  assert.equal(replay.reasonCode, "inspect_existing_receipt_no_replay");
  assert.deepEqual(setup.calls, previousCalls);
  assert.deepEqual(setup.receipt(), previousReceipt);
  assert.equal(replay.gates.testsExecuted, false);
});

test("state files and report exclude complete private source and do not misstate unseen evidence", async t => {
  const setup = fixture(t);
  const result = await setup.execute();
  assert.equal(result.status, "completed");
  const artifacts = readdirSync(setup.stateDirectory).map(name => readFileSync(join(setup.stateDirectory, name), "utf8")).join("\n");
  for (const output of [artifacts, JSON.stringify(result), teamTaskSummary(result), ...setup.contexts]) {
    assert.ok(!output.includes(privateSource));
    assert.ok(!output.includes(changedSource));
    assert.ok(!output.includes(JSON.stringify(privateSource).slice(1, -1)));
  }
  assert.ok(!artifacts.includes(card().goal));
  assert.ok(!artifacts.includes("private unchanged body"));
  assert.ok(result.unverifiedAreas.some(area => /Unshown source/.test(area)));
  assert.ok(result.unverifiedAreas.some(area => /Physical Android\/iPhone/.test(area)));
  assert.ok(setup.contexts.every(context => context.includes(baseSha)));
});

test("post-write verification failure preserves the publication receipt for reconciliation", async t => {
  const setup = fixture(t, card(), { verify: async () => { throw new Error("Synthetic CI read failure."); } });
  const result = await setup.execute();
  assert.equal(result.status, "blocked");
  assert.equal(result.publication?.number, 42);
  assert.equal(result.publication?.headSha, candidateSha);
  assert.equal(result.gates.testsExecuted, false);
  assert.deepEqual(result.changedPaths, [path]);
  const saved = setup.receipt();
  assert.equal(saved.status, "blocked");
  assert.deepEqual(saved.publication, { branch: setup.task.branch, number: 42,
    headSha: candidateSha, url: "https://github.com/erman-ksv/Onay/pull/42" });
  const calls = [...setup.calls];
  assert.equal((await setup.execute()).status, "already-recorded");
  assert.deepEqual(setup.calls, calls);
});

test("live and omitted execution mode require every explicit owner approval before any dependency call", async t => {
  const setup = fixture(t);
  await assert.rejects(setup.execute({}, "live"), /explicit host approval/);
  await assert.rejects(runTeamTask(card(), { stateDirectory: setup.stateDirectory, env: {}, dependencies: setup.dependencies }), /explicit host approval/);
  for (const field of Object.keys(liveApproved)) {
    const env: NodeJS.ProcessEnv = { ...liveApproved };
    delete env[field];
    await assert.rejects(setup.execute(env, "live"), /explicit host approval/);
  }
  await assert.rejects(setup.execute({ ...liveApproved, AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES: "true" }, "live"), /explicit host approval/);
  assert.deepEqual(setup.calls, []);
  assert.deepEqual(readdirSync(setup.stateDirectory), []);
});

test("exact review patches show distant edits without sending unrelated middle source", async t => {
  const first = { before: "passengerOrderReady = false", after: "passengerOrderReady = true" };
  const last = { before: "// private unchanged body 99", after: "// reviewed final boundary 99" };
  const content = privateSource.replace(first.before, first.after).replace(last.before, last.after);
  const setup = fixture(t, card(), {
    generatePatch: async () => ({
      summary: "Two bounded fixture edits",
      files: [{ path, content, message: "Apply two bounded edits" }],
      reviewPatches: [{ path, sourceSha256: createHash("sha256").update(privateSource).digest("hex"),
        edits: [first, last], message: "Apply two bounded edits" }],
    }),
    publish: async () => ({ head_sha: candidateSha, html_url: "https://github.com/erman-ksv/Onay/pull/42", number: 42 }),
  });
  const result = await setup.execute();
  assert.equal(result.status, "completed");
  assert.ok(setup.contexts.length > 0);
  for (const context of setup.contexts) {
    assert.equal(context.includes("// private unchanged body 50"), false);
    assert.ok(context.includes(last.after));
  }
  assert.equal(JSON.stringify(result).includes("private unchanged body 50"), false);
});

test("review patches must reconstruct exactly the current host proposal before any advice or publication", async t => {
  const setup = fixture(t, card(), {
    generatePatch: async () => ({
      summary: "Mismatched review fixture",
      files: [{ path, content: changedSource, message: "Change readiness" }],
      reviewPatches: [{ path, sourceSha256: createHash("sha256").update(privateSource).digest("hex"),
        edits: [{ before: "passengerOrderReady = false", after: "passengerOrderReady = 123" }],
        message: "Different change than the proposal" }],
    }),
  });
  const result = await setup.execute();
  assert.equal(result.status, "blocked");
  assert.equal(setup.calls.some(name => name.startsWith("assess:") || name === "publish"), false);
});

test("reports retain actionable blockers while suppressing source-bearing specialist diagnostics", async t => {
  const setup = fixture(t, card(), {
    assess: async () => ({ ready: false, findings: [
      { severity: "high", message: "The requested acceptance criterion has no corresponding test." },
      { severity: "high", message: privateSource },
    ] }),
  });
  const result = await setup.execute();
  assert.equal(result.status, "blocked");
  assert.equal(setup.calls.includes("publish"), false);
  assert.equal(result.advisoryFindings.product.findings[0].message,
    "The requested acceptance criterion has no corresponding test.");
  assert.equal(JSON.stringify(result).includes("private unchanged body"), false);
  assert.ok(result.advisoryFindings.product.findings[1].message.includes("trusted host"));
});
