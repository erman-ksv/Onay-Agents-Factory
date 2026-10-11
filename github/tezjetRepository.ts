import { GitHubClient } from "./githubClient.js";
import { assertNoSecrets } from "./secretScanner.js";
import { assertRepositoryAllowed, assertWritableBranch } from "./repositoryPolicy.js";
import { getTargetRepository } from "./repositoryConfig.js";

export class TezJetRepositoryAdapter {
  private readonly github: GitHubClient;

  constructor(repository = getTargetRepository()) {
    const allowed = (process.env.AGENT_ALLOWED_REPOSITORIES ?? getTargetRepository())
      .split(",").map((x) => x.trim()).filter(Boolean);
    assertRepositoryAllowed(repository, allowed);
    this.github = new GitHubClient({ repository });
  }

  async read(path: string, ref = "main") {
    return this.github.getFile(path, ref);
  }

  async prepareBranch(branch: string, from = "main") {
    assertWritableBranch(branch);
    return this.github.createBranch(branch, from);
  }

  async write(path: string, content: string, message: string, branch: string) {
    assertWritableBranch(branch);
    assertNoSecrets([{ path, content }]);
    return this.github.upsertFile(path, content, message, branch);
  }

  async openDraftPullRequest(branch: string, title: string, body = "", base = "main") {
    assertWritableBranch(branch);
    return this.github.createPullRequest(branch, title, body, base);
  }
}
