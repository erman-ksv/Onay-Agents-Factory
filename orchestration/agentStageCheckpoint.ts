/**
 * Durable, metadata-only stage receipts for a single Commander task.
 *
 * This is NOT a replay engine: full Coder output and source must never be
 * serialized to this checkpoint. Resume decisions are conservative.
 * In particular, a GitHub mutation that began might have committed even if
 * the process crashed before the tool reported success.
 */
import { createHash } from "node:crypto";
import {
  closeSync, existsSync, lstatSync, openSync, readFileSync,
  renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { AgentRunEvent, AgentRunJournal } from "./agentRunJournal.js";
import { assertCommitSha, assertValidBranchRef } from "../github/githubClient.js";

export type StagePhase = "in-flight" | "completed" | "failed";
export type StageReceipt = {
  actor: string;
  tool: string;
  phase: StagePhase;
  startedSequence: number;
  finishedSequence?: number;
};
export type StageCheckpoint = {
  version: 1;
  fingerprint: string;
  repository: string;
  baseRef: string;
  expectedSha: string;
  taskId: string;
  lastSequence: number;
  stages: StageReceipt[];
  verifiedActors: string[];
  writeAttempted: boolean;
  sealed: boolean;
  outcome?: "completed" | "blocked" | "needs-review";
};
export type RecoveryAdvice = {
  decision: "reconcile-github" | "pause-unknown-outcome" | "pause-failed-tool" |
    "manual-artifact-recovery" | "restart-read-only" | "no-work-recorded";
  reason: string;
  verifiedActors: string[];
  stages: StageReceipt[];
};

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const ACTOR_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const READ_ONLY = new Set(["explore_onay", "security_review", "test_onay", "audit_onay_read_only"]);
const WRITE_TOOLS = new Set(["publish_change_set", "write_candidate", "create_pr", "merge_pull_request", "delete_branch"]);
const MAX_STAGES = 128;

export type StageCheckpointIdentity = {
  goal: string;
  repository: string;
  baseRef: string;
  expectedSha: string;
};
function fingerprint(identity: StageCheckpointIdentity): string {
  return createHash("sha256").update(JSON.stringify([
    identity.goal, identity.repository, identity.baseRef, identity.expectedSha.toLowerCase(),
  ])).digest("hex");
}
function checkIdentity(identity: StageCheckpointIdentity): void {
  assertValidBranchRef(identity.baseRef);
  assertCommitSha(identity.expectedSha);
  if (!/^[\w.-]+\/[\w.-]+$/.test(identity.repository) || !identity.goal.trim())
    throw new Error("An explicit repository and non-empty task goal are required.");
}
function validatePath(path: string): string {
  if (!isAbsolute(path)) throw new Error("Stage checkpoint path must be absolute.");
  const dest = resolve(path);
  if (dest.split("/").some(x => [".git", "node_modules", ".github"].includes(x)))
    throw new Error("Stage checkpoint cannot be stored inside repository metadata.");
  const parent = dirname(dest);
  if (!existsSync(parent) || !lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink())
    throw new Error("Stage checkpoint parent must be a real existing directory.");
  if (existsSync(dest) && (!lstatSync(dest).isFile() || lstatSync(dest).isSymbolicLink()))
    throw new Error("Stage checkpoint cannot be a symlink or special file.");
  return dest;
}

/**
 * The writer owns a one-run exclusive lock. An interrupted run leaves the
 * lock in place; it cannot be silently resumed/replayed by another worker.
 * The recorded data is strictly metadata: no journal messages, arguments,
 * model prompts, credentials, source, full file paths or generated content.
 */
export class StageCheckpointRecorder {
  private readonly dest: string;
  private readonly lockPath: string;
  private readonly lockFd: number;
  private readonly data: StageCheckpoint;
  private unsubscribe?: () => void;
  private failure = false;
  private closed = false;

  constructor(path: string, identity: StageCheckpointIdentity, journal: AgentRunJournal) {
    checkIdentity(identity);
    this.dest = validatePath(path);
    if (existsSync(this.dest)) throw new Error("An existing stage checkpoint must be inspected, not overwritten.");
    this.lockPath = this.dest + ".lock";
    this.lockFd = openSync(this.lockPath, "wx", 0o600);
    try {
      this.data = {
        version: 1, fingerprint: fingerprint(identity), repository: identity.repository,
        baseRef: identity.baseRef, expectedSha: identity.expectedSha.toLowerCase(),
        taskId: journal.taskId, lastSequence: 0, stages: [],
        verifiedActors: [], writeAttempted: false, sealed: false,
      };
      for (const entry of journal.snapshot()) this.apply(entry);
      this.persist();
      this.unsubscribe = journal.subscribe(event => {
        if (this.failure || this.closed) return;
        try { this.apply(event); this.persist(); }
        catch { this.failure = true; }
      });
    } catch (error) {
      closeSync(this.lockFd);
      unlinkSync(this.lockPath);
      throw error;
    }
  }

  private apply(event: AgentRunEvent): void {
    if (this.data.sealed || event.sequence !== this.data.lastSequence + 1)
      throw new Error("Stage journal sequence is invalid.");
    this.data.lastSequence = event.sequence;
    const tool = event.details?.tool;
    if (event.type === "tool_started" || event.type === "tool_completed" || event.type === "tool_failed") {
      if (typeof tool !== "string" || !TOOL_NAME.test(tool) || !ACTOR_NAME.test(event.actor))
        throw new Error("Unrecognized tool or actor metadata.");
      if (event.type === "tool_started") {
        if (this.data.stages.length >= MAX_STAGES) throw new Error("Stage checkpoint receipt budget reached.");
        this.data.stages.push({ actor: event.actor, tool, phase: "in-flight", startedSequence: event.sequence });
        if (WRITE_TOOLS.has(tool) || event.actor === "github") this.data.writeAttempted = true;
      } else {
        const stage = [...this.data.stages].reverse().find(
          item => item.tool === tool && item.actor === event.actor && item.phase === "in-flight");
        if (!stage) throw new Error("Stage completion has no matching started event.");
        stage.phase = event.type === "tool_completed" ? "completed" : "failed";
        stage.finishedSequence = event.sequence;
      }
    }
    if (event.type === "verification_passed" && ACTOR_NAME.test(event.actor) &&
        !this.data.verifiedActors.includes(event.actor)) this.data.verifiedActors.push(event.actor);
  }

  private persist(): void {
    const temp = this.dest + ".tmp." + process.pid;
    try {
      writeFileSync(temp, JSON.stringify(this.data, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      renameSync(temp, this.dest);
    } catch (error) {
      if (existsSync(temp)) unlinkSync(temp);
      throw error;
    }
  }

  assertHealthy(): void {
    if (this.failure) throw new Error("Stage checkpoint persistence failed; stop the task without claiming completion.");
  }

  /** Seal after the SDK run. This records a verdict, not permission to replay tools. */
  finish(outcome: StageCheckpoint["outcome"]): void {
    this.assertHealthy();
    if (this.closed) throw new Error("Stage checkpoint recorder is closed.");
    this.data.outcome = outcome;
    this.data.sealed = true;
    this.persist();
  }

  close(): void {
    if (this.closed) return;
    this.unsubscribe?.();
    this.closed = true;
    closeSync(this.lockFd);
    unlinkSync(this.lockPath);
  }
}

function validateCheckpoint(value: unknown, identity: StageCheckpointIdentity): StageCheckpoint {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Stage checkpoint is malformed.");
  const data = value as StageCheckpoint;
  if (data.version !== 1 || data.fingerprint !== fingerprint(identity) ||
      data.repository !== identity.repository || data.baseRef !== identity.baseRef ||
      data.expectedSha !== identity.expectedSha.toLowerCase() ||
      !Number.isSafeInteger(data.lastSequence) || data.lastSequence < 1 ||
      !Array.isArray(data.stages) || data.stages.length > MAX_STAGES ||
      !Array.isArray(data.verifiedActors) || typeof data.writeAttempted !== "boolean" ||
      typeof data.sealed !== "boolean" ||
      !data.stages.every(stage => stage && ACTOR_NAME.test(stage.actor) && TOOL_NAME.test(stage.tool) &&
        ["in-flight", "completed", "failed"].includes(stage.phase) &&
        Number.isSafeInteger(stage.startedSequence) && stage.startedSequence > 0 &&
        stage.startedSequence <= data.lastSequence)) {
    throw new Error("Stage checkpoint does not match the pinned task or has invalid receipts.");
  }
  return data;
}

/** Never read a checkpoint as proof of CI/security. It is a replay safety record. */
export function inspectStageCheckpoint(path: string, identity: StageCheckpointIdentity): RecoveryAdvice {
  checkIdentity(identity);
  const dest = validatePath(path);
  const data = validateCheckpoint(JSON.parse(readFileSync(dest, "utf8")), identity);
  const summary = { verifiedActors: [...data.verifiedActors], stages: structuredClone(data.stages) };
  if (data.writeAttempted || data.stages.some(stage => WRITE_TOOLS.has(stage.tool) || stage.actor === "github"))
    return { ...summary, decision: "reconcile-github",
      reason: "GitHub changes might already exist. Verify branch head, proposed files and PR before any restart." };
  if (data.stages.some(stage => stage.phase === "in-flight") || !data.sealed)
    return { ...summary, decision: "pause-unknown-outcome",
      reason: "An interrupted or unfinished stage has an unknown outcome; do not replay automatically." };
  if (data.stages.some(stage => stage.phase === "failed"))
    return { ...summary, decision: "pause-failed-tool",
      reason: "A failed tool needs diagnosis before resuming." };
  if (data.stages.some(stage => !READ_ONLY.has(stage.tool)))
    return { ...summary, decision: "manual-artifact-recovery",
      reason: "Coder or specialist outputs need durable artifact validation; metadata alone cannot restore them." };
  if (data.stages.length)
    return { ...summary, decision: "restart-read-only",
      reason: "Only read-only receipts exist. Recheck immutable-SHA Explorer, Security and CI with a new provider; do not reuse these receipts as proof." };
  return { ...summary, decision: "no-work-recorded", reason: "No agent tools were recorded." };
}
