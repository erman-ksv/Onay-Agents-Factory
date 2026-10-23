import { constants, closeSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { TeamTaskStore, type TeamTaskSnapshot } from "./teamTaskStore.js";
import { CALCULATOR_PLAN_ERROR, createCalculatorPlan, prepareCalculatorGoal, calculatorPlanDigest, planObject, planKeys, refuseCalculatorPlan,
  type CalculatorPlan, type CalculatorPlanTask, type PreparedCalculatorGoal, type CalculatorGoalRequest } from "./calculatorPlan.js";
import { scanForSecrets } from "../github/secretScanner.js";
import { CALCULATOR_T02_CHARGE_PIN } from "./calculatorT02ChargeReconciliation.js";
import { inspectCalculatorT02AfterCiEvent } from "./calculatorT02AfterCiEventPreflight.js";
import { assertCalculatorT02InspectedSuccessorPreview,
  type CalculatorT02ReadOnlyPreselection } from "./calculatorT02SuccessorPreview.js";

/** A trusted host callback rechecks actual tools/integration. Model JSON and
 * old receipts cannot supply this authority; full-app acceptance stays separate. */
export type CalculatorDependencyEvidence = {
  repository: string; taskId: string; candidateSha: string; integratedAtSha: string;
  securityReady: true; independentReviewReady: true; taskChecksPassed: true; testsExecuted: true;
};
export type CalculatorSelectionOptions = {
  currentBaseSha: string;
  verifyTask?: (task: CalculatorPlanTask, receipt: TeamTaskSnapshot, currentBaseSha: string) => Promise<CalculatorDependencyEvidence | undefined>;
  /** Read-only historical inspection: NEVER a task-claim or executor permit. */
  inspectedT02?: CalculatorT02ReadOnlyPreselection;
  /** Existing host-owned private barrier directory; read-only inspection only. */
  eventDirectory?: string;
};
export type CalculatorSelection = {
  status: "ready" | "blocked" | "needs-review" | "all-candidates-verified";
  reasonCode: string; task?: CalculatorPlanTask; verifiedTaskIds: string[];
  wholeAppCompleted: false; publicationAuthorized: false;
};
const SHA = /^[a-f0-9]{40}$/;
function missing(error: unknown): boolean { return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT"; }

/** Immutable plan document + existing private TeamTaskStore replay barriers.
 * All metadata is source-free. There is no automatic repair/replay or merge. */
export class CalculatorPlanStore {
  private readonly owner: PreparedCalculatorGoal;
  private readonly request: Readonly<CalculatorGoalRequest>;
  private readonly path: string;
  private readonly rootDev: number;
  private readonly rootIno: number;
  constructor(private readonly directory: string, ownerRequest: unknown) {
    this.owner = prepareCalculatorGoal(ownerRequest);
    this.request = Object.freeze({ version: 1 as const, id: this.owner.id, goal: this.owner.goal,
      baseRef: this.owner.baseRef, baseSha: this.owner.baseSha, provider: this.owner.provider });
    if (!isAbsolute(directory) || resolve(directory) !== directory) refuseCalculatorPlan();
    this.path = join(directory, this.owner.id + ".calculator-plan.json");
    try {
      const probe = new TeamTaskStore(directory, { id: "calc-plan-" + this.owner.id, fingerprint: this.owner.ownerFingerprint }); probe.close();
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 ||
          (process.getuid && stat.uid !== process.getuid())) refuseCalculatorPlan();
      this.rootDev = stat.dev; this.rootIno = stat.ino;
    } catch { throw new Error(CALCULATOR_PLAN_ERROR); }
  }
  private root(): void {
    try {
      const stat = lstatSync(this.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== this.rootDev || stat.ino !== this.rootIno ||
          (stat.mode & 0o777) !== 0o700 || (process.getuid && stat.uid !== process.getuid())) refuseCalculatorPlan();
    } catch { refuseCalculatorPlan(); }
  }
  private marker(): TeamTaskStore {
    this.root();
    return new TeamTaskStore(this.directory, { id: "calc-plan-" + this.owner.id, fingerprint: this.owner.ownerFingerprint });
  }
  private exists(): boolean {
    try { lstatSync(this.path); return true; } catch (error) { if (missing(error)) return false; return refuseCalculatorPlan(); }
  }
  private read(): CalculatorPlan {
    this.root(); let fd: number | undefined;
    try {
      fd = openSync(this.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > 32_768 ||
          (process.getuid && stat.uid !== process.getuid())) refuseCalculatorPlan();
      const raw: unknown = JSON.parse(readFileSync(fd, "utf8"));
      if (!planObject(raw) || !planKeys(raw, ["version", "request", "proposal", "fingerprint"]) || raw.version !== 1 ||
          prepareCalculatorGoal(raw.request).ownerFingerprint !== this.owner.ownerFingerprint) return refuseCalculatorPlan();
      const plan = createCalculatorPlan(this.request, raw.proposal);
      if (plan.fingerprint !== raw.fingerprint) return refuseCalculatorPlan();
      return plan;
    } catch { return refuseCalculatorPlan(); } finally { if (fd !== undefined) closeSync(fd); }
  }
  inspect(): CalculatorPlan | undefined {
    let marker: TeamTaskStore | undefined;
    try {
      marker = this.marker(); const saved = marker.inspectExisting(), exists = this.exists();
      if (!saved && !exists) return undefined;
      if (!saved || !exists || saved.status !== "needs-review" || saved.reasonCode !== "plan_saved_not_execution" ||
          saved.publication || saved.stages.length !== 3 || saved.stages[0].stage !== "save_plan" || saved.stages.some(stage => stage.status !== "passed"))
        return refuseCalculatorPlan();
      const plan = this.read();
      if (saved.stages[1].stage !== "digest_a_" + plan.fingerprint.slice(0, 32) ||
          saved.stages[2].stage !== "digest_b_" + plan.fingerprint.slice(32)) return refuseCalculatorPlan();
      return plan;
    } catch { return refuseCalculatorPlan(); } finally { marker?.close(); }
  }
  initialize(modelResult: unknown): CalculatorPlan {
    const plan = createCalculatorPlan(this.request, modelResult);
    const existing = this.inspect();
    if (existing) { if (existing.fingerprint !== plan.fingerprint) return refuseCalculatorPlan(); return existing; }
    let marker: TeamTaskStore | undefined, fd: number | undefined, temporary: string | undefined;
    try {
      const document = JSON.stringify({ version: 1, request: this.request, proposal: plan.proposal, fingerprint: plan.fingerprint }) + "\n";
      if (Buffer.byteLength(document) > 32_768 || scanForSecrets(document).length) return refuseCalculatorPlan();
      marker = this.marker();
      if (marker.claim() !== "claimed") return refuseCalculatorPlan();
      marker.recordStage("save_plan", "running");
      this.root(); temporary = join(this.directory, ".calc-plan-" + randomBytes(12).toString("hex"));
      fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(fd, document); fsyncSync(fd); closeSync(fd); fd = undefined;
      this.root(); linkSync(temporary, this.path); unlinkSync(temporary); temporary = undefined;
      const rootFd = openSync(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { fsyncSync(rootFd); } finally { closeSync(rootFd); }
      marker.recordStage("save_plan", "passed");
      for (const stage of ["digest_a_" + plan.fingerprint.slice(0, 32), "digest_b_" + plan.fingerprint.slice(32)]) {
        marker.recordStage(stage, "running"); marker.recordStage(stage, "passed");
      }
      marker.finish("needs-review", "plan_saved_not_execution");
      return plan;
    } catch { return refuseCalculatorPlan(); }
    finally {
      if (fd !== undefined) closeSync(fd);
      if (temporary) try { unlinkSync(temporary); } catch { /* Keep fixed diagnostics. */ }
      marker?.close();
    }
  }
  taskReceipt(plan: CalculatorPlan, task: CalculatorPlanTask): TeamTaskStore {
    this.root(); const actual = this.inspect();
    if (!actual || actual.fingerprint !== plan.fingerprint || !actual.tasks.some(item => item.id === task.id)) return refuseCalculatorPlan();
    return new TeamTaskStore(this.directory, { id: "calc-" + task.id,
      fingerprint: calculatorPlanDigest({ planFingerprint: actual.fingerprint, taskId: task.id }) });
  }
  async select(options: CalculatorSelectionOptions): Promise<CalculatorSelection> {
    const plan = this.inspect(); if (!plan || !SHA.test(options.currentBaseSha)) return refuseCalculatorPlan();
    const verified: string[] = [];
    const answer = (status: CalculatorSelection["status"], reasonCode: string, task?: CalculatorPlanTask): CalculatorSelection => ({
      status, reasonCode, ...(task ? { task } : {}), verifiedTaskIds: [...verified], wholeAppCompleted: false, publicationAuthorized: false,
    });
    if (plan.status === "blocked") return answer("blocked", "plan_has_unresolved_blockers");
    const historical = options.inspectedT02;
    if (historical) {
      try { assertCalculatorT02InspectedSuccessorPreview(historical); }
      catch { return answer("needs-review", "historical_publication_unverified"); }
      try {
        if (typeof options.eventDirectory !== "string" ||
            inspectCalculatorT02AfterCiEvent(options.eventDirectory, historical).status !== "not-consumed-read-only")
          return answer("needs-review", "historical_after_ci_event_unverified");
      } catch { return answer("needs-review", "historical_after_ci_event_unverified"); }
      if (historical.status !== "candidate-preview-only" || historical.readOnly !== true ||
          historical.executionAuthorized !== false || historical.publicationAuthorized !== false ||
          historical.resumeAuthorized !== false || historical.budgetResetAuthorized !== false ||
          historical.planFingerprint !== plan.fingerprint ||
          historical.candidateSha !== options.currentBaseSha ||
          historical.previousTaskId !== plan.tasks[1]?.id ||
          historical.nextTaskId !== plan.tasks[2]?.id ||
          !plan.tasks[2]?.dependsOn.includes(historical.previousTaskId))
        return answer("needs-review", "historical_publication_unverified");
    }
    const saved = new Map<string, TeamTaskSnapshot>();
    const originalState = new Map<string, string | undefined>();
    for (const task of plan.tasks) {
      const store = this.taskReceipt(plan, task);
      try {
        const receipt = store.inspectExisting();
        // Historical recovery never trusts a receipt while a writer may still
        // own it, including a crash lock without any receipt.
        if (historical && store.inspectExistingLock()) return answer("needs-review", "historical_task_lock_present");
        if (receipt) saved.set(task.id, receipt);
        if (historical) originalState.set(task.id, receipt ? JSON.stringify(receipt) : undefined);
      } finally { store.close(); }
    }
    if (historical) {
      const original = saved.get(historical.previousTaskId);
      // The exact historical file is canonical JSON plus a final newline.
      // Require the authenticated archive digest, not merely stage labels.
      if (!original || createHash("sha256").update(JSON.stringify(original) + "\n").digest("hex") !==
          CALCULATOR_T02_CHARGE_PIN.originalReceiptSha256)
        return answer("needs-review", "historical_receipt_digest_changed");
    }
    // No recorded/started task is ever selected again, regardless of a status label.
    if ([...saved.values()].some(item => item.status === "running")) return answer("needs-review", "interrupted_or_running_task_no_replay");
    if ([...saved.values()].some(item => item.status === "blocked")) return answer("blocked", "failed_task_requires_explicit_repair");
    if (!saved.size && options.currentBaseSha !== plan.owner.baseSha) return answer("needs-review", "initial_base_changed");
    for (const task of plan.tasks) {
      const receipt = saved.get(task.id); if (!receipt) continue;
      let pub = receipt.publication;
      if (!pub && historical && task.id === historical.previousTaskId) {
        if (receipt.status !== "needs-review" ||
            receipt.reasonCode !== "publication_or_ci_uncertain_inspect_no_replay" ||
            !receipt.stages.some(stage => stage.stage === "host_tests_1" && stage.status === "passed") ||
            !receipt.stages.some(stage => stage.stage === "publish_candidate" && stage.status === "blocked"))
          return answer("needs-review", "historical_publication_unverified");
        pub = { branch: plan.branch, headSha: historical.candidateSha,
          number: 1, url: "https://github.com/" + plan.owner.repository + "/pull/1" };
      }
      if (!pub || pub.branch !== plan.branch || pub.url !== "https://github.com/" + plan.owner.repository + "/pull/" + pub.number ||
          !SHA.test(pub.headSha) || !options.verifyTask) return answer("needs-review", "candidate_needs_fresh_host_verification");
      let evidence: CalculatorDependencyEvidence | undefined;
      try { evidence = await options.verifyTask(task, { ...structuredClone(receipt), publication: pub }, options.currentBaseSha); }
      catch { /* No raw diagnostics. */ }
      if (!evidence || evidence.repository !== plan.owner.repository || evidence.taskId !== task.id ||
          evidence.candidateSha !== pub.headSha || evidence.integratedAtSha !== options.currentBaseSha ||
          evidence.securityReady !== true || evidence.independentReviewReady !== true || evidence.taskChecksPassed !== true || evidence.testsExecuted !== true)
        return answer("needs-review", "dependency_or_candidate_unverified");
      verified.push(task.id);
    }
    if (historical) {
      // A host verification callback is asynchronous: re-check EVERY task,
      // including unclaimed successors, immediately before displaying ready.
      for (const task of plan.tasks) {
        const receipt = this.taskReceipt(plan, task);
        try {
          const present = receipt.inspectExisting();
          if (receipt.inspectExistingLock() ||
              (present ? JSON.stringify(present) : undefined) !== originalState.get(task.id))
            return answer("needs-review", "historical_state_changed_during_verification");
        } finally { receipt.close(); }
      }
    }
    if (historical) {
      // Reinspect the canonical after-CI barrier after asynchronous host checks.
      // An event claimed by a concurrent worker must not appear as "ready".
      try {
        if (inspectCalculatorT02AfterCiEvent(options.eventDirectory!, historical).status !== "not-consumed-read-only")
          return answer("needs-review", "historical_after_ci_event_changed");
      } catch { return answer("needs-review", "historical_after_ci_event_changed"); }
    }
    const next = plan.tasks.find(task => !saved.has(task.id) && task.dependsOn.every(dep => verified.includes(dep)));
    if (next) return answer("ready", "next_task_selected_not_executed", next);
    return verified.length === plan.tasks.length ? answer("all-candidates-verified", "full_app_acceptance_still_required") :
      answer("needs-review", "dependencies_not_ready");
  }
  async claimNext(options: CalculatorSelectionOptions): Promise<{ selection: CalculatorSelection; store?: TeamTaskStore }> {
    // A reconciled historical preview is for display/inspection only. It never
    // grants permission to execute, publish, or issue a new model request.
    if (options.inspectedT02 !== undefined) return {
      selection: { status: "needs-review", reasonCode: "historical_preview_cannot_claim",
        verifiedTaskIds: [], wholeAppCompleted: false, publicationAuthorized: false }
    };
    const selection = await this.select(options);
    if (selection.status !== "ready" || !selection.task) return { selection };
    const plan = this.inspect()!; const store = this.taskReceipt(plan, selection.task);
    try {
      if (store.claim() !== "claimed") {
        store.close(); return { selection: { status: "needs-review", reasonCode: "task_already_recorded_no_replay", verifiedTaskIds: [],
          wholeAppCompleted: false, publicationAuthorized: false } };
      }
      // The receipt is durable before the future host invokes a model/tool.
      return { selection, store };
    } catch { store.close(); return refuseCalculatorPlan(); }
  }
}
