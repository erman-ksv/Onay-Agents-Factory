export type GitHubConfig = { repository: string; token?: string; apiBaseUrl?: string };
export type GitHubFile = { path: string; sha: string; content: string };

export type WorkflowRun = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  head_sha?: string;
};

export function buildWorkflowRunsQuery(branch = "main", headSha?: string): string {
  // When an exact SHA is supplied, do not also constrain by branch: GitHub's
  // branch filter can exclude PR-head commits that are not on the default branch.
  return headSha
    ? `?per_page=20&head_sha=${encodeURIComponent(headSha)}`
    : `?branch=${encodeURIComponent(branch)}&per_page=20`;
}

export class GitHubClient {
  private readonly token: string;
  private readonly apiBaseUrl: string;
  constructor(private readonly config: GitHubConfig) {
    this.token = config.token ?? process.env.GITHUB_TOKEN ?? "";
    this.apiBaseUrl = config.apiBaseUrl ?? "https://api.github.com";
  }
  get repository() { return this.config.repository; }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.token) throw new Error("GITHUB_TOKEN is required for GitHub automation.");
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!response.ok) { const body = await response.text(); throw new Error(`GitHub API ${response.status}: ${body.slice(0, 500)}`); }
    return response.json() as Promise<T>;
  }

  async getFile(path: string, ref = "main"): Promise<GitHubFile> {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const data = await this.request<{ sha: string; content: string; encoding: string }>(`/repos/${this.repository}/contents/${encoded}?ref=${encodeURIComponent(ref)}`);
    const content = data.encoding === "base64" ? Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8") : data.content;
    return { path, sha: data.sha, content };
  }

  async createBranch(name: string, from = "main"): Promise<void> {
    const ref = await this.request<{ object: { sha: string } }>(`/repos/${this.repository}/git/ref/heads/${encodeURIComponent(from)}`);
    await this.request(`/repos/${this.repository}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${name}`, sha: ref.object.sha }) });
  }

  async upsertFile(path: string, content: string, message: string, branch: string): Promise<string> {
    let sha: string | undefined;
    try { sha = (await this.getFile(path, branch)).sha; } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("GitHub API 404")) throw error;
    }
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const result = await this.request<{ commit: { sha: string } }>(`/repos/${this.repository}/contents/${encoded}`, { method: "PUT", body: JSON.stringify({ message, content: Buffer.from(content, "utf8").toString("base64"), branch, ...(sha ? { sha } : {}) }) });
    return result.commit.sha;
  }

  async createPullRequest(head: string, title: string, body = "", base = "main") {
    return this.request<{ html_url: string; number: number; head: { sha: string } }>(`/repos/${this.repository}/pulls`, { method: "POST", body: JSON.stringify({ head, base, title, body, draft: true }) });
  }

  async getCommitSha(ref = "main"): Promise<string> {
    const encodedRef = encodeURIComponent(ref);
    const result = await this.request<{ sha: string }>(`/repos/${this.repository}/commits/${encodedRef}`);
    return result.sha;
  }

  async getWorkflowRuns(branch = "main", headSha?: string): Promise<WorkflowRun[]> {
    const query = buildWorkflowRunsQuery(branch, headSha);
    const result = await this.request<{ workflow_runs: WorkflowRun[] }>(
      `/repos/${this.repository}/actions/runs${query}`,
    );
    return result.workflow_runs;
  }

  async getWorkflowJobs(runId: number) {
    return this.request<{ jobs: Array<{ id: number; name: string; status: string; conclusion: string | null; html_url: string; steps?: Array<{ name: string; number: number; status: string; conclusion: string | null }> }> }>(
      `/repos/${this.repository}/actions/runs/${runId}/jobs?per_page=100`,
    );
  }

  async getWorkflowRun(runId: number) {
    return this.request<WorkflowRun>(`/repos/${this.repository}/actions/runs/${runId}`);
  }
}
