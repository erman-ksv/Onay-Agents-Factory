/** Host-only, atomic remote barrier for ONE corrective phase. No target writes,
 * retries, code substitution, archive authentication or publication authority. */
import { createHash } from "node:crypto";
import { calculatorSources, type CalculatorSnapshot } from "../github/calculatorSnapshot.js";
import { createCalculatorAgentRepairTeam, type CalculatorAgentRepairHost, type CalculatorAuthenticatedFailure } from "./calculatorAgentRepair.js";
import type { CalculatorPlan, CalculatorPlanTask } from "./calculatorPlan.js";
import type { CalculatorModelCheckpointHooks } from "./calculatorModelTeam.js";
import type { CalculatorModelTiming } from "./calculatorGroqPacing.js";

export const CALCULATOR_REPAIR_ADMISSION_ERROR = "Correction admission refused or uncertain. Preserve the remote barrier and all costs; do not retry.";
const FACTORY = "erman-ksv/Onay-Agents-Factory", TARGET = "erman-ksv/Onay-Factory-Calculator";
const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const refuse = (): never => { throw Error(CALCULATOR_REPAIR_ADMISSION_ERROR); };
export type CalculatorRepairAuthority = Readonly<{ runtimeSha: string; sourceCiRunId: number }>;
export type CalculatorRepairAdmission = Readonly<{ ref: string; runtimeSha: string; taskId: string; baseSha: string }>;
type FailureMetadata = Pick<CalculatorAuthenticatedFailure, "taskId" | "planFingerprint" | "baseSha" | "proposalDigest" |
  "sourceManifestSha256" | "priorCharge" | "httpInFlight" | "publicationStarted">;
type Binding = Readonly<{ plan: CalculatorPlan; task: CalculatorPlanTask; source: FailureMetadata }>;

/** Tokens are host credentials, never model-visible context. GITHUB_TOKEN must
 * be Factory-scoped with contents:write; the target token is used for GET only.
 * A queued source CI cannot admit a phase. The source archive still needs an
 * independent authenticated loader; supplying metadata is not authentication. */
export function createCalculatorRepairAdmission(authority: CalculatorRepairAuthority, env: NodeJS.ProcessEnv,
  transport: typeof fetch = globalThis.fetch) {
  if (!authority || Object.keys(authority).sort().join(",") !== "runtimeSha,sourceCiRunId" ||
      !SHA.test(authority.runtimeSha) || !Number.isSafeInteger(authority.sourceCiRunId) || authority.sourceCiRunId < 1 ||
      env.GITHUB_REPOSITORY !== FACTORY || env.GITHUB_RUN_ATTEMPT !== "1" ||
      env.CALCULATOR_AGENT_REPAIR_APPROVED !== "ONE_SEPARATELY_BOUNDED_AGENT_CORRECTION" ||
      env.AGENT_FACTORY_LEGAL_ENABLED !== "false" || env.ONAY_TEAM_FREE_TIER_CONFIRMED !== "true" ||
      !env.GITHUB_TOKEN || !env.CALCULATOR_GITHUB_TOKEN || typeof transport !== "function") return refuse();
  const runtimeSha = authority.runtimeSha, sourceCiRunId = authority.sourceCiRunId;
  const factoryToken = env.GITHUB_TOKEN, targetToken = env.CALCULATOR_GITHUB_TOKEN;
  const permits = new WeakMap<CalculatorRepairAdmission, Binding>();
  let attempted = false, stopped = false;
  async function request(repository: string, path: string, method: "GET" | "POST" = "GET", body?: unknown, missing = false) {
    try {
      const response = await transport("https://api.github.com/repos/" + repository + path, {
        method, redirect: "error", signal: AbortSignal.timeout(10000), headers: {
          Accept: "application/vnd.github+json", Authorization: "Bearer " + (repository === FACTORY ? factoryToken : targetToken),
          "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json",
        }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (missing && response.status === 404) return undefined;
      if (response.status !== (method === "POST" ? 201 : 200) || !response.body) return refuse();
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.length; if (size > 1048576) { await reader.cancel(); return refuse(); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } catch { return refuse(); }
  }
  function metadata(plan: CalculatorPlan, task: CalculatorPlanTask, source: FailureMetadata) {
    if (plan.owner.repository !== TARGET || !plan.tasks.includes(task) || !source || source.taskId !== task.id ||
        source.planFingerprint !== plan.fingerprint || !HASH.test(plan.fingerprint) || !SHA.test(source.baseSha) ||
        !HASH.test(source.proposalDigest) || !HASH.test(source.sourceManifestSha256) ||
        source.httpInFlight !== false || source.publicationStarted !== false ||
        !source.priorCharge || Object.keys(source.priorCharge).sort().join(",") !== "attemptedRequests,elapsedMs,reservedRunTokens,totalRequestBytes" ||
        Object.values(source.priorCharge).some(n => !Number.isSafeInteger(n) || n < 1)) return refuse();
  }
  async function current(binding: Binding) {
    const head = await request(TARGET, "/git/ref/heads/" + encodeURIComponent(binding.plan.branch));
    if (head?.ref !== "refs/heads/" + binding.plan.branch || head.object?.type !== "commit" || head.object.sha !== binding.source.baseSha) return refuse();
  }
  async function sourceCI() {
    const run = await request(FACTORY, "/actions/runs/" + sourceCiRunId);
    if (run?.id !== sourceCiRunId || run.head_sha !== runtimeSha || run.run_attempt !== 1 || run.status !== "completed" ||
        run.conclusion !== "success" || run.path !== ".github/workflows/ci.yml" || run.event !== "push" ||
        run.repository?.full_name !== FACTORY || run.head_repository?.full_name !== FACTORY) return refuse();
    const jobs = await request(FACTORY, "/actions/runs/" + sourceCiRunId + "/attempts/1/jobs?per_page=100");
    if (!Array.isArray(jobs?.jobs) || jobs.total_count !== jobs.jobs.length || jobs.jobs.length !== 1) return refuse();
    const job = jobs.jobs[0];
    if (job.name !== "typecheck" || job.run_id !== sourceCiRunId || job.run_attempt !== 1 || job.head_sha !== runtimeSha ||
        job.status !== "completed" || job.conclusion !== "success" || !Array.isArray(job.steps)) return refuse();
    for (const name of ["Typecheck", "Test"]) {
      const steps = job.steps.filter((step: { name?: unknown }) => step.name === name);
      if (steps.length !== 1 || steps[0].status !== "completed" || steps[0].conclusion !== "success") return refuse();
    }
  }
  return Object.freeze({
    async admit(plan: CalculatorPlan, task: CalculatorPlanTask, source: FailureMetadata): Promise<CalculatorRepairAdmission> {
      if (attempted || stopped) return refuse(); attempted = true;
      try {
        metadata(plan, task, source);
        const binding = Object.freeze({ plan, task, source: Object.freeze({ ...source, priorCharge: Object.freeze({ ...source.priorCharge }) }) });
        await sourceCI(); await current(binding);
        // The key excludes the proposal/runtime/manifest: changing those cannot
        // silently buy another correction of this task at the same target SHA.
        const key = createHash("sha256").update(JSON.stringify({ repository: TARGET, planFingerprint: plan.fingerprint,
          taskId: task.id, baseSha: source.baseSha })).digest("hex");
        const ref = "refs/heads/state/calculator-agent-repair/" + key;
        const path = "/git/ref/heads/" + encodeURIComponent("state/calculator-agent-repair/" + key);
        if (await request(FACTORY, path, "GET", undefined, true) !== undefined) return refuse();
        const created = await request(FACTORY, "/git/refs", "POST", { ref, sha: runtimeSha });
        const valid = (value: any) => value?.ref === ref && value.object?.type === "commit" && value.object.sha === runtimeSha;
        if (!valid(created) || !valid(await request(FACTORY, path))) return refuse();
        await current(binding);
        const permit = Object.freeze({ ref, runtimeSha, taskId: task.id, baseSha: source.baseSha });
        permits.set(permit, binding); return permit;
      } catch { stopped = true; return refuse(); }
    },
    async assertCurrent(permit: CalculatorRepairAdmission): Promise<void> {
      try {
        const binding = permits.get(permit); if (stopped || !binding) return refuse();
        const remote = await request(FACTORY, "/git/ref/heads/" + encodeURIComponent(permit.ref.slice("refs/heads/".length)));
        if (remote?.ref !== permit.ref || remote.object?.type !== "commit" || remote.object.sha !== runtimeSha) return refuse();
        await current(binding);
      } catch { stopped = true; return refuse(); }
    },
  });
}

/** Production composition: no model request before remote admission AND a
 * successful cumulative checkpoint write. All real host tests remain required.
 * Caller must supply the authenticated archive loader; no JSON resume shortcut. */
export function createCalculatorRemotelyAdmittedRepairTeam(ownerRequest: unknown, env: NodeJS.ProcessEnv,
  authority: CalculatorRepairAuthority, host: CalculatorAgentRepairHost,
  options: Readonly<{ transport?: typeof fetch; admissionTransport?: typeof fetch; timing?: CalculatorModelTiming;
    checkpoints: CalculatorModelCheckpointHooks }> ) {
  if (!options?.checkpoints || typeof options.checkpoints.beforeRequest !== "function" ||
      !host || typeof host.loadAuthenticatedFailure !== "function" || typeof host.verifyRepairedProposal !== "function") return refuse();
  const admission = createCalculatorRepairAdmission(authority, env, options.admissionTransport);
  const load = host.loadAuthenticatedFailure, persist = options.checkpoints.beforeRequest;
  let permit: CalculatorRepairAdmission | undefined;
  return createCalculatorAgentRepairTeam(ownerRequest, env, {
    ...host, async loadAuthenticatedFailure(plan: CalculatorPlan, task: CalculatorPlanTask, snapshot: CalculatorSnapshot) {
      const source = await load(plan, task, snapshot);
      calculatorSources(snapshot); // Reject a serialized snapshot before consuming the remote barrier.
      if (source.baseSha !== snapshot.baseSha || snapshot.repository !== plan.owner.repository || snapshot.baseRef !== plan.branch) return refuse();
      permit = await admission.admit(plan, task, source); return source;
    },
  }, { ...options, checkpoints: { ...options.checkpoints, beforeRequest: async state => {
    if (!permit) return refuse();
    await admission.assertCurrent(permit); await persist(state);
    // Persistence may await I/O; recheck the remote SHA before transport.
    await admission.assertCurrent(permit);
  } } });
}
