import { inspectTezJet } from "../github/tezjetExplorer.js";
import { inspectTests } from "../agents/tester/agent.js";
import { inspectSecurity } from "../agents/security/agent.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";
import { prepareTezJetChange } from "../github/changeWorkflow.js";

type ChangeFile = { path: string; content: string; message: string };

export async function analyzeTezJetTask(goal: string) {
  const [exploration, tests, security] = await Promise.all([inspectTezJet(), inspectTests(), inspectSecurity()]);
  return { goal, stages: { explorer: exploration, tester: tests, security }, next: "Produce an explicit change set, review it, then run CI before merge." };
}

export async function runChangePipeline(input: {
  goal: string;
  branch: string;
  title: string;
  body: string;
  files: ChangeFile[];
}) {
  const review = reviewChangeSet({ goal: input.goal, files: input.files });
  if (!review.ready) return { status: "blocked" as const, review };
  const security = await inspectSecurity(input.files.map(file => file.path), "erman-ksv/TezJet", "main");
  if (security.status !== "clean") return { status: "blocked" as const, review, security };
  const pullRequest = await prepareTezJetChange({ branch: input.branch, title: input.title, body: input.body, files: input.files });
  return { status: "draft-pr-created" as const, review, security, pullRequest };
}