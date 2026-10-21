/** Private forensic capture of a returned but rejected model assessment.
 * Nothing in this file restores an assessment, claim, budget or permission. */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync,
  unlinkSync, writeFileSync, type Stats } from "node:fs";
import { isAbsolute, join, parse, resolve } from "node:path";
import { isCalculatorAssessmentValidationCode, type CalculatorAssessmentValidationCode } from "../commander/calculatorTeam.js";
import { scanForSecrets } from "../github/secretScanner.js";
import type { CalculatorExecutionCheckpointIdentity } from "./calculatorExecutionCheckpoint.js";

export const CALCULATOR_ASSESSMENT_REJECTION_ERROR = "Private rejected assessment capture refused; preserve evidence and do not replay.";
const MAX_RESULT_BYTES = 96000, MAX_FILE_BYTES = 100000;
const ID = /^[a-z0-9][a-z0-9_-]{0,119}$/, SHA = /^[a-f0-9]{40}$/, DIGEST = /^[a-f0-9]{64}$/;
const ROLES = ["security", "reviewer", "tester"] as const;
type AssessmentRole = typeof ROLES[number];
export type CalculatorAssessmentRejectionIdentity = CalculatorExecutionCheckpointIdentity & Readonly<{
  proposalDigest: string; role: AssessmentRole;
}>;
export type CalculatorAssessmentRejectionReference = Readonly<{ fileName: string; sha256: string; bytes: number; resultSha256: string }>;
function refuse(): never { throw new Error(CALCULATOR_ASSESSMENT_REJECTION_ERROR); }
function digest(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function secret(value: string): boolean {
  const decoded = value.replace(/\\+u([a-f0-9]{4})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  return [value, decoded].some(text => scanForSecrets(text).length > 0 || /(?:gsk_|gh[pousr]_|sk-)[A-Za-z0-9_-]{20,}/.test(text));
}
function canonical(value: unknown, maximum: number): string {
  const parts: string[] = [], parents = new Set<object>(); let bytes = 0, nodes = 0;
  function emit(part: string): void {
    bytes += Buffer.byteLength(part, "utf8"); if (bytes > maximum) return refuse(); parts.push(part);
  }
  function visit(item: unknown, depth: number): void {
    if (++nodes > 20000 || depth > 64) return refuse();
    if (item === null || typeof item === "boolean") { emit(JSON.stringify(item)); return; }
    if (typeof item === "number") { if (!Number.isFinite(item)) return refuse(); emit(JSON.stringify(item)); return; }
    if (typeof item === "string") { if (secret(item)) return refuse(); emit(JSON.stringify(item)); return; }
    if (!item || typeof item !== "object" || parents.has(item) || (!Array.isArray(item) && !plain(item))) return refuse();
    parents.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Object.getOwnPropertySymbols(item).length || Object.values(descriptors).some(property => !Object.hasOwn(property, "value"))) return refuse();
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) return refuse(); emit("[");
      for (let index = 0; index < item.length; index++) {
        if (!Object.hasOwn(descriptors, String(index))) return refuse();
        if (index) emit(","); visit(descriptors[String(index)]!.value, depth + 1);
      }
      emit("]");
    } else {
      emit("{"); const keys = Object.keys(item).sort();
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]!; if (secret(key)) return refuse();
        if (index) emit(","); emit(JSON.stringify(key)); emit(":"); visit(descriptors[key]!.value, depth + 1);
      }
      emit("}");
    }
    parents.delete(item);
  }
  visit(value, 0); const encoded = parts.join(""); if (secret(encoded)) return refuse(); return encoded;
}
function identity(value: unknown): CalculatorAssessmentRejectionIdentity {
  const keys = ["repository", "goalId", "ownerFingerprint", "planFingerprint", "taskId", "branch", "baseSha", "bootstrapSha", "runtimeConfigDigest", "proposalDigest", "role"];
  if (!plain(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) ||
      typeof value.repository !== "string" || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value.repository) ||
      typeof value.goalId !== "string" || !ID.test(value.goalId) || typeof value.taskId !== "string" || !ID.test(value.taskId) ||
      typeof value.role !== "string" || !ROLES.includes(value.role as AssessmentRole) ||
      typeof value.branch !== "string" || value.branch.length > 200 || value.branch === "HEAD" ||
      !value.branch.split("/").every(part => /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(part) && !part.includes("..") && !part.endsWith(".") && !part.endsWith(".lock")) ||
      ![value.baseSha, value.bootstrapSha].every(item => typeof item === "string" && SHA.test(item)) ||
      ![value.ownerFingerprint, value.planFingerprint, value.runtimeConfigDigest, value.proposalDigest].every(item => typeof item === "string" && DIGEST.test(item))) return refuse();
  canonical(value, 3000);
  return Object.freeze({ repository: value.repository, goalId: value.goalId, ownerFingerprint: value.ownerFingerprint as string,
    planFingerprint: value.planFingerprint as string, taskId: value.taskId, branch: value.branch, baseSha: value.baseSha as string,
    bootstrapSha: value.bootstrapSha as string, runtimeConfigDigest: value.runtimeConfigDigest as string,
    proposalDigest: value.proposalDigest as string, role: value.role as AssessmentRole });
}
function directory(path: string, create = false): Stats {
  if (!isAbsolute(path) || resolve(path) !== path || path === parse(path).root) return refuse();
  const parts = path.slice(parse(path).root.length).split("/").filter(Boolean); let current = parse(path).root;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!; if ([".git", ".github", "node_modules"].includes(part)) return refuse(); current = join(current, part);
    let stat: Stats;
    try { stat = lstatSync(current); }
    catch (error) {
      if (!create || index !== parts.length - 1 || !error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") return refuse();
      mkdirSync(current, { mode: 0o700 }); stat = lstatSync(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) return refuse();
  }
  const stat = lstatSync(path);
  if ((stat.mode & 0o777) !== 0o700 || (process.getuid && stat.uid !== process.getuid())) return refuse(); return stat;
}
function sameFile(path: string, expected: Stats): boolean {
  try { const actual = lstatSync(path); return actual.isFile() && !actual.isSymbolicLink() && actual.nlink === 1 &&
    actual.ino === expected.ino && actual.dev === expected.dev && actual.uid === expected.uid && (actual.mode & 0o777) === 0o600; }
  catch { return false; }
}
function ownedTemporary(path: string, expected: Stats): boolean {
  try { const actual = lstatSync(path); return actual.isFile() && !actual.isSymbolicLink() && (actual.nlink === 1 || actual.nlink === 2) &&
    actual.ino === expected.ino && actual.dev === expected.dev && actual.uid === expected.uid && (actual.mode & 0o777) === 0o600; }
  catch { return false; }
}

/** Write once, privately. The reference contains no model text or authority.
 * A failed write never overwrites another capture or an existing checkpoint. */
export function writeCalculatorAssessmentRejection(directoryInput: string, identityInput: CalculatorAssessmentRejectionIdentity,
  rejection: Readonly<{ result: unknown; validationCode: CalculatorAssessmentValidationCode }>): CalculatorAssessmentRejectionReference {
  let lockPath: string | undefined, lockFd: number | undefined, lockStat: Stats | undefined;
  let temporary: string | undefined, temporaryFd: number | undefined, temporaryStat: Stats | undefined;
  try {
    const binding = identity(identityInput), prefix = binding.taskId + "-" + binding.role + "-rejected";
    if (!ID.test(prefix) || !plain(rejection) || Object.keys(rejection).sort().join(",") !== "result,validationCode" ||
        !isCalculatorAssessmentValidationCode(rejection.validationCode)) return refuse();
    const encodedResult = canonical(rejection.result, MAX_RESULT_BYTES), resultSha256 = digest(encodedResult);
    const unsigned = { version: 1, kind: "calculator-assessment-rejection", evidenceValidation: "unvalidated", identity: binding,
      validationCode: rejection.validationCode, result: JSON.parse(encodedResult), resultSha256,
      assessmentAccepted: false, resumeAuthorized: false, publicationAuthorized: false };
    const raw = Buffer.from(canonical({ ...unsigned, integritySha256: digest(canonical(unsigned, MAX_FILE_BYTES)) }, MAX_FILE_BYTES - 1) + "\n");
    if (raw.length > MAX_FILE_BYTES) return refuse();
    const rootStat = directory(directoryInput, true), fileName = prefix + ".execution.json", path = join(directoryInput, fileName);
    lockPath = path + ".lock";
    lockFd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); lockStat = fstatSync(lockFd);
    function healthy(): void {
      const stat = directory(directoryInput);
      if (stat.ino !== rootStat.ino || stat.dev !== rootStat.dev || !lockPath || !lockStat || !sameFile(lockPath, lockStat)) return refuse();
    }
    healthy(); temporary = join(directoryInput, ".assessment-rejected-" + randomUUID() + ".tmp");
    temporaryFd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    temporaryStat = fstatSync(temporaryFd); writeFileSync(temporaryFd, raw); fsyncSync(temporaryFd); closeSync(temporaryFd); temporaryFd = undefined;
    healthy(); if (!sameFile(temporary, temporaryStat)) return refuse();
    // Hard-link creation is exclusive even if an unrelated writer ignores the
    // lock; the final regular file has one link after removing our staging name.
    linkSync(temporary, path); unlinkSync(temporary); temporary = undefined;
    const rootFd = openSync(directoryInput, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(rootFd); } finally { closeSync(rootFd); }
    return Object.freeze({ fileName, sha256: digest(raw), bytes: raw.length, resultSha256 });
  } catch { return refuse(); }
  finally {
    if (temporaryFd !== undefined) try { closeSync(temporaryFd); } catch { /* Keep fixed diagnostics. */ }
    if (temporary && temporaryStat && ownedTemporary(temporary, temporaryStat)) try { unlinkSync(temporary); } catch { /* Preserve private residue. */ }
    if (lockFd !== undefined) try { closeSync(lockFd); } catch { /* Keep fixed diagnostics. */ }
    if (lockPath && lockStat && sameFile(lockPath, lockStat)) try { unlinkSync(lockPath); } catch { /* Do not remove another writer's lock. */ }
  }
}
