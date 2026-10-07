import { GitHubClient } from "./githubClient.js";

export type CiGateResult =
  | { status: "passed"; runs: Array<{ id: number; name: string; conclusion: string | null; html_url: string }> }
  | { status: "failed" | "pending" | "no-runs"; runs: Array<{ id: number; name: string; status: string; conclusion: string | null; html_url: string }> };

export async function checkCiGate(branch: string, requiredNames: string[] = []): Promise<CiGateResult> {
  const repository = process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet";
  const github = new GitHubClient({ repository });
  const runs = await github.getWorkflowRuns(branch);
  if (!runs.length) return { status: "no-runs", runs };

  const relevant = requiredNames.length
    ? runs.filter(run => requiredNames.some(name => run.name.toLowerCase().includes(name.toLowerCase())))
    : runs;
  if (!relevant.length) return { status: "no-runs", runs };
  if (relevant.some(run => run.status !== "completed")) return { status: "pending", runs: relevant };
  if (relevant.some(run => run.conclusion !== "success")) return { status: "failed", runs: relevant };
  return { status: "passed", runs: relevant };
}

export async function getCiFailureContext(branch: string) {
  const repository = process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet";
  const github = new GitHubClient({ repository });
  const gate = await checkCiGate(branch);
  const failed = gate.runs.filter(run => run.conclusion && run.conclusion !== "success");
  const jobs = [];
  for (const run of failed) {
    const result = await github.getWorkflowJobs(run.id);
    jobs.push({ run, jobs: result.jobs });
  }
  return { gate, failures: jobs };
}
