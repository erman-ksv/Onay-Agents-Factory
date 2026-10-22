/** Host-only authenticated state for the completed first Calculator task.
 * Reading an archive never authorizes models, replay, publication or a refund. */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, writeFileSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { scanForSecrets } from "../github/secretScanner.js";
import { loadCalculatorSnapshot, calculatorSources, createCalculatorSnapshotReader, type CalculatorSnapshotReader } from "../github/calculatorSnapshot.js";
import { prepareCalculatorRoleChanges, validateCalculatorAssessment } from "../commander/calculatorTeam.js";
import type { PreparedCalculatorChanges } from "../commander/calculatorChanges.js";
import { createCalculatorPlan, calculatorPlanDigest, type CalculatorPlan } from "./calculatorPlan.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { prepareCalculatorLaunchRequest } from "./calculatorLaunchState.js";
import { parseCalculatorExecutionCheckpointBytes, type CalculatorExecutionCheckpointIdentity,
  type CalculatorExecutionCheckpointPayload } from "./calculatorExecutionCheckpoint.js";
import { calculatorProposalDigest, validateCalculatorProposalTests } from "./calculatorExecutionEvidence.js";
import { CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES, CALCULATOR_FINAL_TESTER_ALLOWANCE } from "./calculatorStep7FinalTester.js";
import type { CalculatorCheckRunner } from "./calculatorWorkspace.js";
import type { CalculatorExecutionTools } from "./calculatorExecution.js";
import { createCalculatorSandbox } from "./calculatorSandbox.js";

export const CALCULATOR_PUBLISHED_STATE_ERROR = "Published Calculator state refused; preserve evidence. No replay or budget reset.";
export const CALCULATOR_PUBLISHED_STATE_PIN = Object.freeze({
  runId: 39609923862, eventSha: "dd5bf9971cf3f59e9bf75e81621d5412d228984c", runtimeSha: "aec60c61152849150cd901df2d826afd37a33a25",
  artifactId: 12350008132, artifactDigest: "sha256:1fabef62cf75ac976d3844c4adede15e78a8fb38a95ac310372ff83a90947ae9",
  manifestSha256: "24e711c299bfd62ddf24418f6c92d878257c1d9e9ecc815aed45af711f7b30d4",
  goalId: "calculator-pilot-step7-v1", taskId: "calculator-pilot-step7-v1-34ee03-t01",
  planFingerprint: "1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2",
  proposalDigest: "a38dceea13bb4c1457c8c74e5aa254335125ab862fce432bd8ac0fcdacd7e9fb",
  candidateSha: "5c4bc71b3119a50d2ca7ce1dbdf12bcaa000ce75", fileCount: 52, totalBytes: 277133,
});
export type CalculatorPublishedStatePin = Readonly<{ [K in keyof typeof CALCULATOR_PUBLISHED_STATE_PIN]:
  typeof CALCULATOR_PUBLISHED_STATE_PIN[K] extends number ? number : string }>;
export type CalculatorPublishedState = Readonly<{
  repository: string; planFingerprint: string; taskId: string; candidateSha: string; manifestSha256: string;
  fileCount: number; totalBytes: number; completedRoles: readonly string[];
  historicalCharges: typeof CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES;
  completedTaskCharge: CalculatorExecutionCheckpointPayload["modelState"];
  resumeAuthorized: false; budgetResetAuthorized: false;
}>;
type File = { bytes: Buffer; stat: Stats; path: string };
type PrivateState = { files: Map<string, File>; plan: CalculatorPlan; proposal: PreparedCalculatorChanges;
  payload: CalculatorExecutionCheckpointPayload; launch: ReturnType<typeof prepareCalculatorLaunchRequest> };
const verified = new WeakMap<CalculatorPublishedState, PrivateState>();
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const MAX_FILE = 512 * 1024, MAX_TOTAL = 8 * 1024 * 1024;
class PublishedStateError extends Error {
  constructor(readonly code: string) { super(CALCULATOR_PUBLISHED_STATE_ERROR); }
}
function refuse(): never { throw Error(CALCULATOR_PUBLISHED_STATE_ERROR); }
function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function object(value: unknown): Record<string, unknown> { if (!plain(value)) return refuse(); return value; }
function canonical(value: unknown): string {
  function sort(v: unknown): unknown { return Array.isArray(v) ? v.map(sort) : plain(v) ?
    Object.fromEntries(Object.keys(v).sort().map(key => [key, sort(v[key])])) : v; }
  const encoded = JSON.stringify(sort(value)); if (encoded === undefined) return refuse(); return encoded;
}
function unchanged(path: string, stat: Stats): void {
  const next = lstatSync(path);
  if (next.dev !== stat.dev || next.ino !== stat.ino || next.mode !== stat.mode || next.uid !== stat.uid ||
      next.size !== stat.size || next.mtimeMs !== stat.mtimeMs || next.ctimeMs !== stat.ctimeMs || next.isSymbolicLink()) return refuse();
}
function directory(path: string): Stats {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || ![0o700, 0o755].includes(stat.mode & 0o777) ||
      (process.getuid && stat.uid !== process.getuid())) return refuse(); return stat;
}
function read(path: string): File {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_FILE ||
      ![0o600, 0o644].includes(stat.mode & 0o777) || (process.getuid && stat.uid !== process.getuid())) return refuse();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes: Buffer;
  try {
    const current = fstatSync(fd);
    if (current.dev !== stat.dev || current.ino !== stat.ino || current.size !== stat.size || current.nlink !== 1) return refuse();
    bytes = readFileSync(fd); unchanged(path, stat);
  } finally { closeSync(fd); }
  if (bytes.length !== stat.size || bytes.length > MAX_FILE || scanForSecrets(bytes.toString("utf8")).length) return refuse();
  return { path, stat, bytes };
}
function json(file: File): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)); }
function privateState(capability: CalculatorPublishedState): PrivateState {
  const state = verified.get(capability); if (!state) return refuse(); return state;
}
/** Authenticated host configuration only; source and mutable private buffers
 * remain inaccessible. The caller still needs independent execution authority. */
export function calculatorPublishedTaskLaunch(capability: CalculatorPublishedState): ReturnType<typeof prepareCalculatorLaunchRequest> {
  return prepareCalculatorLaunchRequest(structuredClone(privateState(capability).launch));
}

/** Host pins only. The CLI always uses the fixed reviewed pin, never argv/env
 * expectations. A valid digest establishes archive bytes, not live CI authority. */
export function inspectCalculatorPublishedTaskState(root: string,
  pin: CalculatorPublishedStatePin = CALCULATOR_PUBLISHED_STATE_PIN): CalculatorPublishedState {
  let phase = "archive_root";
  try {
    if (!isAbsolute(root) || resolve(root) !== root || root === parse(root).root || !/^[a-f0-9]{64}$/.test(pin.manifestSha256) ||
        !/^[a-f0-9]{40}$/.test(pin.candidateSha)) return refuse();
    let ancestor = parse(root).root;
    for (const part of root.slice(ancestor.length).split("/")) { ancestor = join(ancestor, part); if (lstatSync(ancestor).isSymbolicLink()) return refuse(); }
    const rootStat = directory(root);
    if (readdirSync(root).sort().join(",") !== "evidence,manifest.json") return refuse();
    phase = "manifest_authentication";
    const manifestFile = read(join(root, "manifest.json"));
    if (digest(manifestFile.bytes) !== pin.manifestSha256) return refuse();
    const manifest = object(json(manifestFile)), barrier = object(manifest.barrier);
    if (manifest.version !== 1 || manifest.kind !== "calculator-final-tester-forensic" || manifest.evidenceValidation !== "unvalidated" ||
        manifest.resumeAuthorized !== false || manifest.budgetResetAuthorized !== false || manifest.coderRegenerationAuthorized !== false ||
        barrier.runId !== pin.runId || barrier.eventSha !== pin.eventSha || barrier.runtimeSha !== pin.runtimeSha ||
        barrier.goalId !== pin.goalId || barrier.taskId !== pin.taskId || barrier.planFingerprint !== pin.planFingerprint ||
        barrier.proposalDigest !== pin.proposalDigest || manifest.barrierDigest !== digest(JSON.stringify(barrier)) ||
        canonical(barrier.historicalCharges) !== canonical(CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES) ||
        canonical(barrier.additionalAllowance) !== canonical(CALCULATOR_FINAL_TESTER_ALLOWANCE) ||
        canonical(manifest.historicalCharges) !== canonical(CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES) ||
        canonical(manifest.additionalAllowance) !== canonical(CALCULATOR_FINAL_TESTER_ALLOWANCE) || !Array.isArray(manifest.files) ||
        manifest.fileCount !== pin.fileCount || manifest.files.length !== pin.fileCount || manifest.totalBytes !== pin.totalBytes ||
        pin.fileCount < 1 || pin.fileCount > 256 || pin.totalBytes > MAX_TOTAL || manifest.treeSha256 !== digest(JSON.stringify(manifest.files))) return refuse();
    phase = "manifest_files";
    const files = new Map<string, File>(), dirs: { path: string; stat: Stats; names: string[] }[] = []; let total = 0;
    const expected = new Map<string, Record<string, unknown>>();
    for (const raw of manifest.files) {
      const entry = object(raw);
      if (typeof entry.path !== "string" || entry.path.split("/").length > 12 ||
          !entry.path.split("/").every(part => /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(part) && !part.includes("..")) ||
          !/\.(json|lock)$/.test(entry.path) || expected.has(entry.path) || typeof entry.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || Number(entry.bytes) < 0 || Number(entry.bytes) > MAX_FILE) return refuse();
      expected.set(entry.path, entry);
    }
    function walk(path: string, relative: string, depth: number): void {
      if (depth > 12 || dirs.length > 256) return refuse();
      const stat = directory(path), names = readdirSync(path).sort(); if (names.length > 256) return refuse(); dirs.push({ path, stat, names });
      for (const name of names) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name) || name.includes("..")) return refuse();
        const next = relative ? relative + "/" + name : name, target = join(path, name), s = lstatSync(target);
        if (s.isDirectory()) walk(target, next, depth + 1);
        else {
          const entry = expected.get(next); if (!entry || files.size >= 256) return refuse(); const file = read(target);
          if (file.bytes.length !== entry.bytes || digest(file.bytes) !== entry.sha256 ||
              (next.endsWith(".lock") && file.bytes.length)) return refuse();
          if (next.endsWith(".json") && scanForSecrets(JSON.stringify(json(file))).length) return refuse();
          files.set(next, file); total += file.bytes.length; if (total > MAX_TOTAL) return refuse();
        }
      }
    }
    walk(join(root, "evidence"), "", 0);
    if (files.size !== pin.fileCount || total !== pin.totalBytes) return refuse();
    const get = (path: string): File => { const file = files.get(path); if (!file) return refuse(); return file; };
    phase = "saved_plan";
    const document = object(json(get("state/" + pin.goalId + ".calculator-plan.json")));
    const plan = createCalculatorPlan(document.request, document.proposal), task = plan.tasks[0];
    if (document.version !== 1 || document.fingerprint !== plan.fingerprint || plan.fingerprint !== pin.planFingerprint ||
        plan.owner.id !== pin.goalId || task?.id !== pin.taskId || task.dependsOn.length || plan.status !== "planned") return refuse();
    phase = "execution_history";
    const candidates = [...files].filter(([path]) => path.startsWith("execution-private/") && path.endsWith("/" + pin.taskId + ".execution.json"));
    if (candidates.length !== 1) return refuse(); const raw = object(json(candidates[0]![1]));
    const identity = object(raw.identity) as unknown as CalculatorExecutionCheckpointIdentity;
    if (identity.repository !== plan.owner.repository || identity.goalId !== pin.goalId || identity.taskId !== pin.taskId ||
        identity.ownerFingerprint !== plan.owner.ownerFingerprint || identity.planFingerprint !== plan.fingerprint ||
        identity.branch !== plan.branch || identity.baseSha !== plan.owner.baseSha || identity.bootstrapSha !== plan.owner.baseSha) return refuse();
    const parsed = parseCalculatorExecutionCheckpointBytes(candidates[0]![1].bytes, identity), payload = parsed.data.payload;
    if (parsed.data.proposalDigest !== pin.proposalDigest || !payload.proposal || payload.stage !== "execution_complete" ||
        payload.status !== "passed" || payload.attempt !== 1 || payload.httpInFlight || !payload.publicationStarted ||
        payload.modelState.attemptedRequests !== 1 || payload.assessments.length !== 3) return refuse();
    phase = "saved_assessments";
    for (const [index, role] of (["security", "reviewer", "tester"] as const).entries()) {
      const saved = payload.assessments[index]!;
      if (saved.role !== role || !saved.ready || saved.findings.length || saved.testsExecuted !== false ||
          saved.publicationAuthorized !== false || saved.overallTaskCompletionVerified !== false) return refuse();
      const rawAssessment = { ready: saved.ready, summary: saved.summary, findings: [], unverifiedAreas: [] as string[] };
      const suffix = validateCalculatorAssessment(role, rawAssessment, ["changes@" + plan.owner.baseSha]).unverifiedAreas;
      const count = saved.unverifiedAreas.length - suffix.length;
      if (count < 0 || suffix.some((area, i) => saved.unverifiedAreas[count + i] !== area)) return refuse();
      const rebuilt = validateCalculatorAssessment(role, { ...rawAssessment, unverifiedAreas: saved.unverifiedAreas.slice(0, count) }, ["changes@" + plan.owner.baseSha]);
      if (canonical(rebuilt) !== canonical(saved)) return refuse();
    }
    phase = "published_receipt";
    const receipt = object(json(get("state/calc-" + pin.taskId + ".json"))), publication = object(receipt.publication);
    const requiredStages = ["load_current_source", "restore_proposal_1", "restore_security_1", "restore_reviewer_1", "tester_1", "host_tests_1", "publish_candidate", "verify_candidate_ci"];
    if (receipt.schemaVersion !== 1 || receipt.id !== "calc-" + task.id || receipt.fingerprint !== calculatorPlanDigest({ planFingerprint: plan.fingerprint, taskId: task.id }) ||
        !Array.isArray(receipt.stages) || receipt.stages.length > 32 || receipt.stages.some(s => !plain(s) || s.status !== "passed") ||
        new Set(receipt.stages.map(s => object(s).stage)).size !== receipt.stages.length ||
        requiredStages.some(name => !(receipt.stages as unknown[]).some(s => object(s).stage === name)) ||
        receipt.status !== "needs-review" || !["candidate_ci_pending_no_polling", "task_candidate_verified_not_whole_app"].includes(String(receipt.reasonCode)) ||
        publication.headSha !== pin.candidateSha || publication.branch !== plan.branch || !Number.isSafeInteger(publication.number) || Number(publication.number) < 1 ||
        publication.url !== "https://github.com/" + plan.owner.repository + "/pull/" + publication.number) return refuse();
    phase = "saved_plan_marker";
    const marker = object(json(get("state/calc-plan-" + pin.goalId + ".json")));
    if (marker.schemaVersion !== 1 || marker.id !== "calc-plan-" + pin.goalId || marker.fingerprint !== plan.owner.ownerFingerprint ||
        marker.status !== "needs-review" || marker.reasonCode !== "plan_saved_not_execution" || marker.publication !== undefined ||
        canonical(marker.stages) !== canonical(["save_plan", "digest_a_" + plan.fingerprint.slice(0, 32), "digest_b_" + plan.fingerprint.slice(32)]
          .map(stage => ({ stage, status: "passed" })))) return refuse();
    phase = "original_launch_context";
    let launch: ReturnType<typeof prepareCalculatorLaunchRequest> | undefined;
    for (const [path, file] of files) if (path.endsWith("context.json")) {
      let value = json(file);
      for (let depth = 0; depth < 8 && plain(value); depth++) {
        try {
          const candidate = prepareCalculatorLaunchRequest(value);
          if (candidate.goal.id === pin.goalId && createCalculatorPlan(candidate.goal, plan.proposal).fingerprint === plan.fingerprint) {
            if (launch && canonical(launch.config) !== canonical(candidate.config)) return refuse(); launch = candidate;
          }
        } catch (error) { if (error instanceof Error && error.message === CALCULATOR_PUBLISHED_STATE_ERROR) throw error; }
        value = value.request;
      }
    }
    if (!launch) return refuse();
    phase = "final_snapshot_integrity";
    for (const dir of dirs) { unchanged(dir.path, dir.stat); if (readdirSync(dir.path).sort().join(",") !== dir.names.join(",")) return refuse(); }
    unchanged(root, rootStat); unchanged(manifestFile.path, manifestFile.stat); for (const file of files.values()) unchanged(file.path, file.stat);
    const capability: CalculatorPublishedState = Object.freeze({ repository: plan.owner.repository, planFingerprint: plan.fingerprint,
      taskId: task.id, candidateSha: pin.candidateSha, manifestSha256: pin.manifestSha256, fileCount: files.size, totalBytes: total,
      completedRoles: Object.freeze(["security", "reviewer", "tester"]), historicalCharges: CALCULATOR_FINAL_TESTER_HISTORICAL_CHARGES,
      completedTaskCharge: Object.freeze({ ...payload.modelState }), resumeAuthorized: false, budgetResetAuthorized: false });
    verified.set(capability, { files, plan, proposal: payload.proposal, payload, launch }); return capability;
  } catch { throw new PublishedStateError(phase); }
}

/** Copies only authenticated current state into a new private directory. The
 * original archive/receipts remain untouched; callers retain it with all costs. */
export function restoreCalculatorPublishedTaskState(capability: CalculatorPublishedState, destination: string): void {
  const state = privateState(capability);
  try {
    if (!isAbsolute(destination) || resolve(destination) !== destination || destination === parse(destination).root) return refuse();
    const parent = dirname(destination); if ((directory(parent).mode & 0o777) !== 0o700) return refuse();
    let ancestor = parse(parent).root;
    for (const part of parent.slice(ancestor.length).split("/")) { ancestor = join(ancestor, part); if (lstatSync(ancestor).isSymbolicLink()) return refuse(); }
    // Exclusive directory claim is also the interruption barrier. Never replace
    // an existing empty destination and never erase partial restored evidence.
    mkdirSync(destination, { mode: 0o700 });
    const owned = directory(destination), parentStat = directory(parent);
    const current = () => { const next = directory(destination); if (next.dev !== owned.dev || next.ino !== owned.ino || (next.mode & 0o777) !== 0o700) return refuse(); unchanged(parent, parentStat); };
    for (const [path, file] of state.files) if (path.startsWith("state/")) {
      current();
      const name = path.slice(6); if (name.includes("/") || !/^[a-z0-9][a-z0-9_.-]*\.(json|lock)$/.test(name)) return refuse();
      const fd = openSync(join(destination, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, file.bytes); fsyncSync(fd); } finally { closeSync(fd); }
    }
    current();
    if (new CalculatorPlanStore(destination, state.launch.goal).inspect()?.fingerprint !== capability.planFingerprint) return refuse();
    for (const path of [destination, parent]) { const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
  } catch { return refuse(); }
}

/** Three archived approvals are revalidated above. This runner additionally
 * rebuilds the proposal from fresh bootstrap evidence, compares committed bytes,
 * runs actual current host tests and rechecks the branch. It invokes no model. */
export function createCalculatorPublishedDependencyRunner(capability: CalculatorPublishedState, reader: CalculatorSnapshotReader,
  checkProposal: CalculatorExecutionTools["checkProposal"]): CalculatorCheckRunner {
  const state = privateState(capability), task = state.plan.tasks[0]!;
  return async evidence => {
    try {
      if (evidence.task.id !== task.id || evidence.repository !== capability.repository || evidence.planFingerprint !== capability.planFingerprint ||
          evidence.candidateSha !== capability.candidateSha || evidence.currentSha !== capability.candidateSha || evidence.changedSinceCandidate.length ||
          await reader.getHead(state.plan.branch) !== capability.candidateSha) return undefined;
      const original = await loadCalculatorSnapshot({ repository: capability.repository, baseRef: state.plan.owner.baseSha,
        baseSha: state.plan.owner.baseSha, changePaths: task.paths }, reader);
      const review = object(JSON.parse(state.proposal.reviewEvidence)); if (!Array.isArray(review.changes)) return undefined;
      const reconstructed = prepareCalculatorRoleChanges(task.role, { summary: state.proposal.summary, changes: review.changes.map(raw => {
        const change = object(raw), file = state.proposal.files.find(f => f.path === change.path);
        if (!file || change.operation !== "create") return refuse(); return { operation: "create", path: file.path, content: change.content, message: file.message };
      }) }, original);
      // Source absence was proved at the immutable bootstrap SHA; the saved
      // proposal's publication ref is the project branch, not that SHA string.
      const rebuilt = Object.freeze({ ...reconstructed, baseRef: state.plan.branch });
      if (canonical(rebuilt) !== canonical(state.proposal)) return undefined;
      const current = await loadCalculatorSnapshot({ repository: capability.repository, baseRef: state.plan.branch,
        baseSha: capability.candidateSha, changePaths: task.paths }, reader), sources = calculatorSources(current);
      if (task.paths.some(path => !state.proposal.files.some(file => file.path === path && sources.get(path) === file.content))) return undefined;
      const changes = Object.freeze({ ...rebuilt, baseSha: capability.candidateSha });
      const proof = validateCalculatorProposalTests(await checkProposal({ task, changes, proposalDigest: calculatorProposalDigest(changes) }), task.id, changes);
      if (proof.status !== "passed" || !proof.testsExecuted || await reader.getHead(state.plan.branch) !== capability.candidateSha) return undefined;
      return { repository: capability.repository, planFingerprint: capability.planFingerprint, taskId: task.id, candidateSha: capability.candidateSha,
        currentSha: capability.candidateSha, securityReady: true, independentReviewReady: true, taskChecksPassed: true, testsExecuted: true };
    } catch { return undefined; }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let phase = "archive_import";
  try {
    const args = process.argv.slice(2);
    if (![1, 2, 4].includes(args.length) || (args.length > 1 && args[1] !== "--check-current") ||
        (args.length === 4 && args[2] !== "--restore")) refuse();
    const state = inspectCalculatorPublishedTaskState(args[0]!), saved = privateState(state); let currentHostTestsExecuted = false;
    if (args.length > 1) {
      phase = "current_dependency_checks";
      const reader = createCalculatorSnapshotReader(process.env);
      const checks = createCalculatorSandbox({ image: saved.launch.config.sandboxImage, baseSha: state.candidateSha,
        baseSources: new Map(saved.proposal.files.map(file => [file.path, file.content])) });
      const proof = await createCalculatorPublishedDependencyRunner(state, reader, checks.checkProposal)({ repository: state.repository,
        planFingerprint: state.planFingerprint, task: saved.plan.tasks[0]!, candidateSha: state.candidateSha,
        currentSha: state.candidateSha, changedSinceCandidate: [] });
      if (!proof?.testsExecuted) refuse(); currentHostTestsExecuted = true;
    }
    if (args.length === 4) { phase = "private_state_restoration"; restoreCalculatorPublishedTaskState(state, args[3]!); }
    console.log(JSON.stringify({ status: currentHostTestsExecuted ? "published-task-current-dependency-verified" : "published-task-state-verified",
      ...state, currentHostTestsExecuted, stateRestored: args.length === 4, modelsRun: false,
      githubWritesPerformed: false, privateStateWritesPerformed: args.length === 4 }));
  } catch (error) { console.error(JSON.stringify({ status: "blocked", reasonCode: error instanceof PublishedStateError ? error.code : phase,
    modelsRun: false, githubWritesPerformed: false })); process.exitCode = 10; }
}
