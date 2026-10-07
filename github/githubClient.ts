import type { RequestInit } from "node-fetch";

export type GitHubConfig = { repository: string; token?: string; apiBaseUrl?: string };
export type GitHubFile = { path: string; sha: string; content: string };

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

  async upsertFile(path: string, content: string, message: string, branch: string): Promise<void> {
    let sha: string | undefined;
    try { sha = (await this.getFile(path, branch)).sha; } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("GitHub API 404")) throw error;
    }
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    await this.request(`/repos/${this.repository}/contents/${encoded}`, { method: "PUT", body: JSON.stringify({ message, content: Buffer.from(content, "utf8").toString("base64"), branch, ...(sha ? { sha } : {}) }) });
  }

  async createPullRequest(head: string, title: string, body = "", base = "main") {
    return this.request<{ html_url: string; number: number }>(`/repos/${this.repository}/pulls`, { method: "POST", body: JSON.stringify({ head, base, title, body, draft: true }) });
  }
}