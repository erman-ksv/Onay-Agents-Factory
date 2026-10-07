export type ReviewFinding = { severity: "blocker" | "high" | "medium" | "low"; message: string };

export function reviewChangeSet(input: { goal: string; files: Array<{ path: string; content: string }> }) {
  const findings: ReviewFinding[] = [];
  for (const file of input.files) {
    if (/\.env$|\.pem$|\.key$/i.test(file.path)) findings.push({ severity: "blocker", message: "Sensitive-looking file must not be committed: " + file.path });
  }
  return { agent: "reviewer" as const, ready: !findings.some(f => f.severity === "blocker"), findings };
}

export function runReviewer(input: string) {
  return { agent: "reviewer", input, action: "review proposed changes and identify merge blockers" };
}