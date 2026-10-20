import { CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
import { createCalculatorSnapshotReader, loadCalculatorSnapshot, calculatorSources, type CalculatorSnapshotReader } from "../github/calculatorSnapshot.js";
import { createCalculatorPublisher } from "../github/calculatorPublisher.js";
import { createCalculatorCiReader, type CalculatorWorkflowPin } from "../github/calculatorCi.js";
import { createCalculatorSandbox } from "./calculatorSandbox.js";
import { createCalculatorModelTeam } from "./calculatorModelTeam.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { prepareCalculatorGoal, type CalculatorPlan } from "./calculatorPlan.js";
import { openCalculatorWorkspace } from "./calculatorWorkspace.js";
import { runCalculatorExecution } from "./calculatorExecution.js";
import { TeamTaskStore } from "./teamTaskStore.js";
import type { CalculatorCheckRunner } from "./calculatorWorkspace.js";
import { calculatorProposalDigest, validateCalculatorProposalTests } from "./calculatorExecutionEvidence.js";
import { selectProviderConfig } from "../commander/providerConfig.js";
import { evaluateTestExecutionEvidence } from "../agents/tester/agent.js";

export const CALCULATOR_RUNTIME_ERROR = "Calculator live runtime is not ready. Inspect private state, provider, sandbox, workflow pins and GitHub access; no replay.";
function refuse(): never { throw new Error(CALCULATOR_RUNTIME_ERROR); }
export type CalculatorRuntimeConfig = Readonly<{ version: 1; sandboxImage: string; trustedWorkflows: readonly CalculatorWorkflowPin[] }>;
export function prepareCalculatorRuntimeConfig(value: unknown): CalculatorRuntimeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return refuse();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(",") !== "sandboxImage,trustedWorkflows,version" || raw.version !== 1 ||
      typeof raw.sandboxImage !== "string" || !/^node@sha256:[a-f0-9]{64}$/.test(raw.sandboxImage) ||
      !Array.isArray(raw.trustedWorkflows) || raw.trustedWorkflows.length < 1 || raw.trustedWorkflows.length > 2) return refuse();
  const pins = raw.trustedWorkflows.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).sort().join(",") !== "blobSha,id,path" ||
        typeof item.id !== "number" || !Number.isSafeInteger(item.id) || item.id < 1 ||
        ![".github/workflows/calculator-task-ci.yml", ".github/workflows/calculator-final-ci.yml"].includes(item.path) ||
        typeof item.blobSha !== "string" || !/^[a-f0-9]{40}$/.test(item.blobSha)) return refuse();
    return Object.freeze({ id: item.id, path: item.path as string, blobSha: item.blobSha });
  });
  if (!pins.some(pin => pin.path.endsWith("calculator-task-ci.yml")) || new Set(pins.map(pin => pin.id)).size !== pins.length ||
      new Set(pins.map(pin => pin.path)).size !== pins.length) return refuse();
  return Object.freeze({ version: 1, sandboxImage: raw.sandboxImage, trustedWorkflows: Object.freeze(pins) });
}
export async function loadCalculatorRuntimeSources(reader: CalculatorSnapshotReader, ref: string, sha: string): Promise<ReadonlyMap<string, string>> {
  const sources = new Map<string, string>();
  for (let offset = 0; offset < CALCULATOR_PROFILE.writablePaths.length; offset += 3) {
    const snapshot = await loadCalculatorSnapshot({ repository: CALCULATOR_PROFILE.repository, baseRef: ref, baseSha: sha,
      changePaths: CALCULATOR_PROFILE.writablePaths.slice(offset, offset + 3) }, reader);
    for (const [path, content] of calculatorSources(snapshot)) sources.set(path, content);
  }
  if (await reader.getHead(ref) !== sha) return refuse(); return sources;
}
/** No automatic plan/run chaining or event loop. One call plans or executes one
 * task; durable state survives failures and model HTTP budgets are never reset
 * inside a repair. Production adapters remain isolated from model arguments. */
export async function runCalculatorRuntime(input: unknown, configInput: unknown, directory: string,
  mode: "inspect" | "plan" | "run" | "preflight", env: NodeJS.ProcessEnv = process.env) {
  const owner = prepareCalculatorGoal(input), store = new CalculatorPlanStore(directory, input);
  const saved = store.inspect();
  if (mode === "inspect") return { mode, status: saved?.status ?? "unplanned", planFingerprint: saved?.fingerprint,
    taskIds: saved?.tasks.map(task => task.id) ?? [], wholeAppCompleted: false, legalEnabled: false };
  try {
    const config = prepareCalculatorRuntimeConfig(configInput);
    if (!["plan", "run", "preflight"].includes(mode) || env.AGENT_FACTORY_TARGET_PROFILE !== "calculator" ||
        env.AGENT_FACTORY_LEGAL_ENABLED !== "false" || env.ONAY_TEAM_FREE_TIER_CONFIRMED !== "true" ||
        env.AGENT_FACTORY_PROVIDER !== owner.provider || env.CALCULATOR_MODEL_LIVE_APPROVED !== "ONE_FREE_BOUNDED_RUN" ||
        selectProviderConfig(env).provider !== owner.provider) return refuse();
    const reader = createCalculatorSnapshotReader(env);
    const sandbox = createCalculatorSandbox({ image: config.sandboxImage, baseSha: owner.baseSha, baseSources: new Map() }, env);
    const readiness = await sandbox.preflight();
    if (!readiness.ready) return { mode, status: "blocked", reasonCode: readiness.reasonCode, wholeAppCompleted: false, legalEnabled: false };
    if (await reader.getHead(owner.baseRef) !== owner.baseSha) return refuse();
    const ci = createCalculatorCiReader({ trustedWorkflows: config.trustedWorkflows, approvedBase: { ref: owner.baseRef, sha: owner.baseSha } }, env);
    await ci({ repository: owner.repository, branch: owner.baseRef, candidateSha: owner.baseSha });
    if (mode === "preflight") return { mode, status: "ready-for-explicit-plan-or-run", wholeAppCompleted: false, legalEnabled: false,
      unverifiedAreas: ["No models or app tests ran", "Atomic publication requires explicit run mode and write authorization"] };
    if (mode === "plan") {
      if (saved) return { mode, status: saved.status, planFingerprint: saved.fingerprint, reusedSavedPlan: true, wholeAppCompleted: false, legalEnabled: false };
      const claim = new TeamTaskStore(directory, { id: "calc-planning-" + owner.id, fingerprint: owner.ownerFingerprint });
      try {
        if (claim.claim() !== "claimed") return refuse();
        claim.recordStage("model_plan", "running");
        const plan = await createCalculatorModelTeam(input, env).plan();
        claim.recordStage("model_plan", "passed"); store.initialize(plan.proposal);
        claim.finish("needs-review", "plan_saved_not_execution");
        return { mode, status: plan.status, planFingerprint: plan.fingerprint, wholeAppCompleted: false, legalEnabled: false };
      } catch { try { claim.finish("blocked", "planning_interrupted_no_replay"); } catch { /* Preserve replay barrier. */ } return refuse(); }
      finally { claim.close(); }
    }
    if (!saved || saved.status !== "planned") return refuse();
    const publisher = createCalculatorPublisher({ plan: saved, reader, env });
    let started = false;
    for (const task of saved.tasks) {
      const receipt = store.taskReceipt(saved, task); try { if (receipt.inspectExisting()) started = true; } finally { receipt.close(); }
    }
    if (!started) await publisher.bootstrapProjectBranch();
    const currentSha = await reader.getHead(saved.branch);
    // Verify the pinned workflow itself before model calls and durable task claim.
    await ci({ repository: owner.repository, branch: saved.branch, candidateSha: currentSha });
    const sources = await loadCalculatorRuntimeSources(reader, saved.branch, currentSha);
    const checks = createCalculatorSandbox({ image: config.sandboxImage, baseSha: currentSha, baseSources: sources }, env);
    const team = createCalculatorModelTeam(input, env);
    const verifyDependencies: CalculatorCheckRunner = async evidence => {
      if (evidence.currentSha !== currentSha || await reader.getHead(saved.branch) !== currentSha) return undefined;
      const task = evidence.task, receipt = store.taskReceipt(saved, task);
      try {
        const data = receipt.inspectExisting();
        if (!data || data.publication?.headSha !== evidence.candidateSha ||
            !data.stages.some(stage => stage.stage === "publish_candidate" && stage.status === "passed")) return undefined;
      } finally { receipt.close(); }
      const original = await loadCalculatorSnapshot({ repository: owner.repository, baseRef: owner.baseSha, baseSha: owner.baseSha, changePaths: task.paths }, reader);
      const current = await loadCalculatorSnapshot({ repository: owner.repository, baseRef: saved.branch, baseSha: currentSha, changePaths: task.paths }, reader);
      const observed = team.observeCommitted(saved, task.id, original, current);
      for (const role of ["security", "reviewer", "tester"] as const) if (!(await team.assess(role, saved, task.id, observed)).ready) return undefined;
      const currentChanges = Object.freeze({ ...observed, baseRef: saved.branch, baseSha: currentSha });
      const proof = validateCalculatorProposalTests(await checks.checkProposal({ task, changes: currentChanges,
        proposalDigest: calculatorProposalDigest(currentChanges) }), task.id, currentChanges);
      const result = await ci({ repository: owner.repository, branch: saved.branch, candidateSha: currentSha });
      const tested = evaluateTestExecutionEvidence(result.runs, result.jobs, currentSha, ["Calculator task CI"], ["Syntax", "Task tests"]);
      if (proof.status !== "passed" || !proof.testsExecuted || !tested.testsExecuted || await reader.getHead(saved.branch) !== currentSha) return undefined;
      return { repository: owner.repository, planFingerprint: saved.fingerprint, taskId: task.id, candidateSha: evidence.candidateSha,
        currentSha, securityReady: true, independentReviewReady: true, taskChecksPassed: true, testsExecuted: true };
    };
    const workspace = await openCalculatorWorkspace(store, reader, saved.branch, currentSha);
    return await runCalculatorExecution(workspace, { team, env, verifyDependencies,
      tools: { checkProposal: checks.checkProposal, publish: publisher.publish, ci } });
  } catch { return refuse(); }
}
