import { inspectTezJet } from "../github/tezjetExplorer.js";
import { inspectTestExecution, inspectTests } from "../agents/tester/agent.js";
import { inspectProposedChanges, inspectSecurity } from "../agents/security/agent.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";
import { generateChanges } from "../agents/backend/coder.js";
import { prepareTezJetChange } from "../github/changeWorkflow.js";
import { waitForCiGate } from "../github/ciGate.js";
import { retryFailedCi } from "./retryLoop.js";
import { AgentRunJournal, type AgentRunEvent } from "./agentRunJournal.js";

type ChangeFile = { path: string; content: string; message: string };
const REQUIRED_TEZJET_CI_JOBS = ["Typecheck and API tests"];

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
}) {
  const journal = input.journal ?? new AgentRunJournal(input.goal, undefined, input.onEvent);
  const finish = <T extends Record<string, unknown>>(result: T) => ({
    ...result,
    taskId: journal.taskId,
    events: journal.snapshot(),
  });

  journal.record("agent_started", "reviewer", "Independent review started.", { files: input.files.map(file => file.path) });
  const review = reviewChangeSet({ goal: input.goal, files: input.files });
  journal.record("agent_completed", "reviewer", review.ready ? "Review passed." : "Review found blocking issues.", { ready: review.ready });
  if (!review.ready) {
    journal.record("blocked", "commander", "Stopped before publishing because independent review did not pass.");
    return finish({ status: "blocked" as const, review });
  }

  journal.handoff("reviewer", "security", "Review passed; checking proposed files and repository security.");
  journal.record("agent_started", "security", "Scanning proposed changes for secret-like values.");
  const proposedSecurity = inspectProposedChanges(input.files);
  if (proposedSecurity.status !== "clean") {
    journal.record("blocked", "security", "Proposed-change security scan did not pass.", { status: proposedSecurity.status });
    return finish({ status: "blocked" as const, review, proposedSecurity });
  }
  journal.record("agent_completed", "security", "Proposed-change scan passed.");

  const security = await inspectSecurity(input.files.map(file => file.path), "erman-ksv/TezJet", "main");
  if (security.status !== "clean") {
    journal.record("blocked", "security", "Repository security checks did not pass.", { status: security.status });
    return finish({ status: "blocked" as const, review, security });
  }
  journal.record("verification_passed", "security", "Security checks passed.");

  journal.handoff("security", "github", "Review and security gates passed; preparing a draft PR on the TezJet feature branch.");
  const pullRequest = await prepareTezJetChange({ ...input, body: input.body });
  const headSha = pullRequest.head_sha;
  journal.record("artifact_created", "github", "Draft pull request created for the proposed change.", {
    repository: process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet",
    branch: input.branch,
    headSha,
    url: pullRequest.html_url,
  });

  journal.handoff("github", "ci", "Checking required CI jobs against the proposed commit.", { headSha });
  const ci = await waitForCiGate({ branch: input.branch, headSha, requiredNames: REQUIRED_TEZJET_CI_JOBS });
  if (ci.status === "failed") {
    journal.record("agent_started", "coder", "CI failed; attempting an automatic repair.", { headSha });
    const repair = await retryFailedCi({
      goal: input.goal,
      branch: input.branch,
      repositoryContext: input.files.map(file => `FILE: ${file.path}\n${file.content}`).join("\n\n"),
      headSha,
    });
    if (repair.status !== "passed") {
      journal.record("blocked", "commander", "Automatic CI repair did not pass.", { repairStatus: repair.status });
      return finish({ status: "ci-repair" as const, review, security, pullRequest, ci, repair });
    }

    journal.handoff("ci", "tester", "Repair produced a new candidate commit; Tester must verify the exact final SHA.", { expectedSha: repair.headSha });
    const testEvidence = await inspectTestExecution(
      repair.headSha,
      process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet",
      input.branch,
      REQUIRED_TEZJET_CI_JOBS,
    );
    if (!testEvidence.testsExecuted) {
      journal.record("blocked", "tester", "Trusted test evidence for the final SHA is missing or unsuccessful.", { expectedSha: repair.headSha, status: testEvidence.status });
      return finish({ status: "test-evidence-blocked" as const, review, security, pullRequest, ci, repair, testEvidence });
    }
    journal.record("verification_passed", "tester", "Required CI evidence passed for the exact final commit.", { expectedSha: repair.headSha });
    return finish({ status: "ci-passed" as const, review, security, pullRequest, ci, repair, testEvidence });
  }
  if (ci.status !== "passed") {
    journal.record("blocked", "commander", "Required CI checks are pending or unavailable.", { status: ci.status, headSha });
    return finish({ status: "ci-blocked" as const, review, security, pullRequest, ci });
  }
  journal.record("verification_passed", "ci", "Required CI checks passed.", { headSha });

  journal.handoff("ci", "tester", "CI passed; independently verifying trusted evidence for the exact proposed commit.", { expectedSha: headSha });
  const testEvidence = await inspectTestExecution(
    headSha,
    process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet",
    input.branch,
    REQUIRED_TEZJET_CI_JOBS,
  );
  if (!testEvidence.testsExecuted) {
    journal.record("blocked", "tester", "Trusted test evidence for the exact commit is missing or unsuccessful.", { expectedSha: headSha, status: testEvidence.status });
    return finish({ status: "test-evidence-blocked" as const, review, security, pullRequest, ci, testEvidence });
  }
  journal.record("verification_passed", "tester", "Tester verified successful required checks for the exact commit.", { expectedSha: headSha });
  journal.record("agent_completed", "commander", "Task reached a verified CI result. Merge and deployment are separate actions.");
  return finish({ status: "ci-passed" as const, review, security, pullRequest, ci, testEvidence });
}

export async function generateAndPrepareTezJetChange(input: {
  goal: string;
  branch: string;
  title: string;
  body: string;
  onEvent?: (event: import("./agentRunJournal.js").AgentRunEvent) => void;
}) {
  const journal = new AgentRunJournal(input.goal, undefined, input.onEvent);
  journal.record("agent_started", "explorer", "Reading TezJet repository context before any code generation.");
  const exploration = await inspectTezJet();
  const available = exploration.files.filter(
    (file): file is { path: string; sha: string; content: string } => "content" in file,
  );
  const unavailable = exploration.files.filter(
    (file): file is { path: string; error: string } => "error" in file,
  );
  if (unavailable.length) {
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
  const generated = await generateChanges(input.goal, context);
  if (!generated.files.length) {
    journal.record("blocked", "commander", "Coder produced no change set; nothing was published.", { summary: generated.summary });
    return { status: "no-change" as const, summary: generated.summary, taskId: journal.taskId, events: journal.snapshot() };
  }
  journal.record("artifact_created", "coder", "Coder proposed a change set.", { files: generated.files.map(file => file.path), summary: generated.summary });
  journal.record("agent_completed", "coder", "Proposed change set handed to independent review.");
  return runChangePipeline({ ...input, files: generated.files, journal });
}
