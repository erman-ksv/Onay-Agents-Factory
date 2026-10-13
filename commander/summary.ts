import type { AgentStepResult } from "./executor.js";
import type { TestExecutionEvidence } from "../agents/tester/agent.js";
import { evaluateCiJobs } from "../github/ciGate.js";

type SummaryOptions = {
  proposalOnly?: boolean;
  expectedSha?: string;
  repository?: string;
  ref?: string;
  requiredNames?: string[];
  requiredStepNames?: string[];
};

function verifiedTestEvidence(evidence: TestExecutionEvidence | undefined, options: SummaryOptions): boolean {
  if (!evidence || !options.expectedSha || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(options.expectedSha) ||
      !options.repository?.trim() || !options.ref?.trim() || evidence.testsExecuted !== true ||
      evidence.status !== "passed" || evidence.expectedSha !== options.expectedSha ||
      evidence.repository !== options.repository || evidence.ref !== options.ref ||
      !options.requiredNames?.length || !Array.isArray(evidence.evidence) || !evidence.evidence.length ||
      !Array.isArray(evidence.jobs) || !Array.isArray(evidence.checks) || !evidence.checks.length) return false;
  if (!evidence.evidence.every(run => Number.isSafeInteger(run.runId) && run.runId > 0 &&
      Number.isSafeInteger(run.runAttempt) && run.runAttempt! > 0 &&
      run.headSha === options.expectedSha && run.conclusion === "success")) return false;
  const jobs = evidence.jobs;
  if (!jobs.every(job => typeof job.head_sha === "string" && job.head_sha.toLowerCase() === options.expectedSha!.toLowerCase())) return false;
  if (!evidence.checks.every(check => jobs.some(job => job.run_id === check.runId &&
      job.run_attempt === check.runAttempt && job.name === check.jobName &&
      job.steps?.some(step => step.name === check.name && step.status === check.status && step.conclusion === check.conclusion)))) return false;
  const runs = evidence.evidence.map(run => ({
    id: run.runId, run_attempt: run.runAttempt, name: run.name, head_sha: run.headSha,
    status: "completed", conclusion: run.conclusion, html_url: run.url,
  }));
  // Preserve job boundaries and failed/skipped evidence: an unrelated job must
  // never supply a missing required test, including across matrix entries.
  return evaluateCiJobs(runs, jobs, options.requiredNames, options.requiredStepNames ?? []).status === "passed";
}

export type CommanderSummary = {
  status: "blocked" | "needs-review" | "completed";
  canPublish: boolean;
  completed: number;
  failed: number;
  skipped: number;
  reviewReady: boolean;
  proposedSecurityClean: boolean;
  repositorySecurityClean: boolean;
  testsExecuted: boolean;
};

export function summarizeExecution(execution: AgentStepResult[], options: SummaryOptions = {}): CommanderSummary {
  const review = execution.filter(step => step.agent === "reviewer").at(-1)?.output as
    { ready?: boolean; findings?: Array<{ severity?: string }> } | undefined;
  const security = execution.filter(step => step.agent === "security").at(-1)?.output as
    { proposedChanges?: { status?: string }; repository?: { status?: string } } | undefined;
  const tester = execution.filter(step => step.agent === "tester").at(-1)?.output as
    { testsExecuted?: boolean; executionEvidence?: TestExecutionEvidence } | undefined;
  const reviewBlocked = review?.ready === false || review?.findings?.some(finding => ["blocker", "high"].includes(finding.severity ?? "")) === true;
  const reviewReady = review?.ready === true && !reviewBlocked;
  const proposedSecurityClean = security?.proposedChanges?.status === "clean";
  const repositorySecurityClean = security?.repository?.status === "clean";
  // Discovery is not execution: require explicit evidence that the planned tests actually ran.
  const evidence = tester?.executionEvidence;
  const testsExecuted = tester?.testsExecuted === true && verifiedTestEvidence(evidence, options);
  const hasIncompleteAgents = execution.some((step) => step.status !== "completed");
  const failedGate = reviewBlocked || security?.proposedChanges?.status === "findings" ||
    security?.repository?.status === "findings" || evidence?.status === "failed" || evidence?.status === "sha-mismatch" ||
    (options.expectedSha !== undefined && evidence?.expectedSha !== undefined && evidence.expectedSha !== options.expectedSha) ||
    (options.repository !== undefined && evidence?.repository !== undefined && evidence.repository !== options.repository) ||
    (options.ref !== undefined && evidence?.ref !== undefined && evidence.ref !== options.ref);
  const status = hasIncompleteAgents || failedGate
    ? "blocked"
    : options.proposalOnly || !reviewReady || !proposedSecurityClean || !repositorySecurityClean || !testsExecuted
      ? "needs-review"
      : "completed";

  return {
    status,
    canPublish: status === "completed",
    completed: execution.filter((step) => step.status === "completed").length,
    failed: execution.filter((step) => step.status === "failed").length,
    skipped: execution.filter((step) => step.status === "skipped").length,
    reviewReady,
    proposedSecurityClean,
    repositorySecurityClean,
    testsExecuted,
  };
}

