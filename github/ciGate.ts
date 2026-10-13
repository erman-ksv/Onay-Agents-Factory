import { assertCommitSha, filterWorkflowRunsBySha, GitHubClient, type WorkflowRun } from "./githubClient.js";
import { getTargetRepository } from "./repositoryConfig.js";
import { assertRepositoryAllowed, resolveAllowedRepositories } from "./repositoryPolicy.js";

export type CiGateResult =
  | { status: "passed"; runs: WorkflowRun[] }
  | { status: "failed" | "pending" | "no-runs"; runs: WorkflowRun[] };

export type CiJobStep = { name: string; status: string; conclusion: string | null };
export type CiJob = {
  name: string; status: string; conclusion: string | null; steps?: CiJobStep[];
  run_id?: number; run_attempt?: number; head_sha?: string;
};

/** Only jobs with provenance from the selected run and attempt can prove CI. */
export function filterCiJobsForRuns(runs: WorkflowRun[], jobs: CiJob[]): CiJob[] {
  return jobs.filter(job => runs.some(run => job.run_id === run.id &&
    (run.run_attempt === undefined || job.run_attempt === run.run_attempt) &&
    (!job.head_sha || !run.head_sha || job.head_sha.toLowerCase() === run.head_sha.toLowerCase())));
}

function matchesJobName(actual: string, required: string): boolean {
  const name = actual.trim().toLowerCase();
  const expected = required.trim().toLowerCase();
  return !!expected && (name === expected || (name.startsWith(`${expected} (`) && name.endsWith(")")));
}

export function evaluateCiJobs(
  runs: WorkflowRun[],
  jobs: CiJob[],
  requiredNames: string[] = [],
  requiredStepNames: string[] = [],
): CiGateResult {
  if (!runs.length) return { status: "no-runs", runs };

  // A required job succeeding must never mask a failed or still-running workflow
  // for the same commit. Evaluate run-level status before matching job names.
  if (runs.some(run => run.status !== "completed")) return { status: "pending", runs };
  if (runs.some(run => run.conclusion !== "success")) return { status: "failed", runs };

  if (!requiredNames.length && !requiredStepNames.length) return { status: "passed", runs };

  const verifiedJobs = filterCiJobsForRuns(runs, jobs);
  const matched = requiredNames.map(name => verifiedJobs.filter(job => matchesJobName(job.name, name)));

  // Missing required checks are not evidence of success. Keep the gate closed.
  if (matched.some(matches => matches.length === 0)) return { status: "pending", runs };
  const requiredJobs = requiredNames.length ? [...new Set(matched.flat())] : verifiedJobs;
  if (!requiredJobs.length) return { status: "pending", runs };
  if (requiredJobs.some(job => job.status !== "completed")) return { status: "pending", runs };
  if (requiredJobs.some(job => job.conclusion !== "success")) return { status: "failed", runs };

  if (requiredStepNames.length) {
    // Each required job must contain its own required steps. Pooling steps from
    // unrelated jobs or matrix entries can turn a skipped test into false proof.
    for (const job of requiredJobs) {
      const matchedSteps = requiredStepNames.map(name => (job.steps ?? []).filter(step =>
        !!name.trim() && step.name.trim().toLowerCase() === name.trim().toLowerCase()));
      if (matchedSteps.some(matches => matches.length === 0)) return { status: "pending", runs };
      const steps = matchedSteps.flat();
      if (steps.some(step => step.status !== "completed")) return { status: "pending", runs };
      if (steps.some(step => step.conclusion !== "success")) return { status: "failed", runs };
    }
  }
  return { status: "passed", runs };
}

export type CiGateOptions = { repository?: string; requiredStepNames?: string[] };
export type CiGateInput = CiGateOptions & { branch: string; requiredNames?: string[]; headSha?: string };

export function checkCiGate(input: CiGateInput): Promise<CiGateResult>;
export function checkCiGate(branch: string, requiredNames?: string[], headSha?: string, options?: CiGateOptions): Promise<CiGateResult>;
export async function checkCiGate(
  branchOrInput: string | CiGateInput,
  requiredNames: string[] = [],
  headSha?: string,
  options: CiGateOptions = {},
): Promise<CiGateResult> {
  const input = typeof branchOrInput === "string"
    ? { branch: branchOrInput, requiredNames, headSha, ...options }
    : branchOrInput;
  const repository = input.repository ?? getTargetRepository();
  assertRepositoryAllowed(repository, resolveAllowedRepositories(process.env.AGENT_ALLOWED_REPOSITORIES, getTargetRepository()));
  const github = new GitHubClient({ repository });
  const expectedSha = input.headSha ?? await github.getCommitSha(input.branch);
  assertCommitSha(expectedSha);
  const fetchedRuns = await github.getWorkflowRuns(input.branch, expectedSha);
  const runs = filterWorkflowRunsBySha(fetchedRuns, expectedSha);
  if (!runs.length) return { status: "no-runs", runs };

  const jobGroups = [];
  for (const run of runs) {
    const result = await github.getWorkflowJobs(run.id, run.run_attempt);
    jobGroups.push(...result.jobs);
  }
  return evaluateCiJobs(runs, jobGroups, input.requiredNames ?? [], input.requiredStepNames ?? []);
}

export async function waitForCiGate(input: CiGateInput & {
  timeoutMs?: number;
  pollMs?: number;
}): Promise<CiGateResult> {
  const timeoutMs = Math.max(10_000, input.timeoutMs ?? 300_000);
  const pollMs = Math.max(2_000, input.pollMs ?? 10_000);
  const started = Date.now();
  const repository = input.repository ?? getTargetRepository();
  assertRepositoryAllowed(repository, resolveAllowedRepositories(process.env.AGENT_ALLOWED_REPOSITORIES, getTargetRepository()));
  const expectedSha = input.headSha ?? await new GitHubClient({ repository }).getCommitSha(input.branch);
  assertCommitSha(expectedSha);
  const pinnedInput = { ...input, headSha: expectedSha };

  while (Date.now() - started <= timeoutMs) {
    const gate = await checkCiGate(pinnedInput);
    if (gate.status === "passed" || gate.status === "failed") return gate;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }

  return checkCiGate(pinnedInput);
}

export async function getCiFailureContext(
  branch: string,
  headSha?: string,
  requiredNames: string[] = [],
  options: CiGateOptions = {},
) {
  const repository = options.repository ?? getTargetRepository();
  const github = new GitHubClient({ repository });
  const gate = await checkCiGate(branch, requiredNames, headSha, options);
  const failed = gate.status === "passed" ? [] : gate.runs;
  const jobs = [];
  for (const run of failed) {
    const result = await github.getWorkflowJobs(run.id, run.run_attempt);
    jobs.push({ run, jobs: result.jobs });
  }
  return { gate, failures: jobs };
}

