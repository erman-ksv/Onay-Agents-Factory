import { createHash } from "node:crypto";
import { CALCULATOR_PROFILE, refuseCalculatorChange } from "../config/calculatorProfile.js";
import { calculatorSources, type CalculatorSnapshot } from "../github/calculatorSnapshot.js";
import { scanForSecrets } from "../github/secretScanner.js";
import { inspectProposedChanges } from "../agents/security/agent.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";
import { applyBoundedPatches, type BoundedPatch } from "./boundedPatch.js";

type File = Readonly<{ path: string; content: string; message: string }>;
export type PreparedCalculatorChanges = Readonly<{
  repository: string; baseRef: string; baseSha: string; summary: string;
  files: readonly File[]; reviewEvidence: string;
  gates: Readonly<{ secretScan: "passed"; policyReview: "passed";
    independentReview: "required"; tests: "required"; publicationAuthorized: false }>;
}>;
function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value: Record<string, unknown>, names: string[]): boolean {
  return Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}
function safeText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) && !scanForSecrets(value).length;
}
/** Prepares changes only. Independent reviewers, Tester and exact-commit CI
 * still gate publication/completion in the team execution layer. No I/O here. */
export function prepareCalculatorChanges(input: unknown, snapshot: CalculatorSnapshot): PreparedCalculatorChanges {
  try {
    const sources = calculatorSources(snapshot); // Reject invented/JSON-roundtripped absence evidence.
    if (!plain(input) || !exact(input, ["summary", "changes"]) || !safeText(input.summary, 800) ||
        !Array.isArray(input.changes) || !input.changes.length || input.changes.length > CALCULATOR_PROFILE.maxFiles)
      return refuseCalculatorChange();
    const files: File[] = [], evidence: Record<string, unknown>[] = [];
    const seen = new Set<string>(); let changedCharacters = 0;
    for (const change of input.changes) {
      if (!plain(change) || typeof change.path !== "string" || !snapshot.changePaths.includes(change.path) || seen.has(change.path) ||
          !safeText(change.message, 200)) return refuseCalculatorChange();
      seen.add(change.path);
      if (change.operation === "create") {
        if (!exact(change, ["operation", "path", "content", "message"]) || sources.has(change.path) ||
            !snapshot.files.some(file => file.path === change.path && file.exists === false) ||
            !safeText(change.content, CALCULATOR_PROFILE.maxChangedCharacters) ||
            Buffer.byteLength(change.content) > CALCULATOR_PROFILE.maxNewFileBytes) return refuseCalculatorChange();
        changedCharacters += change.content.length;
        files.push(Object.freeze({ path: change.path, content: change.content, message: change.message }));
        evidence.push({ operation: "create", path: change.path, absenceVerifiedAt: snapshot.baseSha,
          content: change.content, contentSha256: createHash("sha256").update(change.content).digest("hex") });
      } else if (change.operation === "patch") {
        if (!exact(change, ["operation", "path", "sourceSha256", "edits", "message"]) || !sources.has(change.path) ||
            !Array.isArray(change.edits) || change.edits.some(edit => !plain(edit) || !exact(edit, ["before", "after"])))
          return refuseCalculatorChange();
        const patch: BoundedPatch = { path: change.path, sourceSha256: change.sourceSha256 as string,
          edits: change.edits as BoundedPatch["edits"], message: change.message };
        const [file] = applyBoundedPatches([patch], sources, snapshot.changePaths);
        for (const edit of patch.edits) changedCharacters += edit.before.length + edit.after.length;
        files.push(Object.freeze(file));
        evidence.push({ operation: "patch", ...structuredClone(patch) });
      } else return refuseCalculatorChange();
      if (changedCharacters > CALCULATOR_PROFILE.maxChangedCharacters) return refuseCalculatorChange();
    }
    const reviewEvidence = JSON.stringify({ repository: snapshot.repository, baseSha: snapshot.baseSha,
      changes: evidence, unverified: ["Unshown unchanged source", "Independent review", "Exact-candidate runtime CI", "Browser acceptance"] });
    if (Buffer.byteLength(reviewEvidence) > CALCULATOR_PROFILE.maxReviewBytes || scanForSecrets(reviewEvidence).length ||
        !reviewChangeSet({ goal: input.summary, files, allowWorkflowChanges: false, allowBuildConfigChanges: false }).ready ||
        inspectProposedChanges(files).status !== "clean") return refuseCalculatorChange();
    return Object.freeze({ repository: snapshot.repository, baseRef: snapshot.baseRef, baseSha: snapshot.baseSha,
      summary: input.summary, files: Object.freeze(files), reviewEvidence,
      gates: Object.freeze({ secretScan: "passed", policyReview: "passed", independentReview: "required",
        tests: "required", publicationAuthorized: false }) });
  } catch { return refuseCalculatorChange(); }
}
