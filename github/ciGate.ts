import { GitHubClient, type WorkflowRun } from "./githubClient.js";

export type CiGateResult =
  | { status: "passed"; runs: WorkflowRun[] }
  | { status: "failed" | "pending" | "no-runs"; runs: WorkflowRun[] };

export type CiJob = { name: string; status: string; conclusion: string | null };

export function evaluateCiJobs(
  runs: WorkflowRun[],
  jobs: CiJob[],
  requiredNames: string[] = [],
): CiGateResult {
  if (!runs.length) return { status: "no-runs", runs };

  // A required job succeeding must never mask a failed or still-running workflow
  // for the same commit. Evaluate run-level status before matching job names.
  if (runs.some(run => run.status !== "completed")) return { status: "pending", runs };
  if (runs.some(run => run.conclusion !== "success")) return { status: "failed", runs };

  if (!requiredNames.length) return { status: "passed", runs };

  const normalizedJobs = jobs.map(job => ({ ...job, normalizedName: job.name.toLowerCase() }));
  const required = requiredNames.map(name => name.toLowerCase());
  const matched = required.map(name => normalizedJobs.filter(job => job.normalizedName.includes(name)));

  // Missing required checks are not evidence of success. Keep the gate closed.
  if (matched.some(matches => matches.length === 0)) return { status: "pending", runs };
  const requiredJobs = matched.flat();
  if (requiredJobs.some(job => job.status !== "completed")) return { status: "pending", runs };
  if (requiredJobs.some(job => job.conclusion !== "success")) return { status: "failed", runs };
  return { status: "passed", runs };
}

export async function checkCiGate(branch: string, requiredNames: string[] = [], headSha?: string): Promise<CiGateResult> {
  const repository = process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet";
  const github = new GitHubClient({ repository });
  const runs = await github.getWorkflowRuns(branch, headSha);
  if (!runs.length) return { status: "no-runs", runs };

  const jobGroups = [];
  for (const run of runs) {
    const result = await github.getWorkflowJobs(run.id);
    jobGroups.push(...result.jobs);
  }
  return evaluateCiJobs(runs, jobGroups, requiredNames);
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
