import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { TeamTaskStore } from "./teamTaskStore.js";
import { CALCULATOR_ACCEPTANCE, calculatorPlanTaskId, prepareCalculatorGoal } from "./calculatorPlan.js";
import { CALCULATOR_LAUNCH_ERROR, CALCULATOR_LAUNCH_PATH, CALCULATOR_LAUNCH_REQUEST, CALCULATOR_LAUNCH_REPOSITORY, CALCULATOR_LAUNCH_BRANCH,
  prepareCalculatorLaunchRequest, calculatorLaunchBinding, calculatorLaunchManifest, inspectCalculatorLaunchHistory,
  readCalculatorLaunchState, exportCalculatorLaunchCapsule, importCalculatorLaunchCapsule, sanitizeCalculatorLaunchReport, runCalculatorLaunchState } from "./calculatorLaunchState.js";
import { renderCalculatorOneCycleWorkflow } from "../config/calculatorOneCycleWorkflow.js";

const factory = "f".repeat(40), image = "node@sha256:" + "a".repeat(64);
const goal = { version: 1, id: "one-cycle-pilot", goal: "Create the agreed complete calculator website with independent arithmetic and phone browser tests.", provider: "groq", baseRef: "feat/calculator-pilot-bootstrap", baseSha: "e".repeat(40) };
const raw = (mode = "plan") => ({ version: 1, mode, factorySha: factory, freeTierConfirmed: true, goal,
  config: { version: 1, sandboxImage: image, trustedWorkflows: [{ id: 5, path: ".github/workflows/calculator-task-ci.yml", blobSha: "b".repeat(40) }] } });
const request = () => prepareCalculatorLaunchRequest(raw(), factory, image);
const refused = (error: unknown) => error instanceof Error && error.message === CALCULATOR_LAUNCH_ERROR;
const blob = (text: string) => createHash("sha1").update("blob " + Buffer.byteLength(text) + "\0").update(text).digest("hex");
function proposal(inputGoal = goal) {
  const id = (index: number) => calculatorPlanTaskId(inputGoal, index);
  return { tasks: [
    { id: id(1), role: "coder", goal: "Implement arithmetic and meaningful module tests.", acceptanceIds: CALCULATOR_ACCEPTANCE.slice(0, 7).map(item => item.id), paths: ["src/calculator.mjs", "test/calculator.test.mjs"], dependsOn: [] },
    { id: id(2), role: "frontend", goal: "Implement the full responsive UI source group.", acceptanceIds: CALCULATOR_ACCEPTANCE.slice(7).map(item => item.id), paths: ["index.html", "styles.css", "src/app.mjs"], dependsOn: [id(1)] },
    { id: id(3), role: "frontend", goal: "Test buttons and keyboard interaction independently.", acceptanceIds: ["keyboard"], paths: ["test/ui.test.mjs"], dependsOn: [id(2)] },
  ], blockers: [], unverifiedAreas: ["Full browser acceptance remains unverified."] };
}
function fixture(inputGoal = goal) {
  const root = mkdtempSync(join(tmpdir(), "calculator-launch-"));
  for (const name of ["state", "runtime-report", "report", "barrier", "destination"]) mkdirSync(join(root, name), { mode: 0o700 });
  const req = prepareCalculatorLaunchRequest({ ...raw(), goal: inputGoal }), owner = prepareCalculatorGoal(inputGoal), planning = new TeamTaskStore(join(root, "state"), { id: "calc-planning-" + inputGoal.id, fingerprint: owner.ownerFingerprint });
  planning.claim(); planning.recordStage("model_plan", "running"); planning.recordStage("model_plan", "passed"); planning.finish("needs-review", "plan_saved_not_execution"); planning.close();
  const plan = new CalculatorPlanStore(join(root, "state"), inputGoal).initialize(proposal(inputGoal));
  const report = { mode: "plan", status: "planned", planFingerprint: plan.fingerprint, wholeAppCompleted: false, legalEnabled: false };
  writeFileSync(join(root, "runtime-report/calculator-report.json"), JSON.stringify(report), { mode: 0o600 });
  const manifest = calculatorLaunchManifest(req, 1, "a".repeat(40), blob(JSON.stringify(raw())));
  writeFileSync(join(root, "barrier/launch.json"), JSON.stringify(manifest), { mode: 0o600 });
  return { root, req, plan, manifest, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("owner/runtime/config bindings preserve SHA and refuse paid/fallback/mode authority", () => {
  const req = request(); assert.equal(req.factorySha, factory); assert.equal(req.goal.baseSha, goal.baseSha);
  assert.equal(calculatorLaunchBinding(req), calculatorLaunchBinding({ ...req, mode: "run" }));
  for (const invalid of [{ ...raw(), mode: "continue" }, { ...raw(), freeTierConfirmed: false }, { ...raw(), factorySha: "main" },
    { ...raw(), repository: "erman-ksv/Onay" }, { ...raw(), goal: { ...goal, baseRef: "main" } }, { ...raw(), goal: { ...goal, provider: "openai" } }])
    assert.throws(() => prepareCalculatorLaunchRequest(invalid, factory, image));
  assert.throws(() => prepareCalculatorLaunchRequest(raw(), "a".repeat(40), image));
  assert.throws(() => prepareCalculatorLaunchRequest(raw(), factory, "node@sha256:" + "b".repeat(64)));
  const changed = prepareCalculatorLaunchRequest({ ...raw(), goal: { ...goal, goal: goal.goal + " Preserve all existing fixed answers." } });
  assert.notEqual(calculatorLaunchBinding(req), calculatorLaunchBinding(changed));
});
test("valid plan capsule restores exact private receipts for one run without creating claims", () => {
  const f = fixture(); try {
    const before = readCalculatorLaunchState(join(f.root, "state"), f.req); assert.equal(before.size, 3);
    exportCalculatorLaunchCapsule(f.root, f.req, f.manifest, 0);
    importCalculatorLaunchCapsule(join(f.root, "capsule"), join(f.root, "barrier"), join(f.root, "destination"), { ...f.req, mode: "run" }, f.manifest);
    assert.deepEqual([...readCalculatorLaunchState(join(f.root, "destination"), f.req)].map(([name, data]) => [name, data.toString()]), [...before].map(([name, data]) => [name, data.toString()]));
    assert.equal(new CalculatorPlanStore(join(f.root, "destination"), goal).inspect()!.fingerprint, f.plan.fingerprint);
  } finally { f.cleanup(); }
});
test("restore phase accepts downloaded 0755/0644 metadata but never follows a restored symlink", async t => {
  for (const scenario of ["private-restore", "symlink"]) await t.test(scenario, async () => {
    const f = fixture(); try {
      exportCalculatorLaunchCapsule(f.root, f.req, f.manifest, 0);
      const root = join(f.root, "restore-job"); mkdirSync(root, { mode: 0o700 });
      for (const name of ["state", "barrier"]) mkdirSync(join(root, name), { mode: 0o700 });
      cpSync(join(f.root, "capsule"), join(root, "restored-capsule"), { recursive: true });
      cpSync(join(f.root, "barrier"), join(root, "restored-barrier"), { recursive: true });
      function loose(path: string) { const stat = lstatSync(path); chmodSync(path, stat.isDirectory() ? 0o755 : 0o644); if (stat.isDirectory()) for (const name of readdirSync(path)) loose(join(path, name)); }
      loose(join(root, "restored-capsule")); loose(join(root, "restored-barrier"));
      const req = { ...f.req, mode: "run" as const }, current = calculatorLaunchManifest(req, 2, "b".repeat(40), "c".repeat(40));
      writeFileSync(join(root, "context.json"), JSON.stringify({ version: 1, request: req, manifest: current, restore: { runId: 1, barrierId: 11, capsuleId: 12, manifest: f.manifest } }), { mode: 0o600 });
      const external = join(f.root, "external.json"); writeFileSync(external, "{}", { mode: 0o644 }); chmodSync(external, 0o644);
      if (scenario === "symlink") { const path = join(root, "restored-capsule/state", goal.id + ".calculator-plan.json"); unlinkSync(path); symlinkSync(external, path); }
      const call = () => runCalculatorLaunchState(["restore", root, factory, image], {});
      if (scenario === "symlink") { await assert.rejects(call, refused); assert.equal(statSync(external).mode & 0o777, 0o644); }
      else { await call(); assert.equal(new CalculatorPlanStore(join(root, "state"), goal).inspect()!.fingerprint, f.plan.fingerprint);
        assert.equal(statSync(join(root, "restored-capsule")).mode & 0o777, 0o700);
        for (const name of readdirSync(join(root, "state"))) assert.equal(statSync(join(root, "state", name)).mode & 0o777, 0o600); }
    } finally { f.cleanup(); }
  });
});
test("capsules refuse lost markers, task receipts, locks, state tampering and owner drift", async t => {
  for (const name of ["missing-marker", "task-receipt", "lock", "tampered-digest", "owner-drift", "barrier-mismatch"]) await t.test(name, () => {
    const f = fixture(); try {
      if (name === "task-receipt") { const store = new CalculatorPlanStore(join(f.root, "state"), goal).taskReceipt(f.plan, f.plan.tasks[0]); store.claim(); store.finish("blocked", "test_failed"); store.close(); }
      if (name === "lock") writeFileSync(join(f.root, "state", "calc-planning-" + goal.id + ".lock"), "", { mode: 0o600 });
      if (["task-receipt", "lock"].includes(name)) { assert.throws(() => exportCalculatorLaunchCapsule(f.root, f.req, f.manifest, 0)); return; }
      exportCalculatorLaunchCapsule(f.root, f.req, f.manifest, 0);
      if (name === "missing-marker") unlinkSync(join(f.root, "capsule/state", "calc-plan-" + goal.id + ".json"));
      if (name === "tampered-digest") { const path = join(f.root, "capsule/completion.json"), value = JSON.parse(readFileSync(path, "utf8")); value.reportDigest = "a".repeat(64); writeFileSync(path, JSON.stringify(value)); }
      if (name === "barrier-mismatch") writeFileSync(join(f.root, "barrier/launch.json"), JSON.stringify({ ...f.manifest, runId: 77 }));
      const req = name === "owner-drift" ? prepareCalculatorLaunchRequest({ ...raw("run"), goal: { ...goal, baseSha: "b".repeat(40) } }) : { ...f.req, mode: "run" as const };
      assert.throws(() => importCalculatorLaunchCapsule(join(f.root, "capsule"), join(f.root, "barrier"), join(f.root, "destination"), req, f.manifest));
    } finally { f.cleanup(); }
  });
});
test("state export refuses source, oversized files, symlinks, hardlinks, nonempty locks and loose permissions", async t => {
  for (const name of ["source", "oversize", "symlink", "hardlink", "nonempty-lock", "permissions"]) await t.test(name, () => {
    const f = fixture(); try {
      const path = join(f.root, "state", "calc-planning-" + goal.id + ".json");
      if (name === "source") writeFileSync(join(f.root, "state/source.mjs"), "export const privateSource = 1;", { mode: 0o600 });
      if (name === "oversize") writeFileSync(path, "x".repeat(32769));
      if (name === "symlink") { unlinkSync(path); symlinkSync(join(f.root, "runtime-report/calculator-report.json"), path); }
      if (name === "hardlink") linkSync(path, join(f.root, "external-link"));
      if (name === "nonempty-lock") writeFileSync(join(f.root, "state", "calc-planning-" + goal.id + ".lock"), "x", { mode: 0o600 });
      if (name === "permissions") chmodSync(path, 0o644);
      assert.throws(() => readCalculatorLaunchState(join(f.root, "state"), f.req));
    } finally { f.cleanup(); }
  });
});
test("goal IDs beginning plan/planning never disguise execution receipts as plan metadata", () => {
  for (const id of ["plan-pilot", "planning-pilot"]) {
    const inputGoal = { ...goal, id }, f = fixture(inputGoal);
    try {
      const store = new CalculatorPlanStore(join(f.root, "state"), inputGoal).taskReceipt(f.plan, f.plan.tasks[0]);
      store.claim(); store.finish("blocked", "test_failed"); store.close();
      assert.throws(() => exportCalculatorLaunchCapsule(f.root, f.req, f.manifest, 0));
    } finally { f.cleanup(); }
  }
});
test("a failed/429 outcome preserves its barrier and cannot be imported as a runnable plan", () => {
  const f = fixture(); try {
    writeFileSync(join(f.root, "runtime-report/calculator-report.json"), JSON.stringify({ mode: "plan", status: "blocked", reasonCode: "provider_failed", wholeAppCompleted: false, legalEnabled: false }));
    exportCalculatorLaunchCapsule(f.root, f.req, f.manifest, 10);
    assert.throws(() => importCalculatorLaunchCapsule(join(f.root, "capsule"), join(f.root, "barrier"), join(f.root, "destination"), { ...f.req, mode: "run" }, f.manifest), refused);
    assert.equal(JSON.parse(readFileSync(join(f.root, "barrier/launch.json"), "utf8")).runId, 1);
  } finally { f.cleanup(); }
});
test("report export forbids full private source, upstream messages and false app completion", () => {
  const req = request(), valid = { mode: "plan", status: "blocked", reasonCode: "provider_failed", wholeAppCompleted: false, legalEnabled: false };
  assert.equal(sanitizeCalculatorLaunchReport(valid, req).status, "blocked");
  for (const extra of [{ source: "PRIVATE_ORIGINAL" }, { message: "raw upstream failure" }, { wholeAppCompleted: true }, { legalEnabled: true }, { mode: "run" }])
    assert.throws(() => sanitizeCalculatorLaunchReport({ ...valid, ...extra }, req), refused);
});

function historyFixture(mode: "plan" | "run" = "run") {
  const current = prepareCalculatorLaunchRequest(raw(mode)), old = request(), currentSha = "c".repeat(40), oldSha = "d".repeat(40);
  const currentText = JSON.stringify(raw(mode)), oldText = JSON.stringify(raw());
  const manifest = calculatorLaunchManifest(current, 2, currentSha, blob(currentText));
  const run = (number: number, sha: string) => ({ id: number, run_number: number, workflow_id: 42, path: CALCULATOR_LAUNCH_PATH, event: "push", head_branch: CALCULATOR_LAUNCH_BRANCH, head_sha: sha, run_attempt: 1,
    repository: { full_name: CALCULATOR_LAUNCH_REPOSITORY }, head_repository: { full_name: CALCULATOR_LAUNCH_REPOSITORY }, status: number === 2 ? "in_progress" : "completed", conclusion: number === 2 ? null : "success" });
  const runs = [run(2, currentSha), run(1, oldSha)];
  const artifacts = [{ id: 11, name: "calculator-cycle-barrier-" + goal.id, expired: false, size_in_bytes: 1024 }, { id: 12, name: "calculator-cycle-state-" + goal.id, expired: false, size_in_bytes: 4096 }];
  const texts = new Map([[currentSha, currentText], [oldSha, oldText]]); let wrongWorkflow = false, active = true, totalOverride: number | undefined;
  const transport: typeof fetch = async (url, init) => {
    assert.equal(init?.method, "GET"); const path = new URL(String(url)).pathname.replace("/repos/" + CALCULATOR_LAUNCH_REPOSITORY, ""); let result: unknown;
    if (path === "/actions/runs/2") result = runs[0];
    else if (path === "/actions/runs/1") result = runs[1];
    else if (path === "/actions/workflows/42") result = { id: 42, path: CALCULATOR_LAUNCH_PATH, state: active ? "active" : "disabled_manually" };
    else if (path === "/actions/workflows/42/runs") result = { total_count: totalOverride ?? runs.length, workflow_runs: runs };
    else if (path === "/actions/runs/1/artifacts") result = { total_count: artifacts.length, artifacts };
    else if (path.startsWith("/git/commits/")) { const sha = path.split("/").at(-1)!; result = { sha, tree: { sha } }; }
    else if (path.startsWith("/git/trees/")) { const sha = path.split("/").at(-1)!, text = texts.get(sha)!; result = { sha, truncated: false, tree: [
      ...[".github", ".github/workflows", ".factory"].map(path => ({ path, type: "tree", mode: "040000", sha: "a".repeat(40) })),
      { path: CALCULATOR_LAUNCH_PATH, type: "blob", mode: "100644", sha: wrongWorkflow ? "0".repeat(40) : manifest.workflowBlobSha },
      { path: CALCULATOR_LAUNCH_REQUEST, type: "blob", mode: "100644", sha: blob(text) },
    ] }; }
    else if (path.startsWith("/git/blobs/")) { const sha = path.split("/").at(-1)!, text = [...texts.values()].find(text => blob(text) === sha)!; result = { sha, encoding: "base64", content: Buffer.from(text).toString("base64") }; }
    else throw Error("Unexpected test endpoint");
    return Response.json(result);
  };
  const env = { GITHUB_TOKEN: "fixture-factory-read-token", GITHUB_REPOSITORY: CALCULATOR_LAUNCH_REPOSITORY, GITHUB_REF: "refs/heads/" + CALCULATOR_LAUNCH_BRANCH,
    GITHUB_EVENT_NAME: "push", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: currentSha, GITHUB_RUN_ID: "2", GITHUB_RUN_NUMBER: "2" };
  return { current, old, manifest, env, transport, runs, artifacts, texts, oldSha, setWrongWorkflow: () => { wrongWorkflow = true; }, disable: () => { active = false; }, truncate: () => { totalOverride = 41; } };
}
test("trusted full run history permits only first plan then one execution", async () => {
  const f = historyFixture(); assert.equal((await inspectCalculatorLaunchHistory(f.current, f.manifest, f.env, f.transport))?.capsuleId, 12);
  const first = historyFixture("plan"); first.runs.splice(1); first.runs[0].run_number = 1; first.env.GITHUB_RUN_NUMBER = "1";
  assert.equal(await inspectCalculatorLaunchHistory(first.current, first.manifest, first.env, first.transport), null);
  const duplicate = historyFixture("plan"); await assert.rejects(() => inspectCalculatorLaunchHistory(duplicate.current, duplicate.manifest, duplicate.env, duplicate.transport), refused);
});
test("deleting an old run and all its artifacts cannot make plan appear fresh", async () => {
  const f = historyFixture("plan"); f.runs.splice(1); f.artifacts.length = 0;
  await assert.rejects(() => inspectCalculatorLaunchHistory(f.current, f.manifest, f.env, f.transport), refused);
});
test("deleted/expired/ambiguous receipts and previous run never authorize a fresh call", async t => {
  for (const name of ["deleted-all", "deleted-capsule", "deleted-run", "expired", "duplicate-artifact", "previous-run", "binding-drift", "workflow-blob", "rerun", "truncated", "disabled"]) await t.test(name, async () => {
    const f = historyFixture();
    if (name === "deleted-all") f.artifacts.length = 0;
    if (name === "deleted-capsule") f.artifacts.splice(1);
    if (name === "deleted-run") f.runs.splice(1);
    if (name === "expired") f.artifacts[0].expired = true;
    if (name === "duplicate-artifact") f.artifacts.push({ ...f.artifacts[0], id: 99 });
    if (name === "previous-run") f.texts.set(f.oldSha, JSON.stringify(raw("run")));
    if (name === "binding-drift") f.texts.set(f.oldSha, JSON.stringify({ ...raw(), goal: { ...goal, baseSha: "b".repeat(40) } }));
    if (name === "workflow-blob") f.setWrongWorkflow();
    if (name === "rerun") f.runs[1].run_attempt = 2;
    if (name === "truncated") f.truncate();
    if (name === "disabled") f.disable();
    await assert.rejects(() => inspectCalculatorLaunchHistory(f.current, f.manifest, f.env, f.transport), refused);
  });
});
test("renderer persists an immutable barrier before its sole model-capable CLI step", () => {
  const text = renderCalculatorOneCycleWorkflow(factory, image);
  assert.ok(text.indexOf("id: barrier") < text.indexOf("id: execute"));
  assert.equal(text.split("orchestration/calculatorCli.ts").length - 1, 1);
  assert.ok(text.includes("overwrite: false")); assert.ok(text.includes("cancel-in-progress: false"));
  assert.ok(text.includes("ref: " + factory)); assert.ok(text.includes("AGENT_FACTORY_LEGAL_ENABLED: 'false'"));
  assert.ok(text.includes("steps.prepare.outputs.mode == 'run'")); assert.ok(!text.includes("CLOUDFLARE_API_KEY"));
  assert.ok(!text.includes("workflow_dispatch")); assert.ok(!text.includes("pull_request"));
  for (const [sha, img] of [["main", image], [factory, "node:latest"], [factory, image + "\nrun: bad"]]) assert.throws(() => renderCalculatorOneCycleWorkflow(sha, img));
});
