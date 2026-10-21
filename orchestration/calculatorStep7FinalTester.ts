/** One reviewed Tester call for the exact saved proposal and ready specialist prefix. */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, rmSync, writeFileSync, type Stats } from "node:fs";
import { basename, isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderCalculatorFinalTesterWorkflow } from "../config/calculatorFinalTesterWorkflow.js";
import { scanForSecrets } from "../github/secretScanner.js";
import { prepareCalculatorLaunchRequest, sanitizeCalculatorLaunchReport } from "./calculatorLaunchState.js";
import { createCalculatorPlan, type CalculatorPlan } from "./calculatorPlan.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { runCalculatorRuntime } from "./calculatorRuntime.js";
import { TeamTaskStore } from "./teamTaskStore.js";

export const CALCULATOR_FINAL_TESTER_ERROR = "Final Tester continuation refused; preserve all evidence. No automatic replay or budget reset.";
export const CALCULATOR_FINAL_TESTER_BRANCH = "feat/calculator-step7-regeneration-20261020";
export const CALCULATOR_FINAL_TESTER_PATH = ".github/workflows/calculator-step7-final-tester.yml";
export const CALCULATOR_FINAL_TESTER_REQUEST = ".factory/calculator-step7-final-tester-request.json";
export const CALCULATOR_FINAL_TESTER_SOURCE = Object.freeze({
  runId: 39576151385, eventSha: "beac1cd85f762f0073eaf5aa6ff3ff7c6d1c1d11", runtimeSha: "3553a823e88c1c2777208d151693c60c630b37ef",
  artifactId: 12334546968, artifactDigest: "sha256:cffa995e7563da50f4797bf05ac132916f211b2eec41183ebfb298ef6149b132",
  manifestSha256: "24c70e3b23c9ba3e66c8184ee4b79a7879cc0f379545ebb159e59640a6b08e48",
  capsulePath: "execution-private/519aab418f6ba4dde6607e599507cf4c77e60df574e2776b15790ca8e1eeb099/calculator-pilot-step7-v1-34ee03-t01.execution.json",
  capsuleSha256: "e7e15c6e5378ea245a55ac5103b80c04049b7e249c62d062139a3b9fb60abcdb",
  goalId: "calculator-pilot-step7-v1", taskId: "calculator-pilot-step7-v1-34ee03-t01",
  planFingerprint: "1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2",
  proposalDigest: "a38dceea13bb4c1457c8c74e5aa254335125ab862fce432bd8ac0fcdacd7e9fb",
});
export const CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES = Object.freeze({
  oldExecution: Object.freeze({ attemptedRequests: 2, totalRequestBytes: 48000, reservedRunTokens: 16000, elapsedMs: 120000 }),
  planning: Object.freeze({ reservedRunTokens: 13855 }),
  regeneration: Object.freeze({ attemptedRequests: 2, totalRequestBytes: 13304, reservedRunTokens: 6061, elapsedMs: 63809 }),
  priorContinuation: Object.freeze({ attemptedRequests: 2, totalRequestBytes: 16463, reservedRunTokens: 6437, elapsedMs: 65646 }),
});
export const CALCULATOR_FINAL_TESTER_ALLOWANCE = Object.freeze({ maxRequests: 1, maxRunBytes: 24000, maxRunTokens: 16000,
  maxOutputTokens: 1200, wallTimeMs: 120000, maxRepairs: 0 });
const REPOSITORY = "erman-ksv/Onay-Agents-Factory", SOURCE = CALCULATOR_FINAL_TESTER_SOURCE;
const IMAGE = "node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392";
const MAX_FILE = 512 * 1024, MAX_TOTAL = 8 * 1024 * 1024, MAX_FILES = 256;
type File = { path: string; relative: string; stat: Stats; bytes: Buffer };
type LaunchRequest = ReturnType<typeof prepareCalculatorLaunchRequest>;
export type CalculatorFinalTesterRequest = Readonly<{
  version: 1; approval: "ONE_FINAL_TESTER_OF_SAVED_PROPOSAL"; runtimeSha: string; priorRunId: number; priorArtifactId: number;
  priorArtifactDigest: string; priorManifestSha256: string; priorCapsulePath: string; priorCapsuleSha256: string; goalId: string; taskId: string; planFingerprint: string; proposalDigest: string;
  historicalCharges: typeof CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES; additionalAllowance: typeof CALCULATOR_FINAL_TESTER_ALLOWANCE;
}>;
type VerifiedPrior = Readonly<{ request: LaunchRequest; plan: CalculatorPlan; proposal: unknown; restoredAssessments: readonly unknown[];
  receiptSha256: string; capsuleSha256: string; capsulePath: string; manifestSha256: string }>;
type Dependencies = Readonly<{ transport?: typeof fetch; runtime?: typeof runCalculatorRuntime;
  /** Host test adapter only. The CLI never supplies it; owner/model JSON cannot. */
  verifyArtifact?: (root: string) => VerifiedPrior }>;
function refuse(): never { throw Error(CALCULATOR_FINAL_TESTER_ERROR); }
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const byteDigest = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");
const gitBlob = (value: Buffer | string): string => createHash("sha1").update("blob " + Buffer.byteLength(value) + "\0").update(value).digest("hex");
function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!plain(value) || Object.keys(value).length !== fields.length || !fields.every(key => Object.hasOwn(value, key))) return refuse(); return value;
}
function same(left: unknown, right: unknown): boolean { return digest(left) === digest(right); }
function hash(value: unknown): string { if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) return refuse(); return value; }
function integer(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return refuse(); return value; }
function hasSecrets(value: string): boolean {
  const decoded = value.replace(/\\u([a-f0-9]{4})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  return [value, decoded].some(text => scanForSecrets(text).length > 0 || /(?:gsk_|gh[pousr]_)[A-Za-z0-9_-]{20,}/.test(text));
}
function owned(stat: Stats): boolean { return !process.getuid || stat.uid === process.getuid(); }
function directory(path: string): Stats {
  if (!isAbsolute(path) || resolve(path) !== path || path === parse(path).root) return refuse();
  let current = parse(path).root;
  for (const name of path.slice(current.length).split("/").filter(Boolean)) { current = join(current, name); const stat = lstatSync(current); if (!stat.isDirectory() || stat.isSymbolicLink()) return refuse(); }
  const stat = lstatSync(path); if (!owned(stat) || ![0o700, 0o755].includes(stat.mode & 0o777)) return refuse(); return stat;
}
function unchanged(path: string, before: Stats, file: boolean): void {
  const after = lstatSync(path);
  if (after.ino !== before.ino || after.dev !== before.dev || after.mode !== before.mode || after.uid !== before.uid || after.isSymbolicLink() ||
      (file && (!after.isFile() || after.nlink !== 1 || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)) ||
      (!file && !after.isDirectory())) return refuse();
}
function read(path: string, relative = basename(path)): File {
  directory(resolve(path, "..")); const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !owned(stat) || stat.size > MAX_FILE || ![0o600, 0o644].includes(stat.mode & 0o777)) return refuse();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); let bytes: Buffer;
  try { const opened = fstatSync(fd); if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size !== stat.size || opened.nlink !== 1 || opened.mode !== stat.mode || opened.uid !== stat.uid) return refuse(); bytes = readFileSync(fd); }
  finally { closeSync(fd); }
  if (bytes.length !== stat.size) return refuse(); unchanged(path, stat, true);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); if (hasSecrets(text)) return refuse();
  let decoded: unknown; try { decoded = JSON.parse(text); } catch { /* Forensic bytes remain unvalidated. */ }
  if (decoded !== undefined && hasSecrets(JSON.stringify(decoded))) return refuse();
  if (relative.endsWith(".lock") && bytes.length) return refuse(); return { path, relative, stat, bytes };
}
function json(file: File): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)); }
function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); }
}
function write(path: string, bytes: Buffer): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function put(path: string, value: unknown): void { const bytes = Buffer.from(JSON.stringify(value) + "\n"); if (bytes.length > MAX_FILE || hasSecrets(bytes.toString("utf8"))) return refuse(); write(path, bytes); syncDirectory(resolve(path, "..")); }
export function createCalculatorFinalTesterRequest(runtimeSha: string): CalculatorFinalTesterRequest {
  return Object.freeze({ version: 1 as const, approval: "ONE_FINAL_TESTER_OF_SAVED_PROPOSAL" as const, runtimeSha: hash(runtimeSha),
    priorRunId: SOURCE.runId, priorArtifactId: SOURCE.artifactId, priorArtifactDigest: SOURCE.artifactDigest,
    priorManifestSha256: SOURCE.manifestSha256, priorCapsulePath: SOURCE.capsulePath, priorCapsuleSha256: SOURCE.capsuleSha256, goalId: SOURCE.goalId, taskId: SOURCE.taskId, planFingerprint: SOURCE.planFingerprint,
    proposalDigest: SOURCE.proposalDigest, historicalCharges: CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES, additionalAllowance: CALCULATOR_FINAL_TESTER_ALLOWANCE });
}
export function validateCalculatorFinalTesterRequest(value: unknown, runtimeSha: string): CalculatorFinalTesterRequest {
  const expected = createCalculatorFinalTesterRequest(runtimeSha);
  const raw = exact(value, Object.keys(expected)); if (Object.keys(expected).some(key => !same(raw[key], expected[key as keyof typeof expected]))) return refuse();
  return Object.freeze(expected);
}

function savedPrefix(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== 2) return refuse();
  value.forEach((item, index) => {
    const role = exact(item, ["role", "ready", "summary", "findings", "unverifiedAreas", "testsExecuted", "overallTaskCompletionVerified", "publicationAuthorized"]);
    if (role.role !== ["security", "reviewer"][index] || role.ready !== true || !Array.isArray(role.findings) || role.findings.length ||
        typeof role.summary !== "string" || !Array.isArray(role.unverifiedAreas) || role.testsExecuted !== false ||
        role.overallTaskCompletionVerified !== false || role.publicationAuthorized !== false) return refuse();
  });
  return value;
}

/** Reuse the already-proven fixed verifier without exposing private source in logs. */
function verifyArtifact(root: string): VerifiedPrior {
  directory(root);
  const stdout = execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/calculator-continuation-result-audit.mjs", import.meta.url)), root],
    { shell: false, env: {}, timeout: 15000, maxBuffer: 128 * 1024, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const audit: unknown = JSON.parse(stdout);
  if (!plain(audit) || audit.event !== "calculator_continuation_result_read_only_audit" || audit.runId !== SOURCE.runId || audit.artifactId !== SOURCE.artifactId ||
      audit.artifactDigest !== SOURCE.artifactDigest || audit.manifestSha256 !== SOURCE.manifestSha256 || audit.modelsRunByAudit !== false || audit.writesPerformedByAudit !== false ||
      !plain(audit.manifest) || !Array.isArray(audit.manifest.files) || !plain(audit.currentReceipt) || audit.currentReceipt.status !== "blocked" ||
      audit.currentReceipt.publicationPresent !== false || audit.currentPrefixReadyForTester !== true || !Array.isArray(audit.executionCapsules)) return refuse();
  const manifest = audit.manifest, entries = Array.isArray(manifest.files) ? manifest.files : refuse();
  function verified(relative: string): File {
    const entry = entries.find(item => plain(item) && item.path === relative);
    if (!plain(entry) || typeof entry.sha256 !== "string") return refuse(); const file = read(join(root, "evidence", relative), relative);
    if (file.bytes.length !== entry.bytes || byteDigest(file.bytes) !== entry.sha256) return refuse(); return file;
  }
  const capsuleMeta = audit.executionCapsules.find(item => plain(item) && plain(item.identity) && item.identity.taskId === SOURCE.taskId);
  if (!plain(capsuleMeta) || !plain(capsuleMeta.latest) || capsuleMeta.path !== SOURCE.capsulePath || capsuleMeta.sha256 !== SOURCE.capsuleSha256 ||
      capsuleMeta.latest.stage !== "tester_1" || capsuleMeta.latest.status !== "blocked" || capsuleMeta.latest.proposalDigest !== SOURCE.proposalDigest ||
      capsuleMeta.latest.rawProposalExists !== true || capsuleMeta.latest.httpInFlight !== false || capsuleMeta.latest.publicationStarted !== false ||
      !same(capsuleMeta.latest.completedRoles, ["security", "reviewer"]) ||
      !same(capsuleMeta.latest.modelState, CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES.priorContinuation) ||
      !Array.isArray(capsuleMeta.latest.assessmentMetadata) || capsuleMeta.latest.assessmentMetadata.length !== 2 ||
      capsuleMeta.latest.assessmentMetadata.some((role, index) => !plain(role) || role.role !== ["security", "reviewer"][index] || role.ready !== true ||
        !same(role.findingsBySeverity, { blocker: 0, high: 0, medium: 0, low: 0 }))) return refuse();
  const capsuleFile = verified(SOURCE.capsulePath);
  if (byteDigest(capsuleFile.bytes) !== SOURCE.capsuleSha256) return refuse();
  const capsule = json(capsuleFile);
  if (!plain(capsule) || !plain(capsule.payload) || !plain(capsule.payload.proposal) || capsule.proposalDigest !== SOURCE.proposalDigest) return refuse();
  const proposal = capsule.payload.proposal, restoredAssessments = savedPrefix(capsule.payload.assessments);
  const context = json(verified("prior-evidence/evidence/context.json")); if (!plain(context) || !plain(context.request)) return refuse();
  const request = prepareCalculatorLaunchRequest(context.request.request);
  const document = json(verified("state/" + SOURCE.goalId + ".calculator-plan.json"));
  if (!plain(document)) return refuse(); const plan = createCalculatorPlan(request.goal, document.proposal);
  if (plan.fingerprint !== SOURCE.planFingerprint || document.fingerprint !== plan.fingerprint || request.goal.id !== SOURCE.goalId ||
      proposal.baseSha !== request.goal.baseSha || proposal.baseRef !== plan.branch || plan.tasks[0]?.id !== SOURCE.taskId || plan.tasks[0].dependsOn.length) return refuse();
  const receiptFile = verified("state/calc-" + SOURCE.taskId + ".json");
  return { request, plan, proposal, restoredAssessments, receiptSha256: byteDigest(receiptFile.bytes), capsuleSha256: byteDigest(capsuleFile.bytes),
    capsulePath: capsuleMeta.path, manifestSha256: SOURCE.manifestSha256 };
}
function runEnvironment(env: NodeJS.ProcessEnv): { runId: number; eventSha: string } {
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== "refs/heads/" + CALCULATOR_FINAL_TESTER_BRANCH || env.GITHUB_EVENT_NAME !== "push" ||
      env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_RUN_NUMBER !== "1" || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "")) return refuse();
  return { runId: integer(Number(env.GITHUB_RUN_ID)), eventSha: hash(env.GITHUB_SHA) };
}
async function verifyHistory(env: NodeJS.ProcessEnv, runtimeSha: string, request: CalculatorFinalTesterRequest, transport: typeof fetch): Promise<void> {
  const current = runEnvironment(env); validateCalculatorFinalTesterRequest(request, runtimeSha);
  if (!env.GITHUB_TOKEN) return refuse(); let calls = 0; const started = performance.now();
  async function get(path: string): Promise<Record<string, unknown>> {
    if (++calls > 16 || performance.now() - started > 60000) return refuse();
    const response = await transport("https://api.github.com/repos/" + REPOSITORY + path, { method: "GET", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + env.GITHUB_TOKEN, "X-GitHub-Api-Version": "2022-11-28" } });
    if (!response.ok || !response.body) { void response.body?.cancel().catch(() => undefined); return refuse(); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 1048576) { await reader.cancel(); return refuse(); } chunks.push(part.value); } }
    finally { reader.releaseLock(); }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (!plain(value)) return refuse(); return value;
  }
  function scope(value: Record<string, unknown>, path: string) {
    if (value.path !== path || value.head_branch !== CALCULATOR_FINAL_TESTER_BRANCH || value.event !== "push" || value.run_attempt !== 1 || value.run_number !== 1 ||
        !plain(value.repository) || value.repository.full_name !== REPOSITORY || !plain(value.head_repository) || value.head_repository.full_name !== REPOSITORY) return refuse();
  }
  function listing(value: Record<string, unknown>, expected: number) {
    if (value.total_count !== 1 || !Array.isArray(value.workflow_runs) || value.workflow_runs.length !== 1 || !plain(value.workflow_runs[0]) || value.workflow_runs[0].id !== expected) return refuse();
  }
  const now = await get("/actions/runs/" + current.runId); scope(now, CALCULATOR_FINAL_TESTER_PATH);
  if (now.id !== current.runId || now.head_sha !== current.eventSha || now.status !== "in_progress" || now.conclusion !== null) return refuse();
  const workflowId = integer(now.workflow_id), workflow = await get("/actions/workflows/" + workflowId);
  if (workflow.id !== workflowId || workflow.path !== CALCULATOR_FINAL_TESTER_PATH || workflow.state !== "active") return refuse();
  listing(await get("/actions/workflows/" + workflowId + "/runs?per_page=100"), current.runId);
  const commit = await get("/git/commits/" + current.eventSha); if (commit.sha !== current.eventSha || !plain(commit.tree)) return refuse();
  const treeSha = hash(commit.tree.sha), tree = await get("/git/trees/" + treeSha + "?recursive=1");
  if (tree.sha !== treeSha || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 4096) return refuse();
  const entries = new Map<string, Record<string, unknown>>();
  for (const item of tree.tree) { if (!plain(item) || typeof item.path !== "string" || entries.has(item.path)) return refuse(); entries.set(item.path, item); }
  for (const path of [".factory", ".github", ".github/workflows"]) if (entries.get(path)?.type !== "tree" || entries.get(path)?.mode !== "040000") return refuse();
  const code = entries.get(CALCULATOR_FINAL_TESTER_PATH), card = entries.get(CALCULATOR_FINAL_TESTER_REQUEST);
  if (code?.type !== "blob" || code.mode !== "100644" || code.sha !== gitBlob(renderCalculatorFinalTesterWorkflow(runtimeSha, IMAGE)) || card?.type !== "blob" || card.mode !== "100644") return refuse();
  const blob = await get("/git/blobs/" + hash(card.sha)); if (blob.sha !== card.sha || blob.encoding !== "base64" || typeof blob.content !== "string") return refuse();
  const encoded = blob.content.replace(/\s/g, ""), raw = Buffer.from(encoded, "base64");
  if (raw.length > 32768 || raw.toString("base64") !== encoded || gitBlob(raw) !== blob.sha || !same(validateCalculatorFinalTesterRequest(JSON.parse(raw.toString("utf8")), runtimeSha), request)) return refuse();
  const old = await get("/actions/runs/" + SOURCE.runId); scope(old, ".github/workflows/calculator-step7-continuation.yml");
  if (old.id !== SOURCE.runId || old.head_sha !== SOURCE.eventSha || old.status !== "completed" || old.conclusion !== "failure" ||
      !Number.isFinite(Date.parse(String(old.updated_at))) || Date.now() - Date.parse(String(old.updated_at)) < 60000) return refuse();
  listing(await get("/actions/workflows/" + integer(old.workflow_id) + "/runs?per_page=100"), SOURCE.runId);
  const artifact = await get("/actions/artifacts/" + SOURCE.artifactId);
  if (artifact.id !== SOURCE.artifactId || artifact.name !== "calculator-step7-continuation-evidence-" + SOURCE.runId || artifact.expired !== false || artifact.digest !== SOURCE.artifactDigest ||
      typeof artifact.size_in_bytes !== "number" || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 1 || artifact.size_in_bytes > MAX_TOTAL ||
      !plain(artifact.workflow_run) || artifact.workflow_run.id !== SOURCE.runId || artifact.workflow_run.head_sha !== SOURCE.eventSha) return refuse();
  listing(await get("/actions/workflows/" + workflowId + "/runs?per_page=100"), current.runId);
}
export async function verifyCalculatorFinalTesterHistory(env: NodeJS.ProcessEnv, runtimeSha: string,
  request: CalculatorFinalTesterRequest, transport: typeof fetch = globalThis.fetch): Promise<void> {
  try { await verifyHistory(env, runtimeSha, request, transport); } catch { return refuse(); }
}
function barrier(request: CalculatorFinalTesterRequest, prior: VerifiedPrior, env: NodeJS.ProcessEnv) {
  if (prior.capsulePath !== SOURCE.capsulePath || prior.capsuleSha256 !== SOURCE.capsuleSha256 || prior.manifestSha256 !== SOURCE.manifestSha256) return refuse();
  return { version: 1, authorization: request.approval, ...runEnvironment(env), runtimeSha: request.runtimeSha, goalId: SOURCE.goalId, taskId: SOURCE.taskId,
    planFingerprint: SOURCE.planFingerprint, proposalDigest: SOURCE.proposalDigest, priorRunId: SOURCE.runId, priorArtifactId: SOURCE.artifactId,
    priorArtifactDigest: SOURCE.artifactDigest, priorManifestSha256: prior.manifestSha256, priorReceiptSha256: prior.receiptSha256,
    priorCapsuleSha256: prior.capsuleSha256, priorCapsulePath: prior.capsulePath, startAt: "tester_1", completedRoles: ["security", "reviewer"],
    restoredAssessmentsDigest: digest(savedPrefix(prior.restoredAssessments)),
    historicalCharges: CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES, additionalAllowance: CALCULATOR_FINAL_TESTER_ALLOWANCE,
    automaticReplay: false, budgetResetAuthorized: false, coderRegenerationAuthorized: false };
}
function context(root: string, runtimeSha: string, env: NodeJS.ProcessEnv, inspect: (root: string) => VerifiedPrior) {
  directory(root); const raw = exact(json(read(join(root, "context.json"))), ["version", "request", "barrier"]);
  if (raw.version !== 1) return refuse(); const request = validateCalculatorFinalTesterRequest(raw.request, runtimeSha), prior = inspect(join(root, "prior-evidence"));
  const expected = barrier(request, prior, env); if (!same(raw.barrier, expected) || !same(json(read(join(root, "barrier/final-tester.json"))), expected)) return refuse();
  return { request, prior, barrier: expected };
}

/** Fixed bounded artifact collection. Old files are only read and copied. */
function collect(root: string, checked: ReturnType<typeof context>) {
  const rootStat = directory(root), rootNames = readdirSync(root).sort(), destination = join(root, "final-tester-artifact");
  const marker = "calc-final-tester-" + SOURCE.goalId;
  const rootDirs = ["prior-evidence", "state", "execution-private", "barrier"];
  const rootFiles = ["context.json", "calculator-report.json", marker + ".json", marker + ".lock"];
  if (rootNames.some(name => !rootDirs.includes(name) && !rootFiles.includes(name))) return refuse();
  const files: File[] = [], dirs: { path: string; stat: Stats; names: string[] }[] = []; let total = 0;
  function walk(relative: string, depth: number) {
    if (depth > 12 || dirs.length >= MAX_FILES) return refuse(); const path = join(root, relative), stat = directory(path), names = readdirSync(path).sort();
    if (names.length > MAX_FILES) return refuse(); dirs.push({ path, stat, names });
    for (const name of names) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name) || name.includes("..") || hasSecrets(name)) return refuse();
      const next = join(relative, name); if (lstatSync(join(root, next)).isDirectory()) walk(next, depth + 1); else add(next); }
  }
  function add(relative: string) { if (files.length >= MAX_FILES || !/\.(?:json|lock)$/.test(relative)) return refuse(); const file = read(join(root, relative), relative); total += file.bytes.length; if (total > MAX_TOTAL) return refuse(); files.push(file); }
  for (const name of rootNames) { if (rootDirs.includes(name)) walk(name, 1); else add(name); }
  files.sort((left, right) => left.relative.localeCompare(right.relative));
  const entries = files.map(file => ({ path: file.relative, bytes: file.bytes.length, sha256: byteDigest(file.bytes), kind: file.relative.endsWith(".lock") ? "stale-lock" : "json" }));
  const manifest = { version: 1, kind: "calculator-final-tester-forensic", evidenceValidation: "unvalidated", barrier: checked.barrier,
    barrierDigest: digest(checked.barrier), files: entries, fileCount: files.length, totalBytes: total, treeSha256: digest(entries),
    historicalCharges: CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES, additionalAllowance: CALCULATOR_FINAL_TESTER_ALLOWANCE,
    resumeAuthorized: false, budgetResetAuthorized: false, coderRegenerationAuthorized: false };
  let staging: string | undefined, stat: Stats | undefined;
  try {
    staging = join(root, ".final-tester-artifact.tmp." + randomUUID()); mkdirSync(staging, { mode: 0o700 }); stat = directory(staging);
    const evidence = join(staging, "evidence"); mkdirSync(evidence, { mode: 0o700 });
    for (const dir of dirs) mkdirSync(join(evidence, dir.path.slice(root.length + 1)), { mode: 0o700 });
    for (const file of files) write(join(evidence, file.relative), file.bytes);
    put(join(staging, "manifest.json"), manifest); for (const dir of [...dirs].reverse()) syncDirectory(join(evidence, dir.path.slice(root.length + 1)));
    syncDirectory(evidence); syncDirectory(staging); unchanged(root, rootStat, false);
    for (const dir of dirs) { unchanged(dir.path, dir.stat, false); if (readdirSync(dir.path).sort().join(",") !== dir.names.join(",")) return refuse(); }
    for (const file of files) unchanged(file.path, file.stat, true);
    if (readdirSync(root).filter(name => name !== basename(staging!)).sort().join(",") !== rootNames.join(",")) return refuse();
    unchanged(staging, stat, false); renameSync(staging, destination); staging = undefined; syncDirectory(root);
    return Object.freeze({ status: "preserved", fileCount: files.length, totalBytes: total, manifestSha256: byteDigest(Buffer.from(JSON.stringify(manifest) + "\n")) });
  } finally { if (staging && stat) { try { unchanged(staging, stat, false); rmSync(staging, { recursive: true }); } catch { /* Keep private residue. */ } } }
}
async function run(args: string[], env: NodeJS.ProcessEnv, dependencies: Dependencies) {
  if (args.length !== 3 || !["prepare", "execute", "collect"].includes(args[0]!) || !isAbsolute(args[1]!) || resolve(args[1]!) !== args[1]) return refuse();
  const [phase, root, runtimeSha] = args as [string, string, string]; hash(runtimeSha); runEnvironment(env); directory(root);
  const inspect = dependencies.verifyArtifact ?? verifyArtifact, transport = dependencies.transport ?? globalThis.fetch;
  if (phase === "prepare") {
    if (readdirSync(root).join(",") !== "prior-evidence" || !env.GITHUB_WORKSPACE) return refuse();
    const request = validateCalculatorFinalTesterRequest(json(read(join(env.GITHUB_WORKSPACE, "request", CALCULATOR_FINAL_TESTER_REQUEST))), runtimeSha);
    await verifyCalculatorFinalTesterHistory(env, runtimeSha, request, transport);
    const prior = inspect(join(root, "prior-evidence")), currentBarrier = barrier(request, prior, env);
    mkdirSync(join(root, "barrier"), { mode: 0o700 }); put(join(root, "context.json"), { version: 1, request, barrier: currentBarrier }); put(join(root, "barrier/final-tester.json"), currentBarrier);
    return Object.freeze({ status: "ready-for-final-tester", taskId: SOURCE.taskId, proposalDigest: SOURCE.proposalDigest, barrierDigest: digest(currentBarrier), modelRequests: 0 });
  }
  if (env.CALCULATOR_FINAL_TESTER_BARRIER_UPLOADED !== "true") return refuse();
  const checked = context(root, runtimeSha, env, inspect);
  if (phase === "collect") return collect(root, checked);
  if (!env.FACTORY_HISTORY_TOKEN || env.AGENT_FACTORY_PROVIDER !== "groq" || env.GROQ_MODEL || env.AGENT_FACTORY_LEGAL_ENABLED !== "false") return refuse();
  await verifyCalculatorFinalTesterHistory({ ...env, GITHUB_TOKEN: env.FACTORY_HISTORY_TOKEN }, runtimeSha, checked.request, transport);
  const marker = new TeamTaskStore(root, { id: "calc-final-tester-" + SOURCE.goalId, fingerprint: digest(checked.barrier) });
  try {
    if (marker.claim() !== "claimed") return refuse(); marker.recordStage("verify_saved_proposal", "running");
    if (!same(context(root, runtimeSha, env, inspect).barrier, checked.barrier)) return refuse(); marker.recordStage("verify_saved_proposal", "passed");
    mkdirSync(join(root, "state"), { mode: 0o700 }); new CalculatorPlanStore(join(root, "state"), checked.prior.request.goal).initialize(checked.prior.plan.proposal);
    marker.recordStage("final_tester_and_gates", "running");
    const result = await (dependencies.runtime ?? runCalculatorRuntime)(checked.prior.request.goal, checked.prior.request.config, join(root, "state"), "run", env,
      { maxRequests: 1, maxRunBytes: 24000, maxRepairs: 0 }, { proposal: checked.prior.proposal, proposalDigest: SOURCE.proposalDigest, restoredAssessments: checked.prior.restoredAssessments });
    const report = sanitizeCalculatorLaunchReport(result, { ...checked.prior.request, mode: "run" });
    const status = report.status;
    if ((status !== "blocked" && status !== "needs-review" && status !== "candidate-verified") || report.taskId !== SOURCE.taskId || report.attempts !== 1 || report.repairs !== 0 ||
        !same(context(root, runtimeSha, env, inspect).barrier, checked.barrier)) return refuse();
    marker.recordStage("final_tester_and_gates", report.status === "blocked" ? "blocked" : "passed"); marker.finish(report.status === "blocked" ? "blocked" : "needs-review", "one_saved_proposal_final_tester_no_replay");
    put(join(root, "calculator-report.json"), report);
    return Object.freeze({ ...report, status, oldReceiptPreserved: true, historicalChargesErased: false, coderRegenerated: false });
  } catch {
    try { marker.finish("blocked", "final_tester_stopped_no_replay"); } catch { /* Preserve any terminal replay barrier. */ }
    try { put(join(root, "calculator-report.json"), { status: "blocked", reasonCode: "final_tester_stopped_no_replay", taskId: SOURCE.taskId, wholeAppCompleted: false, finalCalculatorCiVerified: false, legalEnabled: false }); } catch { /* Never replace earlier evidence. */ }
    return refuse();
  } finally { marker.close(); }
}
export async function runCalculatorStep7FinalTester(args: string[], env: NodeJS.ProcessEnv = process.env, dependencies: Dependencies = {}) {
  try { return await run(args, env, dependencies); } catch { return refuse(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runCalculatorStep7FinalTester(process.argv.slice(2)).then(result => { console.log(JSON.stringify(result)); if (result.status === "blocked") process.exitCode = 10; })
    .catch(() => { console.error(CALCULATOR_FINAL_TESTER_ERROR); process.exitCode = 10; });
