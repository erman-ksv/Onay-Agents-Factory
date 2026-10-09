import { GitHubClient, type WorkflowRun } from "./githubClient.js";

export type CiGateResult =
  | { status: "passed"; runs: WorkflowRun[] }
  | { status: "failed" | "pending" | "no-runs"; runs: WorkflowRun[] };

export async function checkCiGate(branch: string, requiredNames: string[] = [], headSha?: string): Promise<CiGateResult> {
  const repository = process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet";
  const github = new GitHubClient({ repository });
  const fetchedRuns = await github.getWorkflowRuns(branch, headSha);
  // Keep the SHA check locally too: never let a run for a different commit satisfy this gate.
  const runs = headSha
    ? fetchedRuns.filter(run => run.head_sha?.toLowerCase() === headSha.toLowerCase())
    : fetchedRuns;

  if (!runs.length) return { status: "no-runs", runs: [] };

  if (!requiredNames.length) {
    if (runs.some(run => run.status !== "completed")) return { status: "pending", runs };
    if (runs.some(run => run.conclusion !== "success")) return { status: "failed", runs };
    return { status: "passed", runs };
  }

  // GitHub Actions run.name is the workflow name (for example, "Agent Factory CI"),
  // while checks such as "typecheck" are job names. Match the required names against jobs.
  const matchingRuns: WorkflowRun[] = [];
  const matchingJobs: Array<{ status: string; conclusion: string | null }> = [];

  for (const run of runs) {
    const { jobs } = await github.getWorkflowJobs(run.id);
    const selectedJobs = jobs.filter(job =>
      requiredNames.some(name => job.name.toLowerCase().includes(name.toLowerCase())),
    );
    if (selectedJobs.length) {
      matchingRuns.push(run);
      matchingJobs.push(...selectedJobs);
    }
  }

  if (!matchingRuns.length) return { status: "no-runs", runs };
  if (matchingRuns.some(run => run.status !== "completed") || matchingJobs.some(job => job.status !== "completed")) {
    return { status: "pending", runs: matchingRuns };
  }
  if (matchingRuns.some(run => run.conclusion !== "success") || matchingJobs.some(job => job.conclusion !== "success")) {
    return { status: "failed", runs: matchingRuns };
  }
  return { status: "passed", runs: matchingRuns };
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
