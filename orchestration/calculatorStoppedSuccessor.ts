/** Authenticate the consumed, truncated t02 archive. Inspection grants no replay. */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, parse, resolve } from "node:path";
import { scanForSecrets } from "../github/secretScanner.js";
import { parseCalculatorExecutionCheckpointBytes } from "./calculatorExecutionCheckpoint.js";
import { CALCULATOR_PUBLISHED_STATE_PIN } from "./calculatorPublishedTaskState.js";

export const CALCULATOR_STOPPED_SUCCESSOR_ERROR = "Stopped successor archive unverified; preserve evidence. No replay or refund.";
export const CALCULATOR_STOPPED_SUCCESSOR_PIN = Object.freeze({
  runId: 39747322491, eventSha: "dbae505ae6e4a6f6b2cf93150936eba24c46c8bf", runtimeSha: "6e4873fa763f91191210ce6087ab3aefd787312a",
  artifactId: 12411509353, artifactDigest: "sha256:90ba693a978d1b68067ae2f0e4f19f2d6351afa1d753811d471b1b217dcb8c6b",
  manifestSha256: "a45092537f70be2babcd801aaa71adbfaa80227c4b63750bffea2d2ceaf9d47a", fileCount: 70, totalBytes: 304510,
});
export const CALCULATOR_STOPPED_SUCCESSOR_CHARGE = Object.freeze({ attemptedRequests: 1, totalRequestBytes: 4840,
  reservedRunTokens: 3070, elapsedMs: 23206 });
export const CALCULATOR_STOPPED_SUCCESSOR_TASK = "calculator-pilot-step7-v1-34ee03-t02";
type ArchivePin = Readonly<{ manifestSha256: string; fileCount: number; totalBytes: number }>;
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const digest = (v: unknown) => sha(JSON.stringify(v));
const same = (a: unknown, b: unknown) => digest(a) === digest(b);
const HASH = /^[a-f0-9]{64}$/;
function refuse(): never { throw Error(CALCULATOR_STOPPED_SUCCESSOR_ERROR); }
function object(v: unknown): Record<string, any> {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) return refuse();
  return v as Record<string, any>;
}
function directory(path: string): void {
  const s = lstatSync(path);
  if (!s.isDirectory() || s.isSymbolicLink() || ![0o700, 0o755].includes(s.mode & 0o777) || (process.getuid && s.uid !== process.getuid())) return refuse();
}
function read(path: string): Buffer {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 524288 || ![0o600, 0o644].includes(s.mode & 0o777) ||
      (process.getuid && s.uid !== process.getuid())) return refuse();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); let bytes: Buffer;
  try {
    const before = fstatSync(fd);
    if (before.ino !== s.ino || before.dev !== s.dev || before.nlink !== 1 || before.size !== s.size) return refuse();
    bytes = readFileSync(fd); const after = fstatSync(fd);
    if (after.size !== s.size || after.mtimeMs !== s.mtimeMs || after.ctimeMs !== s.ctimeMs || after.nlink !== 1) return refuse();
  } finally { closeSync(fd); }
  const after = lstatSync(path);
  if (bytes.length !== s.size || after.ino !== s.ino || after.dev !== s.dev || after.mode !== s.mode || after.uid !== s.uid ||
      after.mtimeMs !== s.mtimeMs || after.ctimeMs !== s.ctimeMs || after.isSymbolicLink()) return refuse();
  const text = new TextDecoder("utf8", { fatal: true }).decode(bytes);
  const decoded = path.endsWith(".lock") ? text : JSON.stringify(JSON.parse(text));
  if (scanForSecrets(text).length || scanForSecrets(decoded).length ||
      [text, decoded].some(t => /(?:gsk_|gh[pousr]_)[A-Za-z0-9_-]{20,}/.test(t))) return refuse();
  if (path.endsWith(".lock") && bytes.length) return refuse();
  return bytes;
}

/** Optional pin is a trusted host test seam, never a CLI/env/model parameter.
 * The production wrapper always uses the compiled-in genuine artifact pin. */
export function inspectCalculatorStoppedSuccessor(root: string, pin: ArchivePin = CALCULATOR_STOPPED_SUCCESSOR_PIN) {
  try {
    if (!isAbsolute(root) || resolve(root) !== root || root === parse(root).root || !HASH.test(pin.manifestSha256)) return refuse();
    let ancestor = parse(root).root;
    for (const part of root.slice(ancestor.length).split("/")) { ancestor = join(ancestor, part); if (lstatSync(ancestor).isSymbolicLink()) return refuse(); }
    directory(root);
    if (readdirSync(root).sort().join(",") !== "evidence,manifest.json") return refuse();
    const manifestBytes = read(join(root, "manifest.json"));
    if (sha(manifestBytes) !== pin.manifestSha256) return refuse();
    const manifest = object(JSON.parse(manifestBytes.toString("utf8")));
    if (manifest.version !== 1 || manifest.kind !== "calculator-one-successor-forensic" || manifest.evidenceValidation !== "unvalidated" ||
        manifest.resumeAuthorized !== false || manifest.budgetResetAuthorized !== false || manifest.fileCount !== pin.fileCount ||
        manifest.totalBytes !== pin.totalBytes || !Array.isArray(manifest.files) || manifest.files.length !== pin.fileCount ||
        manifest.treeSha256 !== digest(manifest.files)) return refuse();
    const files = new Map<string, Buffer>(), expected = new Map<string, { bytes: number; sha256: string }>(); let total = 0;
    for (const raw of manifest.files) {
      const f = object(raw);
      if (Object.keys(f).sort().join(",") !== "bytes,path,sha256" || typeof f.path !== "string" || f.path.split("/").length > 18 ||
          f.path.split("/").some((n: string) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(n) || n.includes("..")) ||
          !/\.(json|lock)$/.test(f.path) || !Number.isSafeInteger(f.bytes) || f.bytes < 0 || f.bytes > 524288 || !HASH.test(f.sha256) || expected.has(f.path)) return refuse();
      expected.set(f.path, { bytes: f.bytes, sha256: f.sha256 });
    }
    const evidence = join(root, "evidence"); let dirs = 0;
    function walk(path: string, prefix: string, depth: number): void {
      if (++dirs > 256 || depth > 18) return refuse(); directory(path);
      const before = lstatSync(path), names = readdirSync(path).sort(); if (names.length > 256) return refuse();
      for (const name of names) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name) || name.includes("..")) return refuse();
        const next = join(path, name), relative = prefix ? prefix + "/" + name : name;
        if (lstatSync(next).isDirectory()) {
          if (![...expected.keys()].some(p => p.startsWith(relative + "/"))) return refuse();
          walk(next, relative, depth + 1); continue;
        }
        const entry = expected.get(relative); if (!entry || files.has(relative)) return refuse();
        const bytes = read(next); total += bytes.length;
        if (total > 8388608 || bytes.length !== entry.bytes || sha(bytes) !== entry.sha256) return refuse(); files.set(relative, bytes);
      }
      const after = lstatSync(path);
      if (before.ino !== after.ino || before.dev !== after.dev || before.mode !== after.mode ||
          !same(names, readdirSync(path).sort())) return refuse();
    }
    walk(evidence, "", 0);
    if (files.size !== pin.fileCount || total !== pin.totalBytes) return refuse();
    const json = (path: string) => { const b = files.get(path); if (!b) return refuse(); return object(JSON.parse(b.toString("utf8"))); };
    const source = CALCULATOR_PUBLISHED_STATE_PIN, context = json("context.json"), origin = object(context.origin), transition = object(context.transition);
    if (context.version !== 1 || origin.runId !== CALCULATOR_STOPPED_SUCCESSOR_PIN.runId || origin.eventSha !== CALCULATOR_STOPPED_SUCCESSOR_PIN.eventSha ||
        origin.runtimeSha !== CALCULATOR_STOPPED_SUCCESSOR_PIN.runtimeSha || origin.repository !== "erman-ksv/Onay-Agents-Factory" || origin.runAttempt !== 1 ||
        origin.workflowPath !== ".github/workflows/calculator-after-ci-successor.yml" || context.request.taskId !== CALCULATOR_STOPPED_SUCCESSOR_TASK ||
        context.request.automaticReplay !== false || context.request.budgetResetAuthorized !== false ||
        !same(context.request.source, source) || !same(manifest.previousCharges, context.request.previousCharges) ||
        !same(manifest.additionalAllowance, context.request.additionalAllowance) || transition.previousTaskId !== source.taskId ||
        transition.expectedNextTaskId !== CALCULATOR_STOPPED_SUCCESSOR_TASK || transition.planFingerprint !== source.planFingerprint ||
        transition.candidateSha !== source.candidateSha) return refuse();
    const remote = json("barrier/remote.json");
    if (remote.artifactId !== 12411024412 || remote.artifactDigest !== "sha256:5239635c9ed62556c17c575b09f886f8fbcd294c640f0393526d13426cb90e77" ||
        remote.manifestSha256 !== context.admission.manifestSha256 || !same(remote.origin, context.origin)) return refuse();
    const matches = [...files.keys()].filter(p => new RegExp("^execution-private/[a-f0-9]{64}/" + CALCULATOR_STOPPED_SUCCESSOR_TASK + "\\.execution\\.json$").test(p));
    if (matches.length !== 1) return refuse();
    const capsulePath = matches[0]!, bytes = files.get(capsulePath)!, raw = json(capsulePath);
    const capsule = parseCalculatorExecutionCheckpointBytes(bytes, raw.identity, sha(bytes)).data;
    const identity = capsule.identity, payload = capsule.payload;
    if (identity.repository !== "erman-ksv/Onay-Factory-Calculator" || identity.taskId !== CALCULATOR_STOPPED_SUCCESSOR_TASK ||
        identity.goalId !== source.goalId || identity.planFingerprint !== source.planFingerprint || identity.baseSha !== source.candidateSha ||
        identity.branch !== "feat/calculator-agent/" + source.goalId || payload.stage !== "generate_1" || payload.status !== "blocked" ||
        payload.attempt !== 1 || payload.proposal || payload.assessments.length || !payload.httpInFlight || payload.publicationStarted ||
        !same(payload.modelState, CALCULATOR_STOPPED_SUCCESSOR_CHARGE)) return refuse();
    const receipt = json("state/calc-" + CALCULATOR_STOPPED_SUCCESSOR_TASK + ".json"), report = json("calculator-report.json");
    if (receipt.id !== "calc-" + CALCULATOR_STOPPED_SUCCESSOR_TASK || receipt.status !== "blocked" || receipt.publication !== undefined ||
        receipt.fingerprint !== digest({ planFingerprint: source.planFingerprint, taskId: CALCULATOR_STOPPED_SUCCESSOR_TASK }) ||
        report.status !== "blocked" || report.taskId !== CALCULATOR_STOPPED_SUCCESSOR_TASK || report.publication !== undefined ||
        report.proposalTestsExecuted !== false || report.candidateTestsExecuted !== false || report.wholeAppCompleted !== false || report.legalEnabled !== false) return refuse();
    // Recheck all authenticated inputs after parsing; never clear the old in-flight marker.
    for (const [path, b] of files) if (!read(join(evidence, path)).equals(b)) return refuse();
    if (!read(join(root, "manifest.json")).equals(manifestBytes)) return refuse();
    return Object.freeze({ taskId: CALCULATOR_STOPPED_SUCCESSOR_TASK, manifestSha256: pin.manifestSha256, fileCount: files.size, totalBytes: total,
      capsulePath, capsuleSha256: sha(bytes), receiptSha256: sha(files.get("state/calc-" + CALCULATOR_STOPPED_SUCCESSOR_TASK + ".json")!),
      previousCharge: CALCULATOR_STOPPED_SUCCESSOR_CHARGE, proposalAvailable: false as const, oldHttpInFlight: true as const,
      resumeAuthorized: false as const, budgetResetAuthorized: false as const });
  } catch { return refuse(); }
}
