import { Agent, Runner, tool, type Tool, type Model } from "@openai/agents";
import { z } from "zod";
import { ROLE_SKILLS } from "./skills.js";
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
};

/** Fresh executable tools and evidence state for each task. */
function createAiCommanderExecution(goal: string, options: AiCommanderOptions = {}) {
  const env = options.env ?? process.env;
  const provider = configureModelProvider(env);
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
  const configuredDependencies: AiExecutionDependencies = options.dependencies ?? {
    getHead: getBaseHead,
    getCandidateHead: candidateRef => {
      assertAllowed();
      return new GitHubClient({ repository }).getCommitSha(candidateRef);
    },
    explore: sha => inspectOnay(paths, sha, repository),
    generate: context => generateChanges(goal, context, env),
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
    goal, repository, ref, requiredActors: plan.steps.map(step => step.agent),
    auditOnly: isReadOnlyRepositoryAudit(goal), publication: options.publication,
    writesEnabled: env.AGENT_FACTORY_ENABLE_GITHUB_WRITES === "true", journal: options.journal,
    allowedChangePaths: options.allowedChangePaths,
  }, dependencies);
  const executable = (actor: string, name: string, description: string, execute: () => Promise<unknown> | unknown) => tool({
    name, description, parameters: z.object({}),
    execute: async () => JSON.stringify(await session.invoke(actor, name, execute)),
  });
  const tools: Tool[] = [
    executable("explorer", "explore_onay", "Read actual repository files at an immutable commit. Required before other agents.", () => session.explore()),
    executable("coder", "code_onay", "Run AI Coder using inspected context and store proposed complete file contents. Does not write yet.", () => session.generate()),
    executable("security", "security_review", "Scan the repository and current proposed files for secrets. Repeat after regenerating files.", () => session.inspectSecurity()),
    executable("reviewer", "final_review", "Apply independent path, workflow and build configuration policy review to current files.", () => session.reviewChanges()),
    executable("github", "publish_change_set", "Write reviewed files on the explicitly authorized feature branch and create a draft PR. Requires all specialists except Tester to have returned.", () => session.publish()),
    executable("tester", "test_onay", "Discover scripts and verify required CI jobs/test steps for the exact published commit. Call after publication to verify changes.", () => session.test()),
  ];
  const advisoryRoles = ["backend", "frontend", "database", "dispatch", "legal", "devops", "product", "ux"] as const;
  for (const role of advisoryRoles) {
    const specialist = new Agent({ name: "Onay " + role + " Specialist", ...modelOptions, instructions: ROLE_SKILLS[role] });
    const name = COMMANDER_TOOL_NAMES[role];
    tools.push(tool({
      name, description: "Ask the " + role + " specialist to review actual repository context and proposed changes. Advice does not prove writes or tests.",
      parameters: z.object({ input: z.string() }),
      execute: async ({ input }) => JSON.stringify(await session.invoke(role, name, async () => {
        const context = session.specialistContext();
        const result = await runner.run(specialist, "TASK:\n" + goal + "\n\nREQUEST:\n" + input + "\n\nREPOSITORY CONTEXT:\n" + context +
          '\n\nReturn ONLY JSON: {"ready":boolean,"findings":[{"severity":"blocker"|"high"|"medium"|"low","message":string}],"summary":string}. Set ready=false for unresolved blockers. Advice is not execution evidence.');
        if (typeof result.finalOutput !== "string" || !result.finalOutput.trim()) throw new Error(role + " specialist returned no result.");
        const raw = result.finalOutput.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
        return session.recordAdvice(role, JSON.parse(raw));
      })),
    }));
  }
  const commander = new Agent({
    name: "Onay Commander", ...modelOptions, modelSettings: { parallelToolCalls: false },
    instructions: [
      "Coordinate specialists through executable tools. Host evidence, not final prose, determines completion.",
      "Explore first. For changes call code_onay, every required advisory specialist, security_review and final_review.",
      "If publishing is explicitly enabled, call publish_change_set after reviews pass, then test_onay for the exact candidate commit.",
      "For read-only audits use exploration, security_review and test_onay. Do not generate or publish.",
      "Regeneration invalidates earlier reviews. Script discovery and base-branch CI do not verify proposals.",
      "If publishing is disabled, explain the proposal and remaining verification steps; do not claim files were applied.",
      "Respect tool errors and pending/failed CI. Never invent edits, tools, commands, PRs, tests, legal verification, merge or deployment.",
      "For legal tasks involve Rasul. Humans review legal commitments, merges and deployments.",
    ].join("\n"), tools,
  });
  const publishing = options.publication && env.AGENT_FACTORY_ENABLE_GITHUB_WRITES === "true";
  const prompt = buildCommanderPrompt(goal) + "\n\nPublication enabled for this run: " +
    (publishing ? "yes; publish then verify tests on branch " + options.publication!.branch : "no; return a proposal and do not call publish_change_set.");
  return { commander, session, prompt, runner, provider: provider.provider };
}

export function createAiCommander(goal: string, options: AiCommanderOptions = {}) {
  const { runner: _runner, ...commander } = createAiCommanderExecution(goal, options);
  return commander;
}

export async function runAiCommander(goal: string, options: AiCommanderOptions = {}) {
  const { commander, session, prompt, runner, provider } = createAiCommanderExecution(goal, options);
  try {
    if (provider === "none" && !options.model) {
      throw new Error(providerRequirementMessage(options.env ?? process.env));
    }
    const result = await runner.run(commander, prompt, { maxTurns: 30 });
    await session.verifyFinalCandidate();
    return session.finish(result.finalOutput);
  } catch (error) {
    return session.finish(undefined, error instanceof Error ? error.message : String(error));
  }
}

