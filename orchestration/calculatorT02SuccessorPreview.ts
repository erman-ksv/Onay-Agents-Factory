/** Read-only, fixed-history successor preselection for Calculator t02 -> t03.
 * This module NEVER claims a task or calls a model. It also NEVER converts a
 * reconciliation sidecar into a publication/CI/execution authorization.
 * Independent durable event persistence and a live runtime adapter are absent.
 */
import { CALCULATOR_T02_CHARGE_PIN as PIN } from "./calculatorT02ChargeReconciliation.js";
import { assertCalculatorT02InspectedReadOnlyHandoff,
  type CalculatorT02ReadOnlyHandoff } from "./calculatorT02ReadOnlyHandoff.js";
import { inspectCalculatorT02ReconciliationSidecar } from "./calculatorT02ReconciliationSidecar.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import type { CalculatorSnapshotReader } from "../github/calculatorSnapshot.js";
import type { CalculatorCheckRunner } from "./calculatorWorkspace.js";

export const CALCULATOR_T02_PRESELECTION_ERROR =
  "Calculator t02 successor preselection refused; no replay, publication or next-task claim is authorized.";
const refuse = (): never => { throw Error(CALCULATOR_T02_PRESELECTION_ERROR); };
const PLAN = "1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2";
const T01 = "calculator-pilot-step7-v1-34ee03-t01";
const T02 = "calculator-pilot-step7-v1-34ee03-t02";
const T03 = "calculator-pilot-step7-v1-34ee03-t03";
const BASE = "5c4bc71b3119a50d2ca7ce1dbdf12bcaa000ce75";
const REPO = "erman-ksv/Onay-Factory-Calculator";
const SHA = /^[a-f0-9]{40}$/;

export type CalculatorT02ReadOnlyPreselection = Readonly<{
  status: "candidate-preview-only";
  previousTaskId: typeof T02; nextTaskId: typeof T03;
  planFingerprint: typeof PLAN; candidateSha: string;
  conservativePriorCharges: typeof PIN.conservative;
  readOnly: true; executionAuthorized: false; publicationAuthorized: false;
  resumeAuthorized: false; budgetResetAuthorized: false;
  wholeStep8Closed: false;
}>;
/** The host dependency verifier must re-run checks against committed source,
 * not replay model summaries; this callback is never supplied by a model.
 * A positive result remains only a PREVIEW, not an after-CI event claim.
 */
export async function previewCalculatorT02Successor(store: CalculatorPlanStore,
  reader: CalculatorSnapshotReader, sidecarDirectory: string,
  checked: CalculatorT02ReadOnlyHandoff, verifyDependencies: CalculatorCheckRunner
): Promise<CalculatorT02ReadOnlyPreselection> {
  try {
    assertCalculatorT02InspectedReadOnlyHandoff(checked);
    if (!reader || !store || typeof verifyDependencies !== "function" ||
        checked.taskId !== T02 || checked.planFingerprint !== PLAN ||
        checked.candidateSha !== PIN.candidateSha ||
        checked.originalReceiptSha256 !== PIN.originalReceiptSha256 ||
        checked.readOnly !== true || checked.nextTaskAuthorized !== false ||
        checked.publicationAuthorized !== false || checked.resumeAuthorized !== false) return refuse();
    const sidecar = inspectCalculatorT02ReconciliationSidecar(sidecarDirectory);
    if (!sidecar || sidecar.status !== "already-recorded" ||
        sidecar.candidateSha !== checked.candidateSha ||
        sidecar.originalReceiptSha256 !== checked.originalReceiptSha256 ||
        sidecar.successorAuthorized !== false || sidecar.resumeAuthorized !== false) return refuse();

    const plan = store.inspect();
    if (!plan || plan.status !== "planned" || plan.fingerprint !== PLAN ||
        plan.owner.repository !== REPO || plan.owner.baseSha !== "2c1218f2b020962ad93adf68d902a847271a7e72" ||
        plan.tasks.length !== 5 || plan.tasks[0]?.id !== T01 ||
        plan.tasks[1]?.id !== T02 || plan.tasks[2]?.id !== T03 ||
        !plan.tasks[1].dependsOn.includes(T01) ||
        !plan.tasks[2].dependsOn.includes(T02) ||
        !plan.tasks[2].acceptanceIds.includes("keyboard")) return refuse();
    if (await reader.getHead(plan.branch) !== PIN.candidateSha) return refuse();

    const t01 = store.taskReceipt(plan, plan.tasks[0]);
    const t02 = store.taskReceipt(plan, plan.tasks[1]);
    let previous;
    try {
      const first = t01.inspectExisting();
      const second = t02.inspectExisting();
      if (!first || !second || t01.inspectExistingLock() || t02.inspectExistingLock() ||
          first.status !== "needs-review" ||
          !["candidate_ci_pending_no_polling","task_candidate_verified_not_whole_app"].includes(first.reasonCode ?? "") ||
          first.publication?.headSha !== BASE ||
          first.publication.branch !== plan.branch ||
          first.publication.url !== "https://github.com/" + REPO + "/pull/1" ||
          second.status !== "needs-review" ||
          second.reasonCode !== "publication_or_ci_uncertain_inspect_no_replay" ||
          !!second.publication ||
          !second.stages.some(s => s.stage === "host_tests_1" && s.status === "passed") ||
          !second.stages.some(s => s.stage === "publish_candidate" && s.status === "blocked")) return refuse();
      previous = [first, second] as const;
    } finally { t01.close(); t02.close(); }
    // Another attempt, even at a later task, requires explicit inspection.
    // Do not silently claim the next task when any subsequent receipt or
    // incomplete crash-lock exists.
    for (const task of plan.tasks.slice(2)) {
      const receipt = store.taskReceipt(plan, task);
      try {
        if (receipt.inspectExisting() || receipt.inspectExistingLock()) return refuse();
      } finally { receipt.close(); }
    }
    const candidate = await reader.readCommit(PIN.candidateSha);
    const parent = await reader.readCommit(BASE);
    if (candidate.sha !== PIN.candidateSha || !SHA.test(candidate.treeSha) ||
        !Array.isArray(candidate.parents) || candidate.parents.length !== 1 || candidate.parents[0] !== BASE ||
        parent.sha !== BASE || !SHA.test(parent.treeSha)) return refuse();
    const [now, before] = await Promise.all([reader.readTree(candidate.treeSha),reader.readTree(parent.treeSha)]);
    if (now.truncated !== false || before.truncated !== false ||
        now.sha !== candidate.treeSha || before.sha !== parent.treeSha ||
        now.tree.length > 512 || before.tree.length > 512 ||
        new Set(now.tree.map(e => e.path)).size !== now.tree.length ||
        new Set(before.tree.map(e => e.path)).size !== before.tree.length) return refuse();
    const cur = new Map(now.tree.map(e=>[e.path,e]));
    const old = new Map(before.tree.map(e=>[e.path,e]));
    const unchanged = plan.tasks[0].paths;
    const changed = plan.tasks[1].paths;
    if (unchanged.some(path => !cur.get(path) || !old.get(path) ||
        cur.get(path)!.sha !== old.get(path)!.sha ||
        cur.get(path)!.mode !== "100644" || old.get(path)!.mode !== "100644") ||
        changed.some(path => !cur.get(path) || cur.get(path)!.type !== "blob" ||
        cur.get(path)!.mode !== "100644" ||
        cur.get(path)!.sha === old.get(path)?.sha)) return refuse();
    // No unrelated blob or workflow modifications may be incorporated.
    const currentFiles = new Map(now.tree.filter(e=>e.type==="blob").map(e=>[e.path,e.sha]));
    const oldFiles = new Map(before.tree.filter(e=>e.type==="blob").map(e=>[e.path,e.sha]));
    const difference = [...new Set([...currentFiles.keys(),...oldFiles.keys()])]
      .filter(path=>currentFiles.get(path)!==oldFiles.get(path)).sort();
    if (JSON.stringify(difference)!==JSON.stringify([...changed].sort())) return refuse();

    for (const [index, taskId] of [T01,T02].entries()) {
      const task=plan.tasks[index]!;
      const candidateSha=index===0?BASE:PIN.candidateSha;
      const input=Object.freeze({
        repository:REPO, planFingerprint:PLAN, task, candidateSha,
        currentSha:PIN.candidateSha, changedSinceCandidate:Object.freeze([] as string[]),
      });
      const proof=await verifyDependencies(input);
      if (!proof || proof.repository!==REPO || proof.planFingerprint!==PLAN ||
          proof.taskId!==taskId || proof.candidateSha!==candidateSha ||
          proof.currentSha!==PIN.candidateSha || proof.securityReady!==true ||
          proof.independentReviewReady!==true || proof.taskChecksPassed!==true ||
          proof.testsExecuted!==true) return refuse();
      if (await reader.getHead(plan.branch)!==PIN.candidateSha) return refuse();
    }
    // The original marker and task receipts must remain stable throughout the
    // asynchronous checks. Do not serialize this view as execution authority.
    for (const [index, saved] of previous.entries()) {
      const receipt=store.taskReceipt(plan,plan.tasks[index]!);
      try {
        if (JSON.stringify(receipt.inspectExisting())!==JSON.stringify(saved) ||
            receipt.inspectExistingLock()) return refuse();
      } finally { receipt.close(); }
    }
    if (inspectCalculatorT02ReconciliationSidecar(sidecarDirectory)?.status !== "already-recorded" ||
        await reader.getHead(plan.branch)!==PIN.candidateSha) return refuse();
    return Object.freeze({
      status:"candidate-preview-only" as const, previousTaskId:T02, nextTaskId:T03,
      planFingerprint:PLAN, candidateSha:PIN.candidateSha,
      conservativePriorCharges:PIN.conservative, readOnly:true as const,
      executionAuthorized:false as const, publicationAuthorized:false as const,
      resumeAuthorized:false as const, budgetResetAuthorized:false as const,
      wholeStep8Closed:false as const,
    });
  } catch { return refuse(); }
}
