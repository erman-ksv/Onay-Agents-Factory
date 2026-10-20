/** Private execution evidence, separate from source-free task/stage receipts.
 * A checkpoint records data, never permission to replay or resume a model/tool.
 * Imported artifacts still require a host-verified remote barrier and digest.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, renameSync, unlinkSync, writeFileSync, chmodSync,
} from "node:fs";
import { isAbsolute, join, parse, resolve } from "node:path";
import type { PreparedCalculatorChanges } from "../commander/calculatorChanges.js";
import type { CalculatorAssessment } from "../commander/calculatorTeam.js";
import { scanForSecrets } from "../github/secretScanner.js";
import { calculatorProposalDigest } from "./calculatorExecutionEvidence.js";

export const CALCULATOR_EXECUTION_CHECKPOINT_ERROR = "Private calculator execution checkpoint refused; preserve evidence and do not replay.";
const MAX_BYTES = 512 * 1024;
const MAX_SNAPSHOTS = 64;
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9_-]{0,119}$/;
const STAGE = /^[a-z][a-z0-9_]{0,79}$/;
const ROLES = ["security", "reviewer", "tester"] as const;

export type CalculatorExecutionCheckpointIdentity = Readonly<{
  repository: string; goalId: string; ownerFingerprint: string; planFingerprint: string;
  taskId: string; branch: string; baseSha: string; bootstrapSha: string; runtimeConfigDigest: string;
}>;
export type CalculatorExecutionModelState = Readonly<{
  attemptedRequests: number; totalRequestBytes: number; reservedRunTokens: number; elapsedMs: number;
}>;
export type CalculatorExecutionCheckpointPayload = Readonly<{
  attempt: 1 | 2; stage: string; status: "running" | "passed" | "blocked";
  proposal?: PreparedCalculatorChanges; assessments: readonly CalculatorAssessment[];
  modelState: CalculatorExecutionModelState; httpInFlight: boolean; publicationStarted: boolean;
}>;
type HistoryEntry = {
  sequence: number; payload: CalculatorExecutionCheckpointPayload;
  proposalDigest?: string; integritySha256: string;
};
type RecordData = HistoryEntry & {
  version: 1; identity: CalculatorExecutionCheckpointIdentity; sequence: number;
  history: readonly HistoryEntry[];
};
export type CalculatorExecutionCheckpointReference = Readonly<{ sha256: string; bytes: number; sequence: number }>;
export type CalculatorExecutionCheckpointMetadata = CalculatorExecutionCheckpointReference & Readonly<{
  identity: CalculatorExecutionCheckpointIdentity; attempt: 1 | 2; stage: string;
  status: CalculatorExecutionCheckpointPayload["status"]; proposalDigest?: string;
  completedRoles: readonly string[]; modelState: CalculatorExecutionModelState;
  httpInFlight: boolean; publicationStarted: boolean; chargeAccounting: "conservative-high-water";
}>;
export type CalculatorExecutionCheckpointStore = Readonly<{
  save(payload: CalculatorExecutionCheckpointPayload): CalculatorExecutionCheckpointReference;
  read(expectedDigest?: string): CalculatorExecutionCheckpointPayload | undefined;
  inspect(): CalculatorExecutionCheckpointMetadata | undefined;
  close(): void;
}>;

function refuse(): never { throw new Error(CALCULATOR_EXECUTION_CHECKPOINT_ERROR); }
function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function number(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) && !scanForSecrets(value).length;
}
function branch(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && value !== "HEAD" &&
    value.split("/").every(part => /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(part) &&
      !part.includes("..") && !part.endsWith(".") && !part.endsWith(".lock"));
}
function digest(raw: string | Buffer): string { return createHash("sha256").update(raw).digest("hex"); }
function clone<T>(value: T): T { return structuredClone(value); }
function same(left: unknown, right: unknown): boolean {
  function ordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(ordered);
    if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
    return value;
  }
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}

function validateIdentity(value: unknown): CalculatorExecutionCheckpointIdentity {
  if (!plain(value) || !exact(value, ["repository", "goalId", "ownerFingerprint", "planFingerprint", "taskId", "branch", "baseSha", "bootstrapSha", "runtimeConfigDigest"]) ||
      typeof value.repository !== "string" || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value.repository) ||
      typeof value.goalId !== "string" || !ID.test(value.goalId) || typeof value.taskId !== "string" || !ID.test(value.taskId) ||
      !branch(value.branch) || ![value.baseSha, value.bootstrapSha].every(item => typeof item === "string" && SHA.test(item)) ||
      ![value.ownerFingerprint, value.planFingerprint, value.runtimeConfigDigest].every(item => typeof item === "string" && DIGEST.test(item))) return refuse();
  // Normalize key order so equivalent host objects have the same identity digest.
  return Object.freeze({ repository: value.repository, goalId: value.goalId,
    ownerFingerprint: value.ownerFingerprint as string, planFingerprint: value.planFingerprint as string,
    taskId: value.taskId, branch: value.branch, baseSha: value.baseSha as string,
    bootstrapSha: value.bootstrapSha as string, runtimeConfigDigest: value.runtimeConfigDigest as string });
}
function validateProposal(value: unknown, identity: CalculatorExecutionCheckpointIdentity): PreparedCalculatorChanges {
  if (!plain(value) || !exact(value, ["repository", "baseRef", "baseSha", "summary", "files", "reviewEvidence", "gates"]) ||
      value.repository !== identity.repository || value.baseRef !== identity.branch || value.baseSha !== identity.baseSha ||
      !text(value.summary, 800) || !text(value.reviewEvidence, MAX_BYTES) ||
      !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 16 ||
      !plain(value.gates) || !exact(value.gates, ["secretScan", "policyReview", "independentReview", "tests", "publicationAuthorized"]) ||
      value.gates.secretScan !== "passed" || value.gates.policyReview !== "passed" || value.gates.independentReview !== "required" ||
      value.gates.tests !== "required" || value.gates.publicationAuthorized !== false) return refuse();
  const paths = new Set<string>();
  for (const file of value.files) {
    if (!plain(file) || !exact(file, ["path", "content", "message"]) || typeof file.path !== "string" || file.path.length > 200 ||
        !file.path.split("/").every(part => /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(part) && !part.includes("..")) ||
        paths.has(file.path) || !text(file.content, MAX_BYTES) || !text(file.message, 200)) return refuse();
    paths.add(file.path);
  }
  const evidence: unknown = JSON.parse(value.reviewEvidence);
  if (!plain(evidence) || !exact(evidence, ["repository", "baseSha", "changes", "unverified"]) ||
      evidence.repository !== identity.repository || evidence.baseSha !== identity.baseSha ||
      !Array.isArray(evidence.changes) || evidence.changes.length !== value.files.length ||
      !Array.isArray(evidence.unverified) || evidence.unverified.length > 16 || !evidence.unverified.every(item => text(item, 400))) return refuse();
  return clone(value) as PreparedCalculatorChanges;
}
function validateAssessment(value: unknown, role: string): CalculatorAssessment {
  if (!plain(value) || !exact(value, ["role", "ready", "summary", "findings", "unverifiedAreas", "testsExecuted", "overallTaskCompletionVerified", "publicationAuthorized"]) ||
      value.role !== role || typeof value.ready !== "boolean" || !text(value.summary, 600) ||
      value.testsExecuted !== false || value.overallTaskCompletionVerified !== false || value.publicationAuthorized !== false ||
      !Array.isArray(value.findings) || value.findings.length > 12 || !Array.isArray(value.unverifiedAreas) ||
      value.unverifiedAreas.length > 24 || !value.unverifiedAreas.every(item => text(item, 400))) return refuse();
  for (const finding of value.findings) {
    if (!plain(finding) || !exact(finding, ["severity", "message", "evidenceRefs", "evidenceStatus"]) ||
        !["blocker", "high", "medium", "low"].includes(finding.severity as string) || !text(finding.message, 400) ||
        !["supplied", "missing"].includes(finding.evidenceStatus as string) || !Array.isArray(finding.evidenceRefs) ||
        finding.evidenceRefs.length > 16 || !finding.evidenceRefs.every(item => text(item, 200))) return refuse();
  }
  return clone(value) as CalculatorAssessment;
}
function validatePayload(value: unknown, identity: CalculatorExecutionCheckpointIdentity): CalculatorExecutionCheckpointPayload {
  if (!plain(value) || !exact(value, ["attempt", "stage", "status", "assessments", "modelState", "httpInFlight", "publicationStarted",
      ...(Object.hasOwn(value, "proposal") ? ["proposal"] : [])]) ||
      (value.attempt !== 1 && value.attempt !== 2) || typeof value.stage !== "string" || !STAGE.test(value.stage) ||
      !["running", "passed", "blocked"].includes(value.status as string) || typeof value.httpInFlight !== "boolean" ||
      typeof value.publicationStarted !== "boolean" || !plain(value.modelState) ||
      !exact(value.modelState, ["attemptedRequests", "totalRequestBytes", "reservedRunTokens", "elapsedMs"]) ||
      !Object.values(value.modelState).every(number) || !Array.isArray(value.assessments) || value.assessments.length > 3 ||
      (value.httpInFlight && value.status === "passed")) return refuse();
  const proposal = Object.hasOwn(value, "proposal") ? validateProposal(value.proposal, identity) : undefined;
  if (!proposal && value.assessments.length) return refuse();
  const assessments = value.assessments.map((assessment, index) => validateAssessment(assessment, ROLES[index]!));
  return clone({ attempt: value.attempt, stage: value.stage, status: value.status,
    ...(proposal ? { proposal } : {}), assessments, modelState: value.modelState,
    httpInFlight: value.httpInFlight, publicationStarted: value.publicationStarted }) as CalculatorExecutionCheckpointPayload;
}
function validateTransition(previous: CalculatorExecutionCheckpointPayload, payload: CalculatorExecutionCheckpointPayload,
  repairUsed: boolean): boolean {
  if (payload.attempt < previous.attempt || payload.attempt > previous.attempt + 1 ||
      (previous.publicationStarted && !payload.publicationStarted) || (previous.proposal && !payload.proposal) ||
      ["attemptedRequests", "totalRequestBytes", "reservedRunTokens", "elapsedMs"].some(key =>
        payload.modelState[key as keyof CalculatorExecutionModelState] < previous.modelState[key as keyof CalculatorExecutionModelState])) return refuse();
  const repairCompleted = !!previous.proposal && !!payload.proposal && previous.attempt === 2 && payload.attempt === 2 &&
    previous.stage === "repair_2" && previous.status === "running" && payload.stage === "repair_2" &&
    payload.status === "passed" && payload.assessments.length === 0;
  if ((repairCompleted && repairUsed) ||
      (previous.proposal && !same(previous.proposal, payload.proposal) && !repairCompleted)) return refuse();
  if (payload.attempt !== previous.attempt && (payload.stage !== "repair_2" || payload.status !== "running" ||
      !previous.proposal || !same(previous.proposal, payload.proposal) || !same(previous.assessments, payload.assessments))) return refuse();
  if (!repairCompleted && (payload.assessments.length < previous.assessments.length ||
      previous.assessments.some((assessment, index) => !same(assessment, payload.assessments[index])))) return refuse();
  return repairCompleted;
}
function ensureDirectory(path: string, create: boolean): string {
  if (!isAbsolute(path)) return refuse();
  const directory = resolve(path), parts = directory.slice(parse(directory).root.length).split("/").filter(Boolean);
  if (!parts.length) return refuse();
  let current = parse(directory).root;
  for (let index = 0; index < parts.length; index++) {
    if ([".git", ".github", "node_modules"].includes(parts[index]!)) return refuse();
    current = join(current, parts[index]!);
    if (!existsSync(current)) {
      if (!create || index !== parts.length - 1) return refuse();
      mkdirSync(current, { mode: 0o700 });
    }
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return refuse();
  }
  const stat = lstatSync(directory);
  if (process.getuid && stat.uid !== process.getuid()) return refuse();
  if (create) chmodSync(directory, 0o700);
  if ((lstatSync(directory).mode & 0o777) !== 0o700) return refuse();
  return directory;
}

/** Latest private evidence for one task. Files are never suitable for public logs.
 * Unknown in-flight/HTTP/publication outcomes remain blocked by the host executor.
 * Provider settlement can lower actual usage. Capsules retain the conservative
 * token high-water mark instead of refunding a charge without durable proof.
 */
export function createCalculatorExecutionCheckpointStore(directoryInput: string,
  identityInput: CalculatorExecutionCheckpointIdentity): CalculatorExecutionCheckpointStore {
  let lockFd: number | undefined, lockPath: string | undefined, createdLockStat: { ino: number; dev: number } | undefined;
  try {
    const identity = validateIdentity(identityInput), identityDigest = digest(JSON.stringify(identity));
    const directory = ensureDirectory(directoryInput, true), directoryStat = lstatSync(directory);
    const path = join(directory, identity.taskId + ".execution.json");
    lockPath = path + ".lock";
    lockFd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const lockStat = fstatSync(lockFd);
    createdLockStat = lockStat;
    let closed = false, failed = false, lastSequence = 0, lastSha: string | undefined;
    let previous: CalculatorExecutionCheckpointPayload | undefined;
    let currentRecord: RecordData | undefined, repairUsed = false;
    function healthy(): void {
      if (closed || lockFd === undefined || !lockPath) return refuse();
      ensureDirectory(directory, false);
      const stat = lstatSync(directory), lock = lstatSync(lockPath);
      if (stat.ino !== directoryStat.ino || stat.dev !== directoryStat.dev || !lock.isFile() || lock.isSymbolicLink() ||
          lock.nlink !== 1 || lock.ino !== lockStat.ino || lock.dev !== lockStat.dev || (lock.mode & 0o777) !== 0o600) return refuse();
    }
    function load(expectedDigest?: string): { data: RecordData; reference: CalculatorExecutionCheckpointReference } | undefined {
      healthy();
      if (expectedDigest !== undefined && !DIGEST.test(expectedDigest)) return refuse();
      if (!existsSync(path)) {
        if (lastSequence || expectedDigest !== undefined) return refuse();
        return undefined;
      }
      const before = lstatSync(path);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > MAX_BYTES ||
          (before.mode & 0o777) !== 0o600 || (process.getuid && before.uid !== process.getuid())) return refuse();
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let raw: Buffer;
      try {
        const after = fstatSync(fd);
        if (after.ino !== before.ino || after.dev !== before.dev || !after.isFile() || after.nlink !== 1 || after.size !== before.size) return refuse();
        raw = readFileSync(fd);
      } finally { closeSync(fd); }
      if (raw.length > MAX_BYTES) return refuse();
      const sha256 = digest(raw);
      if ((expectedDigest !== undefined && sha256 !== expectedDigest) || (lastSha !== undefined && sha256 !== lastSha)) return refuse();
      const data: unknown = JSON.parse(raw.toString("utf8"));
      if (!plain(data) || !exact(data, ["version", "identity", "sequence", "payload", "integritySha256", "history",
          ...(Object.hasOwn(data, "proposalDigest") ? ["proposalDigest"] : [])]) || data.version !== 1 ||
          digest(JSON.stringify(validateIdentity(data.identity))) !== identityDigest ||
          !Number.isSafeInteger(data.sequence) || (data.sequence as number) < 1 || (data.sequence as number) < lastSequence ||
          typeof data.integritySha256 !== "string" || !DIGEST.test(data.integritySha256) || !Array.isArray(data.history) ||
          data.history.length >= MAX_SNAPSHOTS || data.sequence !== data.history.length + 1) return refuse();
      const history: HistoryEntry[] = []; let prior: CalculatorExecutionCheckpointPayload | undefined, used = false;
      for (const item of data.history) {
        if (!plain(item) || !exact(item, ["sequence", "payload", "integritySha256",
            ...(Object.hasOwn(item, "proposalDigest") ? ["proposalDigest"] : [])]) || item.sequence !== history.length + 1 ||
            typeof item.integritySha256 !== "string" || !DIGEST.test(item.integritySha256)) return refuse();
        const priorPayload = validatePayload(item.payload, identity);
        const priorProposalDigest = priorPayload.proposal ? calculatorProposalDigest(priorPayload.proposal) : undefined;
        if (item.proposalDigest !== priorProposalDigest) return refuse();
        const priorUnsigned = { version: 1, identity, sequence: item.sequence, payload: priorPayload,
          ...(priorProposalDigest ? { proposalDigest: priorProposalDigest } : {}), history: [...history] };
        if (digest(JSON.stringify(priorUnsigned)) !== item.integritySha256) return refuse();
        if (prior) used = validateTransition(prior, priorPayload, used) || used;
        history.push({ sequence: item.sequence as number, payload: priorPayload,
          ...(priorProposalDigest ? { proposalDigest: priorProposalDigest } : {}), integritySha256: item.integritySha256 });
        prior = priorPayload;
      }
      const payload = validatePayload(data.payload, identity), proposalDigest = payload.proposal ? calculatorProposalDigest(payload.proposal) : undefined;
      if (data.proposalDigest !== proposalDigest) return refuse();
      if (prior) used = validateTransition(prior, payload, used) || used;
      const unsigned = { version: 1, identity, sequence: data.sequence, payload, ...(proposalDigest ? { proposalDigest } : {}), history };
      if (digest(JSON.stringify(unsigned)) !== data.integritySha256) return refuse();
      lastSequence = data.sequence as number; lastSha = sha256; previous = payload;
      currentRecord = { ...unsigned, integritySha256: data.integritySha256 } as RecordData; repairUsed = used;
      return { data: currentRecord,
        reference: Object.freeze({ sha256, bytes: raw.length, sequence: lastSequence }) };
    }
    const initial = load();
    if (initial) previous = initial.data.payload;
    return Object.freeze({
      save(input: CalculatorExecutionCheckpointPayload): CalculatorExecutionCheckpointReference {
        try {
          if (failed) return refuse();
          load();
          if (lastSequence >= MAX_SNAPSHOTS) return refuse();
          const payload = validatePayload(input, identity);
          const storedPayload = clone({ ...payload, modelState: { ...payload.modelState,
            reservedRunTokens: Math.max(previous?.modelState.reservedRunTokens ?? 0, payload.modelState.reservedRunTokens) } });
          const replaced = previous ? validateTransition(previous, storedPayload, repairUsed) : false;
          const proposalDigest = storedPayload.proposal ? calculatorProposalDigest(storedPayload.proposal) : undefined;
          const history: readonly HistoryEntry[] = currentRecord ? [...currentRecord.history, {
            sequence: currentRecord.sequence, payload: clone(currentRecord.payload),
            ...(currentRecord.proposalDigest ? { proposalDigest: currentRecord.proposalDigest } : {}), integritySha256: currentRecord.integritySha256,
          }] : [];
          const unsigned = { version: 1 as const, identity, sequence: lastSequence + 1, payload: storedPayload,
            ...(proposalDigest ? { proposalDigest } : {}), history };
          const data: RecordData = { ...unsigned, integritySha256: digest(JSON.stringify(unsigned)) };
          const raw = Buffer.from(JSON.stringify(data) + "\n");
          if (raw.length > MAX_BYTES) return refuse();
          const temp = path + ".tmp." + randomUUID();
          let fd: number | undefined;
          try {
            healthy();
            fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
            writeFileSync(fd, raw); fsyncSync(fd); closeSync(fd); fd = undefined;
            renameSync(temp, path);
            const directoryFd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
            try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
          } catch {
            failed = true;
            return refuse();
          } finally {
            if (fd !== undefined) closeSync(fd);
            if (existsSync(temp)) unlinkSync(temp);
          }
          lastSequence = data.sequence; lastSha = digest(raw); previous = storedPayload; currentRecord = data;
          repairUsed = repairUsed || replaced;
          return Object.freeze({ sha256: lastSha, bytes: raw.length, sequence: lastSequence });
        } catch { return refuse(); }
      },
      read(expectedDigest?: string): CalculatorExecutionCheckpointPayload | undefined {
        try { const result = load(expectedDigest); return result ? clone(result.data.payload) : undefined; }
        catch { return refuse(); }
      },
      inspect(): CalculatorExecutionCheckpointMetadata | undefined {
        try {
          const result = load(); if (!result) return undefined;
          const { payload, proposalDigest } = result.data;
          return Object.freeze({ ...result.reference, identity: clone(identity), attempt: payload.attempt,
            stage: payload.stage, status: payload.status, ...(proposalDigest ? { proposalDigest } : {}),
            completedRoles: Object.freeze(payload.assessments.map(value => value.role)), modelState: Object.freeze({ ...payload.modelState }),
            httpInFlight: payload.httpInFlight, publicationStarted: payload.publicationStarted,
            chargeAccounting: "conservative-high-water" as const });
        } catch { return refuse(); }
      },
      close(): void {
        if (closed) return;
        closed = true;
        if (lockFd !== undefined) { closeSync(lockFd); lockFd = undefined; }
        if (lockPath && existsSync(lockPath)) {
          const current = lstatSync(lockPath);
          if (current.isFile() && !current.isSymbolicLink() && current.ino === lockStat.ino && current.dev === lockStat.dev) unlinkSync(lockPath);
        }
      },
    });
  } catch {
    if (lockFd !== undefined) { try { closeSync(lockFd); } catch { /* Preserve the original refusal. */ } }
    if (createdLockStat && lockPath && existsSync(lockPath)) {
      try {
        const current = lstatSync(lockPath);
        if (current.isFile() && !current.isSymbolicLink() && current.ino === createdLockStat.ino &&
            current.dev === createdLockStat.dev) unlinkSync(lockPath);
      } catch { /* Never remove a replacement writer's lock. */ }
    }
    return refuse();
  }
}
