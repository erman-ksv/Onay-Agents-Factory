import { assertValidBranchRef, GitHubClient } from "./githubClient.js";
import { assertNoSecrets } from "./secretScanner.js";
import { assertRepositoryAllowed, assertWritableBranch, resolveAllowedRepositories } from "./repositoryPolicy.js";
import { getTargetRepository } from "./repositoryConfig.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";

export class TezJetRepositoryAdapter {
  private readonly github: GitHubClient;

  constructor(repository = getTargetRepository()) {
    const allowed = resolveAllowedRepositories(process.env.AGENT_ALLOWED_REPOSITORIES, getTargetRepository());
    assertRepositoryAllowed(repository, allowed);
    this.github = new GitHubClient({ repository });
  }

  async read(path: string, ref = "main") {
    return this.github.getFile(path, ref);
  }

  async prepareBranch(branch: string, from = "main", fromSha?: string) {
    assertValidBranchRef(branch);
    assertValidBranchRef(from);
    assertWritableBranch(branch);
    return this.github.createBranch(branch, from, fromSha);
  }

  async write(path: string, content: string, message: string, branch: string) {
    assertValidBranchRef(branch);
    assertWritableBranch(branch);
    assertNoSecrets([{ path, content }]);
    const review = reviewChangeSet({
      goal: message,
      files: [{ path, content }],
      allowWorkflowChanges: process.env.AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES === "true",
    });
    if (!review.ready) {
      throw new Error("Write blocked by reviewer policy: " + review.findings.map((finding) => finding.message).join("; "));
    }
    return this.github.upsertFile(path, content, message, branch);
  }

  async openDraftPullRequest(branch: string, title: string, body = "", base = "main") {
    assertValidBranchRef(branch);
    assertValidBranchRef(base);
    assertWritableBranch(branch);
    if (branch === base) throw new Error("The feature branch must differ from the pull request base.");
    return this.github.createPullRequest(branch, title, body, base);
  }
}

