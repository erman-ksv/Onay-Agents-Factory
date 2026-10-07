export type GitHubConfig = { repository: string };

export class GitHubClient {
  constructor(private readonly config: GitHubConfig) {}
  get repository() { return this.config.repository; }
}
