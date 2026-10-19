import { TeamTaskStore } from "./teamTaskStore.js";
import { prepareTeamTask } from "./teamTaskCard.js";
import type { TestExecutionEvidence } from "../agents/tester/agent.js";

export type TeamTaskCiVerification = {
  taskId: string; status: "ci-verified" | "needs-review" | "blocked";
  reasonCode: string; candidateSha?: string; url?: string;
  testsExecuted: boolean; modelRequests: 0; githubWrites: false;
  overallTaskCompletionVerified: false;
};
export async function verifyRecordedTeamTask(input: unknown, directory: string, dependencies: {
  getCandidateHead(branch: string): Promise<string>;
  getPullRequest(number: number): Promise<{ state: string; draft: boolean; html_url: string;
    head: { ref: string; sha: string; repo: { full_name: string } }; base: { ref: string } }>;
  verify(sha: string, branch: string): Promise<TestExecutionEvidence>;
}): Promise<TeamTaskCiVerification> {
  const task = prepareTeamTask(input);
  const store = new TeamTaskStore(directory, { id: task.id, fingerprint: task.fingerprint });
  const result: TeamTaskCiVerification = { taskId: task.id, status: "blocked",
    reasonCode: "receipt_requires_inspection", testsExecuted: false, modelRequests: 0,
    githubWrites: false, overallTaskCompletionVerified: false };
  try {
    const receipt = store.inspectExisting();
    if (!receipt) return result;
    const publication = receipt.publication;
    if (!publication || publication.branch !== task.branch ||
      publication.url !== "https://github.com/" + task.repository + "/pull/" + publication.number) return result;
    const pr = await dependencies.getPullRequest(publication.number);
    const head = await dependencies.getCandidateHead(task.branch);
    if (pr.state !== "open" || !pr.draft || pr.html_url !== publication.url ||
        pr.head.ref !== task.branch || pr.head.repo.full_name !== task.repository ||
        pr.head.sha !== publication.headSha || head !== publication.headSha || pr.base.ref !== task.baseRef)
      return { ...result, reasonCode: "candidate_changed_inspect_github" };
    const evidence = await dependencies.verify(publication.headSha, task.branch);
    // Re-read after CI to reject a moved candidate. Receipts alone prove none of these checks.
    const finalHead = await dependencies.getCandidateHead(task.branch);
    const passed = finalHead === head && evidence.testsExecuted === true && evidence.status === "passed" &&
      evidence.expectedSha === head && evidence.repository === task.repository && evidence.ref === task.branch &&
      evidence.evidence.length > 0 && evidence.evidence.every(run => run.headSha === head && run.conclusion === "success");
    return { ...result, status: passed ? "ci-verified" : "needs-review",
      reasonCode: passed ? "exact_candidate_ci_verified" : "candidate_ci_unverified",
      candidateSha: publication.headSha, url: publication.url, testsExecuted: passed };
  } catch {
    return { ...result, reasonCode: "verification_failed_inspect_github" };
  } finally { store.close(); }
}
