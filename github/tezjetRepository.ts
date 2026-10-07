import { GitHubClient } from "./githubClient.js";
import { assertNoSecrets } from "./secretScanner.js";
import { assertRepositoryAllowed, assertWritableBranch } from "./repositoryPolicy.js";

export class TezJetRepositoryAdapter {
  private readonly github: GitHubClient;

  constructor(repository = process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet") {
    const allowed = (process.env.AGENT_ALLOWED_REPOSITORIES ?? repository)
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
