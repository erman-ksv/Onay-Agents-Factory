import { Agent, run, tool, type Tool, type Model } from "@openai/agents";
import { z } from "zod";
import { ROLE_SKILLS } from "./skills.js";
import { buildCommanderPrompt, COMMANDER_TOOL_NAMES } from "./buildCommanderPrompt.js";
import { configureModelProvider } from "./modelProvider.js";
import { isAgentFactoryTarget, isReadOnlyRepositoryAudit, planTask } from "./planner.js";
import { AiExecutionSession, type AiExecutionDependencies, type AiExecutionOptions } from "./aiExecution.js";
import { getTargetRepository } from "../github/repositoryConfig.js";
import { GitHubClient } from "../github/githubClient.js";
import { AGENT_FACTORY_EXPLORER_FILES, DEFAULT_EXPLORER_FILES, inspectTezJet } from "../github/tezjetExplorer.js";
import { generateChanges } from "../agents/backend/coder.js";
import { inspectProposedChanges, inspectSecurity } from "../agents/security/agent.js";
import { inspectTestExecution, inspectTests } from "../agents/tester/agent.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";
import { prepareTezJetChange } from "../github/changeWorkflow.js";
import { waitForCiGate } from "../github/ciGate.js";
import { assertRepositoryAllowed, resolveAllowedRepositories } from "../github/repositoryPolicy.js";

export type AiCommanderOptions = {
  journal?: AiExecutionOptions["journal"];
  publication?: AiExecutionOptions["publication"];
  env?: NodeJS.ProcessEnv;
  dependencies?: AiExecutionDependencies;
  model?: Model;
};

/** Fresh executable tools and evidence state for each task. */
export function createAiCommander(goal: string, options: AiCommanderOptions = {}) {
  const env = options.env ?? process.env;
  const provider = configureModelProvider(env);
  const modelOptions = options.model ? { model: options.model } : provider.provider === "gemini" ? { model: provider.model } : {};
  const factory = isAgentFactoryTarget(goal);
  const repository = factory ? "erman-ksv/TezJet-Agent-Factory" : getTargetRepository();
  const ref = factory ? "dev/agent-factory-core" : "main";
  const paths = factory ? AGENT_FACTORY_EXPLORER_FILES : DEFAULT_EXPLORER_FILES;
  const requiredNames = factory ? ["typecheck"] : ["Typecheck and API tests"];
  const requiredStepNames = factory ? ["Typecheck", "Test"] : [];
  const plan = planTask(goal);
  const dependencies: AiExecutionDependencies = options.dependencies ?? {
    getHead: async () => {
      assertRepositoryAllowed(repository, resolveAllowedRepositories(env.AGENT_ALLOWED_REPOSITORIES, getTargetRepository()));
      return new GitHubClient({ repository }).getCommitSha(ref);
    },
    getCandidateHead: candidateRef => new GitHubClient({ repository }).getCommitSha(candidateRef),
    explore: sha => inspectTezJet(paths, sha, repository),
    generate: context => generateChanges(goal, context),
    review: files => reviewChangeSet({ goal, files, allowWorkflowChanges: env.AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES === "true" }),
    scan: inspectProposedChanges,
    inspectSecurity: sha => inspectSecurity([...paths], repository, sha),
    discoverTests: () => inspectTests(repository, ref),
    publish: (files, baseSha) => {
      if (!options.publication) throw new Error("No publication request was supplied.");
      return prepareTezJetChange({ ...options.publication, files, repository, baseRef: ref, baseSha });
    },
    verify: async (sha, candidateRef) => {
      await waitForCiGate({ branch: candidateRef, repository, headSha: sha, requiredNames, requiredStepNames });
      return inspectTestExecution(sha, repository, candidateRef, requiredNames, requiredStepNames);
    },
  };
  const session = new AiExecutionSession({
    goal, repository, ref, requiredActors: plan.steps.map(step => step.agent),
    auditOnly: isReadOnlyRepositoryAudit(goal), publication: options.publication,
    writesEnabled: env.AGENT_FACTORY_ENABLE_GITHUB_WRITES === "true", journal: options.journal,
  }, dependencies);
  const executable = (actor: string, name: string, description: string, execute: () => Promise<unknown> | unknown) => tool({
    name, description, parameters: z.object({}),
    execute: async () => JSON.stringify(await session.invoke(actor, name, execute)),
  });
  const tools: Tool[] = [
    executable("explorer", "explore_tezjet", "Read actual repository files at an immutable commit. Required before other agents.", () => session.explore()),
    executable("coder", "code_tezjet", "Run AI Coder using inspected context and store proposed complete file contents. Does not write yet.", () => session.generate()),
    executable("security", "security_review", "Scan the repository and current proposed files for secrets. Repeat after regenerating files.", () => session.inspectSecurity()),
    executable("reviewer", "final_review", "Apply independent path, workflow and build configuration policy review to current files.", () => session.reviewChanges()),
    executable("github", "publish_change_set", "Write reviewed files on the explicitly authorized feature branch and create a draft PR. Requires all specialists except Tester to have returned.", () => session.publish()),
    executable("tester", "test_tezjet", "Discover scripts and verify required CI jobs/test steps for the exact published commit. Call after publication to verify changes.", () => session.test()),
  ];
  const advisoryRoles = ["backend", "frontend", "database", "dispatch", "legal", "devops", "product", "ux"] as const;
  for (const role of advisoryRoles) {
    const specialist = new Agent({ name: "TezJet " + role + " Specialist", ...modelOptions, instructions: ROLE_SKILLS[role] });
    const name = COMMANDER_TOOL_NAMES[role];
    tools.push(tool({
      name, description: "Ask the " + role + " specialist to review actual repository context and proposed changes. Advice does not prove writes or tests.",
      parameters: z.object({ input: z.string() }),
      execute: async ({ input }) => JSON.stringify(await session.invoke(role, name, async () => {
        const context = session.specialistContext();
        const result = await run(specialist, "TASK:\n" + goal + "\n\nREQUEST:\n" + input + "\n\nREPOSITORY CONTEXT:\n" + context +
          '\n\nReturn ONLY JSON: {"ready":boolean,"findings":[{"severity":"blocker"|"high"|"medium"|"low","message":string}],"summary":string}. Set ready=false for unresolved blockers. Advice is not execution evidence.');
        if (typeof result.finalOutput !== "string" || !result.finalOutput.trim()) throw new Error(role + " specialist returned no result.");
        const raw = result.finalOutput.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
        return session.recordAdvice(role, JSON.parse(raw));
      })),
    }));
  }
  const commander = new Agent({
    name: "TezJet Commander", ...modelOptions, modelSettings: { parallelToolCalls: false },
    instructions: [
      "Coordinate specialists through executable tools. Host evidence, not final prose, determines completion.",
      "Explore first. For changes call code_tezjet, every required advisory specialist, security_review and final_review.",
      "If publishing is explicitly enabled, call publish_change_set after reviews pass, then test_tezjet for the exact candidate commit.",
      "For read-only audits use exploration, security_review and test_tezjet. Do not generate or publish.",
      "Regeneration invalidates earlier reviews. Script discovery and base-branch CI do not verify proposals.",
      "If publishing is disabled, explain the proposal and remaining verification steps; do not claim files were applied.",
      "Respect tool errors and pending/failed CI. Never invent edits, tools, commands, PRs, tests, legal verification, merge or deployment.",
      "For legal tasks involve Rasul. Humans review legal commitments, merges and deployments.",
    ].join("\n"), tools,
  });
  const publishing = options.publication && env.AGENT_FACTORY_ENABLE_GITHUB_WRITES === "true";
  const prompt = buildCommanderPrompt(goal) + "\n\nPublication enabled for this run: " +
    (publishing ? "yes; publish then verify tests on branch " + options.publication!.branch : "no; return a proposal and do not call publish_change_set.");
  return { commander, session, prompt };
}

export async function runAiCommander(goal: string, options: AiCommanderOptions = {}) {
  const { commander, session, prompt } = createAiCommander(goal, options);
  try {
    const result = await run(commander, prompt, { maxTurns: 30 });
    return session.finish(result.finalOutput);
  } catch (error) {
    return session.finish(undefined, error instanceof Error ? error.message : String(error));
  }
}

