import { CALCULATOR_PROFILE, calculatorBranch } from "../config/calculatorProfile.js";
import type { CiJob } from "./ciGate.js";
import { assertValidBranchRef, type WorkflowRun } from "./githubClient.js";

export const CALCULATOR_CI_ERROR = "Calculator CI evidence refused: target, provenance, pagination or current attempt is unverified.";
export type CalculatorWorkflowPin = Readonly<{ id: number; path: string; blobSha: string }>;
export type CalculatorCiInput = Readonly<{ repository: string; branch: string; candidateSha: string }>;
export type CalculatorCiEvidence = Readonly<{
  repository: string; branch: string; candidateSha: string; runs: WorkflowRun[]; jobs: CiJob[];
  provenance: Readonly<{ candidateSha: string; workflowPins: readonly CalculatorWorkflowPin[]; verifiedRunIds: readonly number[] }>;
}>;
type RawRun = Omit<WorkflowRun, "head_sha" | "run_attempt"> & { head_sha: string; run_attempt: number; workflow_id: number; path: string; head_branch: string; event: string };
const SHA = /^[a-f0-9]{40}$/;
const PATHS = new Set([".github/workflows/calculator-task-ci.yml", ".github/workflows/calculator-final-ci.yml"]);
const STATUS = new Set(["queued", "in_progress", "completed", "requested", "waiting", "pending"]);
const CONCLUSION = new Set(["success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required", "stale", "startup_failure"]);
const MAX_REQUESTS = 128, MAX_RUNS = 100, MAX_JOBS = 500;
function refuse(): never { throw new Error(CALCULATOR_CI_ERROR); }
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return refuse();
  return input as Record<string, unknown>;
}
function id(input: unknown): number { if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 1) return refuse(); return input; }
function hash(input: unknown): string { if (typeof input !== "string" || !SHA.test(input)) return refuse(); return input; }
function text(input: unknown, max = 200): string {
  if (typeof input !== "string" || !input.trim() || input.length > max || /[\u0000-\u001f\u007f]/.test(input)) return refuse();
  return input;
}
function state(input: unknown): string { const value = text(input, 32); if (!STATUS.has(value)) return refuse(); return value; }
function conclusion(input: unknown): string | null {
  if (input === null) return null; const value = text(input, 32); if (!CONCLUSION.has(value)) return refuse(); return value;
}
function path(input: unknown): string {
  const value = text(input, 240);
  if (value.includes("\\") || value.split("/").some(part => !part || part === "." || part === "..")) return refuse(); return value;
}
function sameRun(before: RawRun, after: RawRun): boolean {
  return before.id === after.id && before.workflow_id === after.workflow_id && before.path === after.path &&
    before.head_sha === after.head_sha && before.head_branch === after.head_branch && before.run_attempt === after.run_attempt &&
    before.status === after.status && before.conclusion === after.conclusion && before.event === after.event;
}

/** Fixed-repository read-only CI tool. Pins are trusted host configuration, never
 * model-selected workflow names. No retries, logging of upstream bodies or writes. */
export function createCalculatorCiReader(options: { trustedWorkflows: readonly CalculatorWorkflowPin[]; approvedBase?: Readonly<{ ref: string; sha: string }> },
  env: NodeJS.ProcessEnv = process.env, transport: typeof fetch = globalThis.fetch) {
  const repository = CALCULATOR_PROFILE.repository, token = env.GITHUB_TOKEN;
  if (env.AGENT_FACTORY_TARGET_PROFILE !== "calculator" || !token ||
      !env.AGENT_ALLOWED_REPOSITORIES?.split(",").map(value => value.trim()).includes(repository)) return refuse();
  if (!options || !Array.isArray(options.trustedWorkflows) || !options.trustedWorkflows.length || options.trustedWorkflows.length > 2) return refuse();
  const pins = Object.freeze(options.trustedWorkflows.map(pin => {
    if (!pin || Object.keys(pin).sort().join(",") !== "blobSha,id,path" || !PATHS.has(pin.path)) return refuse();
    return Object.freeze({ id: id(pin.id), path: pin.path, blobSha: hash(pin.blobSha) });
  }));
  if (!pins.some(pin => pin.path === ".github/workflows/calculator-task-ci.yml") ||
      new Set(pins.map(pin => pin.id)).size !== pins.length || new Set(pins.map(pin => pin.path)).size !== pins.length) return refuse();
  let approvedBase: Readonly<{ ref: string; sha: string }> | undefined;
  if (options.approvedBase !== undefined) {
    try {
      const base = options.approvedBase;
      if (!base || Object.keys(base).sort().join(",") !== "ref,sha" || typeof base.ref !== "string" || !base.ref.startsWith("feat/")) return refuse();
      assertValidBranchRef(base.ref);
      approvedBase = Object.freeze({ ref: base.ref, sha: hash(base.sha) });
    } catch { return refuse(); }
  }
  return async (input: CalculatorCiInput): Promise<CalculatorCiEvidence> => {
    try {
      if (!input || input.repository !== repository || typeof input.branch !== "string") return refuse();
      // The sole bootstrap exception is an exact host-approved ref AND SHA.
      // It receives the same workflow/tree/run provenance checks as a project head.
      if (approvedBase && input.branch === approvedBase.ref) {
        if (input.candidateSha !== approvedBase.sha) return refuse();
      } else if (!input.branch.startsWith("feat/calculator-agent/") ||
          calculatorBranch(input.branch.slice("feat/calculator-agent/".length)) !== input.branch) return refuse();
      const approved = Object.freeze({ repository, branch: input.branch, candidateSha: hash(input.candidateSha) });
      const started = performance.now(); let requests = 0;
      async function read(endpoint: string): Promise<unknown> {
        if (++requests > MAX_REQUESTS) return refuse();
        const remaining = 45_000 - (performance.now() - started); if (remaining <= 0) return refuse();
        const response = await transport("https://api.github.com/repos/" + repository + endpoint, {
          method: "GET", redirect: "error", signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(15_000, remaining)))),
          headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28" },
        });
        if (!response.ok || !response.body) { void response.body?.cancel().catch(() => undefined); return refuse(); }
        const stream = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const chunk = await stream.read(); if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 1_048_576) { await stream.cancel(); return refuse(); }
            chunks.push(chunk.value);
          }
        } finally { stream.releaseLock(); }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      }
      async function current(): Promise<void> {
        const ref = object(await read("/git/ref/heads/" + encodeURIComponent(approved.branch)));
        if (ref.ref !== "refs/heads/" + approved.branch || object(ref.object).type !== "commit" || hash(object(ref.object).sha) !== approved.candidateSha) return refuse();
      }
      async function pages(endpoint: string, key: "workflow_runs" | "jobs", perPage: number, maximum: number): Promise<unknown[]> {
        const result: unknown[] = []; let expected: number | undefined;
        for (let page = 1; page <= maximum / perPage; page++) {
          const data = object(await read(endpoint + (endpoint.includes("?") ? "&" : "?") + "per_page=" + perPage + "&page=" + page));
          if (typeof data.total_count !== "number" || !Number.isSafeInteger(data.total_count) || data.total_count < 0 || data.total_count > maximum ||
              (expected !== undefined && expected !== data.total_count) || !Array.isArray(data[key]) || data[key].length > perPage) return refuse();
          expected = data.total_count; result.push(...data[key]);
          if (result.length > expected) return refuse();
          if (result.length === expected) return result;
          if (data[key].length < perPage) return refuse();
        }
        return refuse();
      }
      function run(raw: unknown): RawRun {
        const value = object(raw), runId = id(value.id), workflowId = id(value.workflow_id);
        if (object(value.repository).full_name !== repository || object(value.head_repository).full_name !== repository ||
            value.head_branch !== approved.branch || hash(value.head_sha) !== approved.candidateSha ||
            value.html_url !== "https://github.com/" + repository + "/actions/runs/" + runId) return refuse();
        const runPath = path(value.path), pinned = pins.find(pin => pin.id === workflowId), event = text(value.event, 40);
        // PR merge-ref and pull_request_target runs do not prove execution of the
        // exact published candidate. Trusted calculator workflows use push or dispatch.
        if (pinned && !["push", "workflow_dispatch"].includes(event)) return refuse();
        if ((pinned && pinned.path !== runPath) || pins.some(pin => pin.path === runPath && pin.id !== workflowId)) return refuse();
        return { id: runId, name: text(value.name), status: state(value.status), conclusion: conclusion(value.conclusion),
          html_url: "https://github.com/" + repository + "/actions/runs/" + runId, head_sha: approved.candidateSha, run_attempt: id(value.run_attempt),
          workflow_id: workflowId, path: runPath, head_branch: approved.branch, event };
      }
      await current();
      const commit = object(await read("/git/commits/" + approved.candidateSha));
      if (hash(commit.sha) !== approved.candidateSha) return refuse();
      const treeSha = hash(object(commit.tree).sha), tree = object(await read("/git/trees/" + treeSha + "?recursive=1"));
      if (hash(tree.sha) !== treeSha || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > CALCULATOR_PROFILE.maxTreeEntries) return refuse();
      const entries = new Map<string, Record<string, unknown>>();
      for (const raw of tree.tree) {
        const entry = object(raw), name = path(entry.path); hash(entry.sha);
        if (entries.has(name)) return refuse(); entries.set(name, entry);
      }
      for (const directory of [".github", ".github/workflows"]) {
        const entry = entries.get(directory); if (!entry || entry.type !== "tree" || entry.mode !== "040000") return refuse();
      }
      for (const pin of pins) {
        const entry = entries.get(pin.path);
        if (!entry || entry.type !== "blob" || entry.mode !== "100644" || entry.sha !== pin.blobSha) return refuse();
        const workflow = object(await read("/actions/workflows/" + pin.id));
        if (id(workflow.id) !== pin.id || workflow.path !== pin.path || workflow.state !== "active") return refuse();
      }
      const listed = (await pages("/actions/runs?head_sha=" + approved.candidateSha + "&branch=" + encodeURIComponent(approved.branch),
        "workflow_runs", 20, MAX_RUNS)).map(run);
      if (new Set(listed.map(value => value.id)).size !== listed.length) return refuse();
      const runs: WorkflowRun[] = [], jobs: CiJob[] = [], verifiedRunIds: number[] = [];
      for (const initial of listed) {
        const latest = run(await read("/actions/runs/" + initial.id));
        if (!sameRun(initial, latest)) return refuse();
        if (pins.some(pin => pin.id === latest.workflow_id)) {
          const fetched = await pages("/actions/runs/" + latest.id + "/attempts/" + latest.run_attempt + "/jobs", "jobs", 100, MAX_JOBS);
          const ids = new Set<number>();
          for (const raw of fetched) {
            const job = object(raw), jobId = id(job.id);
            if (ids.has(jobId) || id(job.run_id) !== latest.id || id(job.run_attempt) !== latest.run_attempt ||
                hash(job.head_sha) !== approved.candidateSha || (job.html_url !== "https://github.com/" + repository + "/actions/runs/" + latest.id + "/job/" + jobId &&
                  job.html_url !== "https://github.com/" + repository + "/runs/" + jobId) ||
                !Array.isArray(job.steps) || job.steps.length > 64) return refuse();
            ids.add(jobId);
            const stepNumbers = new Set<number>();
            const steps = job.steps.map(rawStep => {
              const step = object(rawStep), number = id(step.number); if (stepNumbers.has(number)) return refuse(); stepNumbers.add(number);
              return { name: text(step.name), status: state(step.status), conclusion: conclusion(step.conclusion) };
            });
            jobs.push({ name: text(job.name), status: state(job.status), conclusion: conclusion(job.conclusion),
              run_id: latest.id, run_attempt: latest.run_attempt, head_sha: approved.candidateSha, steps });
          }
          verifiedRunIds.push(latest.id);
        }
        const after = run(await read("/actions/runs/" + latest.id));
        if (!sameRun(latest, after)) return refuse();
        runs.push({ id: after.id, name: after.name, status: after.status, conclusion: after.conclusion,
          html_url: after.html_url, head_sha: approved.candidateSha, run_attempt: after.run_attempt });
      }
      const finalList = (await pages("/actions/runs?head_sha=" + approved.candidateSha + "&branch=" + encodeURIComponent(approved.branch),
        "workflow_runs", 20, MAX_RUNS)).map(run);
      if (finalList.length !== listed.length || new Set(finalList.map(value => value.id)).size !== finalList.length ||
          listed.some(before => !finalList.some(after => sameRun(before, after)))) return refuse();
      await current();
      return Object.freeze({ ...approved, runs, jobs, provenance: Object.freeze({ candidateSha: approved.candidateSha,
        workflowPins: pins, verifiedRunIds: Object.freeze(verifiedRunIds) }) });
    } catch { return refuse(); }
  };
}
