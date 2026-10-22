import type { PreparedCalculatorChanges } from "../commander/calculatorChanges.js";
import type { CalculatorAssessment } from "../commander/calculatorTeam.js";
import type { CalculatorSnapshot } from "../github/calculatorSnapshot.js";
import { calculatorAssessmentEvidencePacket, type CalculatorAssessmentEvidence } from "./calculatorAssessmentEvidence.js";
import { createCalculatorModelTeam, type CalculatorPriorModelCharge, type CalculatorModelCheckpointHooks } from "./calculatorModelTeam.js";
import type { CalculatorModelTiming } from "./calculatorGroqPacing.js";
import type { CalculatorPlan, CalculatorPlanTask } from "./calculatorPlan.js";
import type { CalculatorProposalTests } from "./calculatorExecutionEvidence.js";

export const CALCULATOR_AGENT_REPAIR_ERROR = "Agent repair stopped. Preserve the failure and charges; no manual code substitution, replay or publication is authorized.";
const refuse = (): never => { throw new Error(CALCULATOR_AGENT_REPAIR_ERROR); };
/** Only a trusted host FUNCTION may authenticate and read a stopped private
 * capsule. JSON/model/environment fields do not establish archive provenance,
 * one-use admission, settled HTTP or a fresh separately bounded allowance. */
export type CalculatorAuthenticatedFailure = Readonly<{
  taskId: string; planFingerprint: string; baseSha: string; sourceManifestSha256: string;
  proposal: unknown; proposalDigest: string; assessments: readonly CalculatorAssessment[];
  dependencySnapshot: CalculatorSnapshot;
  proposalTests?: CalculatorProposalTests; priorCharge: CalculatorPriorModelCharge;
  httpInFlight: false; publicationStarted: false;
}>;
export type CalculatorAgentRepairHost = Readonly<{
  loadAuthenticatedFailure(plan: CalculatorPlan, task: CalculatorPlanTask, snapshot: CalculatorSnapshot): Promise<CalculatorAuthenticatedFailure>;
  /** Execute/verify actual checks on the AGENT'S new proposal, not its parent. */
  verifyRepairedProposal(task: CalculatorPlanTask, changes: PreparedCalculatorChanges, snapshot: CalculatorSnapshot): Promise<CalculatorAssessmentEvidence>;
}>;

/** Plug this team into runCalculatorExecution with maxRepairs:0. Its first
 * proposal is ONE corrective Developer/Frontend call, never a manual patch or
 * whole-task regeneration. All THREE fresh assessments and executor tests,
 * publisher lease and exact-SHA CI still run through the existing executor.
 * This adapter creates no authorization, publisher, workflow or repeat loop. */
export function createCalculatorAgentRepairTeam(ownerRequest: unknown, env: NodeJS.ProcessEnv, host: CalculatorAgentRepairHost,
  options: Readonly<{ transport?: typeof fetch; timing?: CalculatorModelTiming; checkpoints?: CalculatorModelCheckpointHooks }> = {}) {
  if (!host || typeof host.loadAuthenticatedFailure !== "function" || typeof host.verifyRepairedProposal !== "function") return refuse();
  const load = host.loadAuthenticatedFailure, verify = host.verifyRepairedProposal;
  let started = false, failed = false, repairedProposal: PreparedCalculatorChanges | undefined;
  let evidence: CalculatorAssessmentEvidence | undefined, priorCharge: CalculatorPriorModelCharge | undefined, sourceManifestSha256: string | undefined;
  const team = createCalculatorModelTeam(ownerRequest, env, options.transport, options.timing, undefined, options.checkpoints,
    "calculator-restored-repair-four-roles", () => evidence);
  return Object.freeze({
    async generate(plan: CalculatorPlan, id: string, snapshot: CalculatorSnapshot): Promise<PreparedCalculatorChanges> {
      if (started || failed) return refuse(); started = true;
      try {
        const task = plan.tasks.find(task => task.id === id); if (!task) return refuse();
        const source = await load(plan, task, snapshot);
        if (!source || source.taskId !== id || source.planFingerprint !== plan.fingerprint || source.baseSha !== snapshot.baseSha ||
            source.httpInFlight !== false || source.publicationStarted !== false || !/^[a-f0-9]{64}$/.test(source.sourceManifestSha256) ||
            !source.priorCharge || Object.keys(source.priorCharge).sort().join(",") !== "attemptedRequests,elapsedMs,reservedRunTokens,totalRequestBytes" ||
            Object.values(source.priorCharge).some(value => !Number.isSafeInteger(value) || value < 1)) return refuse();
        priorCharge = Object.freeze({ ...source.priorCharge }); sourceManifestSha256 = source.sourceManifestSha256;
        const previous = team.restoreProposal(plan, id, snapshot, source.proposal, source.proposalDigest, []);
        const request = team.importRepairFeedback(plan, id, previous, source.assessments, source.proposalTests, source.dependencySnapshot);
        const changes = await team.repair(plan, id, snapshot, request);
        const verified = await verify(task, changes, snapshot);
        // Fail before any specialist request if the host reused stale proof or
        // supplied JSON assertions instead of an exact in-memory capability.
        calculatorAssessmentEvidencePacket(verified, task, changes);
        repairedProposal = changes; evidence = verified; return changes;
      } catch { failed = true; return refuse(); }
    },
    async assess(role: "security" | "reviewer" | "tester", plan: CalculatorPlan, id: string, changes: PreparedCalculatorChanges) {
      if (failed || !repairedProposal || changes !== repairedProposal || !evidence) return refuse();
      try { return await team.assess(role, plan, id, changes); } catch { failed = true; return refuse(); }
    },
    /** One separately admitted repair is the entire allowance. A failed new
     * assessment remains blocked; it cannot silently buy another attempt. */
    repair: async (): Promise<PreparedCalculatorChanges> => refuse(),
    diagnostic: team.diagnostic,
    checkpointCharge: team.checkpointCharge,
    snapshot() {
      const current = team.checkpointCharge();
      const aggregateCharge = priorCharge && current ? Object.freeze({
        attemptedRequests: priorCharge.attemptedRequests + current.attemptedRequests,
        totalRequestBytes: priorCharge.totalRequestBytes + current.totalRequestBytes,
        reservedRunTokens: priorCharge.reservedRunTokens + current.reservedRunTokens,
        elapsedMs: priorCharge.elapsedMs + current.elapsedMs,
      }) : undefined;
      return Object.freeze({ ...team.snapshot(), correctionAttempted: started, stopped: failed || team.snapshot().stopped,
        ...(priorCharge ? { carriedPriorCharge: priorCharge } : {}), ...(aggregateCharge ? { aggregateCharge } : {}),
        ...(sourceManifestSha256 ? { sourceManifestSha256 } : {}),
        manualSourceEditsPerformed: false as const, previousApprovalsTransferred: false as const });
    },
  });
}
