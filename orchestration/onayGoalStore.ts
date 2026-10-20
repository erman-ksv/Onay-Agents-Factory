/** Private, host-owned planning-batch receipts. They prevent replay; they do not
 * prove model execution, CI, dependency integration or whole-application completion. */
import { randomBytes } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, openSync,
  readFileSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { isAbsolute, join, parse, resolve, sep } from "node:path";
import { prepareTeamTask, type TeamTaskCard } from "./teamTaskCard.js";
import { scanForSecrets } from "../github/secretScanner.js";
import { assertCommitSha, assertValidBranchRef } from "../github/githubClient.js";

export type GoalPublication = { branch: string; headSha: string; url: string; number: number };
export type GoalBacklogTask = {
  id: string; card: TeamTaskCard; dependsOn: string[];
  status: "queued" | "running" | "awaiting-ci" | "completed" | "blocked";
  publication?: GoalPublication; reasonCode?: string;
};
export type GoalState = {
  version: 1; goalId: string; goalFingerprint: string; repository: "erman-ksv/Onay";
  baseRef: string; baseSha: string; tasks: GoalBacklogTask[]; blockers: string[];
  status: "planned" | "running" | "waiting" | "completed" | "blocked"; cycles: number;
};
export type GoalTaskUpdate = Pick<Partial<GoalBacklogTask>, "status" | "publication" | "reasonCode">;
const CODE = /^[a-z][a-z0-9_-]{0,63}$/;
const ID = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const FP = /^[a-f0-9]{64}$/;
const MAX_BYTES = 65_536;
const INVALID = "Onay goal metadata is invalid or needs manual reconciliation.";
const PERSISTENCE = "Onay goal persistence failed; stop and inspect the private state.";
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
}
function absent(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
function publication(value: unknown, branch: string): value is GoalPublication {
  if (!object(value) || !keys(value, ["branch", "headSha", "url", "number"]) || value.branch !== branch ||
      typeof value.headSha !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.headSha) ||
      typeof value.number !== "number" || !Number.isSafeInteger(value.number) || value.number < 1 ||
      value.url !== "https://github.com/erman-ksv/Onay/pull/" + value.number) return false;
  return true;
}

export class OnayGoalStore {
  private readonly path: string;
  private readonly marker: string;
  private readonly lock: string;
  private readonly rootDev: number;
  private readonly rootIno: number;
  private lockFd?: number;
  private state?: GoalState;
  private stateDev?: number;
  private stateIno?: number;
  private failed = false;
  private closed = false;

  constructor(private readonly directory: string, private readonly goalId: string, private readonly fingerprint: string) {
    try {
      if (typeof directory !== "string" || !isAbsolute(directory) || resolve(directory) !== directory ||
          typeof goalId !== "string" || !ID.test(goalId) || typeof fingerprint !== "string" || !FP.test(fingerprint)) throw new Error(INVALID);
      this.path = join(directory, goalId + ".goal.json");
      this.marker = join(directory, goalId + ".goal.identity.json");
      this.lock = join(directory, goalId + ".goal.lock");
      const root = this.checkDirectory();
      this.rootDev = root.dev; this.rootIno = root.ino;
    } catch { throw new Error("Onay goal directory or identity is invalid."); }
  }

  private checkDirectory() {
    let part = parse(this.directory).root;
    for (const component of this.directory.slice(part.length).split(sep).filter(Boolean)) {
      part = join(part, component);
      const stat = lstatSync(part);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(INVALID);
    }
    const root = lstatSync(this.directory);
    if ((root.mode & 0o777) !== 0o700 || (process.getuid && root.uid !== process.getuid()) ||
        (this.rootIno !== undefined && (root.ino !== this.rootIno || root.dev !== this.rootDev))) throw new Error(INVALID);
    return root;
  }
  private available(): void {
    if (this.failed || this.closed) throw new Error("Onay goal store is unavailable; inspect its state.");
  }
  private read(path: string): unknown | undefined {
    let fd: number;
    try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if (absent(error)) return undefined; throw error; }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_BYTES ||
          (process.getuid && stat.uid !== process.getuid())) throw new Error(INVALID);
      const value: unknown = JSON.parse(readFileSync(fd, "utf8"));
      if (path === this.path) { this.stateDev = stat.dev; this.stateIno = stat.ino; }
      return value;
    } finally { closeSync(fd); }
  }
  private validate(value: unknown, initial = false): GoalState {
    if (!object(value) || !keys(value, ["version", "goalId", "goalFingerprint", "repository", "baseRef", "baseSha", "tasks", "blockers", "status", "cycles"]) ||
        value.version !== 1 || value.goalId !== this.goalId || value.goalFingerprint !== this.fingerprint || value.repository !== "erman-ksv/Onay" ||
        typeof value.baseRef !== "string" || typeof value.baseSha !== "string" || value.baseSha !== value.baseSha.toLowerCase() ||
        !Array.isArray(value.tasks) || value.tasks.length > 6 || !Array.isArray(value.blockers) || value.blockers.length > 12 ||
        !value.blockers.every(item => typeof item === "string" && item === item.trim() && item.length >= 1 && item.length <= 240 && !/[\u0000-\u001f\u007f]/.test(item)) ||
        !["planned", "running", "waiting", "completed", "blocked"].includes(value.status as string) ||
        typeof value.cycles !== "number" || !Number.isSafeInteger(value.cycles) || value.cycles < 0 || value.cycles > 12) throw new Error(INVALID);
    assertValidBranchRef(value.baseRef); assertCommitSha(value.baseSha);
    const tasks = value.tasks as unknown[];
    const ids = new Set<string>();
    for (const item of tasks) {
      if (!object(item) || !keys(item, ["id", "card", "dependsOn", "status"], ["publication", "reasonCode"]) ||
          typeof item.id !== "string" || !ID.test(item.id) || ids.has(item.id) ||
          !Array.isArray(item.dependsOn) || item.dependsOn.length > 5 || !item.dependsOn.every(id => typeof id === "string" && ID.test(id)) ||
          new Set(item.dependsOn).size !== item.dependsOn.length || item.dependsOn.includes(item.id) ||
          !["queued", "running", "awaiting-ci", "completed", "blocked"].includes(item.status as string) ||
          (Object.hasOwn(item, "reasonCode") && (typeof item.reasonCode !== "string" || !CODE.test(item.reasonCode)))) throw new Error(INVALID);
      const card = prepareTeamTask(item.card);
      if (card.id !== item.id || card.baseRef !== value.baseRef || card.baseSha !== value.baseSha ||
          (Object.hasOwn(item, "publication") && !publication(item.publication, card.branch)) ||
          (["awaiting-ci", "completed"].includes(item.status as string) && !item.publication) ||
          (item.status === "queued" && item.publication)) throw new Error(INVALID);
      ids.add(item.id);
    }
    const typed = value as unknown as GoalState;
    const visited = new Set<string>(), active = new Set<string>();
    const visit = (id: string): void => {
      if (!ids.has(id) || active.has(id)) throw new Error(INVALID);
      if (visited.has(id)) return;
      active.add(id);
      for (const dependency of typed.tasks.find(task => task.id === id)!.dependsOn) visit(dependency);
      active.delete(id); visited.add(id);
    };
    for (const id of ids) visit(id);
    if ((!typed.tasks.length && (typed.status !== "blocked" || !typed.blockers.length)) ||
        (typed.status === "completed" && (typed.blockers.length || typed.tasks.some(task => task.status !== "completed"))) ||
        (initial && (typed.cycles !== 0 || !["planned", "blocked"].includes(typed.status) ||
          typed.tasks.some(task => task.status !== "queued" || task.publication || task.reasonCode))) ||
        Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES || scanForSecrets(JSON.stringify(value)).length) throw new Error(INVALID);
    return structuredClone(typed);
  }

  inspect(): GoalState | undefined {
    this.available();
    try {
      this.checkDirectory();
      const marker = this.read(this.marker), state = this.read(this.path);
      if (marker === undefined && state === undefined) return undefined;
      if (!object(marker) || !keys(marker, ["version", "goalId", "goalFingerprint"]) || marker.version !== 1 ||
          marker.goalId !== this.goalId || marker.goalFingerprint !== this.fingerprint || state === undefined) throw new Error(INVALID);
      return this.validate(state);
    } catch { this.failed = true; throw new Error(INVALID); }
  }
  private claimLock(): void {
    if (this.lockFd !== undefined) throw new Error(INVALID);
    this.checkDirectory();
    this.lockFd = openSync(this.lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fsyncSync(this.lockFd);
  }
  private releaseLock(): void {
    if (this.lockFd === undefined) return;
    const fd = this.lockFd; this.lockFd = undefined;
    try {
      this.checkDirectory();
      const held = fstatSync(fd), named = lstatSync(this.lock);
      if (!named.isFile() || named.isSymbolicLink() || held.dev !== named.dev || held.ino !== named.ino) throw new Error(INVALID);
      unlinkSync(this.lock);
    } finally { closeSync(fd); }
  }
  private persist(path: string, value: unknown, initial: boolean): void {
    let temporary: string | undefined, fd: number | undefined;
    try {
      this.checkDirectory();
      const held = fstatSync(this.lockFd!), named = lstatSync(this.lock);
      if (!named.isFile() || named.isSymbolicLink() || held.ino !== named.ino || held.dev !== named.dev || named.nlink !== 1 || (named.mode & 0o777) !== 0o600) throw new Error(INVALID);
      if (!initial) {
        const old = lstatSync(this.path);
        if (!old.isFile() || old.isSymbolicLink() || old.dev !== this.stateDev || old.ino !== this.stateIno || old.nlink !== 1 || (old.mode & 0o777) !== 0o600) throw new Error(INVALID);
      }
      const serialized = JSON.stringify(value) + "\n";
      if (Buffer.byteLength(serialized) > MAX_BYTES || scanForSecrets(serialized).length) throw new Error(INVALID);
      temporary = join(this.directory, this.goalId + ".tmp." + randomBytes(10).toString("hex"));
      fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(fd, serialized); fsyncSync(fd); closeSync(fd); fd = undefined;
      if (initial) { linkSync(temporary, path); unlinkSync(temporary); } else renameSync(temporary, path);
      temporary = undefined;
      if (path === this.path) { const stat = lstatSync(path); this.stateDev = stat.dev; this.stateIno = stat.ino; }
      const parent = openSync(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { fsyncSync(parent); } finally { closeSync(parent); }
    } catch { this.failed = true; throw new Error(PERSISTENCE); }
    finally {
      if (fd !== undefined) closeSync(fd);
      if (temporary) try { unlinkSync(temporary); } catch { /* Never expose source-bearing filesystem errors. */ }
    }
  }
  saveInitial(state: GoalState): void {
    this.available();
    try {
      const initial = this.validate(state, true);
      this.claimLock();
      if (this.inspect() !== undefined) throw new Error(INVALID);
      this.persist(this.marker, { version: 1, goalId: this.goalId, goalFingerprint: this.fingerprint }, true);
      this.persist(this.path, initial, true);
    } catch { this.failed = true; throw new Error("Onay goal cannot be initialized; inspect existing state and lock."); }
    finally { try { this.releaseLock(); } catch { this.failed = true; throw new Error(PERSISTENCE); } }
  }
  beginCycle(): GoalState {
    this.available();
    try {
      this.claimLock();
      const current = this.inspect();
      if (!current || !["planned", "waiting"].includes(current.status) || current.tasks.some(task => task.status === "running") || current.cycles >= 12) throw new Error(INVALID);
      current.cycles++; current.status = "running";
      this.state = this.validate(current);
      this.persist(this.path, this.state, false);
      return structuredClone(this.state);
    } catch {
      this.failed = true;
      try { this.releaseLock(); } catch { /* Preserve fixed refusal; never remove a foreign lock. */ }
      throw new Error("Onay goal cycle cannot start; inspect interrupted work, state and locks.");
    }
  }
  updateTask(id: string, patch: GoalTaskUpdate): void {
    this.available();
    if (!this.state || this.lockFd === undefined || !object(patch) || !Object.keys(patch).length ||
        !keys(patch, [], ["status", "publication", "reasonCode"])) throw new Error(INVALID);
    const task = this.state.tasks.find(item => item.id === id);
    if (!task || ["completed", "blocked"].includes(task.status)) throw new Error(INVALID);
    const next = { ...task, ...structuredClone(patch) };
    const transitions = { queued: ["queued", "running", "blocked"], running: ["running", "awaiting-ci", "completed", "blocked"],
      "awaiting-ci": ["awaiting-ci", "completed", "blocked"] };
    if (!transitions[task.status as keyof typeof transitions].includes(next.status) ||
        (task.status === "queued" && next.status === "running" && (this.state.tasks.some(item => item.status === "running") ||
          task.dependsOn.some(dependency => this.state!.tasks.find(item => item.id === dependency)!.status !== "completed"))) ||
        (task.publication && (Object.keys(task.publication) as (keyof GoalPublication)[])
          .some(key => task.publication![key] !== next.publication?.[key]))) throw new Error(INVALID);
    const proposed = structuredClone(this.state);
    proposed.tasks[proposed.tasks.findIndex(item => item.id === id)] = next;
    this.state = this.validate(proposed);
    this.persist(this.path, this.state, false);
  }
  finishCycle(): void {
    this.available();
    if (!this.state || this.lockFd === undefined || this.state.tasks.some(task => task.status === "running")) throw new Error(INVALID);
    const allComplete = this.state.tasks.every(task => task.status === "completed");
    this.state.status = this.state.tasks.some(task => task.status === "blocked") || (allComplete && this.state.blockers.length > 0)
      ? "blocked" : allComplete ? "completed" : "waiting";
    this.persist(this.path, this.validate(this.state), false);
    this.state = undefined;
    try { this.releaseLock(); } catch { this.failed = true; throw new Error(PERSISTENCE); }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.releaseLock(); } catch { this.failed = true; throw new Error(PERSISTENCE); }
  }
}
