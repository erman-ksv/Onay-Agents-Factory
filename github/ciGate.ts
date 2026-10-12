import { filterWorkflowRunsBySha, GitHubClient, type WorkflowRun } from "./githubClient.js";
import { getTargetRepository } from "./repositoryConfig.js";
import { assertRepositoryAllowed, resolveAllowedRepositories } from "./repositoryPolicy.js";

export type CiGateResult =
  | { status: "passed"; runs: WorkflowRun[] }
  | { status: "failed" | "pending" | "no-runs"; runs: WorkflowRun[] };

export type CiJobStep = { name: string; status: string; conclusion: string | null };
export type CiJob = { name: string; status: string; conclusion: string | null; steps?: CiJobStep[] };

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

  const normalizedJobs = jobs.map(job => ({ ...job, normalizedName: job.name.toLowerCase() }));
  const required = requiredNames.map(name => name.toLowerCase());
  const matched = required.map(name => normalizedJobs.filter(job => job.normalizedName.includes(name)));

  // Missing required checks are not evidence of success. Keep the gate closed.
  if (matched.some(matches => matches.length === 0)) return { status: "pending", runs };
  const requiredJobs = matched.flat();
  if (requiredJobs.some(job => job.status !== "completed")) return { status: "pending", runs };
  if (requiredJobs.some(job => job.conclusion !== "success")) return { status: "failed", runs };

  if (requiredStepNames.length) {
    const normalizedSteps = jobs.flatMap(job => (job.steps ?? []).map(step => ({ ...step, normalizedName: step.name.toLowerCase() })));
    const requiredSteps = requiredStepNames.map(name => name.toLowerCase());
    const matchedSteps = requiredSteps.map(name => normalizedSteps.filter(step => step.normalizedName === name));
    if (matchedSteps.some(matches => matches.length === 0)) return { status: "pending", runs };
    const steps = matchedSteps.flat();
    if (steps.some(step => step.status !== "completed")) return { status: "pending", runs };
    if (steps.some(step => step.conclusion !== "success")) return { status: "failed", runs };
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
  const fetchedRuns = await github.getWorkflowRuns(input.branch, input.headSha);
  // Fail closed if GitHub returns any run that does not belong to the requested commit.
  const runs = filterWorkflowRunsBySha(fetchedRuns, input.headSha);
  if (!runs.length) return { status: "no-runs", runs };

  const jobGroups = [];
  for (const run of runs) {
    const result = await github.getWorkflowJobs(run.id);
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

  while (Date.now() - started <= timeoutMs) {
    const gate = await checkCiGate(input);
    if (gate.status === "passed" || gate.status === "failed") return gate;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }

  return checkCiGate(input);
}

export async function getCiFailureContext(branch: string, headSha?: string) {
  const repository = getTargetRepository();
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

