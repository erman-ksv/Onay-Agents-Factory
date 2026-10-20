import { assertCommitSha, assertValidBranchRef } from "../github/githubClient.js";

/** Host-owned target; model output cannot select a repository or a workflow. */
export const CALCULATOR_PROFILE = Object.freeze({
  id: "calculator",
  repository: "erman-ksv/Onay-Factory-Calculator",
  writablePaths: Object.freeze([
    "index.html", "styles.css", "src/calculator.mjs", "src/app.mjs",
    "test/calculator.test.mjs", "test/ui.test.mjs",
  ]),
  maxFiles: 3,
  maxSourceBytes: 131_072,
  maxNewFileBytes: 8_192,
  maxChangedCharacters: 6_000,
  maxReviewBytes: 12_000,
  maxTreeEntries: 512,
  requiredActors: Object.freeze(["security", "reviewer", "tester"]),
  requiredCiNames: Object.freeze(["Calculator CI"]),
  requiredCiSteps: Object.freeze(["Syntax", "Unit tests", "Browser tests"]),
  legalEnabled: false,
  mergesEnabled: false,
});
export const CALCULATOR_CHANGE_ERROR = "Calculator change refused: invalid scope, provenance, source, or budget. No write is authorized.";
export function refuseCalculatorChange(): never { throw new Error(CALCULATOR_CHANGE_ERROR); }
export type CalculatorScope = {
  repository: string; baseRef: string; baseSha: string; changePaths: readonly string[];
};
export function validateCalculatorScope(scope: CalculatorScope): void {
  if (!scope || scope.repository !== CALCULATOR_PROFILE.repository || typeof scope.baseRef !== "string" ||
      typeof scope.baseSha !== "string" || !/^[a-f0-9]{40}$/.test(scope.baseSha) ||
      !Array.isArray(scope.changePaths) || !scope.changePaths.length || scope.changePaths.length > CALCULATOR_PROFILE.maxFiles ||
      new Set(scope.changePaths).size !== scope.changePaths.length ||
      scope.changePaths.some(path => typeof path !== "string" || !CALCULATOR_PROFILE.writablePaths.includes(path)))
    refuseCalculatorChange();
  try { assertCommitSha(scope.baseSha); assertValidBranchRef(scope.baseRef); } catch { refuseCalculatorChange(); }
}
export function calculatorBranch(taskId: string): string {
  if (typeof taskId !== "string" || !/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(taskId)) refuseCalculatorChange();
  return "feat/calculator-agent/" + taskId;
}
