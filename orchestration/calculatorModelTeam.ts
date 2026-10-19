import { CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
import { selectProviderConfig } from "../commander/providerConfig.js";
import { createCloudflareCompatibleFetch } from "../commander/cloudflareCompatibility.js";
import { createGroqBudgetedFetch, createProviderContextBudget } from "../commander/providerContextBudget.js";
import { calculatorSources, type CalculatorSnapshot } from "../github/calculatorSnapshot.js";
import { scanForSecrets } from "../github/secretScanner.js";
import { buildCalculatorRoleInstructions, prepareCalculatorRoleChanges, validateCalculatorAssessment } from "../commander/calculatorTeam.js";
import type { PreparedCalculatorChanges } from "../commander/calculatorChanges.js";
import { CALCULATOR_ACCEPTANCE, buildCalculatorPlanningInstructions, createCalculatorPlan, prepareCalculatorGoal, type CalculatorPlan } from "./calculatorPlan.js";
import { createTaskModelBudgetFetch } from "./taskModelBudget.js";

export const CALCULATOR_MODEL_ERROR = "Calculator model team stopped: configuration, evidence, response or context budget is unverified. No retry or write is authorized.";
function refuse(): never { throw new Error(CALCULATOR_MODEL_ERROR); }
/** Real HTTP adapter. No SDK tools, arbitrary URLs, provider fallback, Git writes,
 * installs, automatic retries, or legal role. One instance owns one run's ledger. */
export function createCalculatorModelTeam(ownerRequest: unknown, env: NodeJS.ProcessEnv,
  transport: typeof fetch = globalThis.fetch) {
  const owner = prepareCalculatorGoal(ownerRequest);
  const requestOwner = Object.freeze({ version: 1 as const, id: owner.id, goal: owner.goal,
    baseRef: owner.baseRef, baseSha: owner.baseSha, provider: owner.provider });
  if (env.AGENT_FACTORY_TARGET_PROFILE !== "calculator" || env.AGENT_FACTORY_PROVIDER !== owner.provider ||
      env.CALCULATOR_MODEL_LIVE_APPROVED !== "ONE_FREE_BOUNDED_RUN" ||
      env.ONAY_TEAM_FREE_TIER_CONFIRMED !== "true" || env.AGENT_FACTORY_LEGAL_ENABLED !== "false") return refuse();
  let config: ReturnType<typeof selectProviderConfig>;
  try { config = selectProviderConfig(env); } catch { return refuse(); }
  if (config.provider === "none" || config.provider !== owner.provider ||
      (config.provider !== "groq" && config.provider !== "cloudflare" && config.provider !== "gemini")) return refuse();
  // Capture identity/configuration once. No later process.env lookup can switch it.
  const endpoint = config.baseURL.replace(/\/$/, "") + "/chat/completions", model = config.model, apiKey = config.apiKey;
  const budget = createTaskModelBudgetFetch({}, transport);
  const contextBudget = config.provider === "groq" ? createProviderContextBudget({ reservedOutputTokens: 1200 }) : undefined;
  const request = contextBudget ? createGroqBudgetedFetch(contextBudget, budget.fetch) :
    config.provider === "cloudflare" ? createCloudflareCompatibleFetch(budget.fetch) : budget.fetch;
  let stopped = false, planned = false;
  const generated = new Set<string>();
  const proposals = new WeakMap<PreparedCalculatorChanges, { taskId: string; planFingerprint: string }>();
  const assessed = new WeakMap<PreparedCalculatorChanges, Set<string>>();

  async function call(instructions: string, packet: unknown): Promise<unknown> {
    try {
      if (stopped) return refuse();
      const input = JSON.stringify(packet);
      if (Buffer.byteLength(input) > 16_000 || scanForSecrets(input).length) return refuse();
      const response = await request(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { Authorization: "Bearer " + apiKey, "content-type": "application/json" },
        body: JSON.stringify({ model, stream: false, n: 1, max_completion_tokens: 1200,
          messages: [{ role: "system", content: instructions }, { role: "user", content: input }] }) });
      if (!response.ok || !response.body) { void response.body?.cancel().catch(() => undefined); return refuse(); }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 65_536) { await reader.cancel(); return refuse(); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!Array.isArray(data.choices) || data.choices.length !== 1 || data.choices[0]?.finish_reason !== "stop" ||
          data.choices[0]?.message?.role !== "assistant" || data.choices[0]?.message?.tool_calls ||
          data.choices[0]?.message?.function_call || typeof data.choices[0]?.message?.content !== "string") return refuse();
      const content: string = data.choices[0].message.content;
      if (Buffer.byteLength(content) > 16_000 || scanForSecrets(content).length) return refuse();
      return JSON.parse(content);
    } catch { stopped = true; return refuse(); }
  }
  function taskIn(plan: CalculatorPlan, taskId: string) {
    const actual = createCalculatorPlan(requestOwner, plan.proposal);
    if (actual.fingerprint !== plan.fingerprint) return refuse();
    const task = actual.tasks.find(item => item.id === taskId);
    if (!task || actual.status !== "planned") return refuse();
    return task;
  }
  return Object.freeze({
    async plan(): Promise<CalculatorPlan> {
      try {
        if (planned || stopped) return refuse(); planned = true;
        return createCalculatorPlan(requestOwner, await call(buildCalculatorPlanningInstructions(requestOwner), {
          goal: owner.goal, repository: owner.repository, baseSha: owner.baseSha,
          requirementsSha256: owner.requirementsSha256, unverifiedAreas: ["Source has not been inspected; no task has executed."] }));
      } catch { stopped = true; return refuse(); }
    },
    async generate(plan: CalculatorPlan, taskId: string, snapshot: CalculatorSnapshot): Promise<PreparedCalculatorChanges> {
      try {
        const task = taskIn(plan, taskId);
        if (stopped || generated.has(taskId) || snapshot.repository !== CALCULATOR_PROFILE.repository ||
            snapshot.changePaths.length !== task.paths.length || task.paths.some(path => !snapshot.changePaths.includes(path))) return refuse();
        generated.add(taskId);
        const sources = calculatorSources(snapshot); let excerptBytes = 0;
        const evidence = snapshot.files.map(file => {
          const source = sources.get(file.path);
          // Never serialize a complete private original, even when a file is tiny.
          const end = source === undefined ? 0 : Math.min(1000, Math.floor(source.length / 2));
          const excerpt = source?.slice(0, end) ?? ""; excerptBytes += Buffer.byteLength(excerpt);
          return { ...file, ...(excerpt ? { excerpt: { startCharacter: 0, endCharacter: end, text: excerpt } } : {}),
            unverified: file.exists ? "Remaining original source is omitted; use exact anchored patches only." : "Runtime behavior is unverified." };
        });
        if (excerptBytes > 6_000) return refuse();
        const output = await call(buildCalculatorRoleInstructions(task.role), { repository: owner.repository,
          task, acceptance: CALCULATOR_ACCEPTANCE.filter(item => task.acceptanceIds.includes(item.id)), baseSha: snapshot.baseSha, requirementsSha256: owner.requirementsSha256, evidence,
          unverifiedAreas: ["Unshown originals and other files", "Independent security/review", "Actual tests and browser behavior"] });
        const prepared = prepareCalculatorRoleChanges(task.role, output, snapshot);
        proposals.set(prepared, { taskId, planFingerprint: plan.fingerprint }); return prepared;
      } catch { stopped = true; return refuse(); }
    },
    async assess(role: "security" | "reviewer" | "tester", plan: CalculatorPlan, taskId: string, changes: PreparedCalculatorChanges) {
      try {
        const task = taskIn(plan, taskId), identity = proposals.get(changes);
        if (stopped || !["security", "reviewer", "tester"].includes(role) || !identity || identity.taskId !== taskId ||
            identity.planFingerprint !== plan.fingerprint) return refuse();
        const seen = assessed.get(changes) ?? new Set<string>();
        if (seen.has(role)) return refuse(); seen.add(role); assessed.set(changes, seen);
        const evidenceId = "changes@" + changes.baseSha;
        const result = await call(buildCalculatorRoleInstructions(role), { repository: owner.repository,
          task, acceptance: CALCULATOR_ACCEPTANCE.filter(item => task.acceptanceIds.includes(item.id)), evidenceId, completeChangedText: JSON.parse(changes.reviewEvidence),
          unverifiedAreas: ["Unshown unchanged source", "No runtime tests or browser checks have executed", "No publication or completion"] });
        return validateCalculatorAssessment(role, result, [evidenceId]);
      } catch { stopped = true; return refuse(); }
    },
    snapshot: () => ({ provider: owner.provider, stopped, planned, generatedTasks: generated.size,
      modelBudget: budget.snapshot(), ...(contextBudget ? { contextBudget: contextBudget.snapshot() } : {}),
      testsExecuted: false as const, publicationAuthorized: false as const, legalEnabled: false as const }),
  });
}
