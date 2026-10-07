import { GitHubClient, type WorkflowRun } from "./githubClient.js";

export type CiGateResult =
  | { status: "passed"; runs: WorkflowRun[] }
  | { status: "failed" | "pending" | "no-runs"; runs: WorkflowRun[] };

export async function checkCiGate(branch: string, requiredNames: string[] = [], headSha?: string): Promise<CiGateResult> {
  const repository = process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet";
  const github = new GitHubClient({ repository });
  const runs = await github.getWorkflowRuns(branch, headSha);

  const relevant = requiredNames.length
    ? runs.filter(run => requiredNames.some(name => run.name.toLowerCase().includes(name.toLowerCase())))
    : runs;

  if (!relevant.length) return { status: "no-runs", runs };
  if (relevant.some(run => run.status !== "completed")) return { status: "pending", runs: relevant };
  if (relevant.some(run => run.conclusion !== "success")) return { status: "failed", runs: relevant };
  return { status: "passed", runs: relevant };
}

export async function waitForCiGate(input: {
  branch: string;
  headSha?: string;
  requiredNames?: string[];
  timeoutMs?: number;
  pollMs?: number;
}): Promise<CiGateResult> {
  const timeoutMs = Math.max(10_000, input.timeoutMs ?? 300_000);
  const pollMs = Math.max(2_000, input.pollMs ?? 10_000);
  const started = Date.now();

  while (Date.now() - started <= timeoutMs) {
    const gate = await checkCiGate(input.branch, input.requiredNames ?? [], input.headSha);
    if (gate.status === "passed" || gate.status === "failed") return gate;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }

  return checkCiGate(input.branch, input.requiredNames ?? [], input.headSha);
}

export async function getCiFailureContext(branch: string, headSha?: string) {
  const repository = process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet";
  const github = new GitHubClient({ repository });
  const gate = await checkCiGate(branch, [], headSha);
  const failed = gate.runs.filter(run => run.conclusion && run.conclusion !== "success");
  const jobs = [];
  for (const run of failed) {
    const result = await github.getWorkflowJobs(run.id);
    jobs.push({ run, jobs: result.jobs });
  }
  return { gate, failures: jobs };
}
