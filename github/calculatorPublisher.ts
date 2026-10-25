import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
import { createCalculatorPlan, type CalculatorPlan, type CalculatorPlanTask } from "../orchestration/calculatorPlan.js";
import { calculatorProposalDigest } from "../orchestration/calculatorExecutionEvidence.js";
import { prepareCalculatorRoleChanges } from "../commander/calculatorTeam.js";
import type { PreparedCalculatorChanges } from "../commander/calculatorChanges.js";
import { loadCalculatorSnapshot, type CalculatorSnapshotReader } from "./calculatorSnapshot.js";
import type { TeamTaskPublication } from "../orchestration/teamTaskStore.js";

export const CALCULATOR_PUBLISHER_ERROR = "Calculator publication stopped: authorization, repository, lease, source or Draft PR is unverified. Inspect before any retry.";
export type CalculatorPublicationDiagnostic = Readonly<{
  operation: "bootstrap" | "publish"; phase: string; writeAttempted: boolean; pushAcknowledged: boolean;
  candidateSha?: string; httpStatus?: number;
}>;
const publicationErrors=new WeakMap<Error,CalculatorPublicationDiagnostic>();
/** Source-free diagnostics only. A JSON error cannot create this identity or
 * authorize reconciliation, replay, model calls or any write. */
export function calculatorPublicationDiagnostic(error:unknown):CalculatorPublicationDiagnostic|undefined{
  const value=error instanceof Error?publicationErrors.get(error):undefined;return value?Object.freeze({...value}):undefined;
}
const URL = "https://github.com/" + CALCULATOR_PROFILE.repository + ".git";
const API = "https://api.github.com/repos/" + CALCULATOR_PROFILE.repository;
const SHA = /^[a-f0-9]{40}$/;
function refuse(): never { throw new Error(CALCULATOR_PUBLISHER_ERROR); }
export type CalculatorGitRequest = Readonly<{ args: readonly string[]; cwd: string; env: Readonly<NodeJS.ProcessEnv>; input?: string }>;
export type CalculatorGitRunner = (request: CalculatorGitRequest) => Promise<{ status: number; stdout: string }>;
/** Fixed executable, argv only, bounded output/deadline, no upstream stderr. */
export const runCalculatorGit: CalculatorGitRunner = request => new Promise((resolve, reject) => {
  let child: ReturnType<typeof spawn>;
  try { child = spawn("/usr/bin/git", [...request.args], { cwd: request.cwd, env: request.env,
    shell: false, detached: process.platform !== "win32", stdio: [request.input === undefined ? "ignore" : "pipe", "pipe", "pipe"] }); }
  catch { reject(new Error(CALCULATOR_PUBLISHER_ERROR)); return; }
  let bytes = 0, output = "", settled = false;
  const stop = () => {
    try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* Fixed diagnostics. */ }
  };
  const finish = (status?: number | null) => {
    if (settled) return; settled = true; clearTimeout(timer);
    if (status === undefined || status === null || bytes > 65_536) reject(new Error(CALCULATOR_PUBLISHER_ERROR));
    else resolve({ status, stdout: output });
  };
  const timer = setTimeout(() => { stop(); finish(); }, 30_000); timer.unref();
  child.stdout?.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 65_536) { stop(); finish(); } else output += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 65_536) { stop(); finish(); } });
  child.on("error", () => { stop(); finish(); }); child.on("close", status => finish(status));
  child.stdin?.on("error", () => { stop(); finish(); }); if (request.input !== undefined) child.stdin?.end(request.input);
});

/** Independent host-only publisher. Offline process/HTTP injection is not a model
 * tool and does not weaken live authorization. No network operation is retried. */
export function createCalculatorPublisher(options: {
  plan: CalculatorPlan; reader: CalculatorSnapshotReader; env: NodeJS.ProcessEnv;
  transport?: typeof fetch; runGit?: CalculatorGitRunner;
}) {
  let plan: CalculatorPlan;
  try {
    plan = createCalculatorPlan(options.plan.request, options.plan.proposal);
    if (plan.fingerprint !== options.plan.fingerprint || plan.status !== "planned" ||
        plan.owner.repository !== CALCULATOR_PROFILE.repository || !plan.owner.baseRef.startsWith("feat/") ||
        plan.branch === plan.owner.baseRef) return refuse();
  } catch { return refuse(); }
  const env = { ...options.env }, token = env.GITHUB_TOKEN, reader = options.reader;
  if (!token || env.CALCULATOR_EXECUTION_LIVE_APPROVED !== "RUN_ONE_FREE_CALCULATOR_TASK" ||
      env.AGENT_FACTORY_ENABLE_GITHUB_WRITES !== "true" || env.AGENT_FACTORY_TARGET_PROFILE !== "calculator" ||
      env.AGENT_FACTORY_LEGAL_ENABLED !== "false" || env.ONAY_TEAM_FREE_TIER_CONFIRMED !== "true" ||
      env.AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES === "true" ||
      !env.AGENT_ALLOWED_REPOSITORIES?.split(",").map(value => value.trim()).includes(CALCULATOR_PROFILE.repository)) return refuse();
  const transport = options.transport ?? globalThis.fetch, runGit = options.runGit ?? runCalculatorGit;
  let bootstrapUsed = false, publishUsed = false;
  let phase="authorization",operation:"bootstrap"|"publish"="publish",writeAttempted=false,pushAcknowledged=false;
  let knownCandidate:string|undefined,httpStatus:number|undefined;
  function failed():never{
    const error=new Error(CALCULATOR_PUBLISHER_ERROR);
    publicationErrors.set(error,Object.freeze({operation,phase,writeAttempted,pushAcknowledged,
      ...(knownCandidate&&SHA.test(knownCandidate)?{candidateSha:knownCandidate}:{}),
      ...(Number.isInteger(httpStatus)?{httpStatus}:{} )}));throw error;
  }
  function reset(kind:"bootstrap"|"publish"){operation=kind;phase="admission";writeAttempted=false;pushAcknowledged=false;knownCandidate=undefined;httpStatus=undefined;}
  const safeEnvironment: NodeJS.ProcessEnv = {
    PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC", GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "0",
    GIT_AUTHOR_NAME: "Onay Agents Factory", GIT_AUTHOR_EMAIL: "factory@users.noreply.github.com",
    GIT_COMMITTER_NAME: "Onay Agents Factory", GIT_COMMITTER_EMAIL: "factory@users.noreply.github.com",
  };
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "GIT_SSL_CAINFO", "CURL_CA_BUNDLE"])
    if (env[name]) safeEnvironment[name] = env[name];
  const prefix = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "credential.helper=",
    "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "http.followRedirects=false",
    "-c", "fetch.recurseSubmodules=false", "-c", "push.recurseSubmodules=no", "-c", "gc.auto=0"];
  async function session<T>(action: (git: (args: string[], input?: string, network?: boolean) => Promise<string>) => Promise<T>): Promise<T> {
    const directory = mkdtempSync(join(tmpdir(), "calculator-publish-")), repo = join(directory, "repo"), templates = join(directory, "templates");
    try {
      mkdirSync(repo, { mode: 0o700 }); mkdirSync(templates, { mode: 0o700 });
      const askpass = join(directory, "askpass.cjs");
      // The script contains no credential. Only exact github.com calculator prompts may read the isolated token variable.
      writeFileSync(askpass, "#!" + process.execPath + "\n" +
        'const p=process.argv[2]??""; const host="https://github.com"; const path="/erman-ksv/Onay-Factory-Calculator.git";\n' +
        'if(p===`Username for \'${host}\': `||p===`Username for \'${host}${path}\': `)process.stdout.write("x-access-token\\n");\n' +
        'else if(p===`Password for \'https://x-access-token@github.com\': `||p===`Password for \'https://x-access-token@github.com${path}\': `)process.stdout.write((process.env.CALCULATOR_GIT_AUTH_TOKEN??"")+"\\n"); else process.exitCode=1;\n', { mode: 0o700 });
      const git = async (args: string[], input?: string, network = false) => {
        const result = await runGit({ args: [...prefix, ...args], cwd: repo,
          env: { ...safeEnvironment, ...(network ? { GIT_ASKPASS: askpass, CALCULATOR_GIT_AUTH_TOKEN: token } : {}) }, ...(input === undefined ? {} : { input }) });
        if (result.status !== 0 || typeof result.stdout !== "string" || Buffer.byteLength(result.stdout) > 65_536) return refuse();
        return result.stdout;
      };
      await git(["init", "--bare", "--template=" + templates, "."]); return await action(git);
    } catch { return refuse(); } finally { try { rmSync(directory, { recursive: true, force: true }); } catch { phase="git_cleanup";refuse(); } }
  }
  async function baseCurrent(): Promise<void> { if (await reader.getHead(plan.owner.baseRef) !== plan.owner.baseSha) return refuse(); }
  async function boundedBase(sha: string): Promise<void> {
    const commit = await reader.readCommit(sha);
    if (commit.sha !== sha || !SHA.test(commit.treeSha)) return refuse();
    const tree = await reader.readTree(commit.treeSha);
    if (tree.sha !== commit.treeSha || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 512) return refuse();
    let bytes = 0;
    if (new Set(tree.tree.map(entry => entry.path)).size !== tree.tree.length) return refuse();
    for (const entry of tree.tree) {
      if (typeof entry.path !== "string" || !entry.path || entry.path.length > 240 || /[\u0000-\u0020\u007f\\]/.test(entry.path) ||
          entry.path.split("/").some(part => !part || part === "." || part === "..") || !SHA.test(entry.sha)) return refuse();
      if (entry.type === "tree" && entry.mode === "040000") continue;
      if (entry.type !== "blob" || entry.mode !== "100644" || !Number.isSafeInteger(entry.size) || entry.size! < 0 || entry.size! > 131_072) return refuse();
      bytes += entry.size!;
    }
    if (bytes > 2_097_152) return refuse();
  }
  function remoteHead(output: string): string | undefined {
    if (!output.trim()) return undefined;
    const lines = output.trim().split("\n"), match = /^([a-f0-9]{40})\t(.+)$/.exec(lines[0]);
    if (lines.length !== 1 || !match || match[2] !== "refs/heads/" + plan.branch) return refuse(); return match[1];
  }
  function pushed(output: string, source: string, creating: boolean): void {
    const rows = output.split("\n").filter(line => /^[ *+=!\-]\t/.test(line));
    const expected = (creating ? "*" : " ") + "\t" + source + ":refs/heads/" + plan.branch + "\t";
    // Reject "up to date": another writer reaching the same candidate is not
    // evidence that this operation satisfied its expected-old-SHA precondition.
    if (rows.length !== 1 || !rows[0].startsWith(expected)) return refuse();
  }
  async function fetchBase(git: (args: string[], input?: string, network?: boolean) => Promise<string>, ref: string, expected: string) {
    await git(["fetch", "--no-tags", "--no-recurse-submodules", "--depth=1", URL, "refs/heads/" + ref + ":refs/calculator/base"], undefined, true);
    if ((await git(["rev-parse", "--verify", "refs/calculator/base^{commit}"])).trim() !== expected) return refuse();
  }
  async function readJson(path: string, method = "GET", body?: unknown): Promise<unknown> {
    try {
      const response = await transport(API + path, { method, redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      httpStatus=response.status;
      if (!response.ok || !response.body) { void response.body?.cancel().catch(() => undefined); return refuse(); }
      const stream = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
      try { while (true) { const chunk = await stream.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength; if (bytes > 1_048_576) { await stream.cancel(); return refuse(); } chunks.push(chunk.value); }
      } finally { stream.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { return refuse(); }
  }
  function publication(value: unknown, candidate: string): TeamTaskPublication {
    const pr = value as { number: number; html_url: string; state: string; draft: boolean;
      head: { ref: string; sha: string; repo: { full_name: string } }; base: { ref: string; sha: string; repo: { full_name: string } } };
    if (!pr || !Number.isSafeInteger(pr.number) || pr.number < 1 || pr.html_url !== "https://github.com/" + plan.owner.repository + "/pull/" + pr.number ||
        pr.state !== "open" || pr.draft !== true || pr.head?.repo?.full_name !== plan.owner.repository || pr.base?.repo?.full_name !== plan.owner.repository ||
        pr.head.ref !== plan.branch || pr.head.sha !== candidate || pr.base.ref !== plan.owner.baseRef || pr.base.sha !== plan.owner.baseSha) return refuse();
    return { branch: plan.branch, headSha: candidate, number: pr.number, url: pr.html_url };
  }
  return Object.freeze({
    async bootstrapProjectBranch(): Promise<{ branch: string; headSha: string; created: boolean }> {
      reset("bootstrap");try {
        if (bootstrapUsed) return refuse(); bootstrapUsed = true;phase="base_validation"; await baseCurrent(); await boundedBase(plan.owner.baseSha);
        return await session(async git => {
          const current = remoteHead(await git(["ls-remote", "--refs", URL, "refs/heads/" + plan.branch], undefined, true));
          if (current !== undefined) {
            if (current !== plan.owner.baseSha || await reader.getHead(plan.branch) !== current) return refuse();
            await baseCurrent(); return { branch: plan.branch, headSha: current, created: false };
          }
          await fetchBase(git, plan.owner.baseRef, plan.owner.baseSha); await baseCurrent();
          phase="git_push";knownCandidate=plan.owner.baseSha;writeAttempted=true;
          pushed(await git(["push", "--porcelain", "--force-with-lease=refs/heads/" + plan.branch + ":", URL,
            plan.owner.baseSha + ":refs/heads/" + plan.branch], undefined, true), plan.owner.baseSha, true);
          pushAcknowledged=true;phase="git_ref_after_push";
          if (await reader.getHead(plan.branch) !== plan.owner.baseSha) return refuse(); await baseCurrent();
          return { branch: plan.branch, headSha: plan.owner.baseSha, created: true };
        });
      } catch { return failed(); }
    },
    async publish(input: { task: CalculatorPlanTask; changes: PreparedCalculatorChanges; expectedSha: string; branch: string }): Promise<TeamTaskPublication> {
      reset("publish");try {
        if (publishUsed) return refuse(); publishUsed = true;
        const task = plan.tasks.find(item => item.id === input.task?.id);
        if (!task || input.branch !== plan.branch || !SHA.test(input.expectedSha) || input.changes.repository !== plan.owner.repository ||
            input.changes.baseRef !== plan.branch || input.changes.baseSha !== input.expectedSha) return refuse();
        phase="base_validation";await baseCurrent(); if (await reader.getHead(plan.branch) !== input.expectedSha) return refuse(); await boundedBase(input.expectedSha);
        phase="source_snapshot";const snapshot = await loadCalculatorSnapshot({ repository: plan.owner.repository, baseRef: plan.branch, baseSha: input.expectedSha, changePaths: task.paths }, reader);
        phase="proposal_validation";const raw = JSON.parse(input.changes.reviewEvidence);
        const prepared = prepareCalculatorRoleChanges(task.role, { summary: input.changes.summary, changes: raw.changes.map((change: Record<string, unknown>) => {
          const message = input.changes.files.find(file => file.path === change.path)?.message;
          return change.operation === "create" ? { operation: "create", path: change.path, content: change.content, message } :
            { operation: change.operation, path: change.path, sourceSha256: change.sourceSha256, edits: change.edits, message };
        }) }, snapshot);
        if (calculatorProposalDigest(prepared) !== calculatorProposalDigest(input.changes) || prepared.reviewEvidence !== input.changes.reviewEvidence) return refuse();
        phase="git_prepare";const candidate = await session(async git => {
          if (remoteHead(await git(["ls-remote", "--refs", URL, "refs/heads/" + plan.branch], undefined, true)) !== input.expectedSha) return refuse();
          phase="git_build_candidate";await fetchBase(git, plan.branch, input.expectedSha); await git(["read-tree", input.expectedSha]);
          for (const file of prepared.files) {
            const blob = (await git(["hash-object", "--no-filters", "-w", "--stdin"], file.content)).trim(); if (!SHA.test(blob)) return refuse();
            await git(["update-index", "--add", "--cacheinfo", "100644," + blob + "," + file.path]);
          }
          const tree = (await git(["write-tree"])).trim(); if (!SHA.test(tree)) return refuse();
          const commit = (await git(["commit-tree", tree, "-p", input.expectedSha], "Calculator task " + task.id + "\n")).trim(); if (!SHA.test(commit)) return refuse();
          knownCandidate=commit;phase="git_verify_parent_scope";
          if ((await git(["rev-list", "--parents", "-n", "1", commit])).trim() !== commit + " " + input.expectedSha) return refuse();
          const changed = (await git(["diff-tree", "--no-commit-id", "--name-only", "-r", commit])).trim().split("\n").sort();
          if (JSON.stringify(changed) !== JSON.stringify(prepared.files.map(file => file.path).sort())) return refuse();
          if (await reader.getHead(plan.branch) !== input.expectedSha) return refuse(); await baseCurrent();
          phase="git_push";writeAttempted=true;
          pushed(await git(["push", "--porcelain", "--force-with-lease=refs/heads/" + plan.branch + ":" + input.expectedSha,
            URL, commit + ":refs/heads/" + plan.branch], undefined, true), commit, false);
          pushAcknowledged=true;phase="git_ref_after_push";
          if (await reader.getHead(plan.branch) !== commit) return refuse(); return commit;
        });
        phase="pr_list";const list = await readJson("/pulls?state=all&head=" + encodeURIComponent("erman-ksv:" + plan.branch) + "&per_page=100&page=1");
        if (!Array.isArray(list) || list.length >= 100 || list.length > 1) return refuse();
        let existingNumber: number | undefined;
        if (list.length) {
          const listed = list[0] as { head?: { sha?: string } };
          if (!listed?.head?.sha || !SHA.test(listed.head.sha)) return refuse();
          // Collection metadata may lag a ref update. It locates the PR only;
          // the fresh detail response must prove the exact new candidate.
          existingNumber = publication(list[0], listed.head.sha).number;
        }
        phase=existingNumber?"pr_detail":"pr_create";const pr = existingNumber ? publication(await readJson("/pulls/" + existingNumber), candidate) : publication(await readJson("/pulls", "POST", {
          title: "Calculator pilot: " + plan.owner.id, head: plan.branch, base: plan.owner.baseRef, draft: true, maintainer_can_modify: false,
          body: "Bounded calculator task " + task.id + ".\n\nPlan fingerprint: " + plan.fingerprint + "\nCandidate: " + candidate +
            "\n\nDraft only. Exact-candidate task/final CI and independent acceptance remain mandatory. No merge, deployment or legal approval.",
        }), candidate);
        phase="final_ref_confirmation";if (await reader.getHead(plan.branch) !== candidate) return refuse(); await baseCurrent(); return Object.freeze(pr);
      } catch { return failed(); }
    },
  });
}
