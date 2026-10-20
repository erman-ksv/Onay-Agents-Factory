/**
 * One-task replay barrier. These receipts are metadata, never reusable evidence
 * that a model, Security, tests, CI or a publication passed. Any existing receipt
 * requires external inspection; this store deliberately has no resume method.
 */
import { randomBytes } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, openSync,
  readFileSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { isAbsolute, join, parse, resolve, sep } from "node:path";

export type TeamTaskStageStatus = "running" | "passed" | "blocked";
export type TeamTaskStatus = "running" | "completed" | "blocked" | "needs-review";
export type TeamTaskPublication = { branch: string; headSha: string; url: string; number: number };
export type TeamTaskSnapshot = {
  schemaVersion: 1;
  id: string;
  fingerprint: string;
  status: TeamTaskStatus;
  stages: { stage: string; status: TeamTaskStageStatus }[];
  publication?: TeamTaskPublication;
  reasonCode?: string;
};

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CODE = /^[a-z][a-z0-9_-]{0,63}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const MAX_STAGES = 32;
const MAX_BYTES = 32_768;
const INVALID = "Team task metadata is invalid.";
const PERSISTENCE = "Team task persistence failed; execution must stop.";
const UNAVAILABLE = "Team task store is unavailable; execution must stop.";

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function validPublication(value: unknown): value is TeamTaskPublication {
  if (!plain(value) || !keys(value, ["branch", "headSha", "url", "number"]) ||
      typeof value.branch !== "string" || value.branch.length > 200 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value.branch) ||
      value.branch.includes("..") || value.branch.includes("//") ||
      value.branch.split("/").some(part => !part || part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock")) ||
      typeof value.headSha !== "string" || !SHA.test(value.headSha) ||
      typeof value.number !== "number" || !Number.isSafeInteger(value.number) || value.number < 1 ||
      typeof value.url !== "string" || value.url.length > 512) return false;
  const match = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/([1-9][0-9]*)$/.exec(value.url);
  return !!match && Number(match[1]) === value.number;
}
function validateSnapshot(value: unknown, identity: { id: string; fingerprint: string }): TeamTaskSnapshot {
  if (!plain(value) || !keys(value, ["schemaVersion", "id", "fingerprint", "status", "stages"], ["publication", "reasonCode"]) ||
      value.schemaVersion !== 1 || value.id !== identity.id || value.fingerprint !== identity.fingerprint ||
      !["running", "completed", "blocked", "needs-review"].includes(value.status as string) ||
      !Array.isArray(value.stages) || value.stages.length > MAX_STAGES ||
      !value.stages.every(item => plain(item) && keys(item, ["stage", "status"]) &&
        typeof item.stage === "string" && CODE.test(item.stage) &&
        ["running", "passed", "blocked"].includes(item.status as string)) ||
      new Set(value.stages.map(item => item.stage)).size !== value.stages.length ||
      (Object.hasOwn(value, "publication") && !validPublication(value.publication)) ||
      (Object.hasOwn(value, "reasonCode") && (typeof value.reasonCode !== "string" || !CODE.test(value.reasonCode))) ||
      (value.status === "running" ? Object.hasOwn(value, "reasonCode") : !Object.hasOwn(value, "reasonCode")) ||
      (value.status === "completed" && value.stages.some(item => item.status !== "passed"))) {
    throw new Error(INVALID);
  }
  return structuredClone(value) as TeamTaskSnapshot;
}
function missing(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

export class TeamTaskStore {
  private readonly directory: string;
  private readonly identity: { id: string; fingerprint: string };
  private readonly destination: string;
  private readonly lockPath: string;
  private readonly rootDevice: number;
  private readonly rootInode: number;
  private lockFd?: number;
  private receiptInode?: number;
  private receiptDevice?: number;
  private data?: TeamTaskSnapshot;
  private claimed = false;
  private failed = false;
  private closed = false;

  constructor(directory: string, identity: { id: string; fingerprint: string }) {
    try {
      if (typeof directory !== "string" || !isAbsolute(directory) || directory !== resolve(directory) ||
          !plain(identity) || !keys(identity, ["id", "fingerprint"]) ||
          typeof identity.id !== "string" || !ID.test(identity.id) ||
          typeof identity.fingerprint !== "string" || !FINGERPRINT.test(identity.fingerprint)) throw new Error(INVALID);
      this.directory = directory;
      this.identity = { id: identity.id, fingerprint: identity.fingerprint };
      this.destination = join(directory, identity.id + ".json");
      this.lockPath = join(directory, identity.id + ".lock");
      this.checkAncestors();
      const root = lstatSync(directory);
      if (!root.isDirectory() || root.isSymbolicLink() || (root.mode & 0o022) !== 0 ||
          (process.getuid && root.uid !== process.getuid())) throw new Error(INVALID);
      this.rootDevice = root.dev;
      this.rootInode = root.ino;
    } catch { throw new Error("Team task directory or identity is invalid."); }
  }

  private checkAncestors(): void {
    let path = parse(this.directory).root;
    for (const component of this.directory.slice(path.length).split(sep).filter(Boolean)) {
      path = join(path, component);
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(INVALID);
    }
  }

  private checkRoot(): void {
    this.checkAncestors();
    const root = lstatSync(this.directory);
    if (root.dev !== this.rootDevice || root.ino !== this.rootInode || (root.mode & 0o022) !== 0 ||
        (process.getuid && root.uid !== process.getuid())) throw new Error(INVALID);
  }

  private openPrivateFile(path: string): number {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 ||
          (process.getuid && stat.uid !== process.getuid()) || stat.size > MAX_BYTES) throw new Error(INVALID);
      return fd;
    } catch (error) { closeSync(fd); throw error; }
  }

  private readReceipt(): TeamTaskSnapshot | undefined {
    let fd: number;
    try { fd = this.openPrivateFile(this.destination); }
    catch (error) { if (missing(error)) return undefined; throw error; }
    try {
      const stat = fstatSync(fd);
      const value = validateSnapshot(JSON.parse(readFileSync(fd, "utf8")), this.identity);
      this.receiptDevice = stat.dev;
      this.receiptInode = stat.ino;
      return value;
    } finally { closeSync(fd); }
  }

  /** Inspect metadata without claiming, creating a receipt, or enabling replay. */
  inspectExisting(): TeamTaskSnapshot | undefined {
    if (this.closed || this.failed) throw new Error(UNAVAILABLE);
    try {
      this.checkRoot();
      const existing = this.readReceipt();
      return existing === undefined ? undefined : structuredClone(existing);
    } catch {
      this.failed = true;
      throw new Error("Team task receipt cannot be safely inspected.");
    }
  }

  claim(): "claimed" | "already-recorded" {
    if (this.closed || this.failed || this.data || this.lockFd !== undefined) throw new Error(UNAVAILABLE);
    try {
      this.checkRoot();
      this.lockFd = openSync(this.lockPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      fsyncSync(this.lockFd);
      const existing = this.readReceipt();
      if (existing) {
        this.data = existing;
        this.releaseLock();
        return "already-recorded";
      }
      this.data = { schemaVersion: 1, ...this.identity, status: "running", stages: [] };
      this.persist(true);
      this.claimed = true;
      return "claimed";
    } catch {
      this.failed = true;
      // A competing/stale lock is never removed. Only release our own inode.
      try { this.releaseLock(); } catch { /* Preserve the fixed failure. */ }
      throw new Error("Team task cannot be claimed; inspect its receipt and lock before retrying.");
    }
  }

  private assertWritable(): void {
    if (this.failed || this.closed || !this.claimed || !this.data || this.data.status !== "running" ||
        this.lockFd === undefined) throw new Error(UNAVAILABLE);
  }

  private persist(initial = false): void {
    const temporary = join(this.directory, this.identity.id + ".tmp." + randomBytes(12).toString("hex"));
    let fd: number | undefined;
    try {
      this.checkRoot();
      const lock = fstatSync(this.lockFd!);
      const namedLock = lstatSync(this.lockPath);
      if (!namedLock.isFile() || namedLock.isSymbolicLink() || lock.dev !== namedLock.dev || lock.ino !== namedLock.ino ||
          namedLock.nlink !== 1 || (namedLock.mode & 0o777) !== 0o600) throw new Error(INVALID);
      const serialized = JSON.stringify(validateSnapshot(this.data, this.identity)) + "\n";
      if (Buffer.byteLength(serialized) > MAX_BYTES) throw new Error(INVALID);
      if (!initial) {
        const current = lstatSync(this.destination);
        if (!current.isFile() || current.isSymbolicLink() || current.dev !== this.receiptDevice ||
            current.ino !== this.receiptInode || current.nlink !== 1 || (current.mode & 0o777) !== 0o600) throw new Error(INVALID);
      }
      fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(fd, serialized, "utf8");
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      if (initial) { linkSync(temporary, this.destination); unlinkSync(temporary); }
      else renameSync(temporary, this.destination);
      const current = lstatSync(this.destination);
      this.receiptDevice = current.dev;
      this.receiptInode = current.ino;
      const directoryFd = openSync(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    } catch {
      this.failed = true;
      throw new Error(PERSISTENCE);
    } finally {
      if (fd !== undefined) closeSync(fd);
      try { unlinkSync(temporary); } catch { /* No raw filesystem errors escape. */ }
    }
  }

  recordStage(stage: string, status: TeamTaskStageStatus): void {
    this.assertWritable();
    if (typeof stage !== "string" || !CODE.test(stage) || !["running", "passed", "blocked"].includes(status)) throw new Error(INVALID);
    const prior = this.data!.stages.find(item => item.stage === stage);
    if (prior) {
      if (prior.status !== "running" || status === "running") throw new Error(INVALID);
      prior.status = status;
    } else {
      if (status !== "running" || this.data!.stages.length >= MAX_STAGES) throw new Error(INVALID);
      this.data!.stages.push({ stage, status });
    }
    this.persist();
  }

  recordPublication(value: TeamTaskPublication): void {
    this.assertWritable();
    if (this.data!.publication || !validPublication(value)) throw new Error(INVALID);
    this.data!.publication = structuredClone(value);
    this.persist();
  }

  finish(status: "completed" | "blocked" | "needs-review", reasonCode: string): void {
    this.assertWritable();
    if (!["completed", "blocked", "needs-review"].includes(status) || typeof reasonCode !== "string" || !CODE.test(reasonCode) ||
        (status === "completed" && this.data!.stages.some(item => item.status !== "passed"))) throw new Error(INVALID);
    this.data!.status = status;
    this.data!.reasonCode = reasonCode;
    this.persist();
  }

  snapshot(): TeamTaskSnapshot {
    if (this.failed || !this.data) throw new Error(UNAVAILABLE);
    return structuredClone(this.data);
  }

  private releaseLock(): void {
    if (this.lockFd === undefined) return;
    const fd = this.lockFd;
    this.lockFd = undefined;
    try {
      this.checkRoot();
      const held = fstatSync(fd);
      const named = lstatSync(this.lockPath);
      if (!named.isFile() || named.isSymbolicLink() || held.dev !== named.dev || held.ino !== named.ino) throw new Error(INVALID);
      unlinkSync(this.lockPath);
    } finally { closeSync(fd); }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.releaseLock(); }
    catch { this.failed = true; throw new Error(PERSISTENCE); }
  }
}
