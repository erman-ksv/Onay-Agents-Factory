import { generateChanges } from "../agents/backend/coder.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";
import { inspectProposedChanges, inspectSecurity } from "../agents/security/agent.js";
import { getCiFailureContext, waitForCiGate } from "../github/ciGate.js";
import { TezJetRepositoryAdapter } from "../github/tezjetRepository.js";
import { getTargetRepository } from "../github/repositoryConfig.js";
import type { CiGateResult } from "../github/ciGate.js";
import { AgentRunJournal } from "./agentRunJournal.js";

type ChangeFile = { path: string; content: string; message: string };
const REQUIRED_TEZJET_CI_JOBS = ["Typecheck and API tests"];
const REQUIRED_TEZJET_CI_STEPS = ["Typecheck", "API integration tests"];

export type RetryLoopDependencies = {
  generate: typeof generateChanges;
  review: typeof reviewChangeSet;
  scan: typeof inspectProposedChanges;
  security: typeof inspectSecurity;
  failure: typeof getCiFailureContext;
  wait: typeof waitForCiGate;
  write: TezJetRepositoryAdapter["write"];
};

type RetryAttempt = {
  attempt: number;
  files: string[];
  headSha: string;
  ci?: CiGateResult;
  reason?: string;
};

export function boundedRepairAttempts(value: number | undefined, minimum = 1): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(Math.floor(value!), 3)) : 2;
}

export async function retryFailedCi(input: {
  goal: string;
  branch: string;
  repositoryContext: string;
  headSha: string;
  maxAttempts?: number;
  journal?: AgentRunJournal;
}, overrides: Partial<RetryLoopDependencies> = {}) {
  const dependencies: RetryLoopDependencies = {
    generate: generateChanges, review: reviewChangeSet, scan: inspectProposedChanges,
    security: inspectSecurity, failure: getCiFailureContext, wait: waitForCiGate,
    write: (path, content, message, branch) => new TezJetRepositoryAdapter(getTargetRepository()).write(path, content, message, branch),
    ...overrides,
  };
  const maxAttempts = boundedRepairAttempts(input.maxAttempts);
  const attempts: RetryAttempt[] = [];
  let headSha = input.headSha;
  let gate: CiGateResult | undefined;
  let rejected = "";
  let rejectedFiles: ChangeFile[] = [];
  const currentFiles = new Map<string, ChangeFile>();
  const journal = input.journal ?? new AgentRunJournal(input.goal);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const failure = await dependencies.failure(input.branch, headSha, REQUIRED_TEZJET_CI_JOBS, { requiredStepNames: REQUIRED_TEZJET_CI_STEPS });
    gate = failure.gate;
    if (failure.gate.status === "passed") return { status: "passed" as const, attempts, headSha, ci: failure.gate };
    if (failure.gate.status !== "failed") return { status: "waiting" as const, attempts, gate: failure.gate, headSha };

    const diagnostics = JSON.stringify(failure.failures);
    journal.handoff("ci", "coder", "Returning the failed task to Coder with CI and previous gate diagnostics.", { attempt, maxAttempts, headSha });
    journal.record("agent_started", "coder", "Generating a bounded repair for the current candidate.", { attempt, headSha });
    const context = input.repositoryContext + (currentFiles.size
      ? "\n\nCURRENT CANDIDATE FILES (these replace earlier versions in the context):\n" + [...currentFiles.values()].map(file => `FILE: ${file.path}\n${file.content}`).join("\n\n")
      : "") + (rejectedFiles.length
      ? "\n\nREJECTED PROPOSAL (not written; revise these files to address the previous repair blockers):\n" + rejectedFiles.map(file => `FILE: ${file.path}\n${file.content}`).join("\n\n")
      : "");
    const generated = await dependencies.generate(
      `Original task: ${input.goal}\nFix the CI failure for this TezJet task. Attempt ${attempt}. Do not change unrelated behavior. CI diagnostics:\n${diagnostics}\nPrevious repair blockers:\n${rejected}`,
      context,
    );
    if (!generated.files.length) {
      journal.record("blocked", "coder", "Coder returned no repair files.", { attempt });
      return { status: "blocked" as const, attempts, reason: generated.summary, headSha };
    }
    journal.record("agent_completed", "coder", "Repair files generated; validation is required before writing.", { attempt });

    const review = dependencies.review({ goal: input.goal, files: generated.files, allowWorkflowChanges: process.env.AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES === "true" });
    if (!review.ready) {
      rejected = JSON.stringify({ review });
      rejectedFiles = structuredClone(generated.files);
      attempts.push({ attempt, files: generated.files.map(file => file.path), headSha, reason: "review-blocked" });
      journal.handoff("reviewer", "coder", "Repair was rejected by independent review; return the findings to Coder.", { attempt, findings: review.findings });
      if (attempt === maxAttempts) return { status: "blocked" as const, attempts, review, headSha };
      continue;
    }

    const proposedSecurity = dependencies.scan(generated.files);
    if (proposedSecurity.status !== "clean") {
      rejected = JSON.stringify({ proposedSecurity });
      rejectedFiles = structuredClone(generated.files);
      attempts.push({ attempt, files: generated.files.map(file => file.path), headSha, reason: "security-blocked" });
      journal.handoff("security", "coder", "Repair has proposed-change security findings; return the findings to Coder.", { attempt, findings: proposedSecurity.findings });
      if (attempt === maxAttempts) return { status: "blocked" as const, attempts, proposedSecurity, headSha };
      continue;
    }

    const security = await dependencies.security(undefined, getTargetRepository(), headSha);
    if (security.status !== "clean") return { status: "blocked" as const, attempts, security, headSha };

    for (const file of generated.files as ChangeFile[]) {
      headSha = await dependencies.write(file.path, file.content, file.message, input.branch);
      currentFiles.set(file.path, file);
    }
    rejected = "";
    rejectedFiles = [];

    const ci = await dependencies.wait({ branch: input.branch, headSha, requiredNames: REQUIRED_TEZJET_CI_JOBS, requiredStepNames: REQUIRED_TEZJET_CI_STEPS });
    gate = ci;
    attempts.push({ attempt, files: generated.files.map(file => file.path), headSha, ci });
    if (ci.status === "passed") return { status: "passed" as const, attempts, headSha, ci };
    if (ci.status !== "failed") return { status: "waiting" as const, attempts, headSha, gate: ci };
  }

  journal.record("blocked", "commander", "Automatic repair reached its attempt limit; human review is required.", { maxAttempts, headSha });
  return { status: "max-attempts" as const, attempts, headSha, gate };
}
