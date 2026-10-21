/** Separate host-only forensic export for one reviewed regeneration attempt. */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { basename, isAbsolute, join, parse, resolve } from "node:path";
import { scanForSecrets } from "../github/secretScanner.js";

export const CALCULATOR_REGENERATION_ARTIFACT_ERROR = "Regeneration artifact refused; preserve all evidence. No replay or budget reset is authorized.";
const REPOSITORY = "erman-ksv/Onay-Agents-Factory";
const BRANCH = "feat/calculator-step7-regeneration-20261020";
const ROOT_DIRECTORIES = ["prior-state", "prior-barrier", "state", "execution-private", "barrier"] as const;
const MAX_FILE_BYTES = 512 * 1024, MAX_TOTAL_BYTES = 8 * 1024 * 1024, MAX_FILES = 256, MAX_DEPTH = 8;
export type CalculatorRegenerationArtifactIdentity = Readonly<{
  goalId: string; taskId: string; planFingerprint: string; runtimeSha: string;
  runId: number; eventSha: string; barrierDigest: string;
}>;
export type CalculatorRegenerationArtifactResult = Readonly<{
  status: "preserved"; fileCount: number; totalBytes: number; manifestSha256: string;
}>;
type FileSnapshot = { path: string; relative: string; stat: Stats; bytes: Buffer };
type DirectorySnapshot = { path: string; stat: Stats; names: readonly string[] };
function refuse(): never { throw new Error(CALCULATOR_REGENERATION_ARTIFACT_ERROR); }
function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function digest(value: unknown): string { return sha256(JSON.stringify(value)); }
function hasSecrets(value: string): boolean {
  const unescaped = value.replace(/\\u([a-f0-9]{4})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  return [value, unescaped].some(text => scanForSecrets(text).length > 0 || /(?:gsk_|gh[pousr]_)[A-Za-z0-9_-]{20,}/.test(text));
}
function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plain(value) || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) return refuse(); return value;
}
function hash(value: unknown, length: 40 | 64): string {
  if (typeof value !== "string" || !(length === 40 ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/).test(value)) return refuse(); return value;
}
function identity(value: unknown): CalculatorRegenerationArtifactIdentity {
  const raw = exact(value, ["goalId", "taskId", "planFingerprint", "runtimeSha", "runId", "eventSha", "barrierDigest"]);
  if (typeof raw.goalId !== "string" || !/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(raw.goalId) ||
      typeof raw.taskId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,119}$/.test(raw.taskId) ||
      typeof raw.runId !== "number" || !Number.isSafeInteger(raw.runId) || raw.runId < 1) return refuse();
  const result = { goalId: raw.goalId, taskId: raw.taskId, planFingerprint: hash(raw.planFingerprint, 64),
    runtimeSha: hash(raw.runtimeSha, 40), runId: raw.runId, eventSha: hash(raw.eventSha, 40), barrierDigest: hash(raw.barrierDigest, 64) };
  if (hasSecrets(JSON.stringify(result))) return refuse(); return Object.freeze(result);
}
function optionalStat(path: string): Stats | undefined {
  try { return lstatSync(path); }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined; return refuse(); }
}
function owned(stat: Stats): boolean { return !process.getuid || stat.uid === process.getuid(); }
function directory(path: string): Stats {
  if (!isAbsolute(path) || resolve(path) !== path || path === parse(path).root) return refuse();
  let current = parse(path).root;
  for (const part of path.slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part); const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return refuse();
  }
  const stat = lstatSync(path);
  if (!owned(stat) || (stat.mode & 0o777) !== 0o700) return refuse(); return stat;
}
function unchanged(path: string, before: Stats, file: boolean): void {
  const after = lstatSync(path);
  if (after.ino !== before.ino || after.dev !== before.dev || after.mode !== before.mode || after.uid !== before.uid || after.isSymbolicLink() ||
      (file && (!after.isFile() || after.nlink !== 1 || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)) ||
      (!file && !after.isDirectory())) return refuse();
}
function read(path: string, relative: string): FileSnapshot {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || !owned(before) ||
      (before.mode & 0o777) !== 0o600 || before.size > MAX_FILE_BYTES) return refuse();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); let bytes: Buffer;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.size !== before.size ||
        stat.mode !== before.mode || stat.uid !== before.uid || stat.nlink !== 1) return refuse();
    bytes = readFileSync(fd); const after = fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || after.nlink !== 1) return refuse();
  } finally { closeSync(fd); }
  if (bytes.length !== before.size || bytes.length > MAX_FILE_BYTES || (relative.endsWith(".lock") && bytes.length !== 0)) return refuse();
  unchanged(path, before, true);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); if (hasSecrets(text)) return refuse();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { /* Damaged JSON stays explicitly unvalidated forensic evidence. */ }
  if (parsed !== undefined && hasSecrets(JSON.stringify(parsed))) return refuse();
  return { path, relative, stat: before, bytes };
}
function json(file: FileSnapshot): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)); }
function write(path: string, bytes: Buffer): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** The caller separately verifies remote history and approval. This exporter
 * independently binds the exact local barrier to this run and preserves old
 * bytes without opening receipt stores, creating claims or changing budgets. */
export function exportCalculatorRegenerationArtifact(root: string, identityInput: CalculatorRegenerationArtifactIdentity,
  env: NodeJS.ProcessEnv = process.env): CalculatorRegenerationArtifactResult {
  let lockFd: number | undefined, lockPath: string | undefined, lockStat: Stats | undefined;
  let staging: string | undefined, stagingStat: Stats | undefined;
  try {
    const binding = identity(identityInput), rootStat = directory(root);
    if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== "refs/heads/" + BRANCH || env.GITHUB_EVENT_NAME !== "push" ||
        env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_RUN_ID !== String(binding.runId) || env.GITHUB_SHA !== binding.eventSha ||
        env.CALCULATOR_REGENERATION_BARRIER_UPLOADED !== "true") return refuse();
    const rootNames = readdirSync(root).sort(), destination = join(root, "regeneration-artifact");
    const marker = "calc-regeneration-" + binding.goalId;
    const rootFiles = new Set(["context.json", "calculator-report.json", marker + ".json", marker + ".lock"]);
    if (optionalStat(destination) || rootNames.some(name => !ROOT_DIRECTORIES.includes(name as typeof ROOT_DIRECTORIES[number]) &&
        !rootFiles.has(name) && name !== ".regeneration-artifact.lock")) return refuse();
    const directories: DirectorySnapshot[] = [], files: FileSnapshot[] = []; let totalBytes = 0;
    function addFile(relative: string): void {
      if (files.length >= MAX_FILES || relative.split("/").length > MAX_DEPTH || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(basename(relative)) ||
          basename(relative).includes("..") || !/\.(?:json|lock)$/.test(relative)) return refuse();
      const path = join(root, relative), size = lstatSync(path).size;
      if (size > MAX_TOTAL_BYTES - totalBytes) return refuse();
      const file = read(path, relative); files.push(file); totalBytes += file.bytes.length;
    }
    function walk(relative: string, depth: number): void {
      if (depth > MAX_DEPTH || directories.length >= MAX_FILES || hasSecrets(relative)) return refuse();
      const path = join(root, relative), stat = directory(path), names = readdirSync(path).sort();
      if (names.length > MAX_FILES) return refuse(); directories.push({ path, stat, names });
      for (const name of names) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name) || name.includes("..")) return refuse();
        const child = join(relative, name), childStat = lstatSync(join(root, child));
        if (childStat.isDirectory()) walk(child, depth + 1); else addFile(child);
      }
    }
    for (const name of rootNames) {
      if (ROOT_DIRECTORIES.includes(name as typeof ROOT_DIRECTORIES[number])) walk(name, 1);
      else if (rootFiles.has(name)) addFile(name);
    }
    files.sort((left, right) => left.relative.localeCompare(right.relative));
    const barrier = files.find(file => file.relative === "barrier/regeneration.json"), contextFile = files.find(file => file.relative === "context.json");
    if (!barrier || !contextFile) return refuse();
    const parsedBarrier = json(barrier);
    if (!plain(parsedBarrier) || parsedBarrier.version !== 1 || parsedBarrier.authorization !== "ONE_REGENERATION_AFTER_LOST_PROPOSAL" ||
        parsedBarrier.automaticReplay !== false || parsedBarrier.budgetResetAuthorized !== false || digest(parsedBarrier) !== binding.barrierDigest ||
        ["goalId", "taskId", "planFingerprint", "runtimeSha", "runId", "eventSha"].some(key => parsedBarrier[key] !== binding[key as keyof CalculatorRegenerationArtifactIdentity])) return refuse();
    const context = exact(json(contextFile), ["version", "request", "barrier"]);
    if (context.version !== 1 || !plain(context.request) || digest(context.barrier) !== binding.barrierDigest) return refuse();
    const entries = files.map(file => ({ path: file.relative, kind: file.relative.endsWith(".lock") ? "stale-lock" : "json",
      bytes: file.bytes.length, sha256: sha256(file.bytes) }));
    const manifest = { version: 1, kind: "calculator-regeneration-forensic", evidenceValidation: "unvalidated", identity: binding,
      fileCount: entries.length, totalBytes, files: entries, treeSha256: digest(entries),
      resumeAuthorized: false, budgetResetAuthorized: false };
    const manifestBytes = Buffer.from(JSON.stringify(manifest) + "\n");
    if (manifestBytes.length > 128 * 1024 || hasSecrets(manifestBytes.toString("utf8"))) return refuse();
    lockPath = join(root, ".regeneration-artifact.lock");
    lockFd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); lockStat = fstatSync(lockFd);
    staging = join(root, ".regeneration-artifact.tmp." + randomUUID()); mkdirSync(staging, { mode: 0o700 }); stagingStat = directory(staging);
    const evidence = join(staging, "evidence"); mkdirSync(evidence, { mode: 0o700 });
    for (const item of directories) mkdirSync(join(evidence, item.path.slice(root.length + 1)), { mode: 0o700 });
    for (const file of files) write(join(evidence, file.relative), file.bytes);
    write(join(staging, "manifest.json"), manifestBytes);
    for (const item of [...directories].reverse()) syncDirectory(join(evidence, item.path.slice(root.length + 1)));
    syncDirectory(evidence); syncDirectory(staging);
    unchanged(root, rootStat, false);
    for (const item of directories) {
      unchanged(item.path, item.stat, false);
      if (readdirSync(item.path).sort().join(",") !== item.names.join(",")) return refuse();
    }
    for (const file of files) unchanged(file.path, file.stat, true);
    const expectedRoot = [...rootNames.filter(name => name !== basename(lockPath!)), basename(lockPath), basename(staging)].sort();
    if (readdirSync(root).sort().join(",") !== expectedRoot.join(",") || optionalStat(destination)) return refuse();
    unchanged(staging, stagingStat, false); renameSync(staging, destination); staging = undefined; syncDirectory(root);
    return Object.freeze({ status: "preserved", fileCount: files.length, totalBytes, manifestSha256: sha256(manifestBytes) });
  } catch { return refuse(); }
  finally {
    if (lockFd !== undefined) try { closeSync(lockFd); } catch { /* Keep fixed diagnostics. */ }
    if (lockPath && lockStat) try { const current = lstatSync(lockPath); if (current.isFile() && !current.isSymbolicLink() &&
      current.ino === lockStat.ino && current.dev === lockStat.dev) unlinkSync(lockPath); } catch { /* Another writer's lock stays intact. */ }
    if (staging && stagingStat) try { const current = lstatSync(staging); if (current.isDirectory() && !current.isSymbolicLink() &&
      current.ino === stagingStat.ino && current.dev === stagingStat.dev) rmSync(staging, { recursive: true }); } catch { /* Keep private residue. */ }
  }
}
