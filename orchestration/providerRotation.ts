/**
 * Quota-aware, checkpointed provider rotation for READ-ONLY Commander audits.
 *
 * This is deliberately NOT a general agent-run replay engine. A fresh model
 * run can replay tool calls; only read-only and host-pinned audits may rotate.
 * Change/publish tasks must stop and reconcile their GitHub state first.
 */
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, dirname, resolve } from "node:path";
import { selectProviderConfig } from "../commander/providerConfig.js";
import { isReadOnlyRepositoryAudit } from "../commander/planner.js";
import { assertCommitSha, assertValidBranchRef } from "../github/githubClient.js";

export const ROTATION_ORDER = ["cloudflare", "groq", "gemini"] as const;
export type RotationProvider = typeof ROTATION_ORDER[number];
export type SafeToolName = "explore_onay" | "security_review" | "test_onay";

export type RotationRunResult = {
  status: string;
  reasons: string[];
  missingActors?: string[];
  providerFailure?: { provider?: string; code?: string };
  upstreamRateLimitVerified?: boolean;
  evidence?: {
    repository?: string; baseSha?: string; testsExecuted?: boolean;
    tests?: { status?: string; testsExecuted?: boolean; expectedSha?: string; repository?: string; evidence?: Array<{ headSha: string; conclusion: string | null }> };
    security?: { repository?: { status?: string } };
    changedFiles?: string[]; proposedFiles?: string[];
    publicationAttempted?: boolean; publication?: unknown;
  };
  events?: Array<{ type: string; details?: { tool?: string } }>;
};

export type RotationAttempt = {
  provider: RotationProvider;
  outcome: "running" | "quota" | "completed" | "blocked";
  verifiedTools: SafeToolName[];
};
export type RotationCheckpoint = {
  version: 1;
  fingerprint: string;
  repository: string;
  expectedSha: string;
  status: "running" | "completed" | "blocked" | "exhausted" | "paused";
  attempts: RotationAttempt[];
};
export type RotationDecision = {
  status: RotationCheckpoint["status"];
  provider?: RotationProvider;
  reason: string;
  attempts: RotationAttempt[];
  checkpointPath: string;
};

const SAFE_TOOLS = new Set<string>(["explore_onay", "security_review", "test_onay"]);
const FORBIDDEN_TOOLS = new Set<string>(["code_onay", "publish_change_set", "final_review", "write_candidate", "verify_final_head"]);

function snapshotTools(result: RotationRunResult): SafeToolName[] {
  const events = result.events ?? [];
  return [...new Set(events
    .filter(event => event.type === "tool_completed" && SAFE_TOOLS.has(event.details?.tool ?? ""))
    .map(event => event.details!.tool as SafeToolName))];
}

function mayBeReadOnly(result: RotationRunResult): boolean {
  const evidence = result.evidence;
  if (evidence?.publicationAttempted || evidence?.publication ||
      (evidence?.changedFiles?.length ?? 0) > 0 || (evidence?.proposedFiles?.length ?? 0) > 0) return false;
  return !(result.events ?? []).some(event =>
    (event.type === "tool_started" || event.type === "tool_completed") &&
    FORBIDDEN_TOOLS.has(event.details?.tool ?? ""));
}

/** Only provider errors may trigger rotation. GitHub 429 is NOT a model quota. */
export function isModelQuotaFailure(result: RotationRunResult, provider: RotationProvider): boolean {
  if (result.status !== "blocked" || !mayBeReadOnly(result)) return false;
  if ((result.events ?? []).some(event => event.type === "tool_failed")) return false;
  if (provider === "groq") return result.upstreamRateLimitVerified === true &&
    result.providerFailure?.provider === "groq" && result.providerFailure.code === "rate_limited";
  // Cloudflare 429 must be observed by the outbound model transport, never
  // inferred from untrusted SDK/model text or local per-run budgets.
  if (provider === "cloudflare") return result.upstreamRateLimitVerified === true && !result.providerFailure;
  const reasons = result.reasons.join(" ");
  if (/\bgithub\b|\bsecurity\b|\brepository api\b/i.test(reasons)) return false;
  if (provider === "gemini" && result.upstreamRateLimitVerified === true &&
      /Gemini daily request quota exhausted/i.test(reasons)) return true;
  return false; // Other providers require structured, transport-grounded quota evidence.
}

function verifiedAudit(result: RotationRunResult, repo: string, sha: string): boolean {
  return result.status === "completed" && result.reasons.length === 0 &&
    (result.missingActors?.length ?? 0) === 0 &&
    mayBeReadOnly(result) && result.evidence?.repository === repo &&
    result.evidence?.baseSha?.toLowerCase() === sha.toLowerCase() &&
    result.evidence?.security?.repository?.status === "clean" &&
    result.evidence?.testsExecuted === true &&
    result.evidence?.tests?.status === "passed" &&
    result.evidence?.tests?.testsExecuted === true &&
    result.evidence?.tests?.expectedSha?.toLowerCase() === sha.toLowerCase() &&
    result.evidence?.tests?.repository === repo &&
    (result.evidence?.tests?.evidence?.length ?? 0) > 0 &&
    result.evidence!.tests!.evidence!.every(run => run.headSha.toLowerCase() === sha.toLowerCase() && run.conclusion === "success") &&
    (result.evidence?.changedFiles?.length ?? 0) === 0 &&
    (result.evidence?.proposedFiles?.length ?? 0) === 0 &&
    ["explore_onay", "security_review", "test_onay"].every(name =>
      snapshotTools(result).includes(name as SafeToolName));
}

function safeCheckpointFile(path: string): string {
  if (!isAbsolute(path)) throw new Error("Checkpoint path must be absolute.");
  const resolved = resolve(path);
  const parent = dirname(resolved);
  if (!existsSync(parent) || !lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink())
    throw new Error("Checkpoint parent must be an existing non-symlink directory.");
  if (resolved.split("/").some(part => [".git", "node_modules", ".github"].includes(part)))
    throw new Error("Checkpoint must be outside repository metadata, workflow and dependencies.");
  if (existsSync(resolved) && (!lstatSync(resolved).isFile() || lstatSync(resolved).isSymbolicLink()))
    throw new Error("Checkpoint must be a regular file, not a symlink.");
  return resolved;
}

function writeCheckpoint(path: string, data: RotationCheckpoint) {
  const temp = path + ".tmp." + process.pid;
  try {
    writeFileSync(temp, JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temp, path);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

function readCheckpoint(path: string, fingerprint: string): RotationCheckpoint | undefined {
  if (!existsSync(path)) return undefined;
  const current: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!current || typeof current !== "object" || Array.isArray(current))
    throw new Error("Checkpoint is invalid; stop and inspect.");
  const data = current as RotationCheckpoint;
  if (data.version !== 1 || data.fingerprint !== fingerprint || !Array.isArray(data.attempts) ||
    !ROTATION_ORDER.every(name => data.attempts.filter(entry => entry.provider === name).length <= 1)) {
    throw new Error("Checkpoint does not match this immutable task; stop without API calls.");
  }
  if (!data.attempts.every(entry => ROTATION_ORDER.includes(entry.provider) &&
    ["running", "quota", "completed", "blocked"].includes(entry.outcome) &&
    Array.isArray(entry.verifiedTools))) {
    throw new Error("Checkpoint contains invalid attempts; stop without API calls.");
  }
  return data;
}

export async function rotateReadOnlyAudit(input: {
  goal: string;
  repository: string;
  baseRef: string;
  baseSha: string;
  checkpointPath: string;
  env: NodeJS.ProcessEnv;
  /** Injected for offline tests; real CLI uses runAiCommander. */
  run: (provider: RotationProvider, env: NodeJS.ProcessEnv) => Promise<RotationRunResult>;
}): Promise<RotationDecision> {
  if (!isReadOnlyRepositoryAudit(input.goal) || input.env.AGENT_FACTORY_ENABLE_GITHUB_WRITES === "true")
    throw new Error("Rotation is restricted to read-only tasks with GitHub writes disabled.");
  if (input.env.AGENT_FACTORY_LEGAL_ENABLED === "true")
    throw new Error("This bounded read-only rotation requires legal agent disabled.");
  assertValidBranchRef(input.baseRef);
  assertCommitSha(input.baseSha);
  if (!/^[\w.-]+\/[\w.-]+$/.test(input.repository))
    throw new Error("A specific approved repository is required.");
  const path = safeCheckpointFile(input.checkpointPath);
  const fingerprint = createHash("sha256").update(JSON.stringify([
    input.goal, input.repository, input.baseRef, input.baseSha.toLowerCase(),
  ])).digest("hex");
  // The lock is fail-closed: a crash leaves a lock for manual inspection,
  // preventing two workers from replaying the same task.
  const lockPath = path + ".lock";
  const lock = openSync(lockPath, "wx", 0o600);
  try {
    let state = readCheckpoint(path, fingerprint) ?? {
      version: 1 as const, fingerprint, repository: input.repository,
      expectedSha: input.baseSha.toLowerCase(), status: "running" as const,
      attempts: [] as RotationAttempt[],
    };
    const decision = (status: RotationCheckpoint["status"], reason: string, provider?: RotationProvider): RotationDecision =>
      ({ status, reason, ...(provider ? { provider } : {}), attempts: structuredClone(state.attempts), checkpointPath: path });
    if (state.status !== "running") return decision(state.status, "Previous checkpoint is terminal. Inspect its evidence; no rerun.");
    if (state.attempts.some(attempt => attempt.outcome === "running")) {
      state.status = "paused";
      writeCheckpoint(path, state);
      return decision("paused", "An interrupted attempt requires manual reconciliation; no automatic replay.");
    }
    let configured = 0;
    for (const provider of ROTATION_ORDER) {
      if (state.attempts.some(attempt => attempt.provider === provider)) continue;
      const env = { ...input.env, AGENT_FACTORY_PROVIDER: provider,
        AGENT_FACTORY_ENABLE_GITHUB_WRITES: "false", AGENT_FACTORY_LEGAL_ENABLED: "false" };
      const selected = selectProviderConfig(env);
      if (selected.provider !== provider) continue;
      configured++;
      const attempt: RotationAttempt = { provider, outcome: "running", verifiedTools: [] };
      state.attempts.push(attempt);
      writeCheckpoint(path, state);
      let result: RotationRunResult;
      try {
        result = await input.run(provider, env);
      } catch {
        attempt.outcome = "blocked";
        state.status = "blocked";
        writeCheckpoint(path, state);
        return decision("blocked", "Runner raised an unexpected error; inspect before restart.", provider);
      }
      attempt.verifiedTools = snapshotTools(result);
      if (!mayBeReadOnly(result)) {
        attempt.outcome = "blocked";
        state.status = "blocked";
        writeCheckpoint(path, state);
        return decision("blocked", "Unexpected mutation/write evidence; do not replay this task.", provider);
      }
      if (verifiedAudit(result, input.repository, input.baseSha)) {
        attempt.outcome = "completed";
        state.status = "completed";
        writeCheckpoint(path, state);
        return decision("completed", "Verified exact-commit read-only audit, without any writes.", provider);
      }
      if (isModelQuotaFailure(result, provider)) {
        attempt.outcome = "quota";
        writeCheckpoint(path, state);
        continue;
      }
      attempt.outcome = "blocked";
      state.status = "blocked";
      writeCheckpoint(path, state);
      return decision("blocked", "Audit was not verified; non-quota failure requires investigation.", provider);
    }
    state.status = configured || state.attempts.length ? "exhausted" : "blocked";
    writeCheckpoint(path, state);
    return decision(state.status, configured || state.attempts.length ?
      "No more qualified providers are available for this run; no paid fallback." :
      "No approved provider key is configured; no API requests sent.");
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}
