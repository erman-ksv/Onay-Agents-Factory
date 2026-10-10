import { TezJetRepositoryAdapter } from "../../github/tezjetRepository.js";
import { GitHubClient, type WorkflowRun } from "../../github/githubClient.js";
import { evaluateCiJobs, type CiJob, type CiGateResult } from "../../github/ciGate.js";

export type TestScriptDiscovery = {
  scripts: string[];
  validJson: boolean;
};

export type TestExecutionEvidence = {
  testsExecuted: boolean;
  repository: string;
  ref: string;
  expectedSha: string;
  status: CiGateResult["status"] | "sha-mismatch";
  evidence: Array<{ runId: number; name: string; headSha: string; conclusion: string | null; url: string }>;
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
) : TestExecutionEvidence {
  const exactRuns = runs.filter((run) => run.head_sha === expectedSha);
  const evidence = exactRuns.map((run) => ({
    runId: run.id,
    name: run.name,
    headSha: run.head_sha ?? "",
    conclusion: run.conclusion,
    url: run.html_url,
  }));

  if (!expectedSha.trim() || exactRuns.length === 0) {
    return {
      testsExecuted: false,
      repository: process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet",
      ref: "",
      expectedSha,
      status: "sha-mismatch",
      evidence,
      notes: ["No workflow run was found for the exact expected commit SHA; test execution is unverified."],
    };
  }

  const gate = evaluateCiJobs(exactRuns, jobs, requiredNames);
  return {
    testsExecuted: gate.status === "passed",
    repository: process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet",
    ref: "",
    expectedSha,
    status: gate.status,
    evidence,
    notes: gate.status === "passed"
      ? ["Required CI checks succeeded for the exact commit SHA."]
      : ["Required CI checks have not all succeeded for the exact commit SHA."],
  };
}

export async function inspectTestExecution(
  expectedSha: string,
  repository = process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet",
  ref = "main",
  requiredNames: string[] = ["Typecheck and API tests"],
): Promise<TestExecutionEvidence> {
  if (!expectedSha.trim()) {
    return {
      testsExecuted: false, repository, ref, expectedSha, status: "sha-mismatch",
      evidence: [], notes: ["An expected commit SHA is required to verify test execution."],
    };
  }
  const github = new GitHubClient({ repository });
  const runs = await github.getWorkflowRuns(ref, expectedSha);
  const exactRuns = runs.filter((run) => run.head_sha === expectedSha);
  const jobs: CiJob[] = [];
  for (const run of exactRuns) {
    const result = await github.getWorkflowJobs(run.id);
    jobs.push(...result.jobs);
  }
  const evaluated = evaluateTestExecutionEvidence(exactRuns, jobs, expectedSha, requiredNames);
  return { ...evaluated, repository, ref };
}

export async function inspectTests(repository = process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet", ref = "main") {
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
