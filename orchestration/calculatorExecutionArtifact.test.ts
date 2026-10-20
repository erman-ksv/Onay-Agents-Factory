import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { CALCULATOR_ACCEPTANCE, calculatorPlanTaskId, createCalculatorPlan, prepareCalculatorGoal } from "./calculatorPlan.js";
import { CALCULATOR_LAUNCH_BRANCH, CALCULATOR_LAUNCH_REPOSITORY, calculatorLaunchManifest, prepareCalculatorLaunchRequest } from "./calculatorLaunchState.js";
import { CALCULATOR_EXECUTION_ARTIFACT_ERROR, exportPrivateExecutionArtifact, runCalculatorExecutionArtifact } from "./calculatorExecutionArtifact.js";

const factory = "f".repeat(40), image = "node@sha256:" + "a".repeat(64);
const goal = { version: 1 as const, id: "private-artifact-pilot", goal: "Create the agreed complete calculator with independent arithmetic and browser acceptance checks.",
  provider: "groq" as const, baseRef: "feat/calculator-pilot-bootstrap", baseSha: "e".repeat(40) };
const error = { message: CALCULATOR_EXECUTION_ARTIFACT_ERROR };
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const privateText = "export function PRIVATE_CODER_PROPOSAL(a, b) { return a + b; }";
function fixture(t: { after(callback: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "calculator-private-export-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ["state", "barrier"]) mkdirSync(join(root, name), { mode: 0o700 });
  const request = prepareCalculatorLaunchRequest({ version: 1, mode: "run", factorySha: factory, freeTierConfirmed: true, goal,
    config: { version: 1, sandboxImage: image, trustedWorkflows: [{ id: 5, path: ".github/workflows/calculator-task-ci.yml", blobSha: "b".repeat(40) }] } }, factory, image);
  const launch = calculatorLaunchManifest(request, 22, "a".repeat(40), "b".repeat(40));
  const prior = calculatorLaunchManifest({ ...request, mode: "plan" }, 11, "c".repeat(40), "d".repeat(40));
  const context = { version: 1, request, manifest: launch, restore: { runId: 11, barrierId: 101, capsuleId: 102, manifest: prior } };
  const put = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  put(join(root, "context.json"), context); put(join(root, "barrier/launch.json"), launch);
  const namespace = hash(JSON.stringify(resolve(join(root, "state")))), privateRoot = join(root, "execution-private"), source = join(privateRoot, namespace);
  const env = { CALCULATOR_REMOTE_BARRIER_UPLOADED: "true", GITHUB_REPOSITORY: CALCULATOR_LAUNCH_REPOSITORY,
    GITHUB_REF: "refs/heads/" + CALCULATOR_LAUNCH_BRANCH, GITHUB_EVENT_NAME: "push", GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "22", GITHUB_SHA: launch.eventSha };
  function sources(files: Record<string, string> = { "calc-core.execution.json": JSON.stringify({ source: privateText }), "calc-core.execution.json.lock": "" }) {
    mkdirSync(privateRoot, { mode: 0o700 }); mkdirSync(source, { mode: 0o700 });
    for (const [name, value] of Object.entries(files)) writeFileSync(join(source, name), value, { mode: 0o600 });
  }
  return { root, env, context, launch, request, put, namespace, privateRoot, source, sources,
    collect: () => exportPrivateExecutionArtifact(root, factory, image, env), destination: join(root, "execution-artifact") };
}

test("exact private bytes and stale locks are archived separately with source-free non-resumable manifest", t => {
  const f = fixture(t); f.sources(); const before = readFileSync(join(f.source, "calc-core.execution.json"));
  const result = f.collect(), manifestBytes = readFileSync(join(f.destination, "manifest.json")), manifest = JSON.parse(manifestBytes.toString());
  assert.deepEqual(Object.keys(result).sort(), ["fileCount", "manifestSha256", "status", "totalBytes"]);
  assert.equal(result.status, "preserved"); assert.equal(result.fileCount, 2); assert.equal(result.totalBytes, before.length);
  assert.equal(result.manifestSha256, hash(manifestBytes));
  assert.deepEqual(readFileSync(join(f.destination, "execution-private/calc-core.execution.json")), before);
  assert.equal(readFileSync(join(f.destination, "execution-private/calc-core.execution.json.lock")).length, 0);
  assert.equal(readFileSync(join(f.source, "calc-core.execution.json.lock")).length, 0);
  assert.equal(manifest.evidenceValidation, "unvalidated"); assert.equal(manifest.resumeAuthorized, false); assert.equal(manifest.budgetResetAuthorized, false);
  assert.equal(manifest.planVerification, "absent"); assert.equal("planFingerprint" in manifest, false);
  assert.equal(manifest.ownerFingerprint, prepareCalculatorGoal(goal).ownerFingerprint);
  assert.deepEqual(manifest.launch, f.launch); assert.equal(manifest.namespace, f.namespace);
  assert.equal(manifest.files[0].sha256, hash(before)); assert.equal(manifest.files[1].kind, "stale-lock");
  assert.equal(JSON.stringify(result).includes(privateText), false); assert.equal(manifestBytes.includes(privateText), false);
  for (const path of [f.destination, join(f.destination, "execution-private")]) assert.equal(lstatSync(path).mode & 0o777, 0o700);
  for (const path of [join(f.destination, "manifest.json"), join(f.destination, "execution-private/calc-core.execution.json")]) assert.equal(lstatSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(join(f.root, "state")), []);
  assert.equal(existsSync(join(f.root, "capsule")), false); assert.equal(existsSync(join(f.root, "report")), false);
});

test("missing or empty private evidence is reported explicitly without inventing a proposal", async t => {
  for (const form of ["missing", "empty-parent", "empty-namespace"]) await t.test(form, t => {
    const f = fixture(t);
    if (form !== "missing") mkdirSync(f.privateRoot, { mode: 0o700 });
    if (form === "empty-namespace") mkdirSync(f.source, { mode: 0o700 });
    const result = f.collect(), manifest = JSON.parse(readFileSync(join(f.destination, "manifest.json"), "utf8"));
    assert.equal(result.status, "absent"); assert.equal(result.fileCount, 0); assert.equal(result.totalBytes, 0);
    assert.deepEqual(manifest.files, []); assert.equal(manifest.evidenceValidation, "unvalidated");
    assert.deepEqual(readdirSync(join(f.destination, "execution-private")), []);
  });
});

test("damaged checkpoint bytes remain forensic evidence and never become validated stage results", t => {
  const f = fixture(t), damaged = '{"proposal": "interrupted and incomplete'; f.sources({ "calc-core.execution.json": damaged });
  f.collect(); assert.equal(readFileSync(join(f.destination, "execution-private/calc-core.execution.json"), "utf8"), damaged);
  const manifest = JSON.parse(readFileSync(join(f.destination, "manifest.json"), "utf8"));
  assert.equal(manifest.evidenceValidation, "unvalidated"); assert.equal("completedRoles" in manifest, false); assert.equal(manifest.resumeAuthorized, false);
});

test("optional existing plan fingerprint is verified without task claims or changing state", t => {
  const f = fixture(t), taskId = calculatorPlanTaskId(goal, 1);
  const proposal = { tasks: [{ id: taskId, role: "coder", goal: "Implement arithmetic and independent module unit tests.",
    acceptanceIds: CALCULATOR_ACCEPTANCE.map(item => item.id), paths: ["src/calculator.mjs", "test/calculator.test.mjs"], dependsOn: [] }],
    blockers: [], unverifiedAreas: ["Frontend acceptance remains unverified."] };
  const plan = createCalculatorPlan(goal, proposal), document = { version: 1, request: goal, proposal, fingerprint: plan.fingerprint };
  const path = join(f.root, "state", goal.id + ".calculator-plan.json"); f.put(path, document); const before = readFileSync(path);
  f.sources(); f.collect(); const manifest = JSON.parse(readFileSync(join(f.destination, "manifest.json"), "utf8"));
  assert.equal(manifest.planFingerprint, plan.fingerprint); assert.equal(manifest.planVerification, "document-digest-verified");
  assert.deepEqual(readFileSync(path), before); assert.deepEqual(readdirSync(join(f.root, "state")), [goal.id + ".calculator-plan.json"]);
});

test("changed owner plan document or digest is refused before export", async t => {
  for (const drift of ["owner", "fingerprint"]) await t.test(drift, t => {
    const f = fixture(t), proposal = { tasks: [], blockers: [], unverifiedAreas: [] }, plan = createCalculatorPlan(goal, proposal);
    const request = drift === "owner" ? { ...goal, goal: goal.goal + " Different owner task." } : goal;
    f.put(join(f.root, "state", goal.id + ".calculator-plan.json"), { version: 1, request, proposal,
      fingerprint: drift === "fingerprint" ? "0".repeat(64) : plan.fingerprint });
    f.sources(); assert.throws(f.collect, error); assert.equal(existsSync(f.destination), false);
  });
});

test("run identity, remote barrier, runtime SHA, image and restored provenance must match", async t => {
  for (const drift of ["repository", "ref", "event", "attempt", "run", "sha", "barrier-env", "barrier-file", "factory", "image", "context-extra", "restore", "owner"]) await t.test(drift, t => {
    const f = fixture(t); f.sources(); let args = [f.root, factory, image];
    const changedEnv = { ...f.env };
    const envKeys: Record<string, string> = { repository: "GITHUB_REPOSITORY", ref: "GITHUB_REF", event: "GITHUB_EVENT_NAME", attempt: "GITHUB_RUN_ATTEMPT",
      run: "GITHUB_RUN_ID", sha: "GITHUB_SHA", "barrier-env": "CALCULATOR_REMOTE_BARRIER_UPLOADED" };
    if (envKeys[drift]) changedEnv[envKeys[drift] as keyof typeof changedEnv] = "different";
    if (drift === "barrier-file") f.put(join(f.root, "barrier/launch.json"), { ...f.launch, eventSha: "0".repeat(40) });
    if (drift === "factory") args = [f.root, "0".repeat(40), image];
    if (drift === "image") args = [f.root, factory, "node@sha256:" + "0".repeat(64)];
    if (drift === "context-extra") f.put(join(f.root, "context.json"), { ...f.context, unsafe: true });
    if (drift === "restore") f.put(join(f.root, "context.json"), { ...f.context, restore: null });
    if (drift === "owner") f.put(join(f.root, "context.json"), { ...f.context, request: { ...f.request, goal: { ...goal, id: "changed-owner" } } });
    assert.throws(() => runCalculatorExecutionArtifact(args, changedEnv), error); assert.equal(existsSync(f.destination), false);
  });
});

test("planning mode cannot emit a fourth artifact into prior planning history", t => {
  const f = fixture(t), request = { ...f.request, mode: "plan" as const };
  const manifest = calculatorLaunchManifest(request, f.launch.runId, f.launch.eventSha, f.launch.requestBlobSha);
  f.put(join(f.root, "context.json"), { ...f.context, request, manifest }); f.put(join(f.root, "barrier/launch.json"), manifest);
  assert.throws(f.collect, error); assert.equal(existsSync(f.destination), false);
});

test("wrong private namespace, arbitrary files, nonempty locks and loose permissions are refused", async t => {
  for (const form of ["namespace", "arbitrary", "temporary", "nonempty-lock", "source-permissions", "directory-permissions", "context-permissions"]) await t.test(form, t => {
    const f = fixture(t); f.sources();
    if (form === "namespace") renameSync(f.source, join(f.privateRoot, "0".repeat(64)));
    if (form === "arbitrary") writeFileSync(join(f.source, "private-source.mjs"), privateText, { mode: 0o600 });
    if (form === "temporary") writeFileSync(join(f.source, "calc-core.execution.json.tmp.uncommitted"), privateText, { mode: 0o600 });
    if (form === "nonempty-lock") writeFileSync(join(f.source, "calc-core.execution.json.lock"), "active", { mode: 0o600 });
    if (form === "source-permissions") chmodSync(join(f.source, "calc-core.execution.json"), 0o644);
    if (form === "directory-permissions") chmodSync(f.source, 0o755);
    if (form === "context-permissions") chmodSync(join(f.root, "context.json"), 0o644);
    assert.throws(f.collect, error); assert.equal(existsSync(f.destination), false);
  });
});

test("symlink directories, source files, context and hardlinks are refused without changing targets", async t => {
  for (const form of ["ancestor", "private-root", "namespace", "checkpoint", "context", "hardlink"]) await t.test(form, t => {
    const f = fixture(t); f.sources(); const external = join(f.root, "external"); writeFileSync(external, "external-target", { mode: 0o600 });
    let call = f.collect;
    if (form === "ancestor") { const linked = f.root + "-link"; symlinkSync(f.root, linked, "dir"); t.after(() => unlinkSync(linked)); call = () => exportPrivateExecutionArtifact(linked, factory, image, f.env); }
    if (form === "private-root") { renameSync(f.privateRoot, f.privateRoot + "-real"); symlinkSync(f.privateRoot + "-real", f.privateRoot, "dir"); }
    if (form === "namespace") { renameSync(f.source, f.source + "-real"); symlinkSync(f.source + "-real", f.source, "dir"); }
    if (form === "checkpoint") { unlinkSync(join(f.source, "calc-core.execution.json")); symlinkSync(external, join(f.source, "calc-core.execution.json")); }
    if (form === "context") { unlinkSync(join(f.root, "context.json")); symlinkSync(external, join(f.root, "context.json")); }
    if (form === "hardlink") linkSync(join(f.source, "calc-core.execution.json"), join(f.root, "linked-capsule"));
    assert.throws(call, error); assert.equal(readFileSync(external, "utf8"), "external-target"); assert.equal(existsSync(f.destination), false);
  });
});

test("raw and JSON-escaped secrets fail closed without publishing any bytes", async t => {
  const tokens = ["ghp_" + "A".repeat(30), "gsk_" + "B".repeat(40)];
  for (const source of tokens.flatMap(token => [token, JSON.stringify({ source: token }).replace(token[0]!, "\\u0067"),
    '{"source":"' + token.replace(token[0]!, "\\u0067")])) await t.test("secret", t => {
    const f = fixture(t); f.sources({ "calc-core.execution.json": source });
    assert.throws(f.collect, error); assert.equal(existsSync(f.destination), false);
  });
});

test("file size, total byte and file count limits fail without truncating evidence", async t => {
  for (const form of ["size", "total", "count"]) await t.test(form, t => {
    const f = fixture(t); let files: Record<string, string>;
    if (form === "size") files = { "calc-core.execution.json": "X".repeat(512 * 1024 + 1) };
    else files = Object.fromEntries(Array.from({ length: form === "count" ? 25 : 17 }, (_, index) =>
      ["task-" + index + ".execution.json", form === "count" ? "{}" : "X".repeat(512 * 1024)]));
    f.sources(files); assert.throws(f.collect, error); assert.equal(existsSync(f.destination), false);
    assert.equal(readFileSync(join(f.source, Object.keys(files)[0]!)).length, Object.values(files)[0]!.length);
  });
});

test("existing output or exclusive export lock prevents overwrite", async t => {
  for (const form of ["output", "lock"]) await t.test(form, t => {
    const f = fixture(t); f.sources(); const path = form === "output" ? f.destination : join(f.root, ".execution-artifact.lock");
    if (form === "output") { mkdirSync(path, { mode: 0o700 }); writeFileSync(join(path, "existing"), "retain", { mode: 0o600 }); }
    else writeFileSync(path, "existing-writer", { mode: 0o600 });
    assert.throws(f.collect, error);
    assert.equal(readFileSync(form === "output" ? join(path, "existing") : path, "utf8"), form === "output" ? "retain" : "existing-writer");
  });
});

test("atomic rename failure leaves no uploadable partial output and preserves source", t => {
  const f = fixture(t); f.sources(); const original = readFileSync(join(f.source, "calc-core.execution.json")), realRename = fs.renameSync;
  try {
    fs.renameSync = () => { throw new Error("simulated export publication fault"); }; syncBuiltinESMExports();
    assert.throws(f.collect, error);
  } finally { fs.renameSync = realRename; syncBuiltinESMExports(); }
  assert.equal(existsSync(f.destination), false); assert.deepEqual(readFileSync(join(f.source, "calc-core.execution.json")), original);
  assert.equal(existsSync(join(f.root, ".execution-artifact.lock")), false);
  assert.equal(readdirSync(f.root).some(name => name.startsWith(".execution-artifact.tmp.")), false);
  assert.equal(f.collect().status, "preserved");
});

test("a source mutation during copying refuses the atomic publication", t => {
  const f = fixture(t); f.sources(); const realWrite = fs.writeFileSync, source = join(f.source, "calc-core.execution.json"); let injected = false;
  try {
    fs.writeFileSync = ((...args: unknown[]) => {
      const result = Reflect.apply(realWrite, fs, args);
      if (!injected && typeof args[0] === "number") { injected = true; realWrite(source, "changed while copying", { mode: 0o600 }); }
      return result;
    }) as typeof fs.writeFileSync;
    syncBuiltinESMExports(); assert.throws(f.collect, error);
  } finally { fs.writeFileSync = realWrite; syncBuiltinESMExports(); }
  assert.equal(injected, true); assert.equal(existsSync(f.destination), false);
});

test("fixed CLI arguments reject extra commands and unsafe roots without executing anything", t => {
  const f = fixture(t);
  for (const args of [[], [f.root, factory, image, "--resume"], ["relative", factory, image], [f.root + "/state/..", factory, image], ["/", factory, image]])
    assert.throws(() => runCalculatorExecutionArtifact(args, f.env), error);
  assert.equal(existsSync(f.destination), false);
});
