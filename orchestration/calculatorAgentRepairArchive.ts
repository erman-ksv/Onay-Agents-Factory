/** Pinned private failure -> host loader. No model, writes, budget resets,
 * mutable task receipt restoration, remote admission or inferred permissions. */
import { calculatorSources, loadCalculatorSnapshot, type CalculatorSnapshotReader } from "../github/calculatorSnapshot.js";
import { openCalculatorStoppedArchiveForHost } from "./calculatorStoppedSuccessor.js";
import { parseCalculatorExecutionCheckpointBytes, type CalculatorExecutionCheckpointIdentity,
  type CalculatorExecutionCheckpointPayload } from "./calculatorExecutionCheckpoint.js";
import type { CalculatorAgentRepairHost } from "./calculatorAgentRepair.js";
import type { CalculatorPriorModelCharge } from "./calculatorModelTeam.js";

export const CALCULATOR_REPAIR_ARCHIVE_ERROR = "Pinned repair archive refused. Preserve source artifacts and costs; no execution or replay is authorized.";
const refuse = (): never => { throw Error(CALCULATOR_REPAIR_ARCHIVE_ERROR); };
const HASH = /^[a-f0-9]{64}$/;
const KEYS = ["attemptedRequests", "totalRequestBytes", "reservedRunTokens", "elapsedMs"] as const;
type Phase = Readonly<{ path: string; sha256: string; identity: CalculatorExecutionCheckpointIdentity;
  accounting: "incremental" | "cumulative" }>;
/** Host-reviewed configuration only, never CLI/env/model/imported manifest
 * expectations. The charge list must cover the entire independently verified
 * history; totalCharge is its separately reviewed conservative high-water mark. */
export type CalculatorRepairArchivePin = Readonly<{
  manifestSha256: string; kind: string; fileCount: number; totalBytes: number;
  sourcePath: string; phases: readonly Phase[]; totalCharge: CalculatorPriorModelCharge;
}>;
export type CalculatorRepairArchive = Readonly<{
  taskId: string; planFingerprint: string; baseSha: string; sourceManifestSha256: string;
  priorCharge: CalculatorPriorModelCharge; proposalDigest: string;
  phaseCount: number; resumeAuthorized: false; publicationAuthorized: false;
}>;
type Private = { archive: ReturnType<typeof openCalculatorStoppedArchiveForHost>;
  identity: CalculatorExecutionCheckpointIdentity; payload: CalculatorExecutionCheckpointPayload; used: boolean };
const archives = new WeakMap<CalculatorRepairArchive, Private>();
function charge(value: CalculatorPriorModelCharge) {
  if (!value || Object.keys(value).sort().join(",") !== [...KEYS].sort().join(",") ||
      Object.values(value).some(n => !Number.isSafeInteger(n) || n < 0)) return refuse();
  return Object.freeze({ ...value });
}

export function inspectCalculatorRepairArchive(root: string, expected: CalculatorRepairArchivePin): CalculatorRepairArchive {
  try {
    // Snapshot trusted configuration before any filesystem reads.
    const pin = structuredClone(expected);
    if (!HASH.test(pin.manifestSha256) || !/^calculator-[a-z-]+forensic$/.test(pin.kind) ||
        !Array.isArray(pin.phases) || !pin.phases.length || pin.phases.length > 16 ||
        !Number.isSafeInteger(pin.fileCount) || pin.fileCount < 1 || pin.fileCount > 2048 ||
        !Number.isSafeInteger(pin.totalBytes) || pin.totalBytes < 1 || pin.totalBytes > 8388608) return refuse();
    const expectedCharge = charge(pin.totalCharge);
    if (KEYS.some(k => expectedCharge[k] < 1)) return refuse();
    const archive = openCalculatorStoppedArchiveForHost(root, pin, pin.kind);
    const paths = new Set<string>(), identities = new Set<string>();
    let total: CalculatorPriorModelCharge = { attemptedRequests: 0, totalRequestBytes: 0, reservedRunTokens: 0, elapsedMs: 0 };
    let source: ReturnType<typeof parseCalculatorExecutionCheckpointBytes>["data"] | undefined;
    let firstIdentity: CalculatorExecutionCheckpointIdentity | undefined;
    for (const phase of pin.phases) {
      if (!phase || !HASH.test(phase.sha256) || paths.has(phase.path) ||
          !["incremental", "cumulative"].includes(phase.accounting)) return refuse();
      paths.add(phase.path);
      const record = parseCalculatorExecutionCheckpointBytes(archive.read(phase.path), phase.identity, phase.sha256).data;
      const identityKey = JSON.stringify(record.identity);
      if (identities.has(identityKey)) return refuse(); identities.add(identityKey);
      const identity = record.identity; firstIdentity ??= identity;
      if (identity.repository !== "erman-ksv/Onay-Factory-Calculator" ||
          ["goalId", "ownerFingerprint", "planFingerprint", "taskId", "branch", "baseSha", "bootstrapSha"].some(key =>
            identity[key as keyof CalculatorExecutionCheckpointIdentity] !== firstIdentity![key as keyof CalculatorExecutionCheckpointIdentity]) ||
          record.payload.publicationStarted || record.payload.modelState.attemptedRequests < 1) return refuse();
      const current = charge(record.payload.modelState);
      if (phase.accounting === "cumulative") {
        if (KEYS.some(k => current[k] < total[k])) return refuse(); total = current;
      } else {
        total = charge(Object.fromEntries(KEYS.map(k => [k, total[k] + current[k]])) as CalculatorPriorModelCharge);
      }
      if (phase.path === pin.sourcePath) source = record;
    }
    if (!source || pin.phases[pin.phases.length - 1]!.path !== pin.sourcePath ||
        KEYS.some(k => total[k] !== expectedCharge[k]) || !source.proposalDigest || !source.payload.proposal ||
        source.payload.stage !== "execution_complete" || source.payload.status !== "blocked" ||
        source.payload.httpInFlight || source.payload.publicationStarted || source.payload.assessments.length !== 3 ||
        !source.payload.assessments.some(a => !a.ready || a.findings.some(f => ["blocker", "high"].includes(f.severity)))) return refuse();
    archive.assertUnchanged();
    const capability = Object.freeze({ taskId: source.identity.taskId, planFingerprint: source.identity.planFingerprint,
      baseSha: source.identity.baseSha, sourceManifestSha256: pin.manifestSha256, priorCharge: expectedCharge,
      proposalDigest: source.proposalDigest, phaseCount: pin.phases.length,
      resumeAuthorized: false as const, publicationAuthorized: false as const });
    archives.set(capability, { archive, identity: source.identity, payload: source.payload, used: false }); return capability;
  } catch { return refuse(); }
}

/** The host plugs this FUNCTION into the remotely admitted team. Source stays
 * private until the team reconstructs its bounded previous-change packet.
 * This does not restore old task receipts or create any new allowance. */
export function createCalculatorRepairArchiveLoader(capability: CalculatorRepairArchive,
  dependencyReader: CalculatorSnapshotReader): CalculatorAgentRepairHost["loadAuthenticatedFailure"] {
  const state = archives.get(capability);
  if (!state || !dependencyReader || typeof dependencyReader.getHead !== "function") return refuse();
  return async (plan, task, snapshot) => {
    try {
      if (state.used) return refuse(); state.used = true;
      const id = state.identity;
      if (!plan.tasks.includes(task) || task.id !== id.taskId || plan.fingerprint !== id.planFingerprint ||
          plan.owner.ownerFingerprint !== id.ownerFingerprint || plan.owner.id !== id.goalId || plan.owner.baseSha !== id.bootstrapSha ||
          plan.owner.repository !== id.repository || plan.branch !== id.branch ||
          snapshot.repository !== id.repository || snapshot.baseRef !== id.branch || snapshot.baseSha !== id.baseSha) return refuse();
      calculatorSources(snapshot); state.archive.assertUnchanged();
      const dependencySnapshot = await loadCalculatorSnapshot({ repository: id.repository, baseRef: id.branch,
        baseSha: id.baseSha, changePaths: ["src/calculator.mjs", "test/calculator.test.mjs"] }, dependencyReader);
      state.archive.assertUnchanged();
      return Object.freeze({ taskId: id.taskId, planFingerprint: id.planFingerprint, baseSha: id.baseSha,
        sourceManifestSha256: capability.sourceManifestSha256, proposal: structuredClone(state.payload.proposal),
        proposalDigest: capability.proposalDigest, assessments: Object.freeze(structuredClone(state.payload.assessments)),
        dependencySnapshot, priorCharge: capability.priorCharge, httpInFlight: false as const, publicationStarted: false as const });
    } catch { return refuse(); }
  };
}
