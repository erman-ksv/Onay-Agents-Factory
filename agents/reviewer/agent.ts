export type ReviewFinding = { severity: "blocker" | "high" | "medium" | "low"; message: string };

export type ReviewFile = { path: string; content: string };

function normalizePath(path: string) {
  return path.trim().replace(/\\/g, "/");
}

export function reviewChangeSet(input: { goal: string; files: ReviewFile[]; allowWorkflowChanges?: boolean; allowBuildConfigChanges?: boolean }) {
  const findings: ReviewFinding[] = [];
  const seenPaths = new Set<string>();

  if (!input.goal.trim()) {
    findings.push({ severity: "high", message: "A reviewable change must include a clear task goal." });
  }
  if (input.files.length === 0) {
    findings.push({ severity: "high", message: "The proposed change set contains no files." });
  }

  for (const file of input.files) {
    const path = normalizePath(file.path);
    const lowerPath = path.toLowerCase();

    if (!path || path.startsWith("/") || /^[a-z]:\//i.test(path) || path.split("/").includes("..")) {
      findings.push({ severity: "blocker", message: "Unsafe or invalid repository path: " + file.path });
      continue;
    }

    if (seenPaths.has(lowerPath)) {
      findings.push({ severity: "blocker", message: "Duplicate path in proposed change set: " + path });
    }
    seenPaths.add(lowerPath);

    const segments = lowerPath.split("/");
    const basename = segments.at(-1) ?? "";
    const automationPath = segments[0] === ".github" && (segments[1] === "workflows" || segments[1] === "actions");
    if (automationPath && !input.allowWorkflowChanges) {
      findings.push({ severity: "blocker", message: "Changes to GitHub workflows/actions require explicit AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES=true opt-in: " + path });
    }
    const protectedBuildConfig =
      basename === "package.json" ||
      /^tsconfig(?:\..+)?\.json$/.test(basename) ||
      /^(?:vitest|jest|playwright|cypress|karma|ava)\.config\.(?:[cm]?[jt]s|json)$/.test(basename) ||
      /^\.mocharc(?:\..+)?$/.test(basename);
    if (protectedBuildConfig && !input.allowBuildConfigChanges) {
      findings.push({ severity: "blocker", message: "Changes to package.json, tsconfig or test-runner config can weaken test and typecheck evidence and need an explicit allowBuildConfigChanges opt-in: " + path });
    }
    const sensitiveName =
      /^\.env(?:\.(?!example$).*)?$/i.test(basename) ||
      /\.(?:pem|key|p12|pfx)$/i.test(basename) ||
      /^(?:id_rsa|id_ed25519|credentials(?:\.json)?|service-account.*\.json)$/i.test(basename);

    if (sensitiveName) {
      findings.push({ severity: "blocker", message: "Sensitive-looking file must not be committed: " + path });
    }

    if (file.content.trim().length === 0) {
      findings.push({ severity: "high", message: "Proposed file is empty: " + path });
    }

    if (file.content.length > 1_000_000) {
      findings.push({ severity: "medium", message: "Large proposed file (>1 MB) needs explicit human review: " + path });
    }
  }

  const blocked = findings.some((finding) => finding.severity === "blocker" || finding.severity === "high");
  return { agent: "reviewer" as const, ready: !blocked, findings };
}

export function runReviewer(input: string) {
  return { agent: "reviewer", input, action: "review proposed changes and identify merge blockers" };
}
