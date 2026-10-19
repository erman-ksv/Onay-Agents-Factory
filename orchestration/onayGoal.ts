/** Host-directed planning batches for one broad owner goal. A finished batch
 * never certifies delivery of the product, merged dependencies or device QA. */
import { closeSync, constants, fstatSync, lstatSync, openSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { prepareGoalRequest, type PreparedGoalRequest, type ValidatedGoalPlan } from "./onayGoalPlan.js";
import { OnayGoalStore, type GoalState } from "./onayGoalStore.js";
import { prepareTeamTask, type TeamTaskCard } from "./teamTaskCard.js";
import type { TeamTaskReport } from "./teamTask.js";
import type { TeamTaskCiVerification } from "./teamTaskVerification.js";

export type GoalReport = {
  goalId: string; fingerprint: string; repository: "erman-ksv/Onay";
  status: "planned" | "waiting" | "blocked" | "batch-candidates-ready";
  reasonCode: string; baseSha: string; cycles: number;
  tasks: Array<{ id: string; status: string; dependsOn: string[]; reasonCode?: string; url?: string }>;
  blockers: string[]; unverifiedAreas: string[];
  wholeAppCompleted: false; mergePerformed: false; legalReview: "disabled";
};
export type GoalDependencies = {
  getHead(ref: string): Promise<string>;
  plan(request: PreparedGoalRequest): Promise<ValidatedGoalPlan>;
  execute(card: TeamTaskCard): Promise<TeamTaskReport>;
  verify(card: TeamTaskCard): Promise<TeamTaskCiVerification>;
};

function report(request: PreparedGoalRequest, state: GoalState, reasonCode: string, extra: string[] = []): GoalReport {
  return {
    goalId: request.id, fingerprint: request.fingerprint, repository: request.repository,
    status: state.status === "completed" ? "batch-candidates-ready" : state.status === "running" ? "waiting" : state.status,
    reasonCode, baseSha: request.baseSha, cycles: state.cycles,
    tasks: state.tasks.map(task => ({ id: task.id, status: task.status, dependsOn: [...task.dependsOn],
      ...(task.reasonCode ? { reasonCode: task.reasonCode } : {}), ...(task.publication ? { url: task.publication.url } : {}) })),
    blockers: [...state.blockers], unverifiedAreas: [
      "This is one planning batch, not a complete product backlog or app acceptance.",
      "Source not shown to the planner is unverified; source citations are not runtime test evidence.",
      "Draft PRs remain unmerged. Dependent tasks require an explicitly integrated, newly pinned base.",
      "Physical Android/iPhone, production, SMS, maps and release acceptance are not proven by these receipts.",
      ...extra,
    ], wholeAppCompleted: false, mergePerformed: false, legalReview: "disabled",
  };
}

/** Repeated plan calls inspect the existing backlog without another model call.
 * A crash before persistence leaves a lock: inspect it, never silently replay. */
export async function planOnayGoal(input: unknown, directory: string, deps: Pick<GoalDependencies, "getHead" | "plan">): Promise<GoalReport> {
  const request = prepareGoalRequest(input);
  const store = new OnayGoalStore(directory, request.id, request.fingerprint);
  const lock = join(directory, request.id + ".goal.planning.lock");
  let fd: number | undefined, saved = false;
  try {
    const existing = store.inspect();
    if (existing) return report(request, existing, "existing_backlog_no_replan");
    fd = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const initial: GoalState = {
      version: 1, goalId: request.id, goalFingerprint: request.fingerprint, repository: request.repository,
      baseRef: request.baseRef, baseSha: request.baseSha, tasks: [], blockers: [], status: "blocked", cycles: 0,
    };
    let reason = "goal_planned", unverified: string[] = [];
    try {
      if (await deps.getHead(request.baseRef) !== request.baseSha) {
        initial.blockers = ["The selected base branch changed; inspect it and pin a new goal snapshot."];
        reason = "base_changed";
      } else {
        const plan = await deps.plan(request);
        initial.tasks = plan.tasks.map(task => ({ id: task.id, card: task.card, dependsOn: [...task.dependsOn], status: "queued" }));
        initial.blockers = [...plan.blockers]; unverified = plan.unverifiedAreas;
        initial.status = plan.status === "planned" ? "planned" : "blocked";
        reason = initial.status === "planned" ? "goal_planned" : "planning_requires_evidence_or_scope_decision";
        if (await deps.getHead(request.baseRef) !== request.baseSha) {
          initial.status = "blocked"; initial.blockers = ["The base moved during planning; do not execute stale tasks."];
          reason = "base_changed";
        }
      }
    } catch {
      initial.tasks = []; initial.status = "blocked";
      initial.blockers = ["Planning failed or its free-tier/context budget was exhausted; inspect provider status and evidence. No automatic replay."];
      reason = "planning_failed_no_retry";
    }
    store.saveInitial(initial); saved = true;
    return report(request, initial, reason, unverified);
  } finally {
    if (fd !== undefined) {
      try {
        if (saved) {
          const held = fstatSync(fd), named = lstatSync(lock);
          if (held.ino !== named.ino || held.dev !== named.dev || !named.isFile() || named.nlink !== 1)
            throw new Error("Planning lock changed; inspect private state.");
          unlinkSync(lock);
        }
      } finally { closeSync(fd); }
    }
    store.close();
  }
}

export function inspectOnayGoal(input: unknown, directory: string): GoalReport {
  const request = prepareGoalRequest(input);
  const store = new OnayGoalStore(directory, request.id, request.fingerprint);
  try {
    const state = store.inspect();
    if (!state) throw new Error("No saved Onay goal. Planning has not completed.");
    return report(request, state, "offline_receipt_inspection_only");
  } finally { store.close(); }
}

/** One continuation performs at most one model-backed task. Pending CI is
 * checked once without polling. No re-Coder, merge or stale dependency replay. */
export async function continueOnayGoal(input: unknown, directory: string, deps: GoalDependencies): Promise<GoalReport> {
  const request = prepareGoalRequest(input);
  const store = new OnayGoalStore(directory, request.id, request.fingerprint);
  try {
    const initial = store.inspect();
    if (!initial) throw new Error("The owner goal must be planned first.");
    if (["blocked", "completed"].includes(initial.status)) return report(request, initial, "batch_terminal_inspect_before_new_batch");
    const state = store.beginCycle();
    let reasonCode = "no_safe_independent_task";
    const finish = (): GoalReport => {
      store.finishCycle();
      return report(request, store.inspect()!, reasonCode);
    };
    const awaiting = state.tasks.find(task => task.status === "awaiting-ci" && task.reasonCode !== "ci_verified_review_required");
    if (awaiting) {
      let verified: TeamTaskCiVerification | undefined;
      try { verified = await deps.verify(awaiting.card); } catch { /* Fixed metadata only. */ }
      const sameCandidate = verified?.candidateSha === awaiting.publication?.headSha && verified?.url === awaiting.publication?.url;
      const passed = verified?.taskId === awaiting.id && verified.status === "ci-verified" && verified.testsExecuted && sameCandidate;
      store.updateTask(awaiting.id, { reasonCode: passed ? "ci_verified_review_required" : "ci_pending_or_unverified" });
      reasonCode = passed ? "ci_verified_prior_execution_and_acceptance_not_reconstructed" : "awaiting_ci_no_polling";
      // CI-only verification must not promote a receipt into proof of prior
      // independent reviewers or product acceptance.
      return finish();
    }
    const publishedPaths = new Set(state.tasks.filter(task => task.publication).flatMap(task => task.card.changePaths));
    const next = state.tasks.find(task => task.status === "queued" && !task.dependsOn.length &&
      !task.card.changePaths.some(path => publishedPaths.has(path)));
    if (!next) {
      for (const task of state.tasks.filter(task => task.status === "queued"))
        store.updateTask(task.id, { reasonCode: "waiting_integration" });
      reasonCode = "dependencies_or_overlapping_draft_require_integrated_base";
      return finish();
    }
    try {
      if (await deps.getHead(request.baseRef) !== request.baseSha) {
        reasonCode = "base_changed_plan_new_snapshot";
        return finish();
      }
    } catch { reasonCode = "base_unverified_no_task_started"; return finish(); }
    store.updateTask(next.id, { status: "running", reasonCode: "bounded_team_task_started" });
    try {
      const result = await deps.execute(next.card);
      const task = prepareTeamTask(next.card);
      if (result.execution !== "live" || result.taskId !== next.id || result.fingerprint !== task.fingerprint ||
          result.repository !== request.repository || result.baseSha !== request.baseSha || result.branch !== task.branch)
        throw new Error("Task evidence identity does not match the host backlog.");
      const publication = result.publication ? { ...result.publication, branch: task.branch } : undefined;
      const complete = result.status === "completed" && !!publication && result.testedSha === publication.headSha &&
        result.gates.security && result.gates.policyReview && result.gates.testsExecuted && result.gates.independentAdvice;
      const status = complete ? "completed" : publication && result.status === "needs-review" ? "awaiting-ci" : "blocked";
      store.updateTask(next.id, { status, ...(publication ? { publication } : {}),
        reasonCode: complete ? "candidate_verified_not_merged" : status === "awaiting-ci" ? "candidate_awaiting_ci" : "task_blocked_no_replay" });
      reasonCode = complete ? "one_candidate_verified" : status === "awaiting-ci" ? "candidate_saved_awaiting_ci" : "task_blocked_no_replay";
    } catch {
      store.updateTask(next.id, { status: "blocked", reasonCode: "task_interrupted_inspect_receipts_and_github" });
      reasonCode = "task_interrupted_no_replay";
    }
    return finish();
  } finally { store.close(); }
}
