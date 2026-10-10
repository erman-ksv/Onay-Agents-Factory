import { inspectTezJet } from "../github/tezjetExplorer.js";
import { inspectTestExecution, inspectTests } from "../agents/tester/agent.js";
import { inspectProposedChanges, inspectSecurity } from "../agents/security/agent.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";
import { generateChanges } from "../agents/backend/coder.js";
import { prepareTezJetChange } from "../github/changeWorkflow.js";
import { waitForCiGate } from "../github/ciGate.js";
import { retryFailedCi } from "./retryLoop.js";

type ChangeFile = { path: string; content: string; message: string };
const REQUIRED_TEZJET_CI_JOBS = ["Typecheck and API tests"];

export async function analyzeTezJetTask(goal: string) {
  const [exploration, tests, security] = await Promise.all([inspectTezJet(), inspectTests(), inspectSecurity()]);
  return { goal, stages: { explorer: exploration, tester: tests, security }, next: "Use Coder to produce an explicit change set, then review, security-check, publish a branch, and wait for CI." };
}

export async function runChangePipeline(input: { goal: string; branch: string; title: string; body: string; files: ChangeFile[] }) {
  const review = reviewChangeSet({ goal: input.goal, files: input.files });
  if (!review.ready) return { status: "blocked" as const, review };

  const proposedSecurity = inspectProposedChanges(input.files);
  if (proposedSecurity.status !== "clean") {
    return { status: "blocked" as const, review, proposedSecurity };
  }

  const security = await inspectSecurity(input.files.map(file => file.path), "erman-ksv/TezJet", "main");
  if (security.status !== "clean") return { status: "blocked" as const, review, security };

  const pullRequest = await prepareTezJetChange({ ...input, body: input.body });
  const headSha = pullRequest.head_sha;
  const ci = await waitForCiGate({ branch: input.branch, headSha, requiredNames: REQUIRED_TEZJET_CI_JOBS });
  if (ci.status === "failed") {
    const repair = await retryFailedCi({
      goal: input.goal,
      branch: input.branch,
      repositoryContext: input.files.map(file => `FILE: ${file.path}\n${file.content}`).join("\n\n"),
      headSha,
    });
    if (repair.status !== "passed") {
      return { status: "ci-repair" as const, review, security, pullRequest, ci, repair };
    }

    // Retry may create a new commit. Verify CI evidence against that exact final SHA.
    const testEvidence = await inspectTestExecution(
      repair.headSha,
      process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet",
      input.branch,
      REQUIRED_TEZJET_CI_JOBS,
    );
    return testEvidence.testsExecuted
      ? { status: "ci-passed" as const, review, security, pullRequest, ci, repair, testEvidence }
      : { status: "test-evidence-blocked" as const, review, security, pullRequest, ci, repair, testEvidence };
  }
  if (ci.status !== "passed") return { status: "ci-blocked" as const, review, security, pullRequest, ci };

  // The publish pipeline requires the Tester to independently confirm that the
  // required job succeeded for this exact commit, not merely that CI was found.
  const testEvidence = await inspectTestExecution(
    headSha,
    process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet",
    input.branch,
    REQUIRED_TEZJET_CI_JOBS,
  );
  if (!testEvidence.testsExecuted) {
    return { status: "test-evidence-blocked" as const, review, security, pullRequest, ci, testEvidence };
  }
  return { status: "ci-passed" as const, review, security, pullRequest, ci, testEvidence };
}

export async function generateAndPrepareTezJetChange(input: { goal: string; branch: string; title: string; body: string }) {
  const exploration = await inspectTezJet();
  const available = exploration.files.filter(
    (file): file is { path: string; sha: string; content: string } => "content" in file,
  );
  const unavailable = exploration.files.filter(
    (file): file is { path: string; error: string } => "error" in file,
  );
  if (unavailable.length) {
    return {
      status: "blocked" as const,
      reason: "Repository exploration was incomplete; refusing to generate changes from partial context.",
      unavailableFiles: unavailable.map(file => ({ path: file.path, error: file.error })),
    };
  }

  const context = available
    .map(file => `FILE: ${file.path}\n${file.content}`)
    .join("\n\n");
  const generated = await generateChanges(input.goal, context);
  if (!generated.files.length) return { status: "no-change" as const, summary: generated.summary };
  return runChangePipeline({ ...input, files: generated.files });
}
