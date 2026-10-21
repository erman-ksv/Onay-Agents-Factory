/** One explicit regeneration of the fixed lost proposal. Old evidence and its
 * unknown charge are sealed separately; this is never a resumed old receipt. */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync,
  mkdirSync, chmodSync, writeFileSync } from "node:fs";
import { isAbsolute, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { scanForSecrets } from "../github/secretScanner.js";
import { renderCalculatorRegenerationWorkflow } from "../config/calculatorRegenerationWorkflow.js";
import { prepareCalculatorLaunchRequest, sanitizeCalculatorLaunchReport } from "./calculatorLaunchState.js";
import { createCalculatorPlan, calculatorPlanDigest } from "./calculatorPlan.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { TeamTaskStore } from "./teamTaskStore.js";
import { runCalculatorRuntime } from "./calculatorRuntime.js";
import { exportCalculatorRegenerationArtifact } from "./calculatorRegenerationArtifact.js";

export const CALCULATOR_REGENERATION_ERROR = "Calculator regeneration refused; preserve every old and new receipt. No automatic replay or budget reset.";
export const CALCULATOR_REGENERATION_BRANCH = "feat/calculator-step7-regeneration-20261020";
export const CALCULATOR_REGENERATION_PATH = ".github/workflows/calculator-step7-regeneration.yml";
export const CALCULATOR_REGENERATION_REQUEST = ".factory/calculator-step7-regeneration-request.json";
export const CALCULATOR_REGENERATION_OLD_CHARGE = Object.freeze({ attemptedRequests: 2, totalRequestBytes: 48000, reservedRunTokens: 16000, elapsedMs: 120000 });
export const CALCULATOR_REGENERATION_ALLOWANCE = Object.freeze({ maxRequests: 4, maxRunBytes: 96000, maxRunTokens: 16000,
  maxOutputTokens: 1200, wallTimeMs: 120000, maxRepairs: 0 });
const REPOSITORY = "erman-ksv/Onay-Agents-Factory", OLD_BRANCH = "feat/onay-task-runner-20261019";
const OLD_PATH = ".github/workflows/calculator-step7-recovery.yml";
const OLD_RUN = 39448498604, PREVIOUS_RUN = 39446900969;
const OLD_EVENT = "666ae4a559396e57bcb8e713d29087967b5fb821", PREVIOUS_EVENT = "988bed450daf80e0e9602a0b8ddd3fb1f2771bd6";
const OLD_RUNTIME = "4b8f56ee80c1aecb9f25536ccf2b0c96ef2fa203";
const ORIGINAL_RUNTIME = "d733e078800505534cd7c39f15406822416e7f24";
const BASE = "2c1218f2b020962ad93adf68d902a847271a7e72";
const GOAL = "calculator-pilot-step7-v1", TASK = GOAL + "-34ee03-t01";
const PLAN = "1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2";
const STATE_ARTIFACT = 12276359076, BARRIER_ARTIFACT = 12275614858;
const ARTIFACTS = [[STATE_ARTIFACT, "2ed396c73a32f6104d2f6e689c60ff4403c43925d1cbebd913d236e196929824"],
  [BARRIER_ARTIFACT, "66cd09de2753e5c68e7dfccc877534914a368fa02b543e327cf4b925bb90cb64"]] as const;
const IMAGE = "node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392";
const ORIGINAL = { version: 1, mode: "plan", factorySha: ORIGINAL_RUNTIME, freeTierConfirmed: true,
  goal: { version: 1, id: GOAL, goal: "Create the complete agreed static calculator with independent tests, keyboard support and a responsive phone layout.",
    provider: "groq", baseRef: "feat/calculator-pilot-bootstrap", baseSha: BASE },
  config: { version: 1, sandboxImage: IMAGE, trustedWorkflows: [{ id: 390241255, path: ".github/workflows/calculator-task-ci.yml", blobSha: "45fae4a292a04e89a631ad7ff2469a3af7265e70" }] } };
const MAX_FILE = 512 * 1024, MAX_TOTAL = 8 * 1024 * 1024;
const PINNED_PRIOR_TREE = "cc1ae4a47665b01a568424b6a36a59232503c12d69050f2f4b2a28fbc382272b";
function refuse(): never { throw Error(CALCULATOR_REGENERATION_ERROR); }
function hash(value: unknown): string { if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) return refuse(); return value; }
function integer(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return refuse(); return value; }
function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plain(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) return refuse(); return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (plain(value)) return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  const encoded = JSON.stringify(value); if (encoded === undefined) return refuse(); return encoded;
}
function same(left: unknown, right: unknown): boolean { return canonical(left) === canonical(right); }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function byteDigest(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function gitBlob(value: Buffer | string): string { return createHash("sha1").update("blob " + Buffer.byteLength(value) + "\0").update(value).digest("hex"); }
function secrets(text: string): boolean {
  const decoded = text.replace(/\\u([a-f0-9]{4})/gi, (_all, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  return [text, decoded].some(value => scanForSecrets(value).length > 0 || /gsk_[A-Za-z0-9_-]{20,}/.test(value));
}

/** Produces a reviewable owner request; publishing it remains a host action. */
export function createCalculatorRegenerationRequest(runtimeSha: string) {
  return Object.freeze({ version: 1, approval: "ONE_REGENERATION_AFTER_LOST_PROPOSAL", runtimeSha: hash(runtimeSha), priorRunId: OLD_RUN,
    taskId: TASK, planFingerprint: PLAN, priorStateArtifactId: STATE_ARTIFACT, priorBarrierArtifactId: BARRIER_ARTIFACT,
    oldCharge: CALCULATOR_REGENERATION_OLD_CHARGE, planningCharge: Object.freeze({ reservedRunTokens: 13855 }),
    additionalAllowance: CALCULATOR_REGENERATION_ALLOWANCE, request: prepareCalculatorLaunchRequest(structuredClone(ORIGINAL), ORIGINAL_RUNTIME, IMAGE) });
}
export function validateCalculatorRegenerationRequest(value: unknown, runtimeSha: string) {
  const expected = createCalculatorRegenerationRequest(runtimeSha);
  exact(value, Object.keys(expected));
  if (!same(value, expected) || secrets(JSON.stringify(value))) return refuse(); return expected;
}
type RegenerationRequest = ReturnType<typeof createCalculatorRegenerationRequest>;

function privateDirectory(path: string, downloaded = false): void {
  if (!isAbsolute(path) || resolve(path) !== path || path === parse(path).root) return refuse();
  let current = parse(path).root;
  for (const part of path.slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part); const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return refuse();
  }
  const stat = lstatSync(path);
  if (process.getuid && stat.uid !== process.getuid()) return refuse();
  if (downloaded) chmodSync(path, 0o700);
  else if ((stat.mode & 0o777) !== 0o700) return refuse();
}
function bytes(path: string, downloaded = false, maximum = MAX_FILE): Buffer {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximum ||
      (process.getuid && before.uid !== process.getuid())) return refuse();
  if (downloaded) chmodSync(path, 0o600);
  else if ((before.mode & 0o777) !== 0o600) return refuse();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let data: Buffer;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.nlink !== 1 || stat.size !== before.size) return refuse();
    data = readFileSync(fd);
    const after = fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || after.nlink !== 1) return refuse();
  } finally { closeSync(fd); }
  if (data.length !== before.size || data.length > maximum) return refuse();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  if (secrets(text)) return refuse(); return data;
}
function json(path: string, downloaded = false): unknown { return JSON.parse(bytes(path, downloaded, 32768).toString("utf8")); }
function put(path: string, value: unknown): void {
  const text = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(text) > 32768 || secrets(text)) return refuse();
  writeFileSync(path, text, { mode: 0o600, flag: "wx" });
}
function tree(root: string, downloaded = false): ReadonlyMap<string, Buffer> {
  privateDirectory(root, downloaded); const result = new Map<string, Buffer>(); let total = 0;
  function walk(directory: string, relative: string, depth: number): void {
    if (depth > 8) return refuse(); privateDirectory(directory, downloaded);
    const names = readdirSync(directory).sort();
    for (const name of names) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(name) || name.includes("..")) return refuse();
      const path = join(directory, name), rel = relative ? relative + "/" + name : name, stat = lstatSync(path);
      if (stat.isDirectory() && !stat.isSymbolicLink()) walk(path, rel, depth + 1);
      else {
        if (!name.endsWith(".json") && !name.endsWith(".lock")) return refuse();
        const data = bytes(path, downloaded);
        if (name.endsWith(".lock") && data.length) return refuse();
        total += data.length;
        result.set(rel, data);
        if (result.size > 256 || total > MAX_TOTAL) return refuse();
      }
    }
  }
  walk(root, "", 0); return result;
}
function treeDigest(files: ReadonlyMap<string, Buffer>): string {
  return digest([...files].map(([path, data]) => ({ path, bytes: data.length, sha256: byteDigest(data) })));
}
function pinnedPriorManifest(): readonly Readonly<{ path: string; bytes: number; sha256: string }>[] {
  // This audited per-file manifest is part of the immutable reviewed runtime,
  // not downloaded with the evidence or supplied by a model/request.
  const raw = exact(JSON.parse(readFileSync(new URL("./fixtures/calculatorStep7PriorManifest.json", import.meta.url), "utf8")),
    ["version", "sourceRunId", "artifactId", "artifactDigest", "auditRunId", "files", "treeDigest"]);
  if (raw.version !== 1 || raw.sourceRunId !== OLD_RUN || raw.artifactId !== STATE_ARTIFACT ||
      raw.artifactDigest !== "sha256:" + ARTIFACTS[0][1] || raw.auditRunId !== 39511243248 ||
      raw.treeDigest !== PINNED_PRIOR_TREE || !Array.isArray(raw.files) || raw.files.length !== 25 || digest(raw.files) !== PINNED_PRIOR_TREE) return refuse();
  return raw.files.map(item => {
    const file = exact(item, ["path", "bytes", "sha256"]);
    if (typeof file.path !== "string" || !Number.isSafeInteger(file.bytes) || (file.bytes as number) < 0 ||
        typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) return refuse();
    return { path: file.path, bytes: file.bytes as number, sha256: file.sha256 };
  });
}
function objectFile(files: ReadonlyMap<string, Buffer>, path: string): Record<string, unknown> {
  const data = files.get(path); if (!data || data.length > 32768) return refuse();
  const raw = JSON.parse(data.toString("utf8")); if (!plain(raw)) return refuse(); return raw;
}
/** Validate the exact failed execution. No old store constructor, claim or
 * receipt content write is used, including for a failed validation. */
function validatePrior(root: string, request: RegenerationRequest, downloaded = false) {
  validateCalculatorRegenerationRequest(request, request.runtimeSha);
  const state = tree(join(root, "prior-state"), downloaded), barrierFiles = tree(join(root, "prior-barrier"), downloaded);
  const manifest = pinnedPriorManifest();
  if (state.size !== manifest.length || manifest.some(file => {
    const data = state.get(file.path); return !data || data.length !== file.bytes || byteDigest(data) !== file.sha256;
  }) || treeDigest(state) !== PINNED_PRIOR_TREE || barrierFiles.size !== 1 ||
      !barrierFiles.get("recovery.json")?.equals(state.get("barrier/recovery.json")!)) return refuse();
  const context = objectFile(state, "context.json"), barrier = objectFile(state, "barrier/recovery.json");
  if (context.version !== 1 || context.runtimeSha !== OLD_RUNTIME || context.eventSha !== OLD_EVENT || context.runId !== String(OLD_RUN) ||
      context.correction !== true || !same(context.request, request.request) || !same(barrier, objectFile(barrierFiles, "recovery.json")) ||
      barrier.runtimeSha !== OLD_RUNTIME || barrier.eventSha !== OLD_EVENT || barrier.recoveryRunId !== String(OLD_RUN) ||
      barrier.goalId !== GOAL || barrier.priorRecoveryRunId !== PREVIOUS_RUN || barrier.authorization !== "ONE_JSON_REQUEST_CORRECTION" ||
      barrier.automaticReplay !== false) return refuse();
  const document = objectFile(state, "state/" + GOAL + ".calculator-plan.json");
  if (document.version !== 1 || !same(document.request, request.request.goal) || document.fingerprint !== PLAN) return refuse();
  const plan = createCalculatorPlan(request.request.goal, document.proposal), first = plan.tasks[0];
  if (plan.status !== "planned" || plan.fingerprint !== PLAN || !first || first.id !== TASK || first.role !== "coder" || first.dependsOn.length ||
      [...first.paths].sort().join(",") !== "src/calculator.mjs,test/calculator.test.mjs" || plan.owner.baseSha !== BASE) return refuse();
  const receiptPath = "state/calc-" + TASK + ".json", receipt = objectFile(state, receiptPath);
  const stages = ["load_current_source", "generate_1", "security_1", "reviewer_1"].map((stage, index) => ({ stage, status: index === 3 ? "blocked" : "passed" }));
  if (receipt.id !== "calc-" + TASK || receipt.fingerprint !== calculatorPlanDigest({ planFingerprint: PLAN, taskId: TASK }) ||
      receipt.status !== "blocked" || receipt.reasonCode !== "execution_failed_no_replay" || receipt.publication !== undefined || !same(receipt.stages, stages)) return refuse();
  const allowedState = new Set([GOAL + ".calculator-plan.json", "calc-plan-" + GOAL + ".json", "calc-planning-" + GOAL + ".json",
    "calc-json-correction-" + GOAL + ".json", "calc-" + TASK + ".json"]);
  if ([...state.keys()].filter(path => path.startsWith("state/")).some(path => !allowedState.has(path.slice(6)))) return refuse();
  const report = objectFile(state, "calculator-report.json");
  if (report.taskId !== TASK || report.status !== "blocked" || report.reasonCode !== "execution_failed_no_replay" || report.attempts !== 1 || report.repairs !== 0 ||
      report.proposalTestsExecuted !== false || report.candidateTestsExecuted !== false || report.wholeAppCompleted !== false || report.legalEnabled !== false || report.publication !== undefined) return refuse();
  const planning = objectFile(state, "planning-accounting.json");
  if (!plain(planning.contextBudget) || planning.contextBudget.reservedRunTokens !== 1855 ||
      !plain(planning.carriedPriorCharge) || planning.carriedPriorCharge.reservedRunTokens !== 12000 ||
      !plain(planning.aggregatePlanningCharge) || planning.aggregatePlanningCharge.reservedRunTokens !== 13855) return refuse();
  return Object.freeze({ plan, proposal: document.proposal, treeDigest: treeDigest(state), receiptDigest: byteDigest(state.get(receiptPath)!),
    barrierDigest: treeDigest(barrierFiles) });
}
export function validateCalculatorRegenerationPrior(root: string, request: RegenerationRequest, downloaded = false) {
  try { return validatePrior(root, request, downloaded); } catch { return refuse(); }
}

function runEnvironment(env: NodeJS.ProcessEnv): { runId: number; eventSha: string } {
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== "refs/heads/" + CALCULATOR_REGENERATION_BRANCH ||
      env.GITHUB_EVENT_NAME !== "push" || env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_RUN_NUMBER !== "1" || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "")) return refuse();
  return { runId: integer(Number(env.GITHUB_RUN_ID)), eventSha: hash(env.GITHUB_SHA) };
}
/** Complete bounded history and exact current workflow/request readback. */
async function verifyHistory(env: NodeJS.ProcessEnv, runtimeSha: string,
  request: RegenerationRequest, transport: typeof fetch = globalThis.fetch): Promise<void> {
  const current = runEnvironment(env); validateCalculatorRegenerationRequest(request, runtimeSha);
  if (!env.GITHUB_TOKEN) return refuse(); let calls = 0; const started = performance.now();
  async function get(path: string): Promise<Record<string, unknown>> {
    if (++calls > 16 || performance.now() - started > 60000) return refuse();
    const response = await transport("https://api.github.com/repos/" + REPOSITORY + path, { method: "GET", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + env.GITHUB_TOKEN, "X-GitHub-Api-Version": "2022-11-28" } });
    if (!response.ok || !response.body) { void response.body?.cancel().catch(() => undefined); return refuse(); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > 1048576) { await reader.cancel(); return refuse(); } chunks.push(part.value); } } finally { reader.releaseLock(); }
    const raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (!plain(raw)) return refuse(); return raw;
  }
  function scope(run: Record<string, unknown>, branch: string, path: string, number: number) {
    if (run.head_branch !== branch || run.path !== path || run.event !== "push" || run.run_attempt !== 1 || run.run_number !== number ||
        !plain(run.repository) || run.repository.full_name !== REPOSITORY || !plain(run.head_repository) || run.head_repository.full_name !== REPOSITORY) return refuse();
  }
  function listing(data: Record<string, unknown>, expectedIds: readonly number[]): void {
    if (data.total_count !== expectedIds.length || !Array.isArray(data.workflow_runs) || data.workflow_runs.length !== expectedIds.length ||
        !same(data.workflow_runs.map(item => plain(item) ? integer(item.id) : refuse()).sort((a, b) => a - b), [...expectedIds].sort((a, b) => a - b))) return refuse();
  }
  const now = await get("/actions/runs/" + current.runId); scope(now, CALCULATOR_REGENERATION_BRANCH, CALCULATOR_REGENERATION_PATH, 1);
  if (now.id !== current.runId || now.head_sha !== current.eventSha || now.status !== "in_progress" || now.conclusion !== null) return refuse();
  const workflowId = integer(now.workflow_id), workflow = await get("/actions/workflows/" + workflowId);
  if (workflow.id !== workflowId || workflow.path !== CALCULATOR_REGENERATION_PATH || workflow.state !== "active") return refuse();
  listing(await get("/actions/workflows/" + workflowId + "/runs?per_page=100"), [current.runId]);
  const commit = await get("/git/commits/" + current.eventSha);
  if (commit.sha !== current.eventSha || !plain(commit.tree)) return refuse();
  const treeSha = hash(commit.tree.sha), data = await get("/git/trees/" + treeSha + "?recursive=1");
  if (data.sha !== treeSha || data.truncated !== false || !Array.isArray(data.tree) || data.tree.length > 4096) return refuse();
  const entries = new Map<string, Record<string, unknown>>();
  for (const entry of data.tree) { if (!plain(entry) || typeof entry.path !== "string" || entries.has(entry.path)) return refuse(); entries.set(entry.path, entry); }
  for (const path of [".github", ".github/workflows", ".factory"]) if (entries.get(path)?.mode !== "040000" || entries.get(path)?.type !== "tree") return refuse();
  const code = entries.get(CALCULATOR_REGENERATION_PATH), card = entries.get(CALCULATOR_REGENERATION_REQUEST);
  if (code?.mode !== "100644" || code.type !== "blob" || code.sha !== gitBlob(renderCalculatorRegenerationWorkflow(runtimeSha, IMAGE)) ||
      card?.mode !== "100644" || card.type !== "blob") return refuse();
  const blob = await get("/git/blobs/" + hash(card.sha));
  if (blob.sha !== card.sha || blob.encoding !== "base64" || typeof blob.content !== "string") return refuse();
  const encoded = blob.content.replace(/\s/g, ""), raw = Buffer.from(encoded, "base64");
  if (raw.length > 32768 || raw.toString("base64") !== encoded || gitBlob(raw) !== blob.sha ||
      !same(validateCalculatorRegenerationRequest(JSON.parse(raw.toString("utf8")), runtimeSha), request)) return refuse();
  const old = await get("/actions/runs/" + OLD_RUN); scope(old, OLD_BRANCH, OLD_PATH, 2);
  if (old.id !== OLD_RUN || old.head_sha !== OLD_EVENT || old.status !== "completed" || old.conclusion !== "failure" ||
      !Number.isFinite(Date.parse(String(old.updated_at))) || Date.now() - Date.parse(String(old.updated_at)) < 60000) return refuse();
  const oldWorkflow = integer(old.workflow_id);
  listing(await get("/actions/workflows/" + oldWorkflow + "/runs?per_page=100"), [PREVIOUS_RUN, OLD_RUN]);
  const previous = await get("/actions/runs/" + PREVIOUS_RUN); scope(previous, OLD_BRANCH, OLD_PATH, 1);
  if (previous.id !== PREVIOUS_RUN || previous.workflow_id !== oldWorkflow || previous.head_sha !== PREVIOUS_EVENT || previous.status !== "completed" || previous.conclusion !== "failure") return refuse();
  const artifacts = await get("/actions/runs/" + OLD_RUN + "/artifacts?per_page=100");
  if (artifacts.total_count !== 2 || !Array.isArray(artifacts.artifacts) || artifacts.artifacts.length !== 2) return refuse();
  for (const [id, checksum] of ARTIFACTS) {
    const artifact = artifacts.artifacts.find(item => plain(item) && item.id === id);
    if (!plain(artifact) || artifact.expired !== false || artifact.digest !== "sha256:" + checksum || typeof artifact.size_in_bytes !== "number" ||
        !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 1 || artifact.size_in_bytes > MAX_TOTAL ||
        !plain(artifact.workflow_run) || artifact.workflow_run.id !== OLD_RUN || artifact.workflow_run.head_sha !== OLD_EVENT) return refuse();
  }
  listing(await get("/actions/workflows/" + workflowId + "/runs?per_page=100"), [current.runId]);
}
export async function verifyCalculatorRegenerationHistory(env: NodeJS.ProcessEnv, runtimeSha: string,
  request: RegenerationRequest, transport: typeof fetch = globalThis.fetch): Promise<void> {
  try { await verifyHistory(env, runtimeSha, request, transport); } catch { return refuse(); }
}

function regenerationBarrier(request: RegenerationRequest, prior: ReturnType<typeof validateCalculatorRegenerationPrior>, env: NodeJS.ProcessEnv) {
  const current = runEnvironment(env);
  return { version: 1, authorization: request.approval, goalId: GOAL, taskId: TASK, planFingerprint: PLAN, runtimeSha: request.runtimeSha,
    runId: current.runId, eventSha: current.eventSha, priorRunId: OLD_RUN, priorStateArtifactId: STATE_ARTIFACT, priorBarrierArtifactId: BARRIER_ARTIFACT,
    priorArtifactDigests: Object.fromEntries(ARTIFACTS.map(([id, value]) => [String(id), "sha256:" + value])),
    priorTreeDigest: prior.treeDigest, priorReceiptDigest: prior.receiptDigest, priorBarrierDigest: prior.barrierDigest,
    bootstrapSha: BASE, expectedCurrentSha: BASE, oldCharge: request.oldCharge, planningCharge: request.planningCharge,
    additionalAllowance: request.additionalAllowance, aggregateExecutionCeilings: { maxRequests: 6, maxRunBytes: 144000, maxRunTokens: 32000, maxWallTimeMs: 240000 },
    automaticReplay: false, budgetResetAuthorized: false };
}
function existingContext(root: string, runtimeSha: string, env: NodeJS.ProcessEnv) {
  privateDirectory(root);
  const context = exact(json(join(root, "context.json")), ["version", "request", "barrier"]);
  if (context.version !== 1) return refuse();
  const request = validateCalculatorRegenerationRequest(context.request, runtimeSha), prior = validateCalculatorRegenerationPrior(root, request);
  const barrier = regenerationBarrier(request, prior, env);
  if (!same(context.barrier, barrier) || !same(json(join(root, "barrier/regeneration.json")), barrier)) return refuse();
  return { request, prior, barrier };
}
type Dependencies = Readonly<{ transport?: typeof fetch; runtime?: typeof runCalculatorRuntime; exportArtifact?: typeof exportCalculatorRegenerationArtifact }>;
/** Trusted dependency adapters exist for isolated host tests; the CLI supplies
 * none. Models, request files and environment variables cannot replace them. */
async function runRegeneration(args: string[], env: NodeJS.ProcessEnv, dependencies: Dependencies) {
  if (args.length !== 3 || !["prepare", "execute", "collect"].includes(args[0]!) || !isAbsolute(args[1]!) || resolve(args[1]!) !== args[1]) return refuse();
  const [phase, root, runtimeSha] = args as [string, string, string]; hash(runtimeSha); runEnvironment(env);
  const transport = dependencies.transport ?? globalThis.fetch;
  if (phase === "prepare") {
    privateDirectory(root, true);
    if (readdirSync(root).sort().join(",") !== "prior-barrier,prior-state") return refuse();
    const request = validateCalculatorRegenerationRequest(json(join(env.GITHUB_WORKSPACE!, "request", CALCULATOR_REGENERATION_REQUEST), true), runtimeSha);
    await verifyCalculatorRegenerationHistory(env, runtimeSha, request, transport);
    const prior = validateCalculatorRegenerationPrior(root, request, true), barrier = regenerationBarrier(request, prior, env);
    mkdirSync(join(root, "barrier"), { mode: 0o700 });
    put(join(root, "context.json"), { version: 1, request, barrier }); put(join(root, "barrier/regeneration.json"), barrier);
    return Object.freeze({ status: "ready-for-one-regeneration", taskId: TASK, barrierDigest: digest(barrier), modelRequests: 0 });
  }
  if (env.CALCULATOR_REGENERATION_BARRIER_UPLOADED !== "true") return refuse();
  const { request, prior, barrier } = existingContext(root, runtimeSha, env);
  if (phase === "collect") return (dependencies.exportArtifact ?? exportCalculatorRegenerationArtifact)(root,
    { goalId: GOAL, taskId: TASK, planFingerprint: PLAN, runtimeSha, runId: barrier.runId, eventSha: barrier.eventSha, barrierDigest: digest(barrier) }, env);
  if (env.AGENT_FACTORY_PROVIDER !== "groq" || env.GROQ_MODEL || env.AGENT_FACTORY_LEGAL_ENABLED !== "false" || !env.FACTORY_HISTORY_TOKEN) return refuse();
  await verifyCalculatorRegenerationHistory({ ...env, GITHUB_TOKEN: env.FACTORY_HISTORY_TOKEN }, runtimeSha, request, transport);
  // A new marker authorizes exactly this linked lineage. The old task receipt is
  // never copied into active state, deleted, relabelled, or granted new success.
  const marker = new TeamTaskStore(root, { id: "calc-regeneration-" + GOAL, fingerprint: digest(barrier) });
  try {
    if (marker.claim() !== "claimed") return refuse();
    marker.recordStage("verify_prior_evidence", "running");
    if (!same(existingContext(root, runtimeSha, env).barrier, barrier)) return refuse();
    marker.recordStage("verify_prior_evidence", "passed");
    mkdirSync(join(root, "state"), { mode: 0o700 });
    const plan = new CalculatorPlanStore(join(root, "state"), request.request.goal).initialize(prior.proposal);
    if (plan.fingerprint !== PLAN || plan.tasks[0]?.id !== TASK || plan.tasks[0].dependsOn.length) return refuse();
    marker.recordStage("one_regeneration", "running");
    const result = await (dependencies.runtime ?? runCalculatorRuntime)(request.request.goal, request.request.config, join(root, "state"), "run", env,
      { maxRequests: 4, maxRunBytes: 96000, maxRepairs: 0 });
    const report = sanitizeCalculatorLaunchReport(result, { ...request.request, mode: "run" });
    if (report.taskId !== TASK || report.attempts !== 1 || report.repairs !== 0 || !same(existingContext(root, runtimeSha, env).barrier, barrier)) return refuse();
    marker.recordStage("one_regeneration", report.status === "blocked" ? "blocked" : "passed");
    marker.finish(report.status === "blocked" ? "blocked" : "needs-review", "one_regeneration_attempted_no_replay");
    put(join(root, "calculator-report.json"), report);
    return Object.freeze({ ...report, priorReceiptPreserved: true, priorChargeErased: false });
  } catch {
    try { marker.finish("blocked", "regeneration_stopped_no_replay"); } catch { /* Preserve any terminal barrier. */ }
    try { put(join(root, "calculator-report.json"), { status: "blocked", reasonCode: "regeneration_stopped_no_replay", taskId: TASK,
      wholeAppCompleted: false, finalCalculatorCiVerified: false, legalEnabled: false }); } catch { /* Never overwrite earlier evidence. */ }
    throw Error(CALCULATOR_REGENERATION_ERROR);
  } finally { marker.close(); }
}
export async function runCalculatorStep7Regeneration(args: string[], env: NodeJS.ProcessEnv = process.env, dependencies: Dependencies = {}) {
  try { return await runRegeneration(args, env, dependencies); } catch { return refuse(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCalculatorStep7Regeneration(process.argv.slice(2)).then(result => {
    console.log(JSON.stringify(result)); if ("status" in result && result.status === "blocked") process.exitCode = 10;
  }).catch(() => { console.error(CALCULATOR_REGENERATION_ERROR); process.exitCode = 10; });
}
