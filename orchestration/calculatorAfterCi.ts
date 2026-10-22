import { createHash } from "node:crypto";
import { evaluateTestExecutionEvidence } from "../agents/tester/agent.js";
import type { createCalculatorCiReader, CalculatorCiEvidence, CalculatorWorkflowPin } from "../github/calculatorCi.js";
import type { CalculatorSnapshotReader } from "../github/calculatorSnapshot.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { runCalculatorExecution, type CalculatorExecutionReport } from "./calculatorExecution.js";
import { openCalculatorWorkspace, selectCalculatorWorkspaceTask, assertCalculatorWorkspaceCurrent,
  type CalculatorCheckRunner, type CalculatorCurrentChecks } from "./calculatorWorkspace.js";
import { TeamTaskStore, type TeamTaskSnapshot } from "./teamTaskStore.js";

export const CALCULATOR_AFTER_CI_ERROR = "Calculator after-CI transition refused; preserve prior receipts and charges. No replay is authorized.";
export type CalculatorAfterCiRequest = Readonly<{
  version: 1; planFingerprint: string; previousTaskId: string; candidateSha: string; expectedNextTaskId: string;
}>;
export type CalculatorAfterCiReport = Readonly<{
  status: "blocked" | "needs-review" | "advanced"; reasonCode: string; execution?: CalculatorExecutionReport;
  wholeAppCompleted: false; legalEnabled: false;
}>;
type Execution = Omit<Parameters<typeof runCalculatorExecution>[1], "verifyDependencies" | "restoreProposal" | "restoreAssessments">;
export type CalculatorAfterCiOptions = Readonly<{
  /** Stable, preserved private directory shared by every delivery of this transition.
   * A new empty directory is not a retry/resume mechanism. The host restores it. */
  eventDirectory: string;
  /** Host-owned pinned GitHub reader, never an owner/model-supplied success JSON. */
  ci: ReturnType<typeof createCalculatorCiReader>;
  /** Verifies authenticated saved assessments, unchanged sources and actual host
   * tests. Receipt stage labels alone never establish this evidence. */
  verifyDependencies: CalculatorCheckRunner;
  execution: Execution;
}>;
const SHA = /^[a-f0-9]{40}$/, DIGEST = /^[a-f0-9]{64}$/, ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function refuse(): never { throw Error(CALCULATOR_AFTER_CI_ERROR); }
function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
export function prepareCalculatorAfterCiRequest(value: unknown): CalculatorAfterCiRequest {
  const fields = ["version", "planFingerprint", "previousTaskId", "candidateSha", "expectedNextTaskId"];
  if (!plain(value) || Reflect.ownKeys(value).length !== fields.length ||
      !fields.every(key => Object.hasOwn(value, key) && "value" in Object.getOwnPropertyDescriptor(value, key)!) ||
      value.version !== 1 || typeof value.planFingerprint !== "string" || !DIGEST.test(value.planFingerprint) ||
      typeof value.previousTaskId !== "string" || !ID.test(value.previousTaskId) ||
      typeof value.expectedNextTaskId !== "string" || !ID.test(value.expectedNextTaskId) ||
      value.previousTaskId === value.expectedNextTaskId || typeof value.candidateSha !== "string" || !SHA.test(value.candidateSha)) return refuse();
  return Object.freeze({ version: 1, planFingerprint: value.planFingerprint, previousTaskId: value.previousTaskId,
    candidateSha: value.candidateSha, expectedNextTaskId: value.expectedNextTaskId });
}
function validPrevious(receipt: TeamTaskSnapshot | undefined, branch: string, repository: string, candidate: string): boolean {
  if (!receipt || receipt.status !== "needs-review" ||
      !["candidate_ci_pending_no_polling", "task_candidate_verified_not_whole_app"].includes(receipt.reasonCode ?? "") ||
      receipt.publication?.branch !== branch || receipt.publication.headSha !== candidate ||
      receipt.publication.url !== "https://github.com/" + repository + "/pull/" + receipt.publication.number) return false;
  const passed = (name: string) => receipt.stages.some(stage => stage.stage === name && stage.status === "passed");
  // Shape/replay checks only. Actual assessment/test authority comes from the
  // authenticated host dependency verifier below, independently of these labels.
  return passed("load_current_source") && passed("publish_candidate") && passed("verify_candidate_ci") &&
    [1, 2].some(attempt => (passed("generate_" + attempt) || passed("restore_proposal_" + attempt) ||
      (attempt === 2 && passed("repair_2"))) &&
      ["security", "reviewer", "tester"].every(role => passed(role + "_" + attempt) || passed("restore_" + role + "_" + attempt)) &&
      passed("host_tests_" + attempt));
}
function positiveCi(evidence: CalculatorCiEvidence, repository: string, branch: string, sha: string): boolean {
  if (!evidence || evidence.repository !== repository || evidence.branch !== branch || evidence.candidateSha !== sha ||
      evidence.provenance?.candidateSha !== sha || !Array.isArray(evidence.runs) || !Array.isArray(evidence.jobs) ||
      !Array.isArray(evidence.provenance.workflowPins) ||
      !evidence.provenance.workflowPins.some((pin: CalculatorWorkflowPin) => pin.path === ".github/workflows/calculator-task-ci.yml" &&
        Number.isSafeInteger(pin.id) && pin.id > 0 && SHA.test(pin.blobSha)) ||
      !Array.isArray(evidence.provenance.verifiedRunIds) ||
      evidence.provenance.verifiedRunIds.some((id: number) => !Number.isSafeInteger(id) || id < 1) ||
      new Set(evidence.provenance.verifiedRunIds).size !== evidence.provenance.verifiedRunIds.length ||
      evidence.runs.some(run => run.head_sha !== sha || run.html_url !== "https://github.com/" + repository + "/actions/runs/" + run.id)) return false;
  const taskRuns = evidence.runs.filter(run => run.name === "Calculator task CI");
  if (!taskRuns.length || taskRuns.some(run => !evidence.provenance.verifiedRunIds.includes(run.id))) return false;
  const checks = evaluateTestExecutionEvidence(evidence.runs, evidence.jobs, sha, ["Calculator task CI"], ["Syntax", "Task tests"]);
  return checks.status === "passed" && checks.testsExecuted;
}

/** One host-admitted late-CI transition. It neither subscribes to GitHub events
 * nor starts a project loop. The immutable event identity excludes run ID/attempt:
 * a rerun of the same candidate cannot advance a second task. */
export async function runCalculatorAfterCi(store: CalculatorPlanStore, reader: CalculatorSnapshotReader,
  input: unknown, options: CalculatorAfterCiOptions): Promise<CalculatorAfterCiReport> {
  const answer = (status: CalculatorAfterCiReport["status"], reasonCode: string,
    execution?: CalculatorExecutionReport): CalculatorAfterCiReport => Object.freeze({ status, reasonCode,
      ...(execution ? { execution } : {}), wholeAppCompleted: false, legalEnabled: false });
  let barrier: TeamTaskStore | undefined, claimed = false;
  try {
    const request = prepareCalculatorAfterCiRequest(input), plan = store.inspect();
    if (!plan || plan.status !== "planned" || plan.fingerprint !== request.planFingerprint ||
        !plan.tasks.some(task => task.id === request.previousTaskId) ||
        !plan.tasks.some(task => task.id === request.expectedNextTaskId) || !options ||
        typeof options.ci !== "function" || typeof options.verifyDependencies !== "function" || !plain(options.execution) ||
        ["restoreProposal", "restoreAssessments", "verifyDependencies"].some(key => Object.hasOwn(options.execution, key)) ||
        options.execution.maxRepairs !== 0) return answer("blocked", "after_ci_configuration_unverified");
    const identity = { planFingerprint: plan.fingerprint, previousTaskId: request.previousTaskId, candidateSha: request.candidateSha };
    barrier = new TeamTaskStore(options.eventDirectory, { id: "calc-after-ci-" + digest(identity).slice(0, 48), fingerprint: digest(request) });
    // A duplicate stops before CI/dependency/model callbacks. An interrupted
    // running event is also consumed; no receipt is overwritten or removed.
    if (barrier.inspectExisting()) return answer("needs-review", "after_ci_event_already_recorded_no_replay");
    const previousTask = plan.tasks.find(task => task.id === request.previousTaskId)!;
    const previous = (): TeamTaskSnapshot | undefined => {
      const receipt = store.taskReceipt(plan, previousTask);
      try { return receipt.inspectExisting(); } finally { receipt.close(); }
    };
    const prior = previous();
    if (!validPrevious(prior, plan.branch, plan.owner.repository, request.candidateSha))
      return answer("blocked", "after_ci_previous_candidate_unverified");
    if (await reader.getHead(plan.branch) !== request.candidateSha) return answer("needs-review", "after_ci_candidate_no_longer_current");
    const ciInput = { repository: plan.owner.repository, branch: plan.branch, candidateSha: request.candidateSha };
    if (!positiveCi(await options.ci(ciInput), plan.owner.repository, plan.branch, request.candidateSha))
      return answer("needs-review", "after_ci_required_checks_unverified");
    const workspace = await openCalculatorWorkspace(store, reader, plan.branch, request.candidateSha);
    const proofs = new Map<string, CalculatorCurrentChecks>();
    let selecting = true;
    const verify: CalculatorCheckRunner = async evidence => {
      await assertCalculatorWorkspaceCurrent(workspace);
      if (evidence.repository !== plan.owner.repository || evidence.planFingerprint !== plan.fingerprint ||
          evidence.currentSha !== request.candidateSha || evidence.changedSinceCandidate.length) return undefined;
      const key = digest(evidence), cached = proofs.get(key);
      if (cached) return { ...cached };
      // Newly appeared receipts after preselection cannot silently promote a
      // different task. Only proofs freshly checked during this admission survive.
      if (!selecting) return undefined;
      const proof = await options.verifyDependencies(evidence);
      await assertCalculatorWorkspaceCurrent(workspace);
      if (!proof || proof.repository !== evidence.repository || proof.planFingerprint !== evidence.planFingerprint ||
          proof.taskId !== evidence.task.id || proof.candidateSha !== evidence.candidateSha || proof.currentSha !== evidence.currentSha ||
          proof.securityReady !== true || proof.independentReviewReady !== true || proof.taskChecksPassed !== true || proof.testsExecuted !== true) return undefined;
      proofs.set(key, Object.freeze({ ...proof })); return { ...proof };
    };
    const selection = await selectCalculatorWorkspaceTask(workspace, verify); selecting = false;
    if (selection.status !== "ready" || selection.task?.id !== request.expectedNextTaskId ||
        !selection.verifiedTaskIds.includes(request.previousTaskId)) return answer("needs-review", "after_ci_next_task_not_ready");
    // Dependency checks can take time. Fresh API evidence and head are checked
    // again before consuming the transition or making any next-task model call.
    if (!positiveCi(await options.ci(ciInput), plan.owner.repository, plan.branch, request.candidateSha))
      return answer("needs-review", "after_ci_required_checks_changed");
    await assertCalculatorWorkspaceCurrent(workspace);
    if (digest(previous()) !== digest(prior)) return answer("blocked", "after_ci_previous_receipt_changed");
    if (barrier.claim() !== "claimed") return answer("needs-review", "after_ci_event_already_recorded_no_replay");
    claimed = true; barrier.recordStage("execute_next_task", "running");
    const execution = options.execution, assertTask = (id: string) => { if (id !== request.expectedNextTaskId) return refuse(); };
    const result = await runCalculatorExecution(workspace, { ...execution, verifyDependencies: verify,
      team: {
        generate: async (saved, id, snapshot) => { assertTask(id); return execution.team.generate(saved, id, snapshot); },
        repair: async (saved, id, snapshot, repair) => { assertTask(id); return execution.team.repair(saved, id, snapshot, repair); },
        assess: async (role, saved, id, changes) => { assertTask(id); return execution.team.assess(role, saved, id, changes); },
      },
      checkpoint: async event => { assertTask(event.taskId); await execution.checkpoint?.(event); },
    });
    if (result.taskId && result.taskId !== request.expectedNextTaskId) return refuse();
    barrier.recordStage("execute_next_task", result.status === "blocked" ? "blocked" : "passed");
    barrier.finish(result.status === "blocked" ? "blocked" : "needs-review", "after_ci_one_task_consumed_no_replay");
    return answer(result.status === "blocked" ? "blocked" : result.taskId ? "advanced" : "needs-review",
      "after_ci_one_task_finished_not_whole_app", result);
  } catch {
    if (claimed) try { barrier!.finish("blocked", "after_ci_interrupted_no_replay"); } catch { /* Preserve the earliest durable barrier. */ }
    return answer("blocked", "after_ci_transition_unverified_no_replay");
  } finally { barrier?.close(); }
}
