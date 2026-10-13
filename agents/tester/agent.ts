import { TezJetRepositoryAdapter } from "../../github/tezjetRepository.js";
import { assertCommitSha, filterWorkflowRunsBySha, GitHubClient, type WorkflowRun } from "../../github/githubClient.js";
import { evaluateCiJobs, filterCiJobsForRuns, type CiJob, type CiGateResult } from "../../github/ciGate.js";
import { getTargetRepository } from "../../github/repositoryConfig.js";

export type TestScriptDiscovery = {
  scripts: string[];
  validJson: boolean;
};

export type TestExecutionEvidence = {
  testsExecuted: boolean;
  repository: string;
  ref: string;
  expectedSha: string;
  status: CiGateResult["status"] | "sha-mismatch" | "no-runs";
  evidence: Array<{ runId: number; runAttempt?: number; name: string; headSha: string; conclusion: string | null; url: string }>;
  checks: Array<{ runId?: number; runAttempt?: number; jobName: string; name: string; status: string; conclusion: string | null }>;
  jobs?: CiJob[];
  notes: string[];
};

export function discoverTestScripts(packageJsonContent: string): TestScriptDiscovery {
  try {
    const pkg = JSON.parse(packageJsonContent) as { scripts?: Record<string, unknown> };
    const scripts = Object.entries(pkg.scripts ?? {})
      .filter(([name, command]) => /test|check|lint|type/i.test(name) && typeof command === "string")
      .map(([name, command]) => name + ": " + command);
    return { scripts, validJson: true };
  } catch {
    return { scripts: [], validJson: false };
  }
}

/**
 * Only mark tests executed when a completed successful workflow for the exact
 * requested commit SHA includes every required test/check job.
 */
export function evaluateTestExecutionEvidence(
  runs: WorkflowRun[],
  jobs: CiJob[],
  expectedSha: string,
  requiredNames: string[] = ["Typecheck and API tests"],
  requiredStepNames: string[] = [],
) : TestExecutionEvidence {
  const validSha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(expectedSha);
  const exactRuns = validSha ? filterWorkflowRunsBySha(runs, expectedSha) : [];
  const evidence = exactRuns.map((run) => ({
    runId: run.id,
    runAttempt: run.run_attempt,
    name: run.name,
    headSha: run.head_sha ?? "",
    conclusion: run.conclusion,
    url: run.html_url,
  }));
  const verifiedJobs = filterCiJobsForRuns(exactRuns, jobs);
  const checks = verifiedJobs.flatMap((job) => (job.steps ?? []).map((step) => ({
    runId: job.run_id,
    runAttempt: job.run_attempt,
    jobName: job.name,
    name: step.name,
    status: step.status,
    conclusion: step.conclusion,
  })));

  if (!validSha || exactRuns.length === 0) {
    return {
      testsExecuted: false,
      repository: getTargetRepository(),
      ref: "",
      expectedSha,
      status: validSha && runs.length === 0 ? "no-runs" : "sha-mismatch",
      evidence,
      checks,
      jobs: verifiedJobs,
      notes: ["No workflow run was found for the exact expected commit SHA; test execution is unverified."],
    };
  }

  const gate = evaluateCiJobs(exactRuns, verifiedJobs, requiredNames, requiredStepNames);
  return {
    testsExecuted: gate.status === "passed",
    repository: getTargetRepository(),
    ref: "",
    expectedSha,
    status: gate.status,
    evidence,
    checks,
    jobs: verifiedJobs,
    notes: gate.status === "passed"
      ? ["Required CI jobs and steps succeeded for the exact commit SHA."]
      : ["Required CI jobs or steps have not all succeeded for the exact commit SHA."],
  };
}

export async function inspectTestExecution(
  expectedSha: string,
  repository = getTargetRepository(),
  ref = "main",
  requiredNames: string[] = ["Typecheck and API tests"],
  requiredStepNames: string[] = [],
): Promise<TestExecutionEvidence> {
  if (!expectedSha.trim()) {
    return {
      testsExecuted: false, repository, ref, expectedSha, status: "sha-mismatch",
      evidence: [], checks: [], notes: ["An expected commit SHA is required to verify test execution."],
    };
  }
  assertCommitSha(expectedSha);
  const github = new GitHubClient({ repository });
  const runs = await github.getWorkflowRuns(ref, expectedSha);
  const exactRuns = filterWorkflowRunsBySha(runs, expectedSha);
  const jobs: CiJob[] = [];
  for (const run of exactRuns) {
    const result = await github.getWorkflowJobs(run.id, run.run_attempt);
    jobs.push(...result.jobs);
  }
  const evaluated = evaluateTestExecutionEvidence(runs, jobs, expectedSha, requiredNames, requiredStepNames);
  return { ...evaluated, repository, ref };
}

/**
 * Resolve the current branch head and verify trusted CI evidence for that exact SHA.
 * A missing token, SHA, workflow, or required job is reported as unverified.
 */
export async function inspectRefTestExecution(
  repository: string,
  ref: string,
  requiredNames: string[],
  requiredStepNames: string[] = [],
): Promise<TestExecutionEvidence> {
  try {
    const github = new GitHubClient({ repository });
    const expectedSha = await github.getCommitSha(ref);
    return await inspectTestExecution(expectedSha, repository, ref, requiredNames, requiredStepNames);
  } catch (error) {
    return {
      testsExecuted: false,
      repository,
      ref,
      expectedSha: "",
      status: "no-runs",
      evidence: [],
      checks: [],
      notes: [`Could not verify CI evidence for ${repository}@${ref}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

export async function inspectTests(repository = getTargetRepository(), ref = "main") {
  const adapter = new TezJetRepositoryAdapter(repository);
  const packageJson = await adapter.read("package.json", ref);
  const discovery = discoverTestScripts(packageJson.content);
  if (!discovery.validJson) {
    return { repository, ref, scripts: discovery.scripts, notes: ["package.json is not valid JSON"] };
  }
  return {
    repository,
    ref,
    scripts: discovery.scripts,
    notes: ["Discovery only: call inspectTestExecution with the exact proposed commit SHA to verify trusted CI evidence."],
  };
}

export function runTester(input: string) {
  return { agent: "tester", input, action: "inspect test coverage and verify trusted CI evidence for an exact commit SHA" };
}
