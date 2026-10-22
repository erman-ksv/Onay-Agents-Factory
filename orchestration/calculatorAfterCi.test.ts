import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareCalculatorRoleChanges, validateCalculatorAssessment } from "../commander/calculatorTeam.js";
import type { CalculatorCiEvidence } from "../github/calculatorCi.js";
import type { CalculatorSnapshotReader, CalculatorTreeEntry } from "../github/calculatorSnapshot.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import type { CalculatorExecutionTeam, CalculatorExecutionTools } from "./calculatorExecution.js";
import type { CalculatorCheckRunner } from "./calculatorWorkspace.js";
import { CALCULATOR_AFTER_CI_ERROR, prepareCalculatorAfterCiRequest, runCalculatorAfterCi,
  type CalculatorAfterCiOptions } from "./calculatorAfterCi.js";

const saved = JSON.parse(readFileSync(new URL("./fixtures/calculatorStep7SavedPlan.json", import.meta.url), "utf8"));
const A = saved.request.baseSha as string, B = "b".repeat(40), C = "c".repeat(40), D = "d".repeat(40);
const blob = (content: string) => createHash("sha1").update("blob " + Buffer.byteLength(content) + "\0" + content).digest("hex");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "calculator-after-ci-")), state = join(root, "state"), events = join(root, "events");
  mkdirSync(state, { mode: 0o700 }); mkdirSync(events, { mode: 0o700 });
  const store = new CalculatorPlanStore(state, saved.request), plan = store.initialize(saved.proposal), previous = plan.tasks[0], next = plan.tasks[1];
  const receipt = store.taskReceipt(plan, previous); assert.equal(receipt.claim(), "claimed");
  for (const stage of ["load_current_source", "restore_proposal_1", "restore_security_1", "restore_reviewer_1", "tester_1", "host_tests_1", "publish_candidate", "verify_candidate_ci"]) {
    receipt.recordStage(stage, "running"); receipt.recordStage(stage, "passed");
  }
  receipt.recordPublication({ branch: plan.branch, headSha: B, number: 1, url: "https://github.com/" + plan.owner.repository + "/pull/1" });
  receipt.finish("needs-review", "candidate_ci_pending_no_polling"); receipt.close();
  const receiptPath = join(state, "calc-" + previous.id + ".json"), originalReceipt = readFileSync(receiptPath);
  const sources = new Map([["src/calculator.mjs", "export const add = (a, b) => a + b;\n"],
    ["test/calculator.test.mjs", "export const arithmeticChecked = true;\n"]]);
  const entry = (path: string, content: string): CalculatorTreeEntry => ({ path, sha: blob(content), type: "blob", mode: "100644" });
  const initial: CalculatorTreeEntry[] = [{ path: "src", sha: D, type: "tree", mode: "040000" },
    { path: "test", sha: D, type: "tree", mode: "040000" }, ...[...sources].map(([path, content]) => entry(path, content))];
  const trees = new Map<string, CalculatorTreeEntry[]>([[A, []], [B, initial]]);
  let head = B, ciCalls = 0, dependencyCalls = 0, generations = 0, checks = 0, publishes = 0;
  const assessed: string[] = [];
  const reader: CalculatorSnapshotReader = {
    getHead: async () => head,
    readCommit: async sha => ({ sha, treeSha: sha, parents: sha === A ? [] : [sha === B ? A : B] }),
    readTree: async sha => ({ sha, truncated: false, tree: trees.get(sha) ?? [] }),
    readBlob: async sha => {
      const source = [...sources].find(([, content]) => blob(content) === sha)?.[1];
      if (source === undefined) throw Error("Missing fixture blob");
      return { sha, encoding: "base64", content: Buffer.from(source).toString("base64") };
    },
  };
  const evidence = (sha: string): CalculatorCiEvidence => ({ repository: plan.owner.repository, branch: plan.branch, candidateSha: sha,
    runs: [{ id: sha === B ? 17 : 18, name: "Calculator task CI", status: "completed", conclusion: "success", head_sha: sha, run_attempt: 1,
      html_url: "https://github.com/" + plan.owner.repository + "/actions/runs/" + (sha === B ? 17 : 18) }],
    jobs: [{ name: "Calculator task CI", status: "completed", conclusion: "success", head_sha: sha, run_id: sha === B ? 17 : 18, run_attempt: 1,
      steps: ["Syntax", "Task tests"].map(name => ({ name, status: "completed", conclusion: "success" })) }],
    provenance: { candidateSha: sha, workflowPins: [{ id: 9, path: ".github/workflows/calculator-task-ci.yml", blobSha: D }], verifiedRunIds: [sha === B ? 17 : 18] },
  });
  let readCi: (call: number) => CalculatorCiEvidence = () => evidence(B);
  const ci: CalculatorAfterCiOptions["ci"] = async input => { ciCalls++; assert.equal(input.candidateSha, B); return readCi(ciCalls); };
  const verifyDependencies: CalculatorCheckRunner = async input => {
    dependencyCalls++; assert.equal(input.task.id, previous.id); assert.deepEqual(input.changedSinceCandidate, []);
    return { repository: input.repository, planFingerprint: input.planFingerprint, taskId: input.task.id,
      candidateSha: input.candidateSha, currentSha: input.currentSha,
      securityReady: true, independentReviewReady: true, taskChecksPassed: true, testsExecuted: true };
  };
  const team: CalculatorExecutionTeam = {
    generate: async (_plan, id, snapshot) => {
      generations++; assert.equal(id, next.id);
      const running = store.taskReceipt(plan, next); try { assert.equal(running.inspectExisting()?.status, "running"); } finally { running.close(); }
      return prepareCalculatorRoleChanges("frontend", { summary: "Add scoped static UI scaffolding", changes: [
        { operation: "create", path: "index.html", content: "<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head><body><main><output aria-live=\"polite\">0</output><button type=\"button\">1</button></main><script type=\"module\" src=\"src/app.mjs\"></script></body></html>", message: "Add controls" },
        { operation: "create", path: "styles.css", content: "body { color: #111; }\n", message: "Style controls" },
        { operation: "create", path: "src/app.mjs", content: "export const ready = true;\n", message: "Add UI module" },
      ] }, snapshot);
    },
    repair: async () => { throw Error("No repairs allowed"); },
    assess: async (role, _plan, id) => { assert.equal(id, next.id); assessed.push(role); return validateCalculatorAssessment(role,
      { ready: true, summary: "Scoped fixture proposal reviewed; real tests remain required.", findings: [], unverifiedAreas: [] }, ["changes@" + B]); },
  };
  const tools: CalculatorExecutionTools = {
    checkProposal: async input => { checks++; return { repository: plan.owner.repository, taskId: next.id, baseSha: B,
      proposalDigest: input.proposalDigest, status: "passed", testsExecuted: true, failures: [] }; },
    publish: async input => {
      publishes++; assert.equal(input.expectedSha, B);
      const added = input.changes.files.map(file => entry(file.path, file.content));
      trees.set(C, [...initial, ...added]); head = C;
      return { branch: plan.branch, headSha: C, number: 1, url: "https://github.com/" + plan.owner.repository + "/pull/1" };
    },
    ci: async () => evidence(C),
  };
  const options: CalculatorAfterCiOptions = { eventDirectory: events, ci, verifyDependencies,
    execution: { team, tools, execution: "offline-test", maxRepairs: 0 } };
  const request = { version: 1, planFingerprint: plan.fingerprint, previousTaskId: previous.id, candidateSha: B, expectedNextTaskId: next.id };
  return { root, state, events, store, plan, previous, next, reader, request, options, evidence, assessed, receiptPath, originalReceipt,
    setCi: (read: typeof readCi) => { readCi = read; }, move: (sha: string) => { head = sha; },
    counts: () => ({ ciCalls, dependencyCalls, generations, checks, publishes }),
    savedNext: () => { const data = store.taskReceipt(plan, next); try { return data.inspectExisting(); } finally { data.close(); } },
    unchanged: () => assert.deepEqual(readFileSync(receiptPath), originalReceipt), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("late exact CI advances one never-started task through every executor gate and preserves prior receipt", async () => {
  const f = fixture();
  try {
    const result = await runCalculatorAfterCi(f.store, f.reader, f.request, f.options);
    assert.equal(result.status, "advanced", JSON.stringify({ result, receipt: f.savedNext(), counts: f.counts() })); assert.equal(result.execution?.status, "candidate-verified");
    assert.equal(result.execution?.taskId, f.next.id); assert.equal(result.wholeAppCompleted, false);
    assert.deepEqual(f.assessed, ["security", "reviewer", "tester"]);
    assert.deepEqual(f.counts(), { ciCalls: 2, dependencyCalls: 1, generations: 1, checks: 1, publishes: 1 });
    assert.equal(f.savedNext()?.publication?.headSha, C); f.unchanged();
    assert.equal(readdirSync(f.events).filter(name => name.endsWith(".json")).length, 1);
    assert.ok(!JSON.stringify(result).includes("export const"));
  } finally { f.cleanup(); }
});

test("duplicate deliveries and a new run ID for the same candidate never advance another task", async () => {
  const f = fixture();
  try {
    await runCalculatorAfterCi(f.store, f.reader, f.request, f.options); const original = f.counts();
    f.setCi(() => { throw Error("Duplicate must stop before GitHub/dependency work"); });
    const duplicate = await runCalculatorAfterCi(f.store, f.reader, f.request, f.options);
    assert.equal(duplicate.reasonCode, "after_ci_event_already_recorded_no_replay"); assert.deepEqual(f.counts(), original);
    const changedTarget = await runCalculatorAfterCi(f.store, f.reader, { ...f.request, expectedNextTaskId: f.plan.tasks[2].id }, f.options);
    assert.equal(changedTarget.status, "blocked"); assert.deepEqual(f.counts(), original); f.unchanged();
  } finally { f.cleanup(); }
});

test("pending, failed, skipped and foreign CI block before dependency/model work and do not consume admission", async t => {
  const cases: Array<[string, (data: CalculatorCiEvidence) => CalculatorCiEvidence]> = [
    ["pending", data => ({ ...data, runs: data.runs.map(run => ({ ...run, status: "in_progress", conclusion: null })) })],
    ["failed", data => ({ ...data, jobs: data.jobs.map(job => ({ ...job, conclusion: "failure" })) })],
    ["skipped-test-step", data => ({ ...data, jobs: data.jobs.map(job => ({ ...job, steps: job.steps?.map(step => ({ ...step, conclusion: "skipped" })) })) })],
    ["wrong-sha", data => ({ ...data, candidateSha: C })],
    ["wrong-repository", data => ({ ...data, repository: "someone/else" })],
    ["wrong-branch", data => ({ ...data, branch: "main" })],
    ["wrong-workflow", data => ({ ...data, provenance: { ...data.provenance, workflowPins: [{ id: 9, path: ".github/workflows/other.yml", blobSha: D }] } })],
    ["unproven-run", data => ({ ...data, provenance: { ...data.provenance, verifiedRunIds: [99] } })],
    ["wrong-attempt", data => ({ ...data, jobs: data.jobs.map(job => ({ ...job, run_attempt: 2 })) })],
    ["missing-test-step", data => ({ ...data, jobs: data.jobs.map(job => ({ ...job, steps: job.steps?.slice(0, 1) })) })],
    ["foreign-run-url", data => ({ ...data, runs: data.runs.map(run => ({ ...run, html_url: "https://github.com/someone/else/actions/runs/17" })) })],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const f = fixture();
    try {
      f.setCi(() => mutate(f.evidence(B))); const result = await runCalculatorAfterCi(f.store, f.reader, f.request, f.options);
      assert.notEqual(result.status, "advanced"); assert.equal(f.counts().dependencyCalls, 0); assert.equal(f.counts().generations, 0);
      assert.equal(f.savedNext(), undefined); assert.deepEqual(readdirSync(f.events), []); f.unchanged();
    } finally { f.cleanup(); }
  });
});

test("CI becoming pending during dependency checks cannot consume the transition", async () => {
  const f = fixture();
  try {
    f.setCi(call => call === 1 ? f.evidence(B) : { ...f.evidence(B), runs: [] });
    const result = await runCalculatorAfterCi(f.store, f.reader, f.request, f.options);
    assert.equal(result.reasonCode, "after_ci_required_checks_changed"); assert.equal(f.counts().dependencyCalls, 1);
    assert.equal(f.counts().generations, 0); assert.deepEqual(readdirSync(f.events), []); f.unchanged();
  } finally { f.cleanup(); }
});

test("head movement and missing independent host proof block without a next-task claim", async t => {
  for (const name of ["before-ci", "during-proof", "missing-proof"]) await t.test(name, async () => {
    const f = fixture();
    try {
      if (name === "before-ci") f.move(C);
      const options = { ...f.options, verifyDependencies: async (input: Parameters<CalculatorCheckRunner>[0]) => {
        if (name === "during-proof") f.move(C);
        return name === "missing-proof" ? undefined : f.options.verifyDependencies(input);
      } };
      const result = await runCalculatorAfterCi(f.store, f.reader, f.request, options);
      assert.notEqual(result.status, "advanced"); assert.equal(f.counts().generations, 0); assert.equal(f.savedNext(), undefined);
      assert.deepEqual(readdirSync(f.events), []); f.unchanged();
    } finally { f.cleanup(); }
  });
});

test("concurrent deliveries execute the next task at most once", async () => {
  const f = fixture();
  try {
    const results = await Promise.all([runCalculatorAfterCi(f.store, f.reader, f.request, f.options),
      runCalculatorAfterCi(f.store, f.reader, f.request, f.options)]);
    assert.equal(results.filter(result => result.status === "advanced").length, 1);
    assert.equal(f.counts().generations, 1); assert.equal(f.counts().publishes, 1); f.unchanged();
  } finally { f.cleanup(); }
});

test("an interrupted next task retains event and task barriers and cannot replay", async () => {
  const f = fixture();
  try {
    const options = { ...f.options, execution: { ...f.options.execution, checkpoint: async () => { throw Error("Simulated durable checkpoint stop"); } } };
    const first = await runCalculatorAfterCi(f.store, f.reader, f.request, options);
    assert.equal(first.status, "blocked"); assert.equal(first.execution?.status, "blocked"); assert.equal(f.counts().generations, 0); assert.equal(f.savedNext()?.status, "blocked");
    const second = await runCalculatorAfterCi(f.store, f.reader, f.request, f.options);
    assert.equal(second.reasonCode, "after_ci_event_already_recorded_no_replay"); assert.equal(f.counts().generations, 0); f.unchanged();
  } finally { f.cleanup(); }
});

test("request metadata, wrong successor and runtime restoration injection cannot start a model", async () => {
  const f = fixture();
  try {
    let getterCalls = 0;
    const getter = { ...f.request }; Object.defineProperty(getter, "candidateSha", { get: () => { getterCalls++; return B; } });
    for (const raw of [getter, { ...f.request, candidateSha: "main" }, { ...f.request, unexpected: true },
      { ...f.request, [Symbol("hidden")]: true }, { ...f.request, previousTaskId: f.next.id }])
      assert.throws(() => prepareCalculatorAfterCiRequest(raw), { message: CALCULATOR_AFTER_CI_ERROR });
    assert.equal(getterCalls, 0); assert.ok(Object.isFrozen(prepareCalculatorAfterCiRequest(f.request)));
    const wrong = await runCalculatorAfterCi(f.store, f.reader, { ...f.request, expectedNextTaskId: f.plan.tasks[2].id }, f.options);
    assert.equal(wrong.reasonCode, "after_ci_next_task_not_ready");
    for (const key of ["restoreProposal", "restoreAssessments", "verifyDependencies"]) {
      const injected = { ...f.options, execution: { ...f.options.execution, [key]: undefined } };
      const result = await runCalculatorAfterCi(f.store, f.reader, f.request, injected);
      assert.equal(result.reasonCode, "after_ci_configuration_unverified");
    }
    assert.equal(f.counts().generations, 0); assert.equal(f.savedNext(), undefined); f.unchanged();
  } finally { f.cleanup(); }
});

test("external barrier persistence completes before the successor is claimed or generated", async () => {
  const f = fixture();
  try {
    let persisted = false;
    const generate = f.options.execution.team.generate;
    const result = await runCalculatorAfterCi(f.store, f.reader, f.request, { ...f.options,
      persistBarrier: async input => {
        const barrier = JSON.parse(readFileSync(join(input.eventDirectory, input.eventKey.id + ".json"), "utf8"));
        assert.equal(barrier.status, "running"); assert.equal(f.savedNext(), undefined); assert.equal(f.counts().generations, 0);
        persisted = true;
      }, execution: { ...f.options.execution, team: { ...f.options.execution.team,
        generate: async (...args) => { assert.equal(persisted, true); return generate(...args); } } } });
    assert.equal(result.status, "advanced"); assert.equal(f.counts().ciCalls, 3); assert.equal(f.counts().generations, 1); f.unchanged();
  } finally { f.cleanup(); }
});

test("failed external persistence consumes the event without a task or model request and cannot replay", async () => {
  const f = fixture();
  try {
    const first = await runCalculatorAfterCi(f.store, f.reader, f.request, { ...f.options, persistBarrier: async () => { throw Error("Upload interrupted"); } });
    assert.equal(first.status, "blocked"); assert.equal(f.savedNext(), undefined); assert.equal(f.counts().generations, 0);
    const before = f.counts(), second = await runCalculatorAfterCi(f.store, f.reader, f.request, f.options);
    assert.equal(second.reasonCode, "after_ci_event_already_recorded_no_replay"); assert.deepEqual(f.counts(), before); f.unchanged();
  } finally { f.cleanup(); }
});

test("CI changed while persisting the barrier stops before the first successor request", async () => {
  const f = fixture();
  try {
    f.setCi(call => call < 3 ? f.evidence(B) : { ...f.evidence(B), runs: [] });
    const result = await runCalculatorAfterCi(f.store, f.reader, f.request, { ...f.options, persistBarrier: async () => undefined });
    assert.equal(result.status, "blocked"); assert.equal(f.savedNext(), undefined); assert.equal(f.counts().generations, 0);
    assert.equal(readdirSync(f.events).filter(n => n.endsWith(".json")).length, 1); f.unchanged();
  } finally { f.cleanup(); }
});

test("live execution cannot omit a trusted external barrier persistence tool", async () => {
  const f = fixture();
  try {
    const result = await runCalculatorAfterCi(f.store, f.reader, f.request, { ...f.options,
      execution: { ...f.options.execution, execution: "live" } });
    assert.equal(result.reasonCode, "after_ci_configuration_unverified"); assert.equal(f.counts().ciCalls, 0);
    assert.equal(f.counts().generations, 0); assert.deepEqual(readdirSync(f.events), []);
  } finally { f.cleanup(); }
});
