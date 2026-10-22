import { createHash } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
import { createCalculatorSnapshotReader, loadCalculatorSnapshot, calculatorSources, type CalculatorSnapshotReader } from "../github/calculatorSnapshot.js";
import { createCalculatorPublisher } from "../github/calculatorPublisher.js";
import { createCalculatorCiReader, type CalculatorWorkflowPin } from "../github/calculatorCi.js";
import { createCalculatorSandbox } from "./calculatorSandbox.js";
import { createCalculatorModelTeam, type CalculatorPriorModelCharge } from "./calculatorModelTeam.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { prepareCalculatorGoal, type CalculatorPlan } from "./calculatorPlan.js";
import { openCalculatorWorkspace } from "./calculatorWorkspace.js";
import { runCalculatorExecution, type CalculatorExecutionCheckpointEvent } from "./calculatorExecution.js";
import { createCalculatorExecutionCheckpointStore, type CalculatorExecutionCheckpointPayload,
  type CalculatorExecutionCheckpointStore, type CalculatorExecutionCheckpointIdentity } from "./calculatorExecutionCheckpoint.js";
import { TeamTaskStore } from "./teamTaskStore.js";
import type { CalculatorCheckRunner } from "./calculatorWorkspace.js";
import { calculatorProposalDigest, validateCalculatorProposalTests } from "./calculatorExecutionEvidence.js";
import { selectProviderConfig } from "../commander/providerConfig.js";
import { evaluateTestExecutionEvidence } from "../agents/tester/agent.js";

export const CALCULATOR_RUNTIME_ERROR = "Calculator live runtime is not ready. Inspect private state, provider, sandbox, workflow pins and GitHub access; no replay.";
function refuse(): never { throw new Error(CALCULATOR_RUNTIME_ERROR); }
/** Host-only additional allowance. These literals lower the normal limits;
 * neither owner/model JSON nor environment variables can select a larger cap. */
export type CalculatorRuntimeHostLimits = Readonly<{ maxRequests: 4; maxRunBytes: 96000; maxRepairs: 0 }>;
export function prepareCalculatorRuntimeHostLimits(value: unknown): CalculatorRuntimeHostLimits | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).sort().join(",") !== "maxRepairs,maxRequests,maxRunBytes") return refuse();
  const raw = value as Record<string, unknown>;
  if (raw.maxRequests !== 4 || raw.maxRunBytes !== 96000 || raw.maxRepairs !== 0) return refuse();
  return Object.freeze({ maxRequests: 4, maxRunBytes: 96000, maxRepairs: 0 });
}
/** Called only after the existing task/provider ledgers reserve a request.
 * Persist even a refused reservation, but never label local refusal as HTTP.
 * A caught refusal cannot reopen the gate or refund the conservative charge. */
export function createCalculatorRuntimeRequestCheckpoint(limitsInput: CalculatorRuntimeHostLimits | undefined,
  persist: (charge: CalculatorPriorModelCharge, admitted: boolean) => void | Promise<void>) {
  const limits = prepareCalculatorRuntimeHostLimits(limitsInput);
  if (typeof persist !== "function") return refuse();
  let stopped = false;
  return async (charge: CalculatorPriorModelCharge): Promise<void> => {
    if (stopped) return refuse();
    try {
      if (!charge || typeof charge !== "object" || Array.isArray(charge) ||
          Object.keys(charge).sort().join(",") !== "attemptedRequests,elapsedMs,reservedRunTokens,totalRequestBytes" ||
          Object.values(charge).some(value => !Number.isSafeInteger(value) || value < 0)) return refuse();
      const admitted = !limits || (charge.attemptedRequests <= limits.maxRequests && charge.totalRequestBytes <= limits.maxRunBytes);
      await persist(charge, admitted);
      if (!admitted) return refuse();
    } catch { stopped = true; return refuse(); }
  };
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
/** Private evidence is never placed in the source-free receipt/artifact tree.
 * Namespace by metadata directory, so sibling runs cannot share task filenames.
 * Identity changes stay in the same namespace and fail closed in the store. */
function privateExecutionDirectory(metadataDirectory: string): string {
  const root = join(dirname(resolve(metadataDirectory)), "execution-private");
  if (root === resolve(metadataDirectory)) return refuse();
  const namespace = join(root, digest(resolve(metadataDirectory)));
  for (const target of [root, namespace]) {
    let current = parse(target).root;
    for (const part of dirname(target).slice(current.length).split("/").filter(Boolean)) {
      current = join(current, part);
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return refuse();
    }
    try { lstatSync(target); } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") return refuse();
      mkdirSync(target, { mode: 0o700 });
    }
    const stat = lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 ||
        (process.getuid && stat.uid !== process.getuid())) return refuse();
  }
  return namespace;
}
/** Host-only writers. Existing evidence is an immutable replay barrier, including
 * after the first refusal is caught by an executor failure checkpoint. */
export function createCalculatorRuntimeCheckpointWriters(directory: string,
  identity: Omit<CalculatorExecutionCheckpointIdentity, "taskId">) {
  const writers = new Map<string, CalculatorExecutionCheckpointStore>(), poisoned = new Set<string>();
  let closed = false;
  return Object.freeze({
    get(taskId: string): CalculatorExecutionCheckpointStore {
      if (closed || poisoned.has(taskId)) return refuse();
      const existing = writers.get(taskId); if (existing) return existing;
      let candidate: CalculatorExecutionCheckpointStore | undefined;
      try {
        candidate = createCalculatorExecutionCheckpointStore(directory, { ...identity, taskId });
        if (candidate.inspect()) return refuse();
        writers.set(taskId, candidate); return candidate;
      } catch {
        poisoned.add(taskId);
        try { candidate?.close(); } catch { /* Preserve the replay barrier. */ }
        return refuse();
      }
    },
    has: (taskId: string) => writers.has(taskId),
    close(): void {
      if (closed) return; closed = true;
      let failed = false;
      for (const writer of writers.values()) try { writer.close(); } catch { failed = true; }
      if (failed) return refuse();
    },
  });
}
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
  mode: "inspect" | "plan" | "run" | "preflight", env: NodeJS.ProcessEnv = process.env, hostLimits?: CalculatorRuntimeHostLimits) {
  const limits = prepareCalculatorRuntimeHostLimits(hostLimits);
  if (limits && mode !== "run") return refuse();
  const owner = prepareCalculatorGoal(input), store = new CalculatorPlanStore(directory, input);
  const saved = store.inspect();
  if (mode === "inspect") return { mode, status: saved?.status ?? "unplanned", planFingerprint: saved?.fingerprint,
    taskIds: saved?.tasks.map(task => task.id) ?? [], wholeAppCompleted: false, legalEnabled: false };
  let phase = "runtime_configuration_unverified";
  try {
    const config = prepareCalculatorRuntimeConfig(configInput), provider = selectProviderConfig(env);
    if (!["plan", "run", "preflight"].includes(mode) || env.AGENT_FACTORY_TARGET_PROFILE !== "calculator" ||
        env.AGENT_FACTORY_LEGAL_ENABLED !== "false" || env.ONAY_TEAM_FREE_TIER_CONFIRMED !== "true" ||
        env.AGENT_FACTORY_PROVIDER !== owner.provider || env.CALCULATOR_MODEL_LIVE_APPROVED !== "ONE_FREE_BOUNDED_RUN" ||
        provider.provider !== owner.provider) return refuse();
    const reader = createCalculatorSnapshotReader(env);
    const sandbox = createCalculatorSandbox({ image: config.sandboxImage, baseSha: owner.baseSha, baseSources: new Map() }, env);
    phase = "sandbox_readiness_unverified";
    const readiness = await sandbox.preflight();
    if (!readiness.ready) return { mode, status: "blocked", reasonCode: readiness.reasonCode, wholeAppCompleted: false, legalEnabled: false };
    phase = "bootstrap_head_unverified";
    if (await reader.getHead(owner.baseRef) !== owner.baseSha) return refuse();
    const ci = createCalculatorCiReader({ trustedWorkflows: config.trustedWorkflows, approvedBase: { ref: owner.baseRef, sha: owner.baseSha } }, env);
    phase = "workflow_provenance_unverified";
    await ci({ repository: owner.repository, branch: owner.baseRef, candidateSha: owner.baseSha });
    if (mode === "preflight") return { mode, status: "ready-for-explicit-plan-or-run", wholeAppCompleted: false, legalEnabled: false,
      unverifiedAreas: ["No models or app tests ran", "Atomic publication requires explicit run mode and write authorization"] };
    if (mode === "plan") {
      if (saved) return { mode, status: saved.status, planFingerprint: saved.fingerprint, reusedSavedPlan: true, wholeAppCompleted: false, legalEnabled: false };
      const claim = new TeamTaskStore(directory, { id: "calc-planning-" + owner.id, fingerprint: owner.ownerFingerprint });
      let planningTeam: ReturnType<typeof createCalculatorModelTeam> | undefined;
      try {
        if (claim.claim() !== "claimed") return refuse();
        claim.recordStage("model_plan", "running");
        planningTeam = createCalculatorModelTeam(input, env);
        const plan = await planningTeam.plan();
        claim.recordStage("model_plan", "passed"); store.initialize(plan.proposal);
        claim.finish("needs-review", "plan_saved_not_execution");
        return { mode, status: plan.status, planFingerprint: plan.fingerprint, wholeAppCompleted: false, legalEnabled: false };
      } catch {
        if (planningTeam) console.error(JSON.stringify({ event: "calculator_planning_failed", ...planningTeam.diagnostic() }));
        try { claim.finish("blocked", "planning_interrupted_no_replay"); } catch { /* Preserve replay barrier. */ } return refuse();
      }
      finally { claim.close(); }
    }
    phase = "saved_plan_unverified";
    if (!saved || saved.status !== "planned") return refuse();
    // Only the reviewed Groq adapter can export a provable aggregate ledger.
    // Planning, inspect/preflight and injected offline executor teams are unchanged.
    phase = "execution_checkpoint_accounting_unavailable";
    if (provider.provider !== "groq") return refuse();
    const publisher = createCalculatorPublisher({ plan: saved, reader, env });
    let started = false;
    for (const task of saved.tasks) {
      const receipt = store.taskReceipt(saved, task); try { if (receipt.inspectExisting()) started = true; } finally { receipt.close(); }
    }
    phase = "branch_bootstrap_unverified";
    if (!started) await publisher.bootstrapProjectBranch();
    phase = "project_head_unverified";
    const currentSha = await reader.getHead(saved.branch);
    // Verify the pinned workflow itself before model calls and durable task claim.
    phase = "project_workflow_unverified";
    await ci({ repository: owner.repository, branch: saved.branch, candidateSha: currentSha });
    phase = "current_sources_unverified";
    const sources = await loadCalculatorRuntimeSources(reader, saved.branch, currentSha);
    const checks = createCalculatorSandbox({ image: config.sandboxImage, baseSha: currentSha, baseSources: sources }, env);
    phase = "private_execution_checkpoint_unverified";
    const privateDirectory = privateExecutionDirectory(directory);
    // Runtime checkout provenance is pinned by the host workflow barrier. This
    // digest binds evidence to policy/config/model; it grants no resume authority.
    const runtimeConfigDigest = digest({ policyVersion: "calculator-private-execution-v1", provider: provider.provider, model: provider.model,
      ...(limits ? { hostLimits: limits } : {}),
      version: config.version, sandboxImage: config.sandboxImage,
      trustedWorkflows: [...config.trustedWorkflows].sort((a, b) => a.path.localeCompare(b.path)).map(pin => ({ id: pin.id, path: pin.path, blobSha: pin.blobSha })) });
    const writers = createCalculatorRuntimeCheckpointWriters(privateDirectory, { repository: owner.repository,
      goalId: owner.id, ownerFingerprint: owner.ownerFingerprint, planFingerprint: saved.fingerprint,
      branch: saved.branch, baseSha: currentSha, bootstrapSha: owner.baseSha, runtimeConfigDigest });
    const runtimeId = "runtime-" + digest({ goalId: owner.id, currentSha }).slice(0, 48);
    let checkpointUnavailable = false, activeId = runtimeId, active: CalculatorExecutionCheckpointPayload = {
      attempt: 1, stage: "runtime_budget", status: "running", assessments: [],
      modelState: { attemptedRequests: 0, totalRequestBytes: 0, reservedRunTokens: 0, elapsedMs: 0 },
      httpInFlight: false, publicationStarted: false,
    };
    function save(payload: CalculatorExecutionCheckpointPayload, charge: CalculatorPriorModelCharge): void {
      if (checkpointUnavailable) return refuse();
      try {
        const modelState = { ...charge, elapsedMs: Math.ceil(charge.elapsedMs) };
        if (Object.values(modelState).some(value => !Number.isSafeInteger(value) || value < 0)) return refuse();
        const next = { ...payload, modelState };
        writers.get(activeId).save(next); active = next;
      } catch { checkpointUnavailable = true; return refuse(); }
    }
    const beforeRequest = createCalculatorRuntimeRequestCheckpoint(limits, (charge, admitted) =>
      save({ ...active, status: admitted ? "running" : "blocked", httpInFlight: admitted }, charge));
    const team = createCalculatorModelTeam(input, env, globalThis.fetch, {}, undefined, { beforeRequest });
    function charge(): CalculatorPriorModelCharge {
      const result = team.checkpointCharge(); if (!result) return refuse(); return result;
    }
    function checkpoint(event: CalculatorExecutionCheckpointEvent): void {
      if (!saved!.tasks.some(task => task.id === event.taskId) ||
          (activeId !== runtimeId && activeId !== event.taskId) || (activeId !== event.taskId && active.httpInFlight)) return refuse();
      const inFlight = activeId === event.taskId && active.httpInFlight;
      activeId = event.taskId;
      save({ attempt: event.attempt, stage: event.stage, status: event.status,
        ...(event.proposal ? { proposal: event.proposal } : {}), assessments: event.assessments,
        modelState: active.modelState, publicationStarted: event.publicationStarted,
        // Only a returned, validated stage output can clear an uncertain request.
        httpInFlight: event.status === "passed" ? false : inFlight }, charge());
    }
    try {
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
        for (const role of ["security", "reviewer", "tester"] as const) {
          // Dependency checks precede the next task claim. Preserve the shared
          // ledger in a source-free runtime capsule, never a fictitious task run.
          if (activeId !== runtimeId || active.httpInFlight) return refuse();
          save({ ...active, stage: "dependency_" + role, status: "running" }, charge());
          const assessment = await team.assess(role, saved, task.id, observed);
          save({ ...active, status: "passed", httpInFlight: false }, charge());
          if (!assessment.ready) return undefined;
        }
        const currentChanges = Object.freeze({ ...observed, baseRef: saved.branch, baseSha: currentSha });
        const proof = validateCalculatorProposalTests(await checks.checkProposal({ task, changes: currentChanges,
          proposalDigest: calculatorProposalDigest(currentChanges) }), task.id, currentChanges);
        const result = await ci({ repository: owner.repository, branch: saved.branch, candidateSha: currentSha });
        const tested = evaluateTestExecutionEvidence(result.runs, result.jobs, currentSha, ["Calculator task CI"], ["Syntax", "Task tests"]);
        if (proof.status !== "passed" || !proof.testsExecuted || !tested.testsExecuted || await reader.getHead(saved.branch) !== currentSha) return undefined;
        return { repository: owner.repository, planFingerprint: saved.fingerprint, taskId: task.id, candidateSha: evidence.candidateSha,
          currentSha, securityReady: true, independentReviewReady: true, taskChecksPassed: true, testsExecuted: true };
      };
      phase = "workspace_unverified";
      const workspace = await openCalculatorWorkspace(store, reader, saved.branch, currentSha);
      phase = "one_task_execution_failed";
      const result = await runCalculatorExecution(workspace, { team, env, verifyDependencies, checkpoint,
        ...(limits ? { maxRepairs: limits.maxRepairs } : {}),
        tools: { checkProposal: checks.checkProposal, publish: publisher.publish, ci } });
      if (active.httpInFlight || (active.status === "running" && writers.has(activeId)))
        save({ ...active, status: "blocked" }, charge());
      if (team.snapshot().stopped) console.error(JSON.stringify({ event: "calculator_execution_model_failed", ...team.diagnostic() }));
      return result;
    } catch {
      if (writers.has(activeId)) try { save({ ...active, status: "blocked" }, charge()); } catch { /* Retain the last durable conservative capsule. */ }
      throw new Error(CALCULATOR_RUNTIME_ERROR);
    } finally { writers.close(); }
  } catch { console.error(JSON.stringify({ event: "calculator_runtime_failed", reasonCode: phase })); return refuse(); }
}
