/** Read-only bridge between the historical publish uncertainty and a future
 * separately admitted after-CI handoff. Neither summary JSON nor this view is a
 * source of execution authority. No receipts/locks/state are mutated here. */
import { createHash } from "node:crypto";
import { parseTeamTaskSnapshotBytes } from "./teamTaskStore.js";
import type { CalculatorPriorModelCharge } from "./calculatorModelTeam.js";
import { calculatorPlanDigest } from "./calculatorPlan.js";
import { CALCULATOR_T02_CHARGE_PIN, inspectCalculatorT02ConservativeCharge,
  type CalculatorT02ChargeObservation } from "./calculatorT02ChargeReconciliation.js";

export const CALCULATOR_T02_HANDOFF_ERROR =
  "Historical Calculator t02 handoff is unverified. Preserve receipts, evidence and conservative charges; no replay.";
const TASK = "calculator-pilot-step7-v1-34ee03-t02";
const PLAN = "1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2";
const REPO = "erman-ksv/Onay-Factory-Calculator";
const BRANCH = "feat/calculator-agent/calculator-pilot-step7-v1";
const BASE = "5c4bc71b3119a50d2ca7ce1dbdf12bcaa000ce75";
const CAPSULE = "b49a7295bb014e25f601c04608e6c1cefb20818f27af474369dad71c25c240a7";
const ORIGINAL_RECEIPT_SHA256 = "eb920ca04fead67298f7443102ee118c0f9300fc623ef36af1aa42cd00cd375b";
const PROPOSAL = "bc1e0790d5d4c54c06ea1abe8b6f5d8f6eca767a9a477f4146947d59f3fd6f5b";
const CI_RUN = 39791054276;
const refuse = (): never => { throw Error(CALCULATOR_T02_HANDOFF_ERROR); };
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
function plain(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Reflect.ownKeys(value).every(k => typeof k === "string" && "value" in Object.getOwnPropertyDescriptor(value, k)!);
}
function requireObject(value: unknown): Record<string, any> { if (!plain(value)) return refuse(); return value; }
export type CalculatorT02ReadOnlyVerifier = Readonly<{
  /** Mandatory fresh host GET to the target, never supplied by a model packet. */
  getCurrentHead(): Promise<string>;
  /** Mandatory independent exact-SHA CI inspection; the audit report alone is insufficient. */
  getCandidateCI(): Promise<Readonly<{
    runId: number; headSha: string; runAttempt: number; workflowPath: string;
    completed: boolean; passed: boolean; syntaxPassed: boolean; taskTestsPassed: boolean;
  }>>;
}>;
export type CalculatorT02ReadOnlyHandoff = Readonly<{
  taskId: typeof TASK; planFingerprint: typeof PLAN; candidateSha: string;
  originalReceiptSha256: string; sourceManifestSha256: string;
  priorCharge: CalculatorPriorModelCharge;
  ciRunId: typeof CI_RUN; auditClaimsArchiveVerified: true;
  historicalReceiptPreserved: true; readOnly: true;
  resumeAuthorized: false; budgetResetAuthorized: false;
  publicationAuthorized: false; nextTaskAuthorized: false;
}>;
/** This is NOT a capability used by the selector. It verifies that a blocked
 * receipt, a source-free audit and fresh remote CI agree. Independent archive
 * origin and every original file must also be checked by the trusted host.
 *
 * Do not add an auto-start switch here: a separate durable cross-run barrier,
 * authenticated archive loader and execution admission are still required.
 */
export async function inspectCalculatorT02ReadOnlyHandoff(input: Readonly<{
  audit: unknown; archivedReceiptBytes: Uint8Array; charges: CalculatorT02ChargeObservation;
}>, host: CalculatorT02ReadOnlyVerifier): Promise<CalculatorT02ReadOnlyHandoff> {
  try {
    if (!input || !host || typeof host.getCurrentHead !== "function" ||
        typeof host.getCandidateCI !== "function" ||
        !(input.archivedReceiptBytes instanceof Uint8Array) || input.archivedReceiptBytes.byteLength > 32768) return refuse();
    const a = requireObject(input.audit), archive = requireObject(a.archive),
      capsule = requireObject(a.capsule), observed = requireObject(a.capsuleObserved),
      candidate = requireObject(a.candidate), ci = requireObject(a.ci), roles = capsule.assessments;
    if (a.status !== "publication_reconciled_read_only" || a.readOnlyAudit !== true ||
        a.modelsRun !== false || a.githubWritesPerformed !== false || a.receiptsChanged !== false ||
        a.automaticReplay !== false || a.resumeAuthorized !== false ||
        a.budgetResetAuthorized !== false || a.autonomousDevelopmentProven !== false ||
        a.wholeStep8Closed !== false ||
        a.sourceSha !== "e22c946c77095868deb7e65c230e2e6ab5c860f1" ||
        a.auditRunId !== 39808880793 ||
        a.auditEventSha !== "7dd8648e10451b420b1b0a65bbfbb2341c93cf50" ||
        a.sourceRunId !== CALCULATOR_T02_CHARGE_PIN.sourceRunId ||
        a.sourceArtifactId !== CALCULATOR_T02_CHARGE_PIN.artifactId ||
        a.candidateSha !== CALCULATOR_T02_CHARGE_PIN.candidateSha ||
        archive.manifestSha256 !== CALCULATOR_T02_CHARGE_PIN.manifestSha256 ||
        archive.fileCount !== 255 || archive.totalBytes !== 1413026 || archive.allFilesVerified !== true ||
        observed.stage !== "publish_candidate" || observed.status !== "blocked" ||
        observed.httpInFlight !== false || observed.publicationStarted !== true ||
        observed.proposalDigest !== PROPOSAL || observed.assessmentCount !== 3 ||
        capsule.sha256 !== CAPSULE || capsule.proposalDigest !== PROPOSAL ||
        capsule.publicationStarted !== true || capsule.httpInFlight !== false ||
        capsule.oldReceiptReason !== "publication_or_ci_uncertain_inspect_no_replay" ||
        !Array.isArray(roles) || roles.length !== 3 ||
        roles.some((r, i) => !plain(r) || r.role !== ["security", "reviewer", "tester"][i] ||
          r.ready !== true || r.findings !== 0 || !Number.isSafeInteger(r.unverifiedAreas) || r.unverifiedAreas < 0) ||
        candidate.sha !== CALCULATOR_T02_CHARGE_PIN.candidateSha ||
        candidate.parent !== BASE || candidate.approvedFileBytesMatch !== true ||
        candidate.unchangedDependencyAndWorkflowBlobs !== true || candidate.pr !== 1 ||
        candidate.draft !== true ||
        !Array.isArray(candidate.changedPaths) ||
        candidate.changedPaths.join(",") !== "index.html,src/app.mjs,styles.css" ||
        ci.status !== "passed" || ci.testsExecuted !== true ||
        !Array.isArray(ci.verifiedRunIds) || ci.verifiedRunIds.length !== 1 || ci.verifiedRunIds[0] !== CI_RUN)
      return refuse();
    const prior = inspectCalculatorT02ConservativeCharge(input.charges);
    if (prior.manifestSha256 !== archive.manifestSha256 || prior.candidateSha !== candidate.sha) return refuse();
    if (sha(input.archivedReceiptBytes) !== ORIGINAL_RECEIPT_SHA256) return refuse();
    const receipt = parseTeamTaskSnapshotBytes(input.archivedReceiptBytes, {
      id: "calc-" + TASK, fingerprint: calculatorPlanDigest({ planFingerprint: PLAN, taskId: TASK }),
    });
    if (receipt.status !== "needs-review" ||
        receipt.reasonCode !== "publication_or_ci_uncertain_inspect_no_replay" || receipt.publication ||
        !receipt.stages.some(stage => stage.stage === "load_current_source" && stage.status === "passed") ||
        !receipt.stages.some(stage => stage.stage === "host_tests_1" && stage.status === "passed") ||
        !receipt.stages.some(stage => stage.stage === "publish_candidate") ||
        receipt.stages.some(stage => stage.stage === "verify_candidate_ci" && stage.status === "passed"))
      return refuse();
    const remote = await host.getCandidateCI();
    if (!plain(remote) || remote.runId !== CI_RUN || remote.headSha !== candidate.sha ||
        remote.runAttempt !== 1 || remote.workflowPath !== ".github/workflows/calculator-task-ci.yml" ||
        remote.completed !== true || remote.passed !== true ||
        remote.syntaxPassed !== true || remote.taskTestsPassed !== true ||
        await host.getCurrentHead() !== candidate.sha) return refuse();
    return Object.freeze({
      taskId: TASK, planFingerprint: PLAN, candidateSha: candidate.sha,
      originalReceiptSha256: sha(input.archivedReceiptBytes), sourceManifestSha256: archive.manifestSha256,
      priorCharge: prior.priorCharge, ciRunId: CI_RUN,
      auditClaimsArchiveVerified: true as const, historicalReceiptPreserved: true as const,
      readOnly: true as const, resumeAuthorized: false as const, budgetResetAuthorized: false as const,
      publicationAuthorized: false as const, nextTaskAuthorized: false as const,
    });
  } catch { return refuse(); }
}
