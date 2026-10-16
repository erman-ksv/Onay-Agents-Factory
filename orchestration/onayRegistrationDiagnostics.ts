import type { SpecialistAssessment } from "../commander/aiExecution.js";
import { scanForSecrets } from "../github/secretScanner.js";

export type SpecialistBlocker = {
  role: string;
  severity: "blocker" | "high" | "unspecified";
  message: string;
};

/**
 * Only local, bounded diagnostic metadata is printed. Never echo complete
 * specialist output, model prompts, source code, API keys, or review context.
 */
function safeMessage(value: string): string {
  const condensed = value.replace(/[\r\n\t]+/g, " ").trim();
  if (scanForSecrets(condensed).length) return "[withheld: potential secret]";
  const withoutContacts = condensed
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email redacted]")
    .replace(/\+998[\d\s()-]{9,}/g, "[phone redacted]");
  return withoutContacts.slice(0, 300) || "[no explanation supplied]";
}

export function summarizeSpecialistBlockers(
  assessments: Record<string, SpecialistAssessment>,
): SpecialistBlocker[] {
  const output: SpecialistBlocker[] = [];
  for (const [role, assessment] of Object.entries(assessments)) {
    if (assessment.ready) continue;
    const actionable = assessment.findings.filter(f => f.severity === "blocker" || f.severity === "high");
    if (actionable.length) {
      for (const finding of actionable.slice(0, 5)) {
        output.push({ role, severity: finding.severity as "blocker" | "high", message: safeMessage(finding.message) });
      }
    } else {
      // ready=false without blocker/high findings is still a publication gate.
      output.push({ role, severity: "unspecified", message: safeMessage(assessment.summary ?? "Specialist did not confirm readiness.") });
    }
  }
  return output;
}
