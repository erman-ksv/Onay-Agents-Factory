import { inspectTezJet } from "../github/tezjetExplorer.js";
import { inspectTests } from "../agents/tester/agent.js";
import { inspectProposedChanges, inspectSecurity } from "../agents/security/agent.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";
import { generateChanges } from "../agents/backend/coder.js";
import { prepareTezJetChange } from "../github/changeWorkflow.js";
import { waitForCiGate } from "../github/ciGate.js";
import { retryFailedCi } from "./retryLoop.js";

type ChangeFile = { path: string; content: string; message: string };

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
  const ci = await waitForCiGate({ branch: input.branch, headSha, requiredNames: ["test", "check", "lint", "type"] });
  if (ci.status === "failed") {
    const repair = await retryFailedCi({
      goal: input.goal,
      branch: input.branch,
      repositoryContext: input.files.map(file => `FILE: ${file.path}\n${file.content}`).join("\n\n"),
      headSha,
    });
    return { status: repair.status === "passed" ? "ci-passed" as const : "ci-repair" as const, review, security, pullRequest, ci, repair };
  }
  if (ci.status !== "passed") return { status: "ci-blocked" as const, review, security, pullRequest, ci };
  return { status: "ci-passed" as const, review, security, pullRequest, ci };
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
