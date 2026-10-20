/** Host-only, one-run forensic export. It grants no recovery or model authority. */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { isAbsolute, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { scanForSecrets } from "../github/secretScanner.js";
import { createCalculatorPlan, prepareCalculatorGoal } from "./calculatorPlan.js";
import { CALCULATOR_LAUNCH_BRANCH, CALCULATOR_LAUNCH_REPOSITORY, calculatorLaunchManifest,
  prepareCalculatorLaunchRequest } from "./calculatorLaunchState.js";

export const CALCULATOR_EXECUTION_ARTIFACT_ERROR = "Private execution artifact refused; preserve local evidence. No replay or budget reset is authorized.";
const SHA = /^[a-f0-9]{40}$/;
const MAX_FILE_BYTES = 512 * 1024, MAX_TOTAL_BYTES = 8 * 1024 * 1024, MAX_FILES = 24;
const FILE_NAME = /^[a-z0-9][a-z0-9_-]{0,119}\.execution\.json(?:\.lock)?$/;
type Snapshot = Readonly<{ path: string; bytes: Buffer; stat: Stats }>;
type FileEntry = Readonly<{ path: string; kind: "checkpoint" | "stale-lock"; bytes: number; sha256: string }>;
export type CalculatorExecutionArtifactResult = Readonly<{
  status: "preserved" | "absent"; fileCount: number; totalBytes: number; manifestSha256: string;
}>;
function refuse(): never { throw new Error(CALCULATOR_EXECUTION_ARTIFACT_ERROR); }
function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function digest(value: unknown): string { return sha256(JSON.stringify(value)); }
function hasSecrets(value: string): boolean {
  const unescaped = value.replace(/\\u([a-f0-9]{4})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  return [value, unescaped].some(text => scanForSecrets(text).length > 0 || /gsk_[A-Za-z0-9_-]{20,}/.test(text));
}
function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!plain(value) || Object.keys(value).length !== fields.length || !fields.every(key => Object.hasOwn(value, key))) return refuse();
  return value;
}
function id(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return refuse(); return value;
}
function hash(value: unknown): string { if (typeof value !== "string" || !SHA.test(value)) return refuse(); return value; }
function same(left: unknown, right: unknown): boolean {
  if (!plain(left) || !plain(right) || Object.keys(left).length !== Object.keys(right).length) return false;
  return Object.keys(right).every(key => left[key] === right[key]);
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
  if (after.ino !== before.ino || after.dev !== before.dev || after.mode !== before.mode || after.uid !== before.uid ||
      after.isSymbolicLink() || (file && (!after.isFile() || after.nlink !== 1 || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)) || (!file && !after.isDirectory())) return refuse();
}
function read(path: string, maximum = MAX_FILE_BYTES): Snapshot {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || !owned(before) ||
      (before.mode & 0o777) !== 0o600 || before.size > maximum) return refuse();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let data: Buffer;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.size !== before.size ||
        stat.mode !== before.mode || stat.uid !== before.uid || stat.nlink !== 1) return refuse();
    data = readFileSync(fd);
    const after = fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || after.nlink !== 1) return refuse();
  } finally { closeSync(fd); }
  if (data.length !== before.size || data.length > maximum) return refuse();
  unchanged(path, before, true);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  if (hasSecrets(text)) return refuse();
  // Scan decoded JSON as well, so escaped token prefixes cannot evade the scan.
  let decoded: unknown;
  try { decoded = JSON.parse(text); } catch { /* Forensic bytes need not be a valid checkpoint. */ }
  if (decoded !== undefined && hasSecrets(JSON.stringify(decoded))) return refuse();
  return { path, bytes: data, stat: before };
}
function json(snapshot: Snapshot): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes)); }
function write(path: string, bytes: Buffer): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Copies exact bounded private evidence, never code into the source-free capsule.
 * A valid launch binding is required, but checkpoint contents remain unvalidated
 * forensic evidence and cannot restore claims, provider budgets or model stages.
 */
export function exportPrivateExecutionArtifact(root: string, factorySha: string, image: string,
  env: NodeJS.ProcessEnv = process.env): CalculatorExecutionArtifactResult {
  let lockFd: number | undefined, lockPath: string | undefined, lockStat: Stats | undefined;
  let staging: string | undefined, stagingStat: Stats | undefined;
  try {
    hash(factorySha); if (!/^node@sha256:[a-f0-9]{64}$/.test(image)) return refuse();
    const rootStat = directory(root), state = join(root, "state"), stateStat = directory(state);
    const barrierDirectory = join(root, "barrier"), barrierStat = directory(barrierDirectory);
    const contextFile = read(join(root, "context.json"), 32768), context = exact(json(contextFile), ["version", "request", "manifest", "restore"]);
    if (context.version !== 1) return refuse();
    const request = prepareCalculatorLaunchRequest(context.request, factorySha, image);
    if (request.mode !== "run") return refuse();
    const rawManifest = plain(context.manifest) ? context.manifest : refuse();
    const launch = calculatorLaunchManifest(request, id(rawManifest.runId), hash(rawManifest.eventSha), hash(rawManifest.requestBlobSha));
    if (!same(rawManifest, launch)) return refuse();
    const barrierFile = read(join(barrierDirectory, "launch.json"), 32768);
    if (!same(json(barrierFile), launch) || env.CALCULATOR_REMOTE_BARRIER_UPLOADED !== "true" ||
        env.GITHUB_REPOSITORY !== CALCULATOR_LAUNCH_REPOSITORY || env.GITHUB_REF !== "refs/heads/" + CALCULATOR_LAUNCH_BRANCH ||
        env.GITHUB_EVENT_NAME !== "push" || env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_RUN_ID !== String(launch.runId) ||
        env.GITHUB_SHA !== launch.eventSha) return refuse();
    const restored = exact(context.restore, ["runId", "barrierId", "capsuleId", "manifest"]);
    const oldRaw = plain(restored.manifest) ? restored.manifest : refuse();
    const oldLaunch = calculatorLaunchManifest({ ...request, mode: "plan" }, id(restored.runId), hash(oldRaw.eventSha), hash(oldRaw.requestBlobSha));
    if (!same(oldRaw, oldLaunch) || oldLaunch.runId === launch.runId || id(restored.barrierId) === id(restored.capsuleId)) return refuse();
    const owner = prepareCalculatorGoal(request.goal), planPath = join(state, owner.id + ".calculator-plan.json");
    let planFingerprint: string | undefined, planFile: Snapshot | undefined;
    if (optionalStat(planPath)) {
      planFile = read(planPath, 32768);
      const document = exact(json(planFile), ["version", "request", "proposal", "fingerprint"]);
      if (document.version !== 1 || prepareCalculatorGoal(document.request).ownerFingerprint !== owner.ownerFingerprint) return refuse();
      const plan = createCalculatorPlan(request.goal, document.proposal);
      if (plan.fingerprint !== document.fingerprint) return refuse(); planFingerprint = plan.fingerprint;
    }
    const namespace = digest(resolve(state)), privateRoot = join(root, "execution-private"), source = join(privateRoot, namespace);
    const directories: Readonly<{ path: string; stat: Stats; names: readonly string[] }>[] = [];
    let files: Snapshot[] = [];
    const privateRootExists = !!optionalStat(privateRoot);
    if (privateRootExists) {
      const privateRootStat = directory(privateRoot);
      const names = readdirSync(privateRoot).sort();
      if (names.length > 1 || (names.length === 1 && names[0] !== namespace)) return refuse();
      directories.push({ path: privateRoot, stat: privateRootStat, names });
      if (names.length) {
        const sourceStat = directory(source);
        const entries = readdirSync(source).sort();
        if (entries.length > MAX_FILES || entries.some(name => !FILE_NAME.test(name))) return refuse();
        directories.push({ path: source, stat: sourceStat, names: entries });
        files = entries.map(name => {
          const snapshot = read(join(source, name));
          if (name.endsWith(".lock") && snapshot.bytes.length !== 0) return refuse(); return snapshot;
        });
      }
    }
    const totalBytes = files.reduce((total, file) => total + file.bytes.length, 0);
    if (totalBytes > MAX_TOTAL_BYTES) return refuse();
    const entries: FileEntry[] = files.map(file => ({ path: file.path.slice(source.length + 1),
      kind: file.path.endsWith(".lock") ? "stale-lock" : "checkpoint", bytes: file.bytes.length, sha256: sha256(file.bytes) }));
    const status = entries.length ? "preserved" as const : "absent" as const;
    const artifactManifest = { version: 1, kind: "calculator-private-execution-forensic", evidenceValidation: "unvalidated",
      launch, launchManifestSha256: digest(launch), goalId: owner.id, ownerFingerprint: owner.ownerFingerprint,
      ...(planFingerprint ? { planFingerprint } : {}), planVerification: planFingerprint ? "document-digest-verified" : "absent",
      namespace, status, fileCount: entries.length, totalBytes, files: entries,
      resumeAuthorized: false, budgetResetAuthorized: false };
    const manifestBytes = Buffer.from(JSON.stringify(artifactManifest) + "\n");
    if (manifestBytes.length > 32768 || hasSecrets(manifestBytes.toString("utf8"))) return refuse();
    const destination = join(root, "execution-artifact");
    if (optionalStat(destination)) return refuse();
    lockPath = join(root, ".execution-artifact.lock");
    lockFd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    lockStat = fstatSync(lockFd);
    staging = join(root, ".execution-artifact.tmp." + randomUUID()); mkdirSync(staging, { mode: 0o700 }); stagingStat = directory(staging);
    const stagedFiles = join(staging, "execution-private"); mkdirSync(stagedFiles, { mode: 0o700 });
    for (const file of files) write(join(stagedFiles, file.path.slice(source.length + 1)), file.bytes);
    write(join(staging, "manifest.json"), manifestBytes); syncDirectory(stagedFiles); syncDirectory(staging);
    unchanged(root, rootStat, false); unchanged(state, stateStat, false); unchanged(barrierDirectory, barrierStat, false);
    for (const item of directories) unchanged(item.path, item.stat, false);
    for (const item of [contextFile, barrierFile, ...(planFile ? [planFile] : []), ...files]) unchanged(item.path, item.stat, true);
    if (directories.some(item => readdirSync(item.path).sort().join(",") !== item.names.join(",")) ||
        (!privateRootExists && optionalStat(privateRoot)) || optionalStat(destination)) return refuse();
    unchanged(staging, stagingStat, false); renameSync(staging, destination); staging = undefined; syncDirectory(root);
    return Object.freeze({ status, fileCount: entries.length, totalBytes, manifestSha256: sha256(manifestBytes) });
  } catch { return refuse(); }
  finally {
    if (lockFd !== undefined) { try { closeSync(lockFd); } catch { /* Preserve the fixed refusal. */ } }
    if (lockPath && lockStat) {
      try { const current = lstatSync(lockPath); if (current.isFile() && !current.isSymbolicLink() &&
          current.ino === lockStat.ino && current.dev === lockStat.dev) unlinkSync(lockPath); } catch { /* Do not touch another writer. */ }
    }
    if (staging && stagingStat) {
      try { const current = lstatSync(staging); if (current.isDirectory() && !current.isSymbolicLink() &&
          current.ino === stagingStat.ino && current.dev === stagingStat.dev) rmSync(staging, { recursive: true }); } catch { /* Leave private forensic residue. */ }
    }
  }
}
export function runCalculatorExecutionArtifact(args: string[], env: NodeJS.ProcessEnv = process.env): CalculatorExecutionArtifactResult {
  if (args.length !== 3) return refuse(); return exportPrivateExecutionArtifact(args[0]!, args[1]!, args[2]!, env);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(runCalculatorExecutionArtifact(process.argv.slice(2)))); }
  catch { console.error(CALCULATOR_EXECUTION_ARTIFACT_ERROR); process.exitCode = 10; }
}
