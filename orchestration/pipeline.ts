import { inspectTezJet } from "../github/tezjetExplorer.js";
import { inspectTestExecution, inspectTests } from "../agents/tester/agent.js";
import { inspectProposedChanges, inspectSecurity } from "../agents/security/agent.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";
import { generateChanges } from "../agents/backend/coder.js";
import { prepareTezJetChange } from "../github/changeWorkflow.js";
import { evaluateCiJobs, waitForCiGate } from "../github/ciGate.js";
import { boundedRepairAttempts, retryFailedCi } from "./retryLoop.js";
import { AgentRunJournal, type AgentRunEvent } from "./agentRunJournal.js";
import { getTargetRepository } from "../github/repositoryConfig.js";
import { assertCommitSha, assertValidBranchRef, GitHubClient } from "../github/githubClient.js";
import type { TestExecutionEvidence } from "../agents/tester/agent.js";

type ChangeFile = { path: string; content: string; message: string };
const REQUIRED_TEZJET_CI_JOBS = ["Typecheck and API tests"];
const REQUIRED_TEZJET_CI_STEPS = ["Typecheck", "API integration tests"];

export type PipelineDependencies = {
  generate: typeof generateChanges;
  review: typeof reviewChangeSet;
  scan: typeof inspectProposedChanges;
  security: typeof inspectSecurity;
  prepare: typeof prepareTezJetChange;
  wait: typeof waitForCiGate;
  repair: typeof retryFailedCi;
  verify: typeof inspectTestExecution;
  getHead(branch: string): Promise<string>;
};

export type PipelineGenerationDependencies = PipelineDependencies & {
  explore: typeof inspectTezJet;
};

function verifiedTests(evidence: TestExecutionEvidence, headSha: string, branch: string) {
  if (evidence.testsExecuted !== true || evidence.status !== "passed" || evidence.expectedSha !== headSha ||
      evidence.repository !== getTargetRepository() || evidence.ref !== branch ||
      !Array.isArray(evidence.evidence) || !evidence.evidence.length || !Array.isArray(evidence.jobs) ||
      !evidence.evidence.every(run => Number.isSafeInteger(run.runId) && run.runId > 0 &&
        typeof run.runAttempt === "number" && Number.isSafeInteger(run.runAttempt) && run.runAttempt > 0 &&
        run.headSha === headSha && run.conclusion === "success")) return false;
  if (!evidence.jobs.every(job => typeof job.head_sha === "string" &&
      job.head_sha.toLowerCase() === headSha.toLowerCase())) return false;
  const runs = evidence.evidence.map(run => ({
    id: run.runId, run_attempt: run.runAttempt, name: run.name, head_sha: run.headSha,
    status: "completed", conclusion: run.conclusion, html_url: run.url,
  }));
  return evaluateCiJobs(runs, evidence.jobs, REQUIRED_TEZJET_CI_JOBS, REQUIRED_TEZJET_CI_STEPS).status === "passed";
}

export async function analyzeTezJetTask(goal: string) {
  const [exploration, tests, security] = await Promise.all([inspectTezJet(), inspectTests(), inspectSecurity()]);
  return { goal, stages: { explorer: exploration, tester: tests, security }, next: "Use Coder to produce an explicit change set, then review, security-check, publish a branch, and wait for CI." };
}

export async function runChangePipeline(input: {
  goal: string;
  branch: string;
  title: string;
  body: string;
  files: ChangeFile[];
  journal?: AgentRunJournal;
  onEvent?: (event: AgentRunEvent) => void;
  maxRepairAttempts?: number;
  baseRef?: string;
  baseSha?: string;
}, overrides: Partial<PipelineDependencies> = {}) {
  const dependencies: PipelineDependencies = {
    generate: generateChanges, review: reviewChangeSet, scan: inspectProposedChanges, security: inspectSecurity,
    prepare: prepareTezJetChange, wait: waitForCiGate, repair: retryFailedCi, verify: inspectTestExecution,
    getHead: branch => new GitHubClient({ repository: getTargetRepository() }).getCommitSha(branch),
    ...overrides,
  };
  const journal = input.journal ?? new AgentRunJournal(input.goal, undefined, input.onEvent);
  const finish = <T extends Record<string, unknown>>(result: T) => ({
    ...result,
    taskId: journal.taskId,
    events: journal.snapshot(),
  });

  let files = input.files;
  let review: ReturnType<typeof reviewChangeSet>;
  let proposedSecurity: ReturnType<typeof inspectProposedChanges>;
  const maxRepairs = boundedRepairAttempts(input.maxRepairAttempts, 0);
  for (let repairAttempt = 0; ; repairAttempt++) {
    journal.record("agent_started", "reviewer", "Independent review started.", { files: files.map(file => file.path), repairAttempt });
    review = dependencies.review({ goal: input.goal, files, allowWorkflowChanges: process.env.AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES === "true" });
    proposedSecurity = dependencies.scan(files);
    if (review.ready && proposedSecurity.status === "clean") break;
    const actor = !review.ready ? "reviewer" : "security";
    journal.record("agent_failed", actor, "The proposed change set has blocking validation findings.", { review, proposedSecurity });
    if (repairAttempt >= maxRepairs) {
      journal.record("blocked", "commander", "Proposal repair limit reached; no files were published.", { repairAttempt });
      return finish({ status: "blocked" as const, review, proposedSecurity });
    }
    journal.handoff(actor, "coder", "Returning rejected changes to Coder for a bounded repair.", { attempt: repairAttempt + 1, maxAttempts: maxRepairs });
    journal.record("agent_started", "coder", "Repairing the rejected proposal before publication.");
    const repaired = await dependencies.generate(
      `Original task: ${input.goal}\nRepair this rejected change set without unrelated changes. Review and security diagnostics:\n${JSON.stringify({ review, proposedSecurity })}`,
      files.map(file => `FILE: ${file.path}\n${file.content}`).join("\n\n"),
    );
    if (!repaired.files.length) {
      journal.record("blocked", "coder", "Coder returned no repair files; nothing was published.");
      return finish({ status: "blocked" as const, review, proposedSecurity, reason: repaired.summary });
    }
    // A repair can replace individual files without discarding other proposed changes.
    const updated = new Map(files.map(file => [file.path, file]));
    for (const file of repaired.files) updated.set(file.path, file);
    files = [...updated.values()];
    journal.record("agent_completed", "coder", "Proposal repaired; independent validation will run again.");
  }
  journal.record("verification_passed", "reviewer", "Independent review passed for the current proposal.");
  journal.handoff("reviewer", "security", "Review passed; checking proposed files and repository security.");
  journal.record("agent_completed", "security", "Proposed-change scan passed.");

  const baseRef = input.baseRef ?? "main";
  assertValidBranchRef(baseRef);
  const baseSha = input.baseSha ?? await dependencies.getHead(baseRef);
  assertCommitSha(baseSha);
  const security = await dependencies.security(undefined, getTargetRepository(), baseSha);
  if (security.status !== "clean" || security.repository !== getTargetRepository() || security.ref !== baseSha) {
    journal.record("blocked", "security", "Repository security checks did not pass.", { status: security.status });
    return finish({ status: "blocked" as const, review, security });
  }
  journal.record("verification_passed", "security", "Security checks passed.");

  journal.handoff("security", "github", "Review and security gates passed; preparing a draft PR on the TezJet feature branch.");
  let pullRequest = await dependencies.prepare({ ...input, files, body: input.body, baseRef, baseSha });
  const headSha = pullRequest.head_sha;
  journal.record("artifact_created", "github", "Draft pull request created for the proposed change.", {
    repository: getTargetRepository(),
    branch: input.branch,
    headSha,
    url: pullRequest.html_url,
  });

  journal.handoff("github", "ci", "Checking required CI jobs against the proposed commit.", { headSha });
  const ci = await dependencies.wait({ branch: input.branch, headSha, requiredNames: REQUIRED_TEZJET_CI_JOBS, requiredStepNames: REQUIRED_TEZJET_CI_STEPS });
  if (ci.status === "failed") {
    journal.record("agent_started", "coder", "CI failed; attempting an automatic repair.", { headSha });
    const repair = await dependencies.repair({
      goal: input.goal,
      branch: input.branch,
      repositoryContext: files.map(file => `FILE: ${file.path}\n${file.content}`).join("\n\n"),
      headSha,
      journal,
    });
    if (repair.status !== "passed") {
      journal.record("blocked", "commander", "Automatic CI repair did not pass.", { repairStatus: repair.status });
      return finish({ status: "ci-repair" as const, review, security, pullRequest, ci, repair, headSha: repair.headSha });
    }
    pullRequest = { ...pullRequest, head_sha: repair.headSha, head: { ...pullRequest.head, sha: repair.headSha } };

    journal.handoff("ci", "tester", "Repair produced a new candidate commit; Tester must verify the exact final SHA.", { expectedSha: repair.headSha });
    const testEvidence = await dependencies.verify(
      repair.headSha,
      getTargetRepository(),
      input.branch,
      REQUIRED_TEZJET_CI_JOBS,
      REQUIRED_TEZJET_CI_STEPS,
    );
    const finalHead = await dependencies.getHead(input.branch);
    if (!verifiedTests(testEvidence, repair.headSha, input.branch) || finalHead !== repair.headSha) {
      journal.record("blocked", "tester", "Trusted test evidence for the final SHA is missing or unsuccessful.", { expectedSha: repair.headSha, status: testEvidence.status });
      return finish({ status: "test-evidence-blocked" as const, review, security, pullRequest, ci: repair.ci, initialCi: ci, repair, testEvidence, headSha: repair.headSha, actualHeadSha: finalHead });
    }
    journal.record("verification_passed", "tester", "Required CI evidence passed for the exact final commit.", { expectedSha: repair.headSha });
    journal.record("agent_completed", "commander", "Repair reached a verified CI result for the final commit.", { headSha: repair.headSha });
    return finish({ status: "ci-passed" as const, review, security, pullRequest, ci: repair.ci, initialCi: ci, repair, testEvidence, headSha: repair.headSha });
  }
  if (ci.status !== "passed") {
    journal.record("blocked", "commander", "Required CI checks are pending or unavailable.", { status: ci.status, headSha });
    return finish({ status: "ci-blocked" as const, review, security, pullRequest, ci });
  }
  journal.record("verification_passed", "ci", "Required CI checks passed.", { headSha });

  journal.handoff("ci", "tester", "CI passed; independently verifying trusted evidence for the exact proposed commit.", { expectedSha: headSha });
  const testEvidence = await dependencies.verify(
    headSha,
    getTargetRepository(),
    input.branch,
    REQUIRED_TEZJET_CI_JOBS,
    REQUIRED_TEZJET_CI_STEPS,
  );
  const finalHead = await dependencies.getHead(input.branch);
  if (!verifiedTests(testEvidence, headSha, input.branch) || finalHead !== headSha) {
    journal.record("blocked", "tester", "Trusted test evidence for the exact commit is missing or unsuccessful.", { expectedSha: headSha, status: testEvidence.status });
    return finish({ status: "test-evidence-blocked" as const, review, security, pullRequest, ci, testEvidence, headSha, actualHeadSha: finalHead });
  }
  journal.record("verification_passed", "tester", "Tester verified successful required checks for the exact commit.", { expectedSha: headSha });
  journal.record("agent_completed", "commander", "Task reached a verified CI result. Merge and deployment are separate actions.");
  return finish({ status: "ci-passed" as const, review, security, pullRequest, ci, testEvidence, headSha });
}

export async function generateAndPrepareTezJetChange(input: {
  goal: string;
  branch: string;
  title: string;
  body: string;
  onEvent?: (event: import("./agentRunJournal.js").AgentRunEvent) => void;
  baseRef?: string;
}, overrides: Partial<PipelineGenerationDependencies> = {}) {
  const getHead = overrides.getHead ?? ((ref: string) => new GitHubClient({ repository: getTargetRepository() }).getCommitSha(ref));
  const explore = overrides.explore ?? inspectTezJet;
  const generate = overrides.generate ?? generateChanges;
  const baseRef = input.baseRef ?? "main";
  assertValidBranchRef(baseRef);
  const journal = new AgentRunJournal(input.goal, undefined, input.onEvent);
  journal.record("agent_started", "explorer", "Reading TezJet repository context before any code generation.");
  const baseSha = await getHead(baseRef);
  assertCommitSha(baseSha);
  const exploration = await explore(undefined, baseSha, getTargetRepository());
  const available = exploration.files.filter(
    (file): file is { path: string; sha: string; content: string } => "content" in file,
  );
  const unavailable = exploration.files.filter(
    (file): file is { path: string; error: string } => "error" in file,
  );
  if (unavailable.length || exploration.repository !== getTargetRepository() || exploration.ref !== baseSha) {
    journal.record("blocked", "explorer", "Repository exploration was incomplete; refusing to generate from partial context.", {
      unavailableFiles: unavailable.map(file => file.path),
    });
    return {
      status: "blocked" as const,
      reason: "Repository exploration was incomplete; refusing to generate changes from partial context.",
      unavailableFiles: unavailable.map(file => ({ path: file.path, error: file.error })),
      taskId: journal.taskId,
      events: journal.snapshot(),
    };
  }
  journal.record("agent_completed", "explorer", "Repository context collected.", { inspectedFiles: available.map(file => file.path) });

  const context = available
    .map(file => `FILE: ${file.path}\n${file.content}`)
    .join("\n\n");
  journal.handoff("explorer", "coder", "Repository context is ready; generate a minimal explicit change set.", { inspectedFiles: available.length });
  journal.record("agent_started", "coder", "Generating proposed file changes.");
  const generated = await generate(input.goal, context);
  if (!generated.files.length) {
    journal.record("blocked", "commander", "Coder produced no change set; nothing was published.", { summary: generated.summary });
    return { status: "no-change" as const, summary: generated.summary, taskId: journal.taskId, events: journal.snapshot() };
  }
  journal.record("artifact_created", "coder", "Coder proposed a change set.", { files: generated.files.map(file => file.path), summary: generated.summary });
  journal.record("agent_completed", "coder", "Proposed change set handed to independent review.");
  return runChangePipeline({ ...input, files: generated.files, journal, baseRef, baseSha }, overrides);
}
