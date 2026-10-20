import { createHash } from "node:crypto";
import type { PreparedCalculatorChanges } from "../commander/calculatorChanges.js";
import { scanForSecrets } from "../github/secretScanner.js";

export const CALCULATOR_EXECUTION_ERROR = "Calculator execution stopped: task, gates, current code or tool evidence is unverified. No replay is authorized.";
export function refuseCalculatorExecution(): never { throw new Error(CALCULATOR_EXECUTION_ERROR); }
/** Source-free identity for exact in-memory proposal testing before publication. */
export function calculatorProposalDigest(changes: PreparedCalculatorChanges): string {
  return createHash("sha256").update(JSON.stringify({ repository: changes.repository, baseRef: changes.baseRef,
    baseSha: changes.baseSha, files: [...changes.files].sort((a, b) => a.path.localeCompare(b.path)).map(file => ({ path: file.path, content: file.content })) })).digest("hex");
}
export type CalculatorProposalTests = Readonly<{
  repository: string; taskId: string; baseSha: string; proposalDigest: string;
  status: "passed" | "failed" | "unverified"; testsExecuted: boolean; failures: readonly string[];
}>;
/** Trusted host callback evidence, never parsed from a model assessment. */
export function validateCalculatorProposalTests(input: CalculatorProposalTests, taskId: string,
  changes: PreparedCalculatorChanges): CalculatorProposalTests {
  if (!input || Object.keys(input).sort().join(",") !== "baseSha,failures,proposalDigest,repository,status,taskId,testsExecuted" ||
      input.repository !== changes.repository || input.taskId !== taskId || input.baseSha !== changes.baseSha ||
      input.proposalDigest !== calculatorProposalDigest(changes) || !["passed", "failed", "unverified"].includes(input.status) ||
      typeof input.testsExecuted !== "boolean" || (input.status !== "unverified" && !input.testsExecuted) ||
      !Array.isArray(input.failures) || input.failures.length > 6 ||
      input.failures.some(message => typeof message !== "string" || !message.trim() || message.length > 400 ||
        /[\u0000-\u001f\u007f]/.test(message) || scanForSecrets(message).length) ||
      (input.status === "passed" && input.failures.length !== 0) || (input.status === "failed" && !input.failures.length))
    return refuseCalculatorExecution();
  return Object.freeze({ ...input, failures: Object.freeze([...input.failures]) });
}
export type CalculatorRepairRequest = Readonly<{
  previous: PreparedCalculatorChanges; proposalDigest: string; issues: readonly string[];
}>;
export function validateCalculatorRepairRequest(request: CalculatorRepairRequest): readonly string[] {
  if (!request || request.proposalDigest !== calculatorProposalDigest(request.previous) ||
      !Array.isArray(request.issues) || !request.issues.length || request.issues.length > 6 ||
      request.issues.some(message => typeof message !== "string" || !message.trim() || message.length > 400 ||
        /[\u0000-\u001f\u007f]/.test(message) || scanForSecrets(message).length)) return refuseCalculatorExecution();
  return Object.freeze([...request.issues]);
}
