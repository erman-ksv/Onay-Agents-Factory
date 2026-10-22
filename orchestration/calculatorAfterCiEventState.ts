/** Transfer consumed after-CI events between workers. This is a replay barrier,
 * never execution authority. Artifact provenance and its digest are host pins. */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { scanForSecrets } from "../github/secretScanner.js";
import { parseTeamTaskSnapshotBytes } from "./teamTaskStore.js";
import { calculatorAfterCiEventIdentity, prepareCalculatorAfterCiRequest, type CalculatorAfterCiRequest } from "./calculatorAfterCi.js";

export const CALCULATOR_EVENT_STATE_ERROR = "After-CI event state refused; preserve all barriers. No replay or reset.";
export type CalculatorEventOrigin = Readonly<{
  repository: "erman-ksv/Onay-Agents-Factory"; workflowPath: string; runId: number; runAttempt: 1; eventSha: string; runtimeSha: string;
}>;
export type CalculatorEventArtifactExpectation = Readonly<{ request: CalculatorAfterCiRequest; origin: CalculatorEventOrigin; manifestSha256: string }>;
export type CalculatorEventState = Readonly<{
  manifestSha256: string; eventId: string; fileCount: number; totalBytes: number;
  receiptPresent: boolean; lockPresent: boolean; receiptStatus: string;
  consumed: true; resumeAuthorized: false; budgetResetAuthorized: false;
}>;
type File = { name: string; bytes: Buffer; path: string; stat: Stats };
const states = new WeakMap<CalculatorEventState, readonly File[]>();
const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function refuse(): never { throw Error(CALCULATOR_EVENT_STATE_ERROR); }
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) return refuse(); return v as Record<string, unknown>;
}
function exact(v: unknown, fields: readonly string[]): Record<string, unknown> {
  const value = object(v), descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== fields.length || !fields.every(key => Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key]!, "value"))) return refuse(); return value;
}
export function prepareCalculatorEventOrigin(input: unknown): CalculatorEventOrigin {
  const v = exact(input, ["repository", "workflowPath", "runId", "runAttempt", "eventSha", "runtimeSha"]);
  if (v.repository !== "erman-ksv/Onay-Agents-Factory" || typeof v.workflowPath !== "string" ||
      !/^\.github\/workflows\/[a-z][a-z0-9-]{0,100}\.yml$/.test(v.workflowPath) || !Number.isSafeInteger(v.runId) || Number(v.runId) < 1 ||
      v.runAttempt !== 1 || typeof v.eventSha !== "string" || !SHA.test(v.eventSha) || typeof v.runtimeSha !== "string" || !SHA.test(v.runtimeSha)) return refuse();
  return Object.freeze({ repository: v.repository, workflowPath: v.workflowPath, runId: Number(v.runId), runAttempt: 1, eventSha: v.eventSha, runtimeSha: v.runtimeSha });
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function directory(path: string, incoming = false): Stats {
  if (!isAbsolute(path) || resolve(path) !== path || path === parse(path).root) return refuse();
  let ancestor = parse(path).root;
  for (const part of path.slice(ancestor.length).split("/")) {
    ancestor = join(ancestor, part); const stat = lstatSync(ancestor); if (!stat.isDirectory() || stat.isSymbolicLink()) return refuse();
  }
  const s = lstatSync(path);
  if (!(incoming ? [0o700, 0o755] : [0o700]).includes(s.mode & 0o777) || (process.getuid && s.uid !== process.getuid())) return refuse(); return s;
}
function unchanged(path: string, s: Stats): void {
  const n = lstatSync(path);
  if (n.dev !== s.dev || n.ino !== s.ino || n.mode !== s.mode || n.uid !== s.uid || n.size !== s.size || n.mtimeMs !== s.mtimeMs || n.ctimeMs !== s.ctimeMs || n.isSymbolicLink()) return refuse();
}
function read(path: string, incoming: boolean, maximum = 32768): File {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > maximum || !(incoming ? [0o600, 0o644] : [0o600]).includes(s.mode & 0o777) ||
      (process.getuid && s.uid !== process.getuid())) return refuse();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); let bytes: Buffer;
  try {
    const n = fstatSync(fd); if (n.dev !== s.dev || n.ino !== s.ino || n.nlink !== 1 || n.size !== s.size) return refuse();
    bytes = readFileSync(fd); unchanged(path, s);
  } finally { closeSync(fd); }
  if (bytes.length !== s.size || scanForSecrets(bytes.toString("utf8")).length) return refuse();
  return { name: path.slice(path.lastIndexOf("/") + 1), path, bytes, stat: s };
}
function write(path: string, bytes: Buffer): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function sync(path: string): void { const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
function claim(path: string): { stat: Stats; parent: Stats } {
  if (!isAbsolute(path) || resolve(path) !== path || path === parse(path).root) return refuse();
  directory(dirname(path)); mkdirSync(path, { mode: 0o700 }); return { stat: directory(path), parent: directory(dirname(path)) };
}
function ownedClaim(path: string, before: ReturnType<typeof claim>): void {
  const now = directory(path); if (now.ino !== before.stat.ino || now.dev !== before.stat.dev) return refuse(); unchanged(dirname(path), before.parent);
}
function files(directoryPath: string, request: CalculatorAfterCiRequest, incoming: boolean): { files: File[]; receiptPresent: boolean; lockPresent: boolean; receiptStatus: string } {
  directory(directoryPath, incoming); const key = calculatorAfterCiEventIdentity(request), jsonName = key.id + ".json", lockName = key.id + ".lock";
  const names = readdirSync(directoryPath).sort();
  if (!names.length || names.length > 2 || names.some(name => name !== jsonName && name !== lockName)) return refuse();
  const loaded = names.map(name => read(join(directoryPath, name), incoming));
  const receipt = loaded.find(f => f.name === jsonName), lock = loaded.find(f => f.name === lockName);
  const receiptStatus = receipt ? parseTeamTaskSnapshotBytes(receipt.bytes, key).status : "absent_locked";
  if (lock && lock.bytes.length !== 0) return refuse();
  return { files: loaded, receiptPresent: !!receipt, lockPresent: !!lock, receiptStatus };
}
function metadata(manifestSha256: string, eventId: string, snapshot: ReturnType<typeof files>): CalculatorEventState {
  return Object.freeze({ manifestSha256, eventId, fileCount: snapshot.files.length, totalBytes: snapshot.files.reduce((n, f) => n + f.bytes.length, 0),
    receiptPresent: snapshot.receiptPresent, lockPresent: snapshot.lockPresent, receiptStatus: snapshot.receiptStatus,
    consumed: true, resumeAuthorized: false, budgetResetAuthorized: false });
}

/** Export only a consumed receipt and/or a crash lock. Empty/missing state is
 * refused, never converted into a fresh admission. No source entry is removed. */
export function exportCalculatorAfterCiEventState(source: string, destination: string, input: unknown, originInput: unknown): CalculatorEventState {
  try {
    const request = prepareCalculatorAfterCiRequest(input), origin = prepareCalculatorEventOrigin(originInput), eventKey = calculatorAfterCiEventIdentity(request);
    if (destination === source || destination.startsWith(source + "/")) return refuse();
    const sourceStat = directory(source), snapshot = files(source, request, false);
    const entries = snapshot.files.map(f => ({ path: f.name, bytes: f.bytes.length, sha256: hash(f.bytes) }));
    const manifest = { version: 1, kind: "calculator-consumed-event-state", request, origin, eventKey,
      receiptPresent: snapshot.receiptPresent, lockPresent: snapshot.lockPresent, receiptStatus: snapshot.receiptStatus,
      files: entries, fileCount: entries.length, totalBytes: snapshot.files.reduce((n, f) => n + f.bytes.length, 0),
      resumeAuthorized: false, budgetResetAuthorized: false };
    const raw = Buffer.from(JSON.stringify(manifest) + "\n"); if (scanForSecrets(raw.toString("utf8")).length) return refuse();
    const owned = claim(destination); mkdirSync(join(destination, "state"), { mode: 0o700 });
    for (const f of snapshot.files) { ownedClaim(destination, owned); write(join(destination, "state", f.name), f.bytes); }
    write(join(destination, "manifest.json"), raw); sync(join(destination, "state")); sync(destination); sync(dirname(destination));
    unchanged(source, sourceStat); for (const f of snapshot.files) unchanged(f.path, f.stat);
    if (!same(readdirSync(source).sort(), snapshot.files.map(f => f.name))) return refuse();
    ownedClaim(destination, owned); return metadata(hash(raw), eventKey.id, snapshot);
  } catch { return refuse(); }
}

/** The expected digest and origin must come from a verified host checkpoint or
 * trusted prior job output, not from this artifact's own manifest or model JSON. */
export function inspectCalculatorAfterCiEventState(root: string, expected: CalculatorEventArtifactExpectation): CalculatorEventState {
  try {
    const request = prepareCalculatorAfterCiRequest(expected.request), origin = prepareCalculatorEventOrigin(expected.origin);
    if (!HASH.test(expected.manifestSha256)) return refuse(); const rootStat = directory(root, true);
    if (!same(readdirSync(root).sort(), ["manifest.json", "state"])) return refuse();
    const manifestFile = read(join(root, "manifest.json"), true, 65536);
    if (hash(manifestFile.bytes) !== expected.manifestSha256) return refuse();
    const m = exact(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestFile.bytes)), ["version", "kind", "request", "origin", "eventKey",
      "receiptPresent", "lockPresent", "receiptStatus", "files", "fileCount", "totalBytes", "resumeAuthorized", "budgetResetAuthorized"]);
    const eventKey = calculatorAfterCiEventIdentity(request);
    if (m.version !== 1 || m.kind !== "calculator-consumed-event-state" || !same(prepareCalculatorAfterCiRequest(m.request), request) ||
        !same(prepareCalculatorEventOrigin(m.origin), origin) || !same(m.eventKey, eventKey) || m.resumeAuthorized !== false || m.budgetResetAuthorized !== false) return refuse();
    const statePath = join(root, "state"), stateStat = directory(statePath, true), snapshot = files(statePath, request, true);
    const entries = snapshot.files.map(f => ({ path: f.name, bytes: f.bytes.length, sha256: hash(f.bytes) }));
    if (!same(m.files, entries) || m.fileCount !== entries.length || m.totalBytes !== snapshot.files.reduce((n, f) => n + f.bytes.length, 0) ||
        m.receiptPresent !== snapshot.receiptPresent || m.lockPresent !== snapshot.lockPresent || m.receiptStatus !== snapshot.receiptStatus) return refuse();
    unchanged(root, rootStat); unchanged(statePath, stateStat); unchanged(manifestFile.path, manifestFile.stat); for (const f of snapshot.files) unchanged(f.path, f.stat);
    const capability = metadata(expected.manifestSha256, eventKey.id, snapshot); states.set(capability, snapshot.files); return capability;
  } catch { return refuse(); }
}

/** A new worker receives the original bytes in a new private directory. A lock
 * remains a lock, including a crash before any receipt. Interrupted destinations
 * are retained and cannot be overwritten or retried as a fresh event. */
export function restoreCalculatorAfterCiEventState(capability: CalculatorEventState, destination: string): void {
  try {
    const loaded = states.get(capability); if (!loaded) return refuse(); const owned = claim(destination);
    for (const f of loaded) { ownedClaim(destination, owned); write(join(destination, f.name), f.bytes); }
    ownedClaim(destination, owned); sync(destination); sync(dirname(destination));
  } catch { return refuse(); }
}
