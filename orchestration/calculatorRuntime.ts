import {createCalculatorProjectRuntimeTeam,prepareCalculatorProjectRuntimeHost,type CalculatorProjectRuntimeHost} from './calculatorProjectRuntimeTeam.js';
import type { CalculatorHostPreset } from "./taskModelBudget.js";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
import { createCalculatorSnapshotReader, loadCalculatorSnapshot, calculatorSources, type CalculatorSnapshot, type CalculatorSnapshotReader } from "../github/calculatorSnapshot.js";
import { createCalculatorPublisher } from "../github/calculatorPublisher.js";
import { createCalculatorCiReader, type CalculatorWorkflowPin } from "../github/calculatorCi.js";
import { createCalculatorSandbox } from "./calculatorSandbox.js";
import { createCalculatorModelTeam, type CalculatorPriorModelCharge, type CalculatorRejectedAssessment } from "./calculatorModelTeam.js";
import type { PreparedCalculatorChanges } from "../commander/calculatorChanges.js";
import { writeCalculatorAssessmentRejection } from "./calculatorAssessmentRejection.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { prepareCalculatorGoal, type CalculatorPlan } from "./calculatorPlan.js";
import { openCalculatorWorkspace } from "./calculatorWorkspace.js";
import { runCalculatorExecution, type CalculatorExecutionCheckpointEvent, type CalculatorExecutionReport } from "./calculatorExecution.js";
import { createCalculatorExecutionCheckpointStore, type CalculatorExecutionCheckpointPayload,
  type CalculatorExecutionCheckpointStore, type CalculatorExecutionCheckpointIdentity } from "./calculatorExecutionCheckpoint.js";
import { TeamTaskStore } from "./teamTaskStore.js";
import type { CalculatorCheckRunner } from "./calculatorWorkspace.js";
import { calculatorProposalDigest, validateCalculatorProposalTests } from "./calculatorExecutionEvidence.js";
import { selectProviderConfig } from "../commander/providerConfig.js";
import { evaluateTestExecutionEvidence } from "../agents/tester/agent.js";
import { prepareCalculatorAfterCiRequest, runCalculatorAfterCi, type CalculatorAfterCiRequest, type CalculatorAfterCiBarrierPersistence } from "./calculatorAfterCi.js";

export const CALCULATOR_RUNTIME_ERROR = "Calculator live runtime is not ready. Inspect private state, provider, sandbox, workflow pins and GitHub access; no replay.";
function refuse(): never { throw new Error(CALCULATOR_RUNTIME_ERROR); }
/** A trusted host may supply a separately authenticated dependency checker.
 * JSON, model output and old receipt status cannot provide this capability.
 * The checker must verify archived approvals and actual current host tests. */
export type CalculatorRuntimeAfterCi = Readonly<{
  request: CalculatorAfterCiRequest; verifyDependencies: CalculatorCheckRunner;
  persistBarrier: CalculatorAfterCiBarrierPersistence;
}>;
export function prepareCalculatorRuntimeAfterCi(value: unknown): CalculatorRuntimeAfterCi | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return refuse();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== 3 || !Object.hasOwn(descriptors, "request") || !Object.hasOwn(descriptors, "verifyDependencies") ||
      !Object.hasOwn(descriptors, "persistBarrier") ||
      !Object.values(descriptors).every(item => Object.hasOwn(item, "value")) ||
      typeof descriptors.verifyDependencies.value !== "function" || typeof descriptors.persistBarrier.value !== "function") return refuse();
  try { return Object.freeze({ request: prepareCalculatorAfterCiRequest(descriptors.request.value),
    verifyDependencies: descriptors.verifyDependencies.value as CalculatorCheckRunner,
    persistBarrier: descriptors.persistBarrier.value as CalculatorAfterCiBarrierPersistence }); }
  catch { return refuse(); }
}
/** Host-only limits. The named successor preset changes waiting time only,
 * with four requests, fixed byte/output ceilings and no repair. */
export type CalculatorRuntimeHostLimits = Readonly<
  { maxRequests: 4; maxRunBytes: 96000; maxRepairs: 0; hostPreset: CalculatorHostPreset } |
  { maxRequests: 4; maxRunBytes: 96000; maxRepairs: 0 } |
  { maxRequests: 3; maxRunBytes: 72000; maxRepairs: 0 } |
  { maxRequests: 1; maxRunBytes: 24000; maxRepairs: 0 }>;
export function prepareCalculatorRuntimeHostLimits(value: unknown): CalculatorRuntimeHostLimits | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      !["maxRepairs,maxRequests,maxRunBytes", "hostPreset,maxRepairs,maxRequests,maxRunBytes"].includes(Object.keys(value).sort().join(","))) return refuse();
  const raw = value as Record<string, unknown>;
  if (raw.maxRepairs !== 0) return refuse();
  if (Object.hasOwn(raw, "hostPreset")) {
    if ((raw.hostPreset !== "calculator-successor-four-roles" && raw.hostPreset !== "calculator-frontend-2048-four-roles") || raw.maxRequests !== 4 || raw.maxRunBytes !== 96000) return refuse();
    return Object.freeze({ maxRequests: 4, maxRunBytes: 96000, maxRepairs: 0, hostPreset: raw.hostPreset });
  }
  if (raw.maxRequests === 4 && raw.maxRunBytes === 96000) return Object.freeze({ maxRequests: 4, maxRunBytes: 96000, maxRepairs: 0 });
  if (raw.maxRequests === 3 && raw.maxRunBytes === 72000) return Object.freeze({ maxRequests: 3, maxRunBytes: 72000, maxRepairs: 0 });
  if (raw.maxRequests === 1 && raw.maxRunBytes === 24000) return Object.freeze({ maxRequests: 1, maxRunBytes: 24000, maxRepairs: 0 });
  return refuse();
}
/** A host-verified private capsule supplies the whole prepared proposal and an
 * optional completed prefix. ModelTeam independently revalidates both before
 * returning capabilities; this envelope alone grants no authorization. */
export type CalculatorRuntimeContinuation = Readonly<{
  proposal: unknown; proposalDigest: string; restoredAssessments?: readonly unknown[];
}>;
export function prepareCalculatorRuntimeContinuation(value: unknown): CalculatorRuntimeContinuation | undefined {
  if (value === undefined) return undefined;
  try {
    const parents = new Set<object>(); let bytes = 0, nodes = 0;
    function copy(item: unknown, depth: number): unknown {
      if (++nodes > 20000 || depth > 64) return refuse();
      if (item === null || typeof item === "boolean" || typeof item === "string" || typeof item === "number") {
        if (typeof item === "number" && !Number.isFinite(item)) return refuse();
        if (typeof item === "string" && item.length > 100000) return refuse();
        bytes += Buffer.byteLength(JSON.stringify(item)); if (bytes > 100000) return refuse(); return item;
      }
      if (!item || typeof item !== "object" || parents.has(item) ||
          (Array.isArray(item) ? Object.getPrototypeOf(item) !== Array.prototype :
            ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) return refuse();
      parents.add(item);
      const properties = Object.getOwnPropertyDescriptors(item);
      if (Object.getOwnPropertySymbols(item).length || Object.values(properties).some(property => !Object.hasOwn(property, "value") ||
          (!property.enumerable && !(Array.isArray(item) && property === properties.length)))) return refuse();
      const keys = Object.keys(item); bytes += 2 + Math.max(0, keys.length - 1);
      if (bytes > 100000 || (Array.isArray(item) && (keys.length !== item.length || keys.some((key, index) => key !== String(index))))) return refuse();
      let result: unknown;
      if (Array.isArray(item)) result = Object.freeze(keys.map(key => copy(properties[key]!.value, depth + 1)));
      else {
        const target: Record<string, unknown> = {};
        for (const key of keys.sort()) {
          bytes += Buffer.byteLength(JSON.stringify(key)) + 1; if (bytes > 100000) return refuse();
          Object.defineProperty(target, key, { value: copy(properties[key]!.value, depth + 1), enumerable: true });
        }
        result = Object.freeze(target);
      }
      parents.delete(item); return result;
    }
    const raw = copy(value, 0) as Record<string, unknown>;
    if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
        !["proposal,proposalDigest", "proposal,proposalDigest,restoredAssessments"].includes(Object.keys(raw).join(",")) ||
        typeof raw.proposalDigest !== "string" || !/^[a-f0-9]{64}$/.test(raw.proposalDigest) ||
        !raw.proposal || typeof raw.proposal !== "object" || Array.isArray(raw.proposal)) return refuse();
    if (Object.hasOwn(raw, "restoredAssessments")) {
      const prefix = raw.restoredAssessments;
      if (!Array.isArray(prefix) || (prefix.length !== 0 && (prefix.length !== 2 || prefix.some((assessment, index) =>
        !assessment || typeof assessment !== "object" || Array.isArray(assessment) ||
        assessment.role !== ["security", "reviewer"][index])))) return refuse();
      return Object.freeze({ proposal: raw.proposal, proposalDigest: raw.proposalDigest, restoredAssessments: prefix });
    }
    return Object.freeze({ proposal: raw.proposal, proposalDigest: raw.proposalDigest });
  } catch { return refuse(); }
}
/** The linked-artifact wrapper verifies authority before calling this host
 * callback. Restrict restoration to the untouched first task and owner base. */
export function createCalculatorRuntimeContinuationRestorer(continuationInput: CalculatorRuntimeContinuation,
  expected: CalculatorPlan, team: Pick<ReturnType<typeof createCalculatorModelTeam>, "restoreProposal">) {
  const continuation = prepareCalculatorRuntimeContinuation(continuationInput), first = expected.tasks[0];
  if (!continuation || !first || first.dependsOn.length || typeof team?.restoreProposal !== "function") return refuse();
  let used = false;
  return (plan: CalculatorPlan, id: string, snapshot: CalculatorSnapshot): PreparedCalculatorChanges => {
    if (used) return refuse(); used = true;
    if (plan.fingerprint !== expected.fingerprint || plan.owner.ownerFingerprint !== expected.owner.ownerFingerprint ||
        plan.branch !== expected.branch || plan.owner.baseSha !== expected.owner.baseSha ||
        plan.tasks[0]?.id !== first.id || plan.tasks[0].dependsOn.length || id !== first.id || snapshot.repository !== expected.owner.repository ||
        snapshot.baseRef !== expected.branch || snapshot.baseSha !== expected.owner.baseSha ||
        snapshot.changePaths.length !== first.paths.length || first.paths.some(path => !snapshot.changePaths.includes(path))) return refuse();
    return team.restoreProposal(plan, id, snapshot, continuation.proposal, continuation.proposalDigest, continuation.restoredAssessments ?? []);
  };
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
export type CalculatorRuntimeAssessmentContext = Readonly<{
  identity: CalculatorExecutionCheckpointIdentity; proposal: PreparedCalculatorChanges;
  expectedRole: CalculatorRejectedAssessment["role"]; kind: "task" | "dependency";
  stage: string; attempt: 1 | 2; status: CalculatorExecutionCheckpointPayload["status"]; httpInFlight: boolean;
}>;
/** A rejection hook proves that a parsed provider response returned. Preserve
 * that result privately before clearing uncertainty in the execution checkpoint.
 * This terminal host hook never appends an accepted specialist assessment. */
export function createCalculatorRuntimeAssessmentRejection(input: Readonly<{
  directory: string; context: () => CalculatorRuntimeAssessmentContext | undefined;
  charge: () => CalculatorPriorModelCharge;
  persistReturned: (charge: CalculatorPriorModelCharge) => void | Promise<void>;
}>) {
  if (!input || typeof input.context !== "function" || typeof input.charge !== "function" || typeof input.persistReturned !== "function") return refuse();
  let stopped = false;
  return async (rejection: CalculatorRejectedAssessment): Promise<void> => {
    if (stopped) return refuse(); stopped = true;
    try {
      const context = input.context();
      if (!context || !rejection || context.expectedRole !== rejection.role || context.status !== "running" || !context.httpInFlight ||
          context.proposal.repository !== context.identity.repository ||
          (context.kind !== "task" && context.kind !== "dependency") ||
          context.stage !== (context.kind === "task" ? rejection.role + "_" + context.attempt : "dependency_" + rejection.role) ||
          (context.kind === "task" && (context.proposal.baseRef !== context.identity.branch || context.proposal.baseSha !== context.identity.baseSha)) ||
          (context.kind === "dependency" && context.proposal.baseSha !== context.identity.bootstrapSha)) return refuse();
      writeCalculatorAssessmentRejection(input.directory, { ...context.identity,
        proposalDigest: calculatorProposalDigest(context.proposal), role: rejection.role },
      { result: rejection.result, validationCode: rejection.validationCode });
      await input.persistReturned(input.charge());
    } catch { return refuse(); }
  };
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
/** Worker-local pathname only. The event identity inside the directory is
 * location independent, so an authenticated artifact can restore another worker. */
export function calculatorRuntimeAfterCiEventPath(metadataDirectory: string): string {
  if (!isAbsolute(metadataDirectory) || resolve(metadataDirectory) !== metadataDirectory || metadataDirectory === parse(metadataDirectory).root) return refuse();
  return join(dirname(metadataDirectory), "execution-private", digest(metadataDirectory), "after-ci-events");
}
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
 * inside a repair. A host-only after-CI entry admits one fresh successor; its
 * event barrier is separate from consumed task receipts and historic charges.
 * Production adapters remain isolated from model arguments. */
export async function runCalculatorRuntime(input: unknown, configInput: unknown, directory: string,
  mode: "inspect" | "plan" | "run" | "preflight", env: NodeJS.ProcessEnv = process.env, hostLimits?: CalculatorRuntimeHostLimits,
  continuationInput?: CalculatorRuntimeContinuation, afterCiInput?: CalculatorRuntimeAfterCi, projectHostInput?:CalculatorProjectRuntimeHost) {
  let projectHost:CalculatorProjectRuntimeHost|undefined;
  try{projectHost=prepareCalculatorProjectRuntimeHost(projectHostInput);}catch{return refuse();}
  const projectMode=env.AGENT_FACTORY_PROJECT_BUDGET_MODE;
  if(projectMode!==undefined&&projectMode!=='required'||projectHost&&projectMode!=='required'||
    projectMode==='required'&&(mode==='run'||mode==='plan'||mode==='preflight')&&!projectHost)return refuse();
  const limits = prepareCalculatorRuntimeHostLimits(hostLimits), continuation = prepareCalculatorRuntimeContinuation(continuationInput);
  const afterCi = prepareCalculatorRuntimeAfterCi(afterCiInput);
  const hostPreset = limits && "hostPreset" in limits ? limits.hostPreset : undefined;
  if (hostPreset && (!afterCi || continuation)) return refuse();
  if (afterCi && (mode !== "run" || continuation || limits?.maxRequests !== 4 || limits.maxRepairs !== 0)) return refuse();
  if ((limits || continuation) && mode !== "run") return refuse();
  if (continuation ? limits?.maxRequests !== (continuation.restoredAssessments?.length === 2 ? 1 : 3) :
      limits?.maxRequests === 3 || limits?.maxRequests === 1) return refuse();
  const owner = prepareCalculatorGoal(input), store = new CalculatorPlanStore(directory, input);
  const saved = store.inspect();
  if (mode === "inspect") return { mode, status: saved?.status ?? "unplanned", planFingerprint: saved?.fingerprint,
    taskIds: saved?.tasks.map(task => task.id) ?? [], wholeAppCompleted: false, legalEnabled: false };
  let projectGrantSha256:string|undefined;
  let phase = "runtime_configuration_unverified";
  try {
    if(projectHost){
      if(!saved||saved.fingerprint!==projectHost.controller.identity.planFingerprint||saved.owner.ownerFingerprint!==projectHost.controller.identity.ownerFingerprint)return refuse();
      await projectHost.controller.assertAuthorized();projectGrantSha256=(await projectHost.controller.inspect()).grantSha256;
    }
    const config = prepareCalculatorRuntimeConfig(configInput), provider = selectProviderConfig(env);
    if (!["plan", "run", "preflight"].includes(mode) || env.AGENT_FACTORY_TARGET_PROFILE !== "calculator" ||
        env.AGENT_FACTORY_LEGAL_ENABLED !== "false" || env.ONAY_TEAM_FREE_TIER_CONFIRMED !== "true" ||
        env.AGENT_FACTORY_PROVIDER !== owner.provider || env.CALCULATOR_MODEL_LIVE_APPROVED !== "ONE_FREE_BOUNDED_RUN" ||
        provider.provider !== owner.provider) return refuse();
    const reader = createCalculatorSnapshotReader(env);
    const sandbox = createCalculatorSandbox({ image: config.sandboxImage, baseSha: owner.baseSha, baseSources: new Map(), includeFailureDetails: true }, env);
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
    if (afterCi && saved.fingerprint !== afterCi.request.planFingerprint) return refuse();
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
    if (continuation && (started || !saved.tasks[0] || saved.tasks[0].dependsOn.length)) return refuse();
    if (!continuation && !started) await publisher.bootstrapProjectBranch();
    phase = "project_head_unverified";
    const currentSha = await reader.getHead(saved.branch);
    if (continuation && currentSha !== owner.baseSha) return refuse();
    if (afterCi && (!started || currentSha !== afterCi.request.candidateSha)) return refuse();
    // Verify the pinned workflow itself before model calls and durable task claim.
    phase = "project_workflow_unverified";
    await ci({ repository: owner.repository, branch: saved.branch, candidateSha: currentSha });
    phase = "current_sources_unverified";
    const sources = await loadCalculatorRuntimeSources(reader, saved.branch, currentSha);
    const checks = createCalculatorSandbox({ image: config.sandboxImage, baseSha: currentSha, baseSources: sources, includeFailureDetails: true }, env);
    phase = "private_execution_checkpoint_unverified";
    const privateDirectory = privateExecutionDirectory(directory);
    // Runtime checkout provenance is pinned by the host workflow barrier. This
    // digest binds evidence to policy/config/model; it grants no resume authority.
    const runtimeConfigDigest = digest({ policyVersion: "calculator-private-execution-v1", provider: provider.provider, model: provider.model,
      ...(projectHost?{projectBudget:{projectKey:projectHost.controller.projectKey,grantSha256:projectGrantSha256,executionId:projectHost.executionId}}:{}),
      ...(limits ? { hostLimits: limits } : {}),
      ...(continuation ? { continuationProposalDigest: continuation.proposalDigest } : {}),
      ...(continuation?.restoredAssessments?.length ? { restoredAssessmentsDigest: digest(continuation.restoredAssessments) } : {}),
      ...(afterCi ? { afterCiRequest: afterCi.request } : {}),
      version: config.version, sandboxImage: config.sandboxImage,
      trustedWorkflows: [...config.trustedWorkflows].sort((a, b) => a.path.localeCompare(b.path)).map(pin => ({ id: pin.id, path: pin.path, blobSha: pin.blobSha })) });
    const checkpointIdentity = { repository: owner.repository,
      goalId: owner.id, ownerFingerprint: owner.ownerFingerprint, planFingerprint: saved.fingerprint,
      branch: saved.branch, baseSha: currentSha, bootstrapSha: owner.baseSha, runtimeConfigDigest };
    const writers = createCalculatorRuntimeCheckpointWriters(privateDirectory, checkpointIdentity);
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
    let dependencyAssessment: Readonly<{ taskId: string; proposal: PreparedCalculatorChanges; expectedRole: CalculatorRejectedAssessment["role"] }> | undefined;
    const afterAssessmentRejected = createCalculatorRuntimeAssessmentRejection({ directory: privateDirectory,
      context: () => {
        if (dependencyAssessment) {
          if (activeId !== runtimeId || active.stage !== "dependency_" + dependencyAssessment.expectedRole ||
              !saved.tasks.some(task => task.id === dependencyAssessment!.taskId)) return undefined;
          return { identity: { ...checkpointIdentity, taskId: dependencyAssessment.taskId }, proposal: dependencyAssessment.proposal,
            expectedRole: dependencyAssessment.expectedRole, kind: "dependency", stage: active.stage, attempt: active.attempt,
            status: active.status, httpInFlight: active.httpInFlight };
        }
        const match = /^(security|reviewer|tester)_([12])$/.exec(active.stage);
        if (!match || activeId === runtimeId || !active.proposal || !saved.tasks.some(task => task.id === activeId) ||
            Number(match[2]) !== active.attempt) return undefined;
        return { identity: { ...checkpointIdentity, taskId: activeId }, proposal: active.proposal,
          expectedRole: match[1] as CalculatorRejectedAssessment["role"], kind: "task", stage: active.stage, attempt: active.attempt,
          status: active.status, httpInFlight: active.httpInFlight };
      }, charge: () => charge(), persistReturned: returnedCharge => save({ ...active, status: "blocked", httpInFlight: false }, returnedCharge),
    });
    const team = projectHost
      ? await createCalculatorProjectRuntimeTeam(input,saved,env,projectHost,{checkpoints:{beforeRequest,afterAssessmentRejected},...(hostPreset?{preset:hostPreset}:{})})
      : createCalculatorModelTeam(input, env, globalThis.fetch, {}, undefined, { beforeRequest, afterAssessmentRejected }, hostPreset);
    function charge(): CalculatorPriorModelCharge {
      const result = team.checkpointCharge(); if (!result) return refuse(); return result;
    }
    function checkpoint(event: CalculatorExecutionCheckpointEvent): void {
      if (!saved!.tasks.some(task => task.id === event.taskId) ||
          (continuation && event.taskId !== saved!.tasks[0]!.id) ||
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
        // This entry may only review the untouched first task. A late receipt
        // cannot turn it into dependency inference or selection of a next task.
        if (continuation) return undefined;
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
          dependencyAssessment = { taskId: task.id, proposal: observed, expectedRole: role };
          let assessment;
          try { assessment = await team.assess(role, saved, task.id, observed); }
          finally { dependencyAssessment = undefined; }
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
      const executionOptions = { team, env, checkpoint,
        ...(limits ? { maxRepairs: limits.maxRepairs } : {}),
        ...(continuation ? { restoreProposal: createCalculatorRuntimeContinuationRestorer(continuation, saved, team) } : {}),
        ...(continuation?.restoredAssessments?.length ? {
          restoreAssessments: (plan: CalculatorPlan, id: string, proposal: PreparedCalculatorChanges) => team.restoredAssessmentPrefix(plan, id, proposal),
        } : {}),
        tools: { checkProposal: checks.checkProposal, publish: publisher.publish, ci } };
      let result: CalculatorExecutionReport;
      if (afterCi) {
        // This directory survives with private evidence. It never sits inside
        // the strict source-free task metadata capsule or replaces old state.
        const eventDirectory = calculatorRuntimeAfterCiEventPath(directory);
        try { mkdirSync(eventDirectory, { mode: 0o700 }); }
        catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") return refuse(); }
        const stat = lstatSync(eventDirectory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 ||
            (process.getuid && stat.uid !== process.getuid())) return refuse();
        const transition = await runCalculatorAfterCi(store, reader, afterCi.request, { eventDirectory, ci,
          verifyDependencies: afterCi.verifyDependencies, persistBarrier: afterCi.persistBarrier, execution: executionOptions });
        result = transition.execution ?? { status: transition.status === "blocked" ? "blocked" as const : "needs-review" as const,
          reasonCode: transition.reasonCode, attempts: 0, repairs: 0, proposalTestsExecuted: false,
          candidateTestsExecuted: false, wholeAppCompleted: false as const, finalCalculatorCiVerified: false as const, legalEnabled: false as const };
      } else result = await runCalculatorExecution(workspace, { ...executionOptions, verifyDependencies });
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
