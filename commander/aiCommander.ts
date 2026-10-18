import { Agent, Runner, tool, type Tool, type Model } from "@openai/agents";
import { z } from "zod";
import { legalAgentEnabled } from "./legalPolicy.js";
import { buildSpecialistInstructions } from "./skills.js";
import { buildCommanderPrompt, COMMANDER_TOOL_NAMES } from "./buildCommanderPrompt.js";
import { configureModelProvider } from "./modelProvider.js";
import { providerRequirementMessage } from "./providerConfig.js";
import { isAgentFactoryTarget, isReadOnlyRepositoryAudit, planTask } from "./planner.js";
import { AiExecutionSession, type AiExecutionDependencies, type AiExecutionOptions } from "./aiExecution.js";
import { getTargetRepository } from "../github/repositoryConfig.js";
import { assertCommitSha, assertValidBranchRef, GitHubClient } from "../github/githubClient.js";
import { AGENT_FACTORY_EXPLORER_FILES, DEFAULT_EXPLORER_FILES, inspectOnay } from "../github/onayExplorer.js";
import { generateChanges } from "../agents/backend/coder.js";
import { inspectProposedChanges, inspectSecurity } from "../agents/security/agent.js";
import { inspectTestExecution, inspectTests } from "../agents/tester/agent.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";
import { prepareOnayChange } from "../github/changeWorkflow.js";
import { waitForCiGate } from "../github/ciGate.js";
import { assertRepositoryAllowed, resolveAllowedRepositories } from "../github/repositoryPolicy.js";
import { extractProviderFailure } from "./providerContextBudget.js";
import { AgentRunJournal } from "../orchestration/agentRunJournal.js";
import { StageCheckpointRecorder } from "../orchestration/agentStageCheckpoint.js";

export type AiCommanderOptions = {
  journal?: AiExecutionOptions["journal"];
  publication?: AiExecutionOptions["publication"];
  env?: NodeJS.ProcessEnv;
  dependencies?: AiExecutionDependencies;
  model?: Model;
  /** Host-selected branch; models cannot change the repository base. */
  baseRef?: string;
  /** Reject a changed base before reading source files or publishing. */
  expectedBaseSha?: string;
  /** Host-selected file scope; models cannot expand the permitted change set. */
  allowedChangePaths?: readonly string[];
  specialistContextTransform?: AiExecutionOptions["specialistContextTransform"];
  specialistSelections?: AiExecutionOptions["specialistSelections"];
  /** Host-only turn budget for an explicitly scoped synthetic multi-agent proof. */
  maxTurns?: number;
  /** Host-supplied offline test transport. Never read from model messages or prompts. */
  modelFetch?: typeof fetch;
  /** Opt-in, absolute host-owned checkpoint path. Never taken from model text. */
  stageCheckpointPath?: string;
};

/** Fresh executable tools and evidence state for each task. */
function createAiCommanderExecution(goal: string, options: AiCommanderOptions = {}) {
  const env = options.env ?? process.env;
  const legalEnabled = legalAgentEnabled(env);
  const provider = configureModelProvider(env, options.modelFetch ? { fetch: options.modelFetch } : {});
  const contextBudget = provider.provider !== "none" ? provider.contextBudget : undefined;
  const runner = new Runner(provider.provider !== "none" ? { modelProvider: provider.modelProvider } : {});
  const modelOptions = options.model ? { model: options.model } : provider.provider !== "none" && provider.model ? { model: provider.model } : {};
  const factory = isAgentFactoryTarget(goal);
  const repository = factory ? "erman-ksv/Onay-Agents-Factory" : getTargetRepository();
  const ref = options.baseRef ?? (factory ? "dev/agent-factory-core" : "main");
  assertValidBranchRef(ref);
  if (options.expectedBaseSha !== undefined) assertCommitSha(options.expectedBaseSha);
  const assertAllowed = () => assertRepositoryAllowed(repository,
    resolveAllowedRepositories(env.AGENT_ALLOWED_REPOSITORIES, getTargetRepository()));
  const validateBaseHead = (sha: string) => {
    assertCommitSha(sha);
    if (options.expectedBaseSha !== undefined && sha.toLowerCase() !== options.expectedBaseSha.toLowerCase()) {
      throw new Error(`The selected base branch ${ref} no longer matches the expected base commit SHA.`);
    }
    return sha;
  };
  const getBaseHead = async () => {
    assertAllowed();
    return validateBaseHead(await new GitHubClient({ repository }).getCommitSha(ref));
  };
  const paths = factory ? AGENT_FACTORY_EXPLORER_FILES : DEFAULT_EXPLORER_FILES;
  const requiredNames = factory ? ["typecheck"] : ["Typecheck and API tests"];
  const requiredStepNames = factory ? ["Typecheck", "Test"] : ["Typecheck", "API integration tests"];
  const plan = planTask(goal);
  const auditOnly = isReadOnlyRepositoryAudit(goal);
  // Free-tier providers, including Gemini, use a single compact, host-verified read-only audit tool.
  // No optional specialist fanout, Coder or publication routes; this bounds
  // consumption and preserves the three independent Explorer/Security/Tester gates.
  const compactFreeAudit = auditOnly && (provider.provider === "cloudflare" ||
    provider.provider === "gemini" || provider.provider === "groq" ||
    provider.provider === "openrouter" || provider.provider === "mistral");
  let generationContext = (): string => { throw new Error("Coder requires successful repository exploration first."); };
  const configuredDependencies: AiExecutionDependencies = options.dependencies ?? {
    getHead: getBaseHead,
    getCandidateHead: candidateRef => {
      assertAllowed();
      return new GitHubClient({ repository }).getCommitSha(candidateRef);
    },
    explore: sha => inspectOnay(paths, sha, repository),
    generate: () => generateChanges(goal, generationContext(), env, { contextBudget }),
    review: files => reviewChangeSet({ goal, files, allowWorkflowChanges: env.AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES === "true" }),
    scan: inspectProposedChanges,
    inspectSecurity: sha => inspectSecurity([...paths], repository, sha),
    discoverTests: async () => {
      // Test discovery is also a repository read; a model may request it before Explorer.
      assertAllowed();
      if (options.expectedBaseSha !== undefined) await getBaseHead();
      return inspectTests(repository, ref);
    },
    publish: (files, baseSha) => {
      if (!options.publication) throw new Error("No publication request was supplied.");
      return prepareOnayChange({ ...options.publication, files, repository, baseRef: ref, baseSha });
    },
    verify: async (sha, candidateRef) => {
      await waitForCiGate({ branch: candidateRef, repository, headSha: sha, requiredNames, requiredStepNames });
      return inspectTestExecution(sha, repository, candidateRef, requiredNames, requiredStepNames);
    },
  };
  const dependencies: AiExecutionDependencies = {
    ...configuredDependencies,
    getHead: async () => {
      assertAllowed();
      return validateBaseHead(await configuredDependencies.getHead());
    },
  };
  const session = new AiExecutionSession({
    goal, repository, ref, requiredActors: plan.steps.filter(step => legalEnabled || step.agent !== "legal").map(step => step.agent),
    auditOnly, publication: options.publication,
    writesEnabled: env.AGENT_FACTORY_ENABLE_GITHUB_WRITES === "true", journal: options.journal ??
      (options.stageCheckpointPath ? new AgentRunJournal(goal) : undefined),
    allowedChangePaths: options.allowedChangePaths,
    specialistContextTransform: options.specialistContextTransform,
    specialistSelections: options.specialistSelections,
  }, dependencies);
  generationContext = () => session.specialistContext("coder", "Prepare only the host-authorized change. Unshown source is unverified; refuse incomplete whole-file reconstruction.");
  let privateCoderCalls = 0;
  const executable = (actor: string, name: string, description: string, execute: () => Promise<unknown> | unknown) => tool({
    name, description, parameters: z.object({}),
    execute: async () => {
      const result = await session.invoke(actor, name, async () => {
        const value = await execute();
        session.modelToolResult(value);
        return value;
      });
      return session.modelToolResult(result);
    },
  });
  const compactAuditTools: Tool[] = [tool({
    name: "audit_onay_read_only",
    description: "Run repository Explorer, Security, and exact-commit CI Tester once, in order, using trusted host APIs. No writes or advisory model calls.",
    parameters: z.object({}),
    execute: async () => {
      const exploration = await session.invoke("explorer", "explore_onay", () => session.explore());
      if ("error" in exploration) return session.modelToolResult({ status: "blocked", stage: "explorer" });
      const security = await session.invoke("security", "security_review", () => session.inspectSecurity());
      if ("error" in security) return session.modelToolResult({ status: "blocked", stage: "security" });
      const scanned = security.repository.status === "clean";
      // A failed security gate must stop the audit before further delegation.
      if (!scanned) return session.modelToolResult({ status: "blocked", stage: "security", securityClean: false });
      const tester = await session.invoke("tester", "test_onay", () => session.test());
      if ("error" in tester) return session.modelToolResult({ status: "blocked", stage: "tester" });
      // Full source, CI logs and diagnostics stay with the host session.
      return session.modelToolResult({
        status: tester.testsExecuted ? "verified" : "not_verified",
        repository, baseSha: exploration.ref,
        filesInspected: exploration.files.length,
        securityClean: scanned, exactCommitCiVerified: tester.testsExecuted,
        writesPerformed: false, legalReview: legalEnabled ? "enabled_not_executed" : "disabled",
      });
    },
  })];
  const tools: Tool[] = compactFreeAudit ? compactAuditTools : [
    executable("explorer", "explore_onay", "Read actual repository files at an immutable commit. Required before other agents.", () => session.explore()),
    executable("coder", "code_onay", "Run AI Coder using inspected context and store proposed complete file contents. Does not write yet.", async () => {
      // Private Onay runs cannot regenerate indefinitely: each regeneration
      // invalidates independent specialist assessments, review and security.
      // Fail closed and require a new reviewed run rather than spend model turns
      // repeatedly re-creating source or bypassing earlier blockers.
      if (options.specialistContextTransform && ++privateCoderCalls > 1) {
        throw new Error("Private-source Coder already invoked. Stop, inspect the first proposal and specialist blockers; do not regenerate in this run.");
      }
      await session.generate();
      // All runs use the same privacy boundary, not only opt-in private runs.
      return session.proposalMetadata();
    }),
    executable("security", "security_review", "Scan the repository and current proposed files for secrets. Repeat after regenerating files.", () => session.inspectSecurity()),
    executable("reviewer", "final_review", "Apply independent path, workflow and build configuration policy review to current files.", () => session.reviewChanges()),
    executable("github", "publish_change_set", "Write reviewed files on the explicitly authorized feature branch and create a draft PR. Requires all specialists except Tester to have returned.", () => session.publish()),
    executable("tester", "test_onay", "Discover scripts and verify required CI jobs/test steps for the exact published commit. Call after publication to verify changes.", async () => {
      const { discovery: _discovery, ...evidence } = await session.test();
      return { ...evidence, discovery: { detailsRetainedByHost: true } };
    }),
  ];
  const advisoryRoles = ["backend", "frontend", "database", "dispatch", "legal", "devops", "product", "ux"] as const;
  for (const role of advisoryRoles) {
    if (compactFreeAudit || (role === "legal" && !legalEnabled)) continue;
    const specialist = new Agent({ name: "Onay " + role + " Specialist", ...modelOptions, instructions: buildSpecialistInstructions(role) });
    const name = COMMANDER_TOOL_NAMES[role];
    tools.push(tool({
      name, description: "Ask the " + role + " specialist to review actual repository context and proposed changes. Advice does not prove writes or tests.",
      parameters: z.object({ input: z.string().max(600) }),
      execute: async ({ input }) => session.modelToolResult(await session.invoke(role, name, async () => {
        const context = session.specialistContext(role, input);
        const result = await runner.run(specialist, "TASK:\n" + goal + "\n\nREQUEST:\n" + input + "\n\nREPOSITORY CONTEXT:\n" + context +
          '\n\nReturn ONLY JSON: {"ready":boolean,"findings":[{"severity":"blocker"|"high"|"medium"|"low","message":string}],"summary":string}. Set ready=false for unresolved blockers. Advice is not execution evidence.');
        if (typeof result.finalOutput !== "string" || !result.finalOutput.trim()) throw new Error(role + " specialist returned no result.");
        const raw = result.finalOutput.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
        const assessment = session.recordAdvice(role, JSON.parse(raw));
        return session.adviceMetadata(role, assessment);
      })),
    }));
  }
  const commander = new Agent({
    name: "Onay Commander", ...modelOptions, modelSettings: { parallelToolCalls: false },
    instructions: compactFreeAudit ? [
      "Perform a read-only Onay audit using audit_onay_read_only exactly once.",
      "The host tool checks repository exploration, security and exact-commit CI without publishing or invoking advisory specialists.",
      "Summarize its evidence, but never claim success if the tool says blocked or not_verified.",
      "Do not claim legal approval, release readiness or deployment.",
    ].join("\n") : [
      "Coordinate specialists through executable tools. Host evidence, not final prose, determines completion.",
      "Explore first. For changes call code_onay, every required advisory specialist, security_review and final_review.",
      "If publishing is explicitly enabled, call publish_change_set after reviews pass, then test_onay for the exact candidate commit.",
      "For read-only audits use exploration, security_review and test_onay. Do not generate or publish.",
      "Regeneration invalidates earlier reviews. Script discovery and base-branch CI do not verify proposals.",
      "If publishing is disabled, explain the proposal and remaining verification steps; do not claim files were applied.",
      "Respect tool errors and pending/failed CI. Never invent edits, tools, commands, PRs, tests, legal verification, merge or deployment.",
      "Explorer and Coder return metadata only. Full files stay in trusted host memory. Specialists see selected ranges only; unread files, omitted ranges and unexecuted tests remain unverified.",
      legalEnabled ? "For legal tasks involve Rasul. Humans review legal commitments, merges and deployments." :
        "Legal specialist is temporarily disabled by the host. Do not invoke or simulate legal review; report it as DISABLED, never approved. Humans review commitments, merges and deployments.",
      ...(options.specialistContextTransform ? [
        "PRIVATE-SOURCE RUN: Follow this exact sequence: explore_onay; code_onay ONCE; then product_requirements, ux_accessibility_review, backend/frontend and other required specialists, " + (legalEnabled ? "rasul_legal_compliance, " : "") + "security_review and final_review. Specialist advice before code generation is invalidated. Publish only if every gate is ready; then test_onay.",
        "Do not repeat code_onay or repeat an advisory specialist. Re-running Coder destroys prior approvals. If any tool fails or specialist reports high/blocker, STOP with a clear explanation; do not retry, publish or invent completion.",
        "Publishing a Draft PR is not production deployment; still respect all security, legal and review blockers.",
      ] : []),
    ].join("\n"), tools,
  });
  const publishing = options.publication && env.AGENT_FACTORY_ENABLE_GITHUB_WRITES === "true";
  const prompt = compactFreeAudit ?
    goal + "\n\nThis is a read-only audit. Call audit_onay_read_only once, then report its result. No writes, no extra specialists, no release approval." :
    buildCommanderPrompt(goal, env) + "\n\nPublication enabled for this run: " +
    (publishing ? "yes; publish then verify tests on branch " + options.publication!.branch : "no; return a proposal and do not call publish_change_set.");
  return { commander, session, prompt, runner, contextBudget, provider: provider.provider,
    legalReview: legalEnabled ? "enabled" as const : "disabled" as const };
}

export function createAiCommander(goal: string, options: AiCommanderOptions = {}) {
  const { runner: _runner, ...commander } = createAiCommanderExecution(goal, options);
  return commander;
}

export async function runAiCommander(goal: string, options: AiCommanderOptions = {}) {
  const { commander, session, prompt, runner, contextBudget, provider, legalReview } = createAiCommanderExecution(goal, options);
  // Opt-in persists events in order. No checkpoint is silently reused across runs.
  if (options.stageCheckpointPath && !options.expectedBaseSha)
    throw new Error("Durable Commander checkpoint requires an immutable expectedBaseSha.");
  const recorder = options.stageCheckpointPath ? new StageCheckpointRecorder(options.stageCheckpointPath,
    { goal, repository: session.options.repository, baseRef: session.options.ref,
      expectedSha: options.expectedBaseSha! }, session.journal) : undefined;
  try {
    if (provider === "none" && !options.model) {
      throw new Error(providerRequirementMessage(options.env ?? process.env));
    }
    const turns = options.maxTurns ?? 30;
    if (!Number.isSafeInteger(turns) || turns < 1 || turns > 48) {
      throw new Error("Commander turn budget must be an integer from 1 to 48.");
    }
    const result = await runner.run(commander, prompt, { maxTurns: turns });
    const failure = contextBudget?.failure ?? session.providerFailure;
    if (failure) {
      const finished = session.finish(undefined, failure.message);
      recorder?.finish(finished.status);
      return { ...finished, providerFailure: failure, legalReview };
    }
    await session.verifyFinalCandidate();
    const finished = session.finish(result.finalOutput);
    recorder?.finish(finished.status);
    return { ...finished, legalReview };
  } catch (error) {
    const failure = contextBudget?.failure ?? session.providerFailure ?? extractProviderFailure(error);
    const finished = session.finish(undefined, failure?.message ?? session.safeErrorMessage(error));
    recorder?.finish(finished.status);
    return { ...finished, ...(failure ? { providerFailure: failure } : {}), legalReview };
  } finally {
    recorder?.close();
  }
}


