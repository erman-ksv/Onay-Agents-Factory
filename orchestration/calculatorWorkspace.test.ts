import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
import { calculatorSources, createCalculatorSnapshotReader, type CalculatorSnapshotReader, type CalculatorTreeEntry } from "../github/calculatorSnapshot.js";
import { CALCULATOR_ACCEPTANCE, calculatorPlanTaskId } from "./calculatorPlan.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { CALCULATOR_WORKSPACE_ERROR, openCalculatorWorkspace, selectCalculatorWorkspaceTask, claimCalculatorWorkspaceTask,
  assertCalculatorWorkspaceCurrent, loadCalculatorWorkspaceTask, type CalculatorCheckRunner } from "./calculatorWorkspace.js";

const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40), D = "d".repeat(40);
const owner = { version: 1, id: "workspace-pilot", goal: "Build the entire agreed static calculator website with arithmetic and browser tests.",
  baseRef: "feat/calculator-pilot-bootstrap", baseSha: A, provider: "groq" };
const source = "export const add = (a, b) => a + b;\n";
const blob = createHash("sha1").update("blob " + Buffer.byteLength(source) + "\0" + source).digest("hex");
const entry = (path: string, hash = blob): CalculatorTreeEntry => ({ path, sha: hash, type: "blob", mode: "100644" });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "calculator-workspace-"));
  const store = new CalculatorPlanStore(directory, owner), id = (n: number) => calculatorPlanTaskId(owner, n);
  const plan = store.initialize({ tasks: [
    { id: id(1), role: "coder", goal: "Implement arithmetic and module regression tests.",
      acceptanceIds: CALCULATOR_ACCEPTANCE.slice(0, 7).map(item => item.id), paths: ["src/calculator.mjs", "test/calculator.test.mjs"], dependsOn: [] },
    { id: id(2), role: "frontend", goal: "Implement responsive browser calculator controls.",
      acceptanceIds: CALCULATOR_ACCEPTANCE.slice(7).map(item => item.id), paths: ["index.html", "styles.css", "src/app.mjs"], dependsOn: [id(1)] },
    { id: id(3), role: "frontend", goal: "Test keyboard and browser interactions thoroughly.",
      acceptanceIds: ["keyboard"], paths: ["test/ui.test.mjs"], dependsOn: [id(2)] },
  ], blockers: [], unverifiedAreas: [] });
  let head = A;
  const parents = new Map<string, readonly string[]>([[A, []], [B, [A]], [C, [B]], [D, [A]]]);
  const files: CalculatorTreeEntry[] = [
    { path: "src", sha: D, type: "tree", mode: "040000" }, { path: "test", sha: D, type: "tree", mode: "040000" },
    entry("src/calculator.mjs"), entry("test/calculator.test.mjs"),
  ];
  const trees = new Map([[A, [] as CalculatorTreeEntry[]], [B, files], [C, files], [D, files]]);
  const reader: CalculatorSnapshotReader = {
    getHead: async () => head,
    readCommit: async hash => ({ sha: hash, treeSha: hash, parents: parents.get(hash) ?? [] }),
    readTree: async hash => ({ sha: hash, truncated: false, tree: trees.get(hash) ?? [] }),
    readBlob: async hash => ({ sha: hash, encoding: "base64", content: Buffer.from(source).toString("base64") }),
  };
  const runner: CalculatorCheckRunner = async input => ({ ...input, taskId: input.task.id,
    securityReady: true, independentReviewReady: true, taskChecksPassed: true, testsExecuted: true });
  function savedCandidate() {
    const receipt = store.taskReceipt(plan, plan.tasks[0]);
    assert.equal(receipt.claim(), "claimed");
    receipt.recordPublication({ branch: plan.branch, headSha: B, number: 1,
      url: "https://github.com/" + CALCULATOR_PROFILE.repository + "/pull/1" });
    receipt.finish("completed", "offline_fixture_only"); receipt.close(); head = C;
  }
  return { store, reader, runner, plan, parents, trees, files, savedCandidate,
    move: (hash: string) => { head = hash; }, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
const refused = (error: unknown) => error instanceof Error && error.message === CALCULATOR_WORKSPACE_ERROR;

test("bootstrap is read-only; initial execution requires a project branch pinned to the approved base", async () => {
  const f = fixture();
  try {
    const bootstrap = await openCalculatorWorkspace(f.store, f.reader, owner.baseRef, A);
    assert.equal((await selectCalculatorWorkspaceTask(bootstrap)).status, "ready");
    await assert.rejects(() => claimCalculatorWorkspaceTask(bootstrap), refused);
    const project = await openCalculatorWorkspace(f.store, f.reader, f.plan.branch, A);
    const result = await claimCalculatorWorkspaceTask(project);
    assert.equal(result.selection.task?.id, f.plan.tasks[0].id); assert.ok(result.store);
    result.store!.finish("blocked", "offline_fixture_only"); result.store!.close();
    assert.equal((await selectCalculatorWorkspaceTask(project)).status, "blocked");
  } finally { f.cleanup(); }
});
test("stale, foreign and forged workspace capabilities stop without claiming work", async t => {
  for (const name of ["stale", "foreign", "forged", "bootstrap-after-start"]) await t.test(name, async () => {
    const f = fixture();
    try {
      if (name === "bootstrap-after-start") f.savedCandidate();
      if (name === "forged") {
        const actual = await openCalculatorWorkspace(f.store, f.reader, f.plan.branch, A);
        await assert.rejects(() => assertCalculatorWorkspaceCurrent(JSON.parse(JSON.stringify(actual))), refused);
      } else await assert.rejects(() => openCalculatorWorkspace(f.store, f.reader,
        name === "foreign" ? "main" : owner.baseRef, name === "stale" ? B : name === "bootstrap-after-start" ? C : A), refused);
    } finally { f.cleanup(); }
  });
});
test("dependency requires actual ancestry, present files and fresh exact-current-SHA host checks", async () => {
  const f = fixture();
  try {
    f.savedCandidate(); const workspace = await openCalculatorWorkspace(f.store, f.reader, f.plan.branch, C);
    assert.equal((await selectCalculatorWorkspaceTask(workspace)).status, "needs-review");
    let called = 0;
    const selected = await selectCalculatorWorkspaceTask(workspace, async input => {
      called++; assert.equal(input.currentSha, C); assert.equal(input.candidateSha, B);
      assert.deepEqual(input.changedSinceCandidate, []); return f.runner(input);
    });
    assert.equal(called, 1); assert.equal(selected.task?.id, f.plan.tasks[1].id);
    assert.equal(selected.wholeAppCompleted, false); assert.equal(selected.publicationAuthorized, false);
  } finally { f.cleanup(); }
});
test("missing, divergent, malformed and incomplete ancestry cannot unlock a dependency", async t => {
  for (const name of ["diverged", "behind", "missing-parents", "wrong-commit", "wrong-tree", "truncated", "missing-file", "symlink", "missing-parent-directory", "cycle", "too-deep"]) await t.test(name, async () => {
    const f = fixture();
    try {
      f.savedCandidate();
      if (name === "diverged") f.parents.set(C, [D]);
      if (name === "behind") f.move(A);
      if (name === "missing-parents") f.reader.readCommit = async hash => ({ sha: hash, treeSha: hash });
      if (name === "wrong-commit") f.reader.readCommit = async () => ({ sha: D, treeSha: C, parents: [B] });
      if (name === "wrong-tree") f.reader.readTree = async () => ({ sha: D, truncated: false, tree: f.files });
      if (name === "truncated") f.reader.readTree = async hash => ({ sha: hash, truncated: true, tree: f.files });
      if (name === "missing-file") f.trees.set(C, []);
      if (name === "symlink") f.trees.set(C, f.files.map(item => item.path === "src/calculator.mjs" ? { ...item, mode: "120000" } : item));
      if (name === "missing-parent-directory") f.trees.set(C, f.files.filter(item => item.path !== "src"));
      if (name === "cycle") f.parents.set(C, [C]);
      if (name === "too-deep") {
        let hash = C;
        for (let n = 1; n < 67; n++) { const parent = n.toString(16).padStart(40, "0"); f.parents.set(hash, [parent]); hash = parent; }
        f.parents.set(hash, [B]);
      }
      const workspace = await openCalculatorWorkspace(f.store, f.reader, f.plan.branch, name === "behind" ? A : C);
      let checks = 0;
      const selected = await selectCalculatorWorkspaceTask(workspace, async input => { checks++; return f.runner(input); });
      assert.equal(selected.status, "needs-review"); assert.equal(checks, 0);
    } finally { f.cleanup(); }
  });
});
test("old or incomplete test/review attestations cannot stand in for current checks", async t => {
  for (const key of ["repository", "planFingerprint", "taskId", "candidateSha", "currentSha", "securityReady", "independentReviewReady", "taskChecksPassed", "testsExecuted"]) await t.test(key, async () => {
    const f = fixture();
    try {
      f.savedCandidate(); const workspace = await openCalculatorWorkspace(f.store, f.reader, f.plan.branch, C);
      const result = await selectCalculatorWorkspaceTask(workspace, async input => Object.assign((await f.runner(input))!, { [key]: key.endsWith("Sha") ? A : false }));
      assert.equal(result.status, "needs-review");
    } finally { f.cleanup(); }
  });
});
test("later edits or reverts are disclosed and require revalidation, not ancestry-only acceptance", async () => {
  const f = fixture();
  try {
    f.savedCandidate(); f.trees.set(C, f.files.map(item => item.path === "src/calculator.mjs" ? { ...item, sha: D } : item));
    const workspace = await openCalculatorWorkspace(f.store, f.reader, f.plan.branch, C);
    let checked = false;
    const result = await selectCalculatorWorkspaceTask(workspace, async input => {
      checked = true; assert.deepEqual(input.changedSinceCandidate, ["src/calculator.mjs"]); return undefined;
    });
    assert.ok(checked); assert.equal(result.status, "needs-review");
    assert.equal((await selectCalculatorWorkspaceTask(workspace, f.runner)).status, "ready");
  } finally { f.cleanup(); }
});
test("ref movement during checks stops selection and leaves the next task unclaimed", async () => {
  const f = fixture();
  try {
    f.savedCandidate(); const workspace = await openCalculatorWorkspace(f.store, f.reader, f.plan.branch, C);
    await assert.rejects(() => selectCalculatorWorkspaceTask(workspace, async input => { f.move(D); return f.runner(input); }), refused);
    const next = f.store.taskReceipt(f.plan, f.plan.tasks[1]);
    try { assert.equal(next.inspectExisting(), undefined); } finally { next.close(); }
  } finally { f.cleanup(); }
});
test("ref movement after a durable claim preserves a blocked receipt and forbids replay", async () => {
  const f = fixture();
  try {
    const workspace = await openCalculatorWorkspace(f.store, f.reader, f.plan.branch, A);
    f.reader.getHead = async () => {
      const receipt = f.store.taskReceipt(f.plan, f.plan.tasks[0]);
      try { return receipt.inspectExisting() ? B : A; } finally { receipt.close(); }
    };
    await assert.rejects(() => claimCalculatorWorkspaceTask(workspace), refused);
    const receipt = f.store.taskReceipt(f.plan, f.plan.tasks[0]);
    try { assert.equal(receipt.inspectExisting()?.status, "blocked"); } finally { receipt.close(); }
  } finally { f.cleanup(); }
});
test("next task source is loaded at the current SHA, kept private, and invalidated by movement", async () => {
  const f = fixture();
  try {
    f.savedCandidate(); const workspace = await openCalculatorWorkspace(f.store, f.reader, f.plan.branch, C);
    const snapshot = await loadCalculatorWorkspaceTask(workspace, f.plan.tasks[0].id);
    assert.equal(snapshot.baseSha, C); assert.equal(calculatorSources(snapshot).get("src/calculator.mjs"), source);
    assert.ok(!JSON.stringify(workspace).includes(source)); assert.ok(!JSON.stringify(snapshot).includes(source));
    f.move(D); await assert.rejects(() => loadCalculatorWorkspaceTask(workspace, f.plan.tasks[0].id), refused);
  } finally { f.cleanup(); }
});
test("fixed-target GET adapter preserves parents needed for immutable ancestry checks", async () => {
  const urls: string[] = [];
  const reader = createCalculatorSnapshotReader({ AGENT_FACTORY_TARGET_PROFILE: "calculator", GITHUB_TOKEN: "fixture-not-a-secret",
    AGENT_ALLOWED_REPOSITORIES: CALCULATOR_PROFILE.repository }, async (url, init) => {
    urls.push(String(url)); assert.equal(init?.method, "GET");
    return Response.json({ sha: C, tree: { sha: D }, parents: [{ sha: B }, { sha: A }] });
  });
  assert.deepEqual(await reader.readCommit(C), { sha: C, treeSha: D, parents: [B, A] });
  assert.deepEqual(urls, ["https://api.github.com/repos/" + CALCULATOR_PROFILE.repository + "/git/commits/" + C]);
});
