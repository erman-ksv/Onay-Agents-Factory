/** Durable, non-authorizing publication reconciliation sidecar for the fixed
 * historical Calculator t02. The original task receipts, locks, costs and
 * source ZIP remain untouched; this marker cannot launch or resume any task.
 * A future runner must re-authenticate the source and fresh CI independently.
 */
import { createHash } from "node:crypto";
import { TeamTaskStore, type TeamTaskSnapshot } from "./teamTaskStore.js";
import {
  assertCalculatorT02InspectedReadOnlyHandoff,
  type CalculatorT02ReadOnlyHandoff,
} from "./calculatorT02ReadOnlyHandoff.js";
import { CALCULATOR_T02_CHARGE_PIN as PIN } from "./calculatorT02ChargeReconciliation.js";

export const CALCULATOR_T02_SIDECAR_ERROR =
  "Historical t02 reconciliation sidecar refused; retain old state and costs. No replay or successor is authorized.";
const refuse = (): never => { throw Error(CALCULATOR_T02_SIDECAR_ERROR); };
const digest = (x: unknown): string => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const KEY = Object.freeze({
  version: 1,
  kind: "calculator-t02-published-sidecar-no-execution",
  taskId: "calculator-pilot-step7-v1-34ee03-t02",
  planFingerprint: "1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2",
  candidateSha: PIN.candidateSha,
  manifestSha256: PIN.manifestSha256,
  originalReceiptSha256: PIN.originalReceiptSha256,
  priorCharge: PIN.conservative,
});
const ID = "calc-t02-pub-" + digest(KEY).slice(0, 48);
const FINGERPRINT = digest({ ...KEY, purpose: "historical-reconciliation-only" });
const STAGES = ["original_receipt_pinned", "charges_preserved", "published_candidate_ci_verified"] as const;
export type CalculatorT02SidecarReport = Readonly<{
  status: "recorded" | "already-recorded";
  taskId: typeof KEY.taskId;
  candidateSha: string;
  priorCharge: typeof PIN.conservative;
  originalReceiptSha256: string;
  readOnly: true;
  resumeAuthorized: false;
  budgetResetAuthorized: false;
  publicationAuthorized: false;
  successorAuthorized: false;
}>;
function validated(record: TeamTaskSnapshot | undefined): boolean {
  return !!record && record.id === ID && record.fingerprint === FINGERPRINT &&
    record.status === "needs-review" && record.reasonCode === "publication_reconciled_non_authorizing" &&
    record.publication === undefined && record.stages.length === STAGES.length &&
    STAGES.every((name, i) => record.stages[i]?.stage === name && record.stages[i]?.status === "passed");
}
function report(status: CalculatorT02SidecarReport["status"]): CalculatorT02SidecarReport {
  return Object.freeze({
    status, taskId: KEY.taskId, candidateSha: PIN.candidateSha, priorCharge: PIN.conservative,
    originalReceiptSha256: PIN.originalReceiptSha256, readOnly: true as const,
    resumeAuthorized: false as const, budgetResetAuthorized: false as const,
    publicationAuthorized: false as const, successorAuthorized: false as const,
  });
}
/** Existing private 0700 directory is supplied by the host, outside the old
 * task directory. The input must be the actual in-process checked observation:
 * a cloned JSON report is rejected before ANY filesystem operation.
 *
 * This one-use record is intentionally only bookkeeping, not a controller
 * transition. Errors never remove source state, receipts, locks or charges.
 */
export function recordCalculatorT02ReconciliationSidecar(directory: string,
  checked: CalculatorT02ReadOnlyHandoff): CalculatorT02SidecarReport {
  assertCalculatorT02InspectedReadOnlyHandoff(checked);
  if (checked.taskId !== KEY.taskId || checked.planFingerprint !== KEY.planFingerprint ||
      checked.candidateSha !== PIN.candidateSha ||
      checked.sourceManifestSha256 !== PIN.manifestSha256 ||
      checked.originalReceiptSha256 !== PIN.originalReceiptSha256 ||
      checked.priorCharge.attemptedRequests !== PIN.conservative.attemptedRequests ||
      checked.priorCharge.totalRequestBytes !== PIN.conservative.totalRequestBytes ||
      checked.priorCharge.reservedRunTokens !== PIN.conservative.reservedRunTokens ||
      checked.priorCharge.elapsedMs !== PIN.conservative.elapsedMs ||
      checked.resumeAuthorized !== false || checked.budgetResetAuthorized !== false ||
      checked.publicationAuthorized !== false || checked.nextTaskAuthorized !== false) return refuse();
  let store: TeamTaskStore | undefined;
  try {
    store = new TeamTaskStore(directory, { id: ID, fingerprint: FINGERPRINT });
    // Never overwrite even a malformed or incomplete historical sidecar.
    if (store.inspectExisting() || store.inspectExistingLock()) return refuse();
    if (store.claim() !== "claimed") return refuse();
    for (const name of STAGES) {
      store.recordStage(name, "running"); store.recordStage(name, "passed");
    }
    store.finish("needs-review", "publication_reconciled_non_authorizing");
    return report("recorded");
  } catch { return refuse(); }
  finally { store?.close(); }
}
/** Inspection after worker restart does not recreate the in-process authority.
 * Even an existing valid sidecar requires independent, fresh host verification.
 */
export function inspectCalculatorT02ReconciliationSidecar(directory: string): CalculatorT02SidecarReport | undefined {
  let store: TeamTaskStore | undefined;
  try {
    store = new TeamTaskStore(directory, { id: ID, fingerprint: FINGERPRINT });
    const receipt = store.inspectExisting();
    if (!receipt && !store.inspectExistingLock()) return undefined;
    if (!validated(receipt)) return refuse();
    return report("already-recorded");
  } catch { return refuse(); }
  finally { store?.close(); }
}
