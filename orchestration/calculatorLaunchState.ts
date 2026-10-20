import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, appendFileSync, chmodSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { prepareCalculatorGoal, createCalculatorPlan, calculatorPlanDigest, calculatorPlanTaskId, type CalculatorGoalRequest, type CalculatorPlan } from "./calculatorPlan.js";
import { prepareCalculatorRuntimeConfig, type CalculatorRuntimeConfig } from "./calculatorRuntime.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { TeamTaskStore } from "./teamTaskStore.js";
import { scanForSecrets } from "../github/secretScanner.js";
import { renderCalculatorOneCycleWorkflow } from "../config/calculatorOneCycleWorkflow.js";

export const CALCULATOR_LAUNCH_ERROR = "Calculator launch refused: authorization, provenance or recoverable replay state is unverified. No automatic retry.";
export const CALCULATOR_LAUNCH_REPOSITORY = "erman-ksv/Onay-Agents-Factory";
export const CALCULATOR_LAUNCH_BRANCH = "feat/onay-task-runner-20261019";
export const CALCULATOR_LAUNCH_PATH = ".github/workflows/calculator-one-cycle.yml";
export const CALCULATOR_LAUNCH_REQUEST = ".factory/calculator-one-cycle-request.json";
const SHA = /^[a-f0-9]{40}$/, DIGEST = /^[a-f0-9]{64}$/, MAX_FILE = 32768;
function refuse(): never { throw Error(CALCULATOR_LAUNCH_ERROR); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return refuse();
  return value as Record<string, unknown>;
}
function exact(value: unknown, fields: string[]): Record<string, unknown> {
  const item = record(value); if (Object.keys(item).sort().join(",") !== [...fields].sort().join(",")) return refuse(); return item;
}
function hash(value: unknown): string { if (typeof value !== "string" || !SHA.test(value)) return refuse(); return value; }
function id(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return refuse(); return value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function gitBlob(value: string | Buffer): string { return createHash("sha1").update("blob " + Buffer.byteLength(value) + "\0").update(value).digest("hex"); }
export type CalculatorLaunchRequest = Readonly<{ version: 1; mode: "plan" | "run"; factorySha: string; freeTierConfirmed: true; goal: CalculatorGoalRequest; config: CalculatorRuntimeConfig }>;
export function prepareCalculatorLaunchRequest(value: unknown, factorySha?: string, image?: string): CalculatorLaunchRequest {
  const raw = exact(value, ["version", "mode", "factorySha", "freeTierConfirmed", "goal", "config"]);
  if (raw.version !== 1 || !["plan", "run"].includes(String(raw.mode)) || raw.freeTierConfirmed !== true ||
      (factorySha !== undefined && raw.factorySha !== factorySha)) return refuse();
  hash(raw.factorySha); const owner = prepareCalculatorGoal(raw.goal), config = prepareCalculatorRuntimeConfig(raw.config);
  if (owner.baseRef !== "feat/calculator-pilot-bootstrap" || (image !== undefined && config.sandboxImage !== image)) return refuse();
  return Object.freeze({ version: 1, mode: raw.mode as "plan" | "run", factorySha: raw.factorySha as string, freeTierConfirmed: true,
    goal: { version: 1 as const, id: owner.id, goal: owner.goal, provider: owner.provider, baseRef: owner.baseRef, baseSha: owner.baseSha }, config });
}
export function calculatorLaunchBinding(request: CalculatorLaunchRequest): string {
  return digest({ ownerFingerprint: prepareCalculatorGoal(request.goal).ownerFingerprint, configDigest: digest(request.config), factorySha: request.factorySha });
}
export type CalculatorLaunchManifest = Readonly<{ version: 1; goalId: string; mode: "plan" | "run"; factorySha: string; ownerFingerprint: string;
  configDigest: string; binding: string; runId: number; eventSha: string; requestBlobSha: string; workflowBlobSha: string }>;
type Restore = { runId: number; barrierId: number; capsuleId: number; manifest: CalculatorLaunchManifest };
type Context = { version: 1; request: CalculatorLaunchRequest; manifest: CalculatorLaunchManifest; restore: Restore | null };
export function calculatorLaunchManifest(request: CalculatorLaunchRequest, runId: number, eventSha: string, requestBlobSha: string): CalculatorLaunchManifest {
  return { version: 1, goalId: request.goal.id, mode: request.mode, factorySha: request.factorySha,
    ownerFingerprint: prepareCalculatorGoal(request.goal).ownerFingerprint, configDigest: digest(request.config), binding: calculatorLaunchBinding(request),
    runId: id(runId), eventSha: hash(eventSha), requestBlobSha: hash(requestBlobSha),
    workflowBlobSha: gitBlob(renderCalculatorOneCycleWorkflow(request.factorySha, request.config.sandboxImage)) };
}
function barrierName(goalId: string): string { return "calculator-cycle-barrier-" + goalId; }
function capsuleName(goalId: string): string { return "calculator-cycle-state-" + goalId; }
function reportName(runId: number): string { return "calculator-cycle-report-" + runId; }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function manifest(value: unknown, expected: CalculatorLaunchManifest): CalculatorLaunchManifest {
  const raw = exact(value, Object.keys(expected));
  if (Object.keys(expected).some(key => raw[key] !== expected[key as keyof CalculatorLaunchManifest])) return refuse(); return expected;
}

/** Full bounded run history is checked even when artifacts have been deleted.
 * Old source, missing/expired state or a second execution is never a new goal. */
export async function inspectCalculatorLaunchHistory(request: CalculatorLaunchRequest, current: CalculatorLaunchManifest,
  env: NodeJS.ProcessEnv, transport: typeof fetch = globalThis.fetch): Promise<Restore | null> {
  if (!env.GITHUB_TOKEN || env.GITHUB_REPOSITORY !== CALCULATOR_LAUNCH_REPOSITORY || env.GITHUB_REF !== "refs/heads/" + CALCULATOR_LAUNCH_BRANCH ||
      env.GITHUB_EVENT_NAME !== "push" || env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_SHA !== current.eventSha || Number(env.GITHUB_RUN_ID) !== current.runId) return refuse();
  let requests = 0; const started = performance.now();
  async function read(endpoint: string): Promise<unknown> {
    if (++requests > 256 || performance.now() - started > 60000) return refuse();
    const response = await transport("https://api.github.com/repos/" + CALCULATOR_LAUNCH_REPOSITORY + endpoint, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(12000),
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + env.GITHUB_TOKEN, "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!response.ok || !response.body) { void response.body?.cancel().catch(() => undefined); return refuse(); }
    const stream = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    try { while (true) { const part = await stream.read(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > 1048576) { await stream.cancel(); return refuse(); } chunks.push(part.value); } } finally { stream.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  function run(value: unknown) {
    const raw = record(value);
    if (raw.path !== CALCULATOR_LAUNCH_PATH || raw.event !== "push" || raw.head_branch !== CALCULATOR_LAUNCH_BRANCH || raw.run_attempt !== 1 ||
        record(raw.repository).full_name !== CALCULATOR_LAUNCH_REPOSITORY || record(raw.head_repository).full_name !== CALCULATOR_LAUNCH_REPOSITORY) return refuse();
    return { id: id(raw.id), number: id(raw.run_number), workflowId: id(raw.workflow_id), sha: hash(raw.head_sha), status: raw.status, conclusion: raw.conclusion };
  }
  async function pages(endpoint: string, key: string, maximum: number, pageSize: number): Promise<unknown[]> {
    const result: unknown[] = []; let count: number | undefined;
    for (let page = 1; page <= Math.ceil(maximum / pageSize); page++) {
      const data = record(await read(endpoint + (endpoint.includes("?") ? "&" : "?") + "per_page=" + pageSize + "&page=" + page));
      if (!Number.isSafeInteger(data.total_count) || Number(data.total_count) < 0 || Number(data.total_count) > maximum ||
          (count !== undefined && count !== data.total_count) || !Array.isArray(data[key]) || data[key].length > pageSize) return refuse();
      count = Number(data.total_count); result.push(...data[key]);
      if (result.length === count) return result;
      if (result.length > count || data[key].length < pageSize) return refuse();
    } return refuse();
  }
  const now = run(await read("/actions/runs/" + current.runId));
  if (now.sha !== current.eventSha) return refuse();
  const workflow = record(await read("/actions/workflows/" + now.workflowId));
  if (workflow.id !== now.workflowId || workflow.path !== CALCULATOR_LAUNCH_PATH || workflow.state !== "active") return refuse();
  const listed = (await pages("/actions/workflows/" + now.workflowId + "/runs?branch=" + encodeURIComponent(CALCULATOR_LAUNCH_BRANCH) + "&event=push", "workflow_runs", 40, 20)).map(run);
  if (!listed.some(item => item.id === current.runId && item.sha === current.eventSha && item.number === now.number) ||
      new Set(listed.map(item => item.id)).size !== listed.length || new Set(listed.map(item => item.number)).size !== listed.length ||
      listed.some(item => item.number > listed.length) || now.number !== Number(env.GITHUB_RUN_NUMBER)) return refuse();
  // Complete 1..N workflow numbering is an independent deletion barrier. Missing
  // runs cannot make both their artifacts and model history appear brand new.
  for (let number = 1; number <= listed.length; number++) if (!listed.some(item => item.number === number)) return refuse();
  let prior: Restore | null = null;
  for (const listedRun of listed) {
    const item = run(await read("/actions/runs/" + listedRun.id));
    if (item.id !== listedRun.id || item.number !== listedRun.number || item.sha !== listedRun.sha || item.workflowId !== now.workflowId) return refuse();
    const commit = record(await read("/git/commits/" + item.sha)); if (commit.sha !== item.sha) return refuse();
    const treeSha = hash(record(commit.tree).sha), tree = record(await read("/git/trees/" + treeSha + "?recursive=1"));
    if (tree.sha !== treeSha || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 4096) return refuse();
    const entries = new Map<string, Record<string, unknown>>();
    for (const raw of tree.tree) { const entry = record(raw); if (typeof entry.path !== "string" || entries.has(entry.path)) return refuse(); entries.set(entry.path, entry); }
    for (const path of [".github", ".github/workflows", ".factory"]) { const entry = entries.get(path); if (!entry || entry.mode !== "040000" || entry.type !== "tree") return refuse(); }
    const code = entries.get(CALCULATOR_LAUNCH_PATH), card = entries.get(CALCULATOR_LAUNCH_REQUEST);
    if (!code || code.mode !== "100644" || code.type !== "blob" || code.sha !== current.workflowBlobSha || !card || card.mode !== "100644" || card.type !== "blob") return refuse();
    const blob = record(await read("/git/blobs/" + hash(card.sha)));
    if (blob.sha !== card.sha || blob.encoding !== "base64" || typeof blob.content !== "string") return refuse();
    const data = Buffer.from(blob.content.replace(/\s/g, ""), "base64");
    if (data.length < 2 || data.length > 24576 || data.toString("base64") !== blob.content.replace(/\s/g, "") || gitBlob(data) !== card.sha) return refuse();
    const old = prepareCalculatorLaunchRequest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)));
    if (item.id === current.runId) { if (!same(old, request) || card.sha !== current.requestBlobSha) return refuse(); continue; }
    if (old.goal.id !== request.goal.id) continue;
    if (calculatorLaunchBinding(old) !== current.binding || request.mode === "plan" || old.mode !== "plan" || prior || item.status !== "completed" || item.conclusion !== "success") return refuse();
    const artifacts = (await pages("/actions/runs/" + item.id + "/artifacts", "artifacts", 10, 10)).map(record);
    const expectedNames = new Set([barrierName(old.goal.id), capsuleName(old.goal.id), reportName(item.id)]);
    if (artifacts.some(artifact => typeof artifact.name !== "string" || !expectedNames.has(artifact.name) || artifact.expired !== false ||
        !Number.isSafeInteger(artifact.size_in_bytes) || Number(artifact.size_in_bytes) < 1 || Number(artifact.size_in_bytes) > 1048576) ||
        new Set(artifacts.map(artifact => artifact.name)).size !== artifacts.length) return refuse();
    const barrier = artifacts.find(artifact => artifact.name === barrierName(old.goal.id)), capsule = artifacts.find(artifact => artifact.name === capsuleName(old.goal.id));
    if (!barrier || !capsule) return refuse();
    prior = { runId: item.id, barrierId: id(barrier.id), capsuleId: id(capsule.id), manifest: calculatorLaunchManifest(old, item.id, item.sha, hash(card.sha)) };
  }
  const finalRuns = (await pages("/actions/workflows/" + now.workflowId + "/runs?branch=" + encodeURIComponent(CALCULATOR_LAUNCH_BRANCH) + "&event=push", "workflow_runs", 40, 20)).map(run);
  if (finalRuns.length !== listed.length || listed.some(before => !finalRuns.some(after => after.id === before.id && after.number === before.number && after.sha === before.sha && after.workflowId === before.workflowId))) return refuse();
  if (request.mode === "run" && !prior) return refuse(); return prior;
}

function directory(path: string): void {
  if (!isAbsolute(path) || resolve(path) !== path) return refuse();
  let current = "/";
  for (const part of path.split("/").filter(Boolean)) { current = join(current, part); const stat = lstatSync(current); if (!stat.isDirectory() || stat.isSymbolicLink()) return refuse(); }
  const stat = lstatSync(path); if ((stat.mode & 0o777) !== 0o700 || (process.getuid && stat.uid !== process.getuid())) return refuse();
}
function bytes(path: string, maximum = MAX_FILE): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { const stat = fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 ||
      (process.getuid && stat.uid !== process.getuid()) || stat.size > maximum) return refuse(); return readFileSync(fd); } finally { closeSync(fd); }
}
function json(path: string, maximum = MAX_FILE): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes(path, maximum))); }
function put(path: string, value: unknown): void { writeFileSync(path, JSON.stringify(value) + "\n", { mode: 0o600, flag: "wx" }); }
function make(path: string): void { mkdirSync(path, { mode: 0o700 }); }
export function readCalculatorLaunchState(root: string, request: CalculatorLaunchRequest): ReadonlyMap<string, Buffer> {
  directory(root); const names = readdirSync(root).sort(), result = new Map<string, Buffer>(), owner = prepareCalculatorGoal(request.goal);
  const receiptIds = new Map([["calc-plan-" + owner.id, owner.ownerFingerprint], ["calc-planning-" + owner.id, owner.ownerFingerprint]]);
  let plan: CalculatorPlan | undefined;
  const planName = owner.id + ".calculator-plan.json";
  if (names.includes(planName)) {
    const raw = exact(json(join(root, planName)), ["version", "request", "proposal", "fingerprint"]);
    if (raw.version !== 1 || prepareCalculatorGoal(raw.request).ownerFingerprint !== owner.ownerFingerprint) return refuse();
    plan = createCalculatorPlan(request.goal, raw.proposal); if (plan.fingerprint !== raw.fingerprint) return refuse();
    for (const task of plan.tasks) receiptIds.set("calc-" + task.id, calculatorPlanDigest({ planFingerprint: plan.fingerprint, taskId: task.id }));
  }
  const allowed = new Set([planName, ...[...receiptIds.keys()].flatMap(name => [name + ".json", name + ".lock"])]);
  if (names.length > 21 || names.some(name => !allowed.has(name))) return refuse();
  for (const name of names) { const data = bytes(join(root, name)); if ((name.endsWith(".lock") && data.length !== 0) || scanForSecrets(data.toString("utf8")).length) return refuse(); result.set(name, data); }
  for (const [receiptId, fingerprint] of receiptIds) if (names.includes(receiptId + ".json")) {
    const store = new TeamTaskStore(root, { id: receiptId, fingerprint }); try { if (!store.inspectExisting()) return refuse(); } finally { store.close(); }
  }
  return result;
}
function runnable(root: string, request: CalculatorLaunchRequest): CalculatorPlan {
  const files = readCalculatorLaunchState(root, request), owner = prepareCalculatorGoal(request.goal);
  const allowed = new Set([owner.id + ".calculator-plan.json", "calc-plan-" + owner.id + ".json", "calc-planning-" + owner.id + ".json"]);
  if (files.size !== allowed.size || [...files.keys()].some(name => !allowed.has(name))) return refuse();
  const plan = new CalculatorPlanStore(root, request.goal).inspect(); if (!plan || plan.status !== "planned") return refuse();
  const planning = new TeamTaskStore(root, { id: "calc-planning-" + owner.id, fingerprint: owner.ownerFingerprint });
  try { const receipt = planning.inspectExisting(); if (!receipt || receipt.status !== "needs-review" || receipt.reasonCode !== "plan_saved_not_execution" || receipt.publication ||
      receipt.stages.length !== 1 || receipt.stages[0].stage !== "model_plan" || receipt.stages[0].status !== "passed") return refuse(); } finally { planning.close(); }
  return plan;
}
export function sanitizeCalculatorLaunchReport(value: unknown, request: CalculatorLaunchRequest): Record<string, unknown> {
  const raw = record(value), allowed = new Set(["mode", "status", "reasonCode", "planFingerprint", "taskId", "attempts", "repairs", "publication", "proposalTestsExecuted", "candidateTestsExecuted", "wholeAppCompleted", "finalCalculatorCiVerified", "legalEnabled"]);
  if (Object.keys(raw).some(key => !allowed.has(key)) || !["planned", "blocked", "needs-review", "candidate-verified"].includes(String(raw.status)) || raw.wholeAppCompleted !== false || raw.legalEnabled !== false ||
      (raw.mode !== undefined && raw.mode !== request.mode) || (raw.finalCalculatorCiVerified !== undefined && raw.finalCalculatorCiVerified !== false)) return refuse();
  if (raw.reasonCode !== undefined && (typeof raw.reasonCode !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(raw.reasonCode))) return refuse();
  if (raw.planFingerprint !== undefined && (typeof raw.planFingerprint !== "string" || !DIGEST.test(raw.planFingerprint))) return refuse();
  if (raw.taskId !== undefined && !Array.from({ length: 8 }, (_, index) => calculatorPlanTaskId(request.goal, index + 1)).includes(String(raw.taskId))) return refuse();
  for (const key of ["attempts", "repairs"]) if (raw[key] !== undefined && (!Number.isInteger(raw[key]) || Number(raw[key]) < 0 || Number(raw[key]) > (key === "repairs" ? 1 : 2))) return refuse();
  for (const key of ["proposalTestsExecuted", "candidateTestsExecuted"]) if (raw[key] !== undefined && typeof raw[key] !== "boolean") return refuse();
  if (raw.publication !== undefined) { const pub = exact(raw.publication, ["branch", "headSha", "url", "number"]);
    if (pub.branch !== "feat/calculator-agent/" + request.goal.id || !SHA.test(String(pub.headSha)) || pub.url !== "https://github.com/erman-ksv/Onay-Factory-Calculator/pull/" + id(pub.number)) return refuse(); }
  if (scanForSecrets(JSON.stringify(raw)).length) return refuse(); return { ...raw };
}
type Completion = { version: 1; manifestDigest: string; exitCode: number; stateDigests: Record<string, string>; reportDigest: string };
export function exportCalculatorLaunchCapsule(root: string, request: CalculatorLaunchRequest, current: CalculatorLaunchManifest, exitCode: number): void {
  directory(root); if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) return refuse();
  const state = readCalculatorLaunchState(join(root, "state"), request), reportPath = join(root, "runtime-report/calculator-report.json");
  let report: Record<string, unknown>;
  try { report = sanitizeCalculatorLaunchReport(json(reportPath), request); } catch { report = { mode: request.mode, status: "blocked", reasonCode: "runtime_report_unverified", wholeAppCompleted: false, legalEnabled: false }; exitCode = 10; }
  if (request.mode === "plan" && exitCode === 0 && (report.status !== "planned" || report.planFingerprint !== runnable(join(root, "state"), request).fingerprint)) return refuse();
  const capsule = join(root, "capsule"); make(capsule); make(join(capsule, "state")); make(join(capsule, "report"));
  for (const [name, value] of state) writeFileSync(join(capsule, "state", name), value, { mode: 0o600, flag: "wx" });
  put(join(capsule, "launch.json"), current); put(join(capsule, "report/calculator-report.json"), report);
  const completion: Completion = { version: 1, manifestDigest: digest(current), exitCode,
    stateDigests: Object.fromEntries([...state].map(([name, value]) => [name, createHash("sha256").update(value).digest("hex")])), reportDigest: digest(report) };
  put(join(capsule, "completion.json"), completion);
  writeFileSync(join(root, "report/calculator-report.json"), JSON.stringify(report) + "\n", { mode: 0o600 });
}
export function importCalculatorLaunchCapsule(capsule: string, barrier: string, destination: string, request: CalculatorLaunchRequest, prior: CalculatorLaunchManifest): void {
  directory(capsule); directory(barrier); directory(destination);
  if (request.mode !== "run" || prior.mode !== "plan" || prior.binding !== calculatorLaunchBinding(request) || readdirSync(destination).length ||
      readdirSync(capsule).sort().join(",") !== "completion.json,launch.json,report,state" || readdirSync(barrier).join(",") !== "launch.json") return refuse();
  manifest(json(join(capsule, "launch.json")), prior); manifest(json(join(barrier, "launch.json")), prior);
  directory(join(capsule, "state")); directory(join(capsule, "report")); if (readdirSync(join(capsule, "report")).join(",") !== "calculator-report.json") return refuse();
  const state = readCalculatorLaunchState(join(capsule, "state"), request), completion = exact(json(join(capsule, "completion.json")), ["version", "manifestDigest", "exitCode", "stateDigests", "reportDigest"]);
  const expected = Object.fromEntries([...state].map(([name, value]) => [name, createHash("sha256").update(value).digest("hex")]));
  const report = sanitizeCalculatorLaunchReport(json(join(capsule, "report/calculator-report.json")), { ...request, mode: "plan" });
  if (completion.version !== 1 || completion.manifestDigest !== digest(prior) || completion.exitCode !== 0 || !same(completion.stateDigests, expected) ||
      completion.reportDigest !== digest(report) || report.status !== "planned") return refuse();
  const plan = runnable(join(capsule, "state"), request); if (report.planFingerprint !== plan.fingerprint) return refuse();
  for (const [name, value] of state) writeFileSync(join(destination, name), value, { mode: 0o600, flag: "wx" });
  runnable(destination, request);
}

function context(root: string): Context {
  directory(root); const raw = exact(json(join(root, "context.json")), ["version", "request", "manifest", "restore"]);
  if (raw.version !== 1) return refuse(); const request = prepareCalculatorLaunchRequest(raw.request), current = record(raw.manifest);
  const expected = calculatorLaunchManifest(request, id(current.runId), hash(current.eventSha), hash(current.requestBlobSha)); manifest(current, expected);
  let restore: Restore | null = null;
  if (raw.restore !== null) { const old = exact(raw.restore, ["runId", "barrierId", "capsuleId", "manifest"]), m = record(old.manifest);
    const prior = calculatorLaunchManifest({ ...request, mode: "plan" }, id(old.runId), hash(m.eventSha), hash(m.requestBlobSha)); manifest(m, prior);
    restore = { runId: prior.runId, barrierId: id(old.barrierId), capsuleId: id(old.capsuleId), manifest: prior }; }
  return { version: 1, request, manifest: expected, restore };
}
function privatizeDownload(root: string, capsule: boolean): void {
  const top = lstatSync(root); if (!top.isDirectory() || top.isSymbolicLink()) return refuse();
  const names = readdirSync(root).sort(), expected = capsule ? ["completion.json", "launch.json", "report", "state"] : ["launch.json"];
  if (names.join(",") !== expected.join(",")) return refuse();
  const paths = [root];
  for (const name of names) {
    const path = join(root, name), stat = lstatSync(path);
    if (capsule && ["state", "report"].includes(name)) {
      if (!stat.isDirectory() || stat.isSymbolicLink()) return refuse(); paths.push(path);
      const files = readdirSync(path); if (files.length > (name === "state" ? 21 : 1) || (name === "report" && files[0] !== "calculator-report.json")) return refuse();
      for (const file of files) paths.push(join(path, file));
    } else paths.push(path);
  }
  for (const path of paths) { const stat = lstatSync(path); if (stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()) ||
      (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE || (path.endsWith(".lock") && stat.size !== 0)))) return refuse(); }
  for (const path of paths) chmodSync(path, lstatSync(path).isDirectory() ? 0o700 : 0o600);
}
/** Fixed CLI phases are invoked by the trusted workflow, never a model command. */
export async function runCalculatorLaunchState(args: string[], env: NodeJS.ProcessEnv = process.env, transport: typeof fetch = globalThis.fetch): Promise<void> {
  if (args.length !== 4 || !["prepare", "restore", "collect"].includes(args[0]) || !SHA.test(args[2]) || !/^node@sha256:[a-f0-9]{64}$/.test(args[3])) return refuse();
  const [phase, root, factorySha, image] = args;
  if (!isAbsolute(root) || resolve(root) !== root) return refuse();
  if (phase === "prepare") {
    make(root); for (const name of ["state", "runtime-report", "report", "barrier"]) make(join(root, name));
    put(join(root, "report/calculator-report.json"), { status: "blocked", reasonCode: "launch_not_executed", wholeAppCompleted: false, legalEnabled: false });
    const workspace = env.GITHUB_WORKSPACE; if (!workspace) return refuse();
    for (const path of [join(workspace, "request"), join(workspace, "request/.factory")]) { const stat = lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink()) return refuse(); }
    const requestPath = join(workspace, "request", CALCULATOR_LAUNCH_REQUEST), fd = openSync(requestPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); let raw: Buffer;
    try { const stat = fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1 || stat.size < 2 || stat.size > 24576) return refuse(); raw = readFileSync(fd); } finally { closeSync(fd); }
    const request = prepareCalculatorLaunchRequest(JSON.parse(raw.toString("utf8")), factorySha, image), owner = prepareCalculatorGoal(request.goal);
    if (env.HAS_CALCULATOR_TOKEN !== "true" || env[{ groq: "HAS_GROQ", gemini: "HAS_GEMINI", cloudflare: "HAS_CLOUDFLARE" }[owner.provider]] !== "true") return refuse();
    const current = calculatorLaunchManifest(request, Number(env.GITHUB_RUN_ID), hash(env.GITHUB_SHA), gitBlob(raw));
    const prior = await inspectCalculatorLaunchHistory(request, current, env, transport);
    put(join(root, "context.json"), { version: 1, request, manifest: current, restore: prior }); put(join(root, "goal.json"), request.goal); put(join(root, "config.json"), request.config);
    if (!env.GITHUB_OUTPUT) return refuse();
    appendFileSync(env.GITHUB_OUTPUT, "mode=" + request.mode + "\nprovider=" + owner.provider + "\ngoal_id=" + owner.id + "\nrestore=" + Boolean(prior) +
      "\nbarrier_name=" + barrierName(owner.id) + "\ncapsule_name=" + capsuleName(owner.id) + (prior ? "\nprior_run=" + prior.runId + "\nprior_barrier=" + prior.barrierId + "\nprior_capsule=" + prior.capsuleId : "") + "\n");
    return;
  }
  const saved = context(root); if (saved.request.factorySha !== factorySha || saved.request.config.sandboxImage !== image) return refuse();
  if (phase === "restore") {
    if (saved.restore) { privatizeDownload(join(root, "restored-capsule"), true); privatizeDownload(join(root, "restored-barrier"), false);
      importCalculatorLaunchCapsule(join(root, "restored-capsule"), join(root, "restored-barrier"), join(root, "state"), saved.request, saved.restore.manifest); }
    else if (saved.request.mode !== "plan" || readdirSync(join(root, "state")).length) return refuse();
    put(join(root, "barrier/launch.json"), saved.manifest); return;
  }
  const barrier = manifest(json(join(root, "barrier/launch.json")), saved.manifest);
  if (env.CALCULATOR_REMOTE_BARRIER_UPLOADED !== "true") return refuse();
  exportCalculatorLaunchCapsule(root, saved.request, barrier, Number(env.CALCULATOR_CLI_EXIT_CODE));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCalculatorLaunchState(process.argv.slice(2)).catch(() => { console.error(CALCULATOR_LAUNCH_ERROR); process.exitCode = 10; });
}
