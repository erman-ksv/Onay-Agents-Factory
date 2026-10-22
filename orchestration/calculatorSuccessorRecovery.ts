/** One separately admitted t02 regeneration. The consumed old event and charges stay archived. */
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CALCULATOR_STOPPED_SUCCESSOR_PIN, CALCULATOR_STOPPED_SUCCESSOR_CHARGE, inspectCalculatorStoppedSuccessor } from "./calculatorStoppedSuccessor.js";
import { renderCalculatorSuccessorRecoveryWorkflow } from "../config/calculatorSuccessorRecoveryWorkflow.js";
import { scanForSecrets } from "../github/secretScanner.js";
import { createCalculatorSnapshotReader } from "../github/calculatorSnapshot.js";
import { createCalculatorCiReader } from "../github/calculatorCi.js";
import { createCalculatorSandbox } from "./calculatorSandbox.js";
import { CALCULATOR_PUBLISHED_STATE_PIN, inspectCalculatorPublishedTaskState, restoreCalculatorPublishedTaskState,
  createCalculatorPublishedDependencyRunner, calculatorPublishedTaskLaunch } from "./calculatorPublishedTaskState.js";
import { CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES } from "./calculatorStep7FinalTester.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { openCalculatorWorkspace, selectCalculatorWorkspaceTask } from "./calculatorWorkspace.js";
import { runCalculatorRuntime } from "./calculatorRuntime.js";
import { sanitizeCalculatorLaunchReport } from "./calculatorLaunchState.js";
import { TeamTaskStore } from "./teamTaskStore.js";
import { calculatorAfterCiEventIdentity, prepareCalculatorAfterCiRequest } from "./calculatorAfterCi.js";
import { exportCalculatorAfterCiEventState, inspectCalculatorAfterCiEventState, prepareCalculatorEventOrigin } from "./calculatorAfterCiEventState.js";

export const CALCULATOR_SUCCESSOR_RECOVERY_ERROR = "Truncated successor recovery refused; preserve all evidence. No replay or budget reset.";
export const CALCULATOR_SUCCESSOR_RECOVERY_BRANCH = "feat/calculator-step7-regeneration-20261020";
export const CALCULATOR_SUCCESSOR_RECOVERY_PATH = ".github/workflows/calculator-successor-recovery.yml";
export const CALCULATOR_SUCCESSOR_RECOVERY_REQUEST = ".factory/calculator-successor-recovery-request.json";
const FACTORY = "erman-ksv/Onay-Agents-Factory", SOURCE = CALCULATOR_PUBLISHED_STATE_PIN;
const IMAGE = "node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392";
export const CALCULATOR_SUCCESSOR_RECOVERY_CHARGES = Object.freeze({ ...CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES,
  completedTask: Object.freeze({ attemptedRequests: 1, totalRequestBytes: 8262, reservedRunTokens: 4210, elapsedMs: 16575 }),
  stoppedSuccessor: CALCULATOR_STOPPED_SUCCESSOR_CHARGE });
export const CALCULATOR_SUCCESSOR_RECOVERY_ALLOWANCE = Object.freeze({ maxRequests: 4, maxRunBytes: 96000, maxRunTokens: 16000,
  maxOutputTokens: 1200, wallTimeMs: 300000, maxRepairs: 0, hostPreset: "calculator-successor-four-roles" });
const MAX_FILE = 512 * 1024, MAX_TOTAL = 8 * 1024 * 1024;
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const digest = (value: unknown) => sha256(JSON.stringify(value));
const blob = (value: string) => createHash("sha1").update("blob " + Buffer.byteLength(value) + "\0").update(value).digest("hex");
function refuse(): never { throw Error(CALCULATOR_SUCCESSOR_RECOVERY_ERROR); }
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) return refuse(); return v as Record<string, unknown>;
}
function same(a: unknown, b: unknown): boolean { return digest(a) === digest(b); }
function hash(v: unknown): string { if (typeof v !== "string" || !/^[a-f0-9]{40}$/.test(v)) return refuse(); return v; }
function integer(v: unknown): number { if (!Number.isSafeInteger(v) || Number(v) < 1) return refuse(); return Number(v); }
export function createCalculatorSuccessorRecoveryRequest(runtimeSha: string) {
  return Object.freeze({ version: 1 as const, approval: "ONE_TRUNCATED_SUCCESSOR_REGENERATION" as const, runtimeSha: hash(runtimeSha),
    source: CALCULATOR_STOPPED_SUCCESSOR_PIN, completedTaskSource: SOURCE, taskId: "calculator-pilot-step7-v1-34ee03-t02", previousCharges: CALCULATOR_SUCCESSOR_RECOVERY_CHARGES,
    additionalAllowance: CALCULATOR_SUCCESSOR_RECOVERY_ALLOWANCE, automaticReplay: false as const, budgetResetAuthorized: false as const });
}
export function validateCalculatorSuccessorRecoveryRequest(value: unknown, runtimeSha: string) {
  const raw = object(value), expected = createCalculatorSuccessorRecoveryRequest(runtimeSha);
  if (Reflect.ownKeys(raw).length !== Object.keys(expected).length || Object.keys(expected).some(key =>
    !Object.hasOwn(raw, key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(raw, key)!, "value") ||
    !same(raw[key], expected[key as keyof typeof expected]))) return refuse(); return expected;
}
export const calculatorSuccessorRecoveryRequestText = (runtimeSha: string): string => JSON.stringify(createCalculatorSuccessorRecoveryRequest(runtimeSha)) + "\n";
function runIdentity(env: NodeJS.ProcessEnv) {
  if (env.GITHUB_REPOSITORY !== FACTORY || env.GITHUB_EVENT_NAME !== "push" || env.GITHUB_REF !== "refs/heads/" + CALCULATOR_SUCCESSOR_RECOVERY_BRANCH ||
      env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_RUN_NUMBER !== "1" || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "")) return refuse();
  return { runId: integer(Number(env.GITHUB_RUN_ID)), eventSha: hash(env.GITHUB_SHA) };
}
type File = { path: string; relative: string; bytes: Buffer; stat: Stats };
function directory(path: string): Stats {
  if (!isAbsolute(path) || resolve(path) !== path || path === parse(path).root) return refuse(); let next = parse(path).root;
  for (const part of path.slice(next.length).split("/")) { next = join(next, part); const s = lstatSync(next); if (!s.isDirectory() || s.isSymbolicLink()) return refuse(); }
  const s = lstatSync(path); if (![0o700, 0o755].includes(s.mode & 0o777) || (process.getuid && s.uid !== process.getuid())) return refuse(); return s;
}
function unchanged(path: string, stat: Stats): void {
  const next = lstatSync(path); if (next.ino !== stat.ino || next.dev !== stat.dev || next.mode !== stat.mode || next.uid !== stat.uid ||
    next.size !== stat.size || next.mtimeMs !== stat.mtimeMs || next.ctimeMs !== stat.ctimeMs || next.isSymbolicLink()) return refuse();
}
function secrets(text: string): boolean { return scanForSecrets(text).length > 0 || /(?:gsk_|gh[pousr]_)[A-Za-z0-9_-]{20,}/.test(text); }
function read(path: string, relative = ""): File {
  const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_FILE ||
      ![0o600, 0o644].includes(stat.mode & 0o777) || (process.getuid && stat.uid !== process.getuid())) return refuse();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); let bytes: Buffer;
  try { const s = fstatSync(fd); if (s.dev !== stat.dev || s.ino !== stat.ino || s.nlink !== 1 || s.size !== stat.size) return refuse(); bytes = readFileSync(fd); }
  finally { closeSync(fd); }
  unchanged(path, stat); if (bytes.length !== stat.size) return refuse();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); if (secrets(text)) return refuse();
  if (path.endsWith(".lock")) { if (bytes.length) return refuse(); }
  else if (secrets(JSON.stringify(JSON.parse(text)))) return refuse();
  return { path, relative, bytes, stat };
}
function json(path: string): unknown { return JSON.parse(read(path).bytes.toString("utf8")); }
function sync(path: string): void { const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
function put(path: string, value: unknown): void {
  const bytes = Buffer.from(JSON.stringify(value) + "\n"); if (bytes.length > MAX_FILE || secrets(bytes.toString("utf8"))) return refuse();
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); } sync(dirname(path));
}
function factoryReader(env: NodeJS.ProcessEnv, transport: typeof fetch) {
  if (!env.FACTORY_HISTORY_TOKEN) return refuse(); let calls = 0; const started = performance.now();
  return async (path: string): Promise<Record<string, unknown>> => {
    if (++calls > 20 || performance.now() - started > 60000) return refuse();
    const r = await transport("https://api.github.com/repos/" + FACTORY + path, { method: "GET", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + env.FACTORY_HISTORY_TOKEN, "X-GitHub-Api-Version": "2022-11-28" } });
    if (!r.ok || !r.body) { void r.body?.cancel().catch(() => undefined); return refuse(); }
    const reader = r.body.getReader(), parts: Uint8Array[] = []; let size = 0;
    try { while (true) { const p = await reader.read(); if (p.done) break; size += p.value.byteLength; if (size > 1048576) { await reader.cancel(); return refuse(); } parts.push(p.value); } }
    finally { reader.releaseLock(); }
    return object(JSON.parse(Buffer.concat(parts).toString("utf8")));
  };
}
export async function verifyCalculatorSuccessorRecoveryHistory(env: NodeJS.ProcessEnv, runtimeSha: string, transport: typeof fetch = globalThis.fetch): Promise<void> {
  try {
    const run = runIdentity(env), get = factoryReader(env, transport), current = await get("/actions/runs/" + run.runId);
    if (current.id !== run.runId || current.head_sha !== run.eventSha || current.path !== CALCULATOR_SUCCESSOR_RECOVERY_PATH || current.run_attempt !== 1 ||
        current.run_number !== 1 || current.head_branch !== CALCULATOR_SUCCESSOR_RECOVERY_BRANCH || current.event !== "push" || current.status !== "in_progress" ||
        current.conclusion !== null || object(current.repository).full_name !== FACTORY || object(current.head_repository).full_name !== FACTORY) return refuse();
    const workflowId = integer(current.workflow_id), listing = await get("/actions/workflows/" + workflowId + "/runs?per_page=100");
    if (listing.total_count !== 1 || !Array.isArray(listing.workflow_runs) || listing.workflow_runs.length !== 1 || object(listing.workflow_runs[0]).id !== run.runId) return refuse();
    const workflow = await get("/contents/" + CALCULATOR_SUCCESSOR_RECOVERY_PATH + "?ref=" + run.eventSha), request = await get("/contents/" + CALCULATOR_SUCCESSOR_RECOVERY_REQUEST + "?ref=" + run.eventSha);
    if (workflow.type !== "file" || workflow.sha !== blob(renderCalculatorSuccessorRecoveryWorkflow(runtimeSha)) ||
        request.type !== "file" || request.sha !== blob(calculatorSuccessorRecoveryRequestText(runtimeSha))) return refuse();
    const prior = await get("/actions/runs/" + SOURCE.runId);
    if (prior.id !== SOURCE.runId || prior.head_sha !== SOURCE.eventSha || prior.path !== ".github/workflows/calculator-step7-final-tester.yml" ||
        prior.head_branch !== CALCULATOR_SUCCESSOR_RECOVERY_BRANCH || prior.event !== "push" || prior.run_attempt !== 1 || prior.status !== "completed" || prior.conclusion !== "success" ||
        object(prior.repository).full_name !== FACTORY || object(prior.head_repository).full_name !== FACTORY) return refuse();
    const artifact = await get("/actions/artifacts/" + SOURCE.artifactId);
    if (artifact.id !== SOURCE.artifactId || artifact.name !== "calculator-step7-final-tester-evidence-" + SOURCE.runId || artifact.digest !== SOURCE.artifactDigest ||
        artifact.expired !== false || artifact.size_in_bytes !== 53286 || object(artifact.workflow_run).id !== SOURCE.runId || object(artifact.workflow_run).head_sha !== SOURCE.eventSha) return refuse();
    const stopped = CALCULATOR_STOPPED_SUCCESSOR_PIN;
    const failed = await get("/actions/runs/" + stopped.runId);
    if (failed.id !== stopped.runId || failed.head_sha !== stopped.eventSha || failed.path !== ".github/workflows/calculator-after-ci-successor.yml" ||
        failed.head_branch !== CALCULATOR_SUCCESSOR_RECOVERY_BRANCH || failed.event !== "push" || failed.run_attempt !== 1 ||
        failed.status !== "completed" || failed.conclusion !== "failure" || object(failed.repository).full_name !== FACTORY ||
        object(failed.head_repository).full_name !== FACTORY) return refuse();
    const failedArtifact = await get("/actions/artifacts/" + stopped.artifactId);
    if (failedArtifact.id !== stopped.artifactId || failedArtifact.name !== "calculator-successor-evidence-" + stopped.runId ||
        failedArtifact.digest !== stopped.artifactDigest || failedArtifact.size_in_bytes !== 69704 || failedArtifact.expired !== false ||
        object(failedArtifact.workflow_run).id !== stopped.runId || object(failedArtifact.workflow_run).head_sha !== stopped.eventSha) return refuse();
  } catch { return refuse(); }
}
export async function verifyCalculatorSuccessorRecoveryRemoteBarrier(env: NodeJS.ProcessEnv, transport: typeof fetch = globalThis.fetch): Promise<void> {
  try {
    const current = runIdentity(env);
    if (!/^[1-9][0-9]*$/.test(env.CALCULATOR_SUCCESSOR_RECOVERY_BARRIER_ID ?? "") || !/^sha256:[a-f0-9]{64}$/.test(env.CALCULATOR_SUCCESSOR_RECOVERY_BARRIER_DIGEST ?? "")) return refuse();
    const id = integer(Number(env.CALCULATOR_SUCCESSOR_RECOVERY_BARRIER_ID)), artifact = await factoryReader(env, transport)("/actions/artifacts/" + id);
    if (artifact.id !== id || artifact.name !== "calculator-successor-recovery-admission-" + current.runId || artifact.digest !== env.CALCULATOR_SUCCESSOR_RECOVERY_BARRIER_DIGEST ||
        artifact.expired !== false || typeof artifact.size_in_bytes !== "number" || artifact.size_in_bytes < 1 || artifact.size_in_bytes > 262144 ||
        object(artifact.workflow_run).id !== current.runId || object(artifact.workflow_run).head_sha !== current.eventSha) return refuse();
  } catch { return refuse(); }
}
export function createCalculatorSuccessorRecoveryAdmission(root: string, transition: ReturnType<typeof prepareCalculatorAfterCiRequest>, origin: ReturnType<typeof prepareCalculatorEventOrigin>) {
  const source = join(root, "admission-event"); mkdirSync(source, { mode: 0o700 }); const marker = new TeamTaskStore(source, calculatorAfterCiEventIdentity(transition));
  try {
    if (marker.claim() !== "claimed") return refuse(); marker.recordStage("execute_next_task", "running");
    return exportCalculatorAfterCiEventState(source, join(root, "admission-artifact"), transition, origin);
  } finally { marker.close(); }
}

/** Bounded immutable private forensic export, including all old costs/state and
 * new event locks/checkpoints. Never replaces any prior file or grants resume. */
export function collectCalculatorSuccessorRecoveryEvidence(root: string) {
  try {
    const rootStat = directory(root), rootNames = readdirSync(root).sort();
    const allowedDirs = ["prior-evidence", "state", "execution-private", "admission-event", "admission-artifact", "confirmed-event", "barrier"];
    const allowedFiles = ["context.json", "calculator-report.json", "calc-successor-recovery-" + SOURCE.goalId + ".json", "calc-successor-recovery-" + SOURCE.goalId + ".lock"];
    if (rootNames.some(n => !allowedDirs.includes(n) && !allowedFiles.includes(n))) return refuse();
    const files: File[] = [], dirs: { path: string; stat: Stats; names: string[] }[] = []; let total = 0;
    function walk(path: string, relative: string, depth: number): void {
      if (depth > 16 || dirs.length >= 256) return refuse(); const stat = directory(path), names = readdirSync(path).sort();
      if (names.length > 256) return refuse(); dirs.push({ path, stat, names });
      for (const name of names) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name) || name.includes("..")) return refuse();
        const next = join(path, name), rel = relative + "/" + name;
        if (lstatSync(next).isDirectory()) walk(next, rel, depth + 1); else add(next, rel);
      }
    }
    function add(path: string, relative: string): void {
      if (files.length >= 256 || !/\.(json|lock)$/.test(relative)) return refuse(); const f = read(path, relative);
      total += f.bytes.length; if (total > MAX_TOTAL) return refuse(); files.push(f);
    }
    for (const name of rootNames) { if (allowedDirs.includes(name)) walk(join(root, name), name, 1); else add(join(root, name), name); }
    files.sort((a, b) => a.relative.localeCompare(b.relative));
    const entries = files.map(f => ({ path: f.relative, bytes: f.bytes.length, sha256: sha256(f.bytes) }));
    const destination = join(root, "successor-artifact"); mkdirSync(destination, { mode: 0o700 }); mkdirSync(join(destination, "evidence"), { mode: 0o700 });
    for (const d of dirs) mkdirSync(join(destination, "evidence", d.path.slice(root.length + 1)), { mode: 0o700 });
    for (const f of files) {
      const fd = openSync(join(destination, "evidence", f.relative), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, f.bytes); fsyncSync(fd); } finally { closeSync(fd); }
    }
    const manifest = { version: 1, kind: "calculator-truncated-successor-recovery-forensic", evidenceValidation: "unvalidated", files: entries,
      fileCount: files.length, totalBytes: total, treeSha256: digest(entries), previousCharges: CALCULATOR_SUCCESSOR_RECOVERY_CHARGES,
      additionalAllowance: CALCULATOR_SUCCESSOR_RECOVERY_ALLOWANCE, resumeAuthorized: false, budgetResetAuthorized: false };
    put(join(destination, "manifest.json"), manifest);
    for (const d of [...dirs].reverse()) { unchanged(d.path, d.stat); if (!same(readdirSync(d.path).sort(), d.names)) return refuse(); sync(join(destination, "evidence", d.path.slice(root.length + 1))); }
    for (const f of files) unchanged(f.path, f.stat);
    if (rootStat.ino !== lstatSync(root).ino || rootStat.dev !== lstatSync(root).dev || !same(readdirSync(root).filter(n => n !== "successor-artifact").sort(), rootNames)) return refuse();
    sync(join(destination, "evidence")); sync(destination); sync(root);
    return { status: "preserved", fileCount: files.length, totalBytes: total, manifestSha256: sha256(JSON.stringify(manifest) + "\n") };
  } catch { return refuse(); }
}
export async function runCalculatorSuccessorRecovery(args: string[], env: NodeJS.ProcessEnv = process.env, transport: typeof fetch = globalThis.fetch) {
  let phase = "entry_unverified";
  try {
    if (args.length !== 3 || !["prepare", "execute", "collect"].includes(args[0]!)) return refuse();
    const [mode, root, runtimeSha] = args as [string, string, string]; hash(runtimeSha); const current = runIdentity(env); directory(root);
    if (mode === "collect") return collectCalculatorSuccessorRecoveryEvidence(root);
    phase = "history_unverified"; await verifyCalculatorSuccessorRecoveryHistory(env, runtimeSha, transport);
    phase = "published_archive_unverified";
    const stopped = inspectCalculatorStoppedSuccessor(join(root, "prior-evidence"));
    const prior = inspectCalculatorPublishedTaskState(join(root, "prior-evidence/evidence/prior-evidence")), launch = calculatorPublishedTaskLaunch(prior);
    if (launch.config.sandboxImage !== IMAGE || !same(prior.completedTaskCharge, CALCULATOR_SUCCESSOR_RECOVERY_CHARGES.completedTask)) return refuse();
    const origin = prepareCalculatorEventOrigin({ repository: FACTORY, workflowPath: CALCULATOR_SUCCESSOR_RECOVERY_PATH, runId: current.runId,
      runAttempt: 1, eventSha: current.eventSha, runtimeSha });
    if (mode === "prepare") {
      if (!env.GITHUB_WORKSPACE || readdirSync(root).join(",") !== "prior-evidence") return refuse(); chmodSync(root, 0o700);
      phase = "request_unverified";
      const request = validateCalculatorSuccessorRecoveryRequest(json(join(env.GITHUB_WORKSPACE, "request", CALCULATOR_SUCCESSOR_RECOVERY_REQUEST)), runtimeSha);
      restoreCalculatorPublishedTaskState(prior, join(root, "state"));
      const store = new CalculatorPlanStore(join(root, "state"), launch.goal), plan = store.inspect(); if (!plan) return refuse();
      const transition = prepareCalculatorAfterCiRequest({ version: 1, planFingerprint: plan.fingerprint, previousTaskId: prior.taskId,
        candidateSha: prior.candidateSha, expectedNextTaskId: request.taskId });
      const reader = createCalculatorSnapshotReader(env), checks = createCalculatorSandbox({ image: IMAGE, baseSha: prior.candidateSha, baseSources: new Map() }, env);
      const ci = createCalculatorCiReader({ trustedWorkflows: launch.config.trustedWorkflows }, env);
      phase = "candidate_ci_unverified";
      const evidence = await ci({ repository: prior.repository, branch: plan.branch, candidateSha: prior.candidateSha });
      const { evaluateTestExecutionEvidence } = await import("../agents/tester/agent.js");
      const verifiedCi = evaluateTestExecutionEvidence(evidence.runs, evidence.jobs, prior.candidateSha, ["Calculator task CI"], ["Syntax", "Task tests"]);
      if (!verifiedCi.testsExecuted || verifiedCi.status !== "passed") return refuse();
      phase = "current_dependency_unverified";
      const workspace = await openCalculatorWorkspace(store, reader, plan.branch, prior.candidateSha);
      const selected = await selectCalculatorWorkspaceTask(workspace, createCalculatorPublishedDependencyRunner(prior, reader, checks.checkProposal));
      if (selected.status !== "ready" || selected.task?.id !== request.taskId) return refuse();
      phase = "admission_unverified";
      const admission = createCalculatorSuccessorRecoveryAdmission(root, transition, origin);
      put(join(root, "context.json"), { version: 1, request, origin, transition, prior, stopped, admission });
      return { status: "ready-for-one-successor", taskId: request.taskId, manifestSha256: admission.manifestSha256, modelsRun: false };
    }
    phase = "context_unverified";
    const context = object(json(join(root, "context.json"))), request = validateCalculatorSuccessorRecoveryRequest(context.request, runtimeSha);
    const transition = prepareCalculatorAfterCiRequest(context.transition), admission = object(context.admission);
    if (context.version !== 1 || !same(context.origin, origin) || !same(context.prior, prior) || !same(context.stopped, stopped) || transition.expectedNextTaskId !== request.taskId ||
        transition.previousTaskId !== SOURCE.taskId || transition.candidateSha !== SOURCE.candidateSha || transition.planFingerprint !== SOURCE.planFingerprint ||
        typeof admission.manifestSha256 !== "string") return refuse();
    inspectCalculatorAfterCiEventState(join(root, "admission-artifact"), { request: transition, origin, manifestSha256: admission.manifestSha256 });
    phase = "remote_admission_unverified"; await verifyCalculatorSuccessorRecoveryRemoteBarrier(env, transport);
    if (env.AGENT_FACTORY_PROVIDER !== "groq" || env.GROQ_MODEL || env.AGENT_FACTORY_LEGAL_ENABLED !== "false") return refuse();
    const marker = new TeamTaskStore(root, { id: "calc-successor-recovery-" + SOURCE.goalId, fingerprint: digest(context) });
    try {
      if (marker.claim() !== "claimed") return refuse(); marker.recordStage("execute_saved_successor", "running");
      const reader = createCalculatorSnapshotReader(env), checks = createCalculatorSandbox({ image: IMAGE, baseSha: SOURCE.candidateSha, baseSources: new Map() }, env);
      phase = "successor_runtime_stopped";
      const result = await runCalculatorRuntime(launch.goal, launch.config, join(root, "state"), "run", env,
        { maxRequests: 4, maxRunBytes: 96000, maxRepairs: 0, hostPreset: "calculator-successor-four-roles" }, undefined, {
          request: transition, verifyDependencies: createCalculatorPublishedDependencyRunner(prior, reader, checks.checkProposal),
          persistBarrier: async input => {
            const actual = exportCalculatorAfterCiEventState(input.eventDirectory, join(root, "confirmed-event"), transition, origin);
            if (actual.manifestSha256 !== admission.manifestSha256 || !same(input.request, transition)) return refuse();
            await verifyCalculatorSuccessorRecoveryRemoteBarrier(env, transport);
            mkdirSync(join(root, "barrier"), { mode: 0o700 });
            put(join(root, "barrier/remote.json"), { artifactId: integer(Number(env.CALCULATOR_SUCCESSOR_RECOVERY_BARRIER_ID)),
              artifactDigest: env.CALCULATOR_SUCCESSOR_RECOVERY_BARRIER_DIGEST, manifestSha256: actual.manifestSha256, origin });
          },
        });
      const report = sanitizeCalculatorLaunchReport(result, { ...launch, mode: "run" });
      if (report.taskId !== undefined && report.taskId !== request.taskId) return refuse();
      marker.recordStage("execute_saved_successor", report.status === "blocked" ? "blocked" : "passed");
      marker.finish(report.status === "blocked" ? "blocked" : "needs-review", "one_successor_consumed_no_replay"); put(join(root, "calculator-report.json"), report);
      return { ...report, status: String(report.status), previousTaskReplayed: false, historicalChargesErased: false };
    } catch {
      try { marker.finish("blocked", "successor_interrupted_no_replay"); } catch { /* Retain earliest durable barrier. */ }
      try { put(join(root, "calculator-report.json"), { status: "blocked", reasonCode: "successor_interrupted_no_replay", wholeAppCompleted: false, legalEnabled: false }); } catch { /* Never replace evidence. */ }
      return refuse();
    } finally { marker.close(); }
  } catch { console.error(JSON.stringify({ event: "calculator_successor_recovery_stopped", reasonCode: phase })); return refuse(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runCalculatorSuccessorRecovery(process.argv.slice(2)).then(result => { console.log(JSON.stringify(result)); if (result.status === "blocked") process.exitCode = 10; })
    .catch(() => { console.error(CALCULATOR_SUCCESSOR_RECOVERY_ERROR); process.exitCode = 10; });
