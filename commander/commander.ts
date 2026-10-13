import { generateChanges } from "../agents/backend/coder.js";
import { inspectProposedChanges, inspectSecurity } from "../agents/security/agent.js";
import { inspectRefTestExecution, inspectTests } from "../agents/tester/agent.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";
import { AGENT_FACTORY_EXPLORER_FILES, DEFAULT_EXPLORER_FILES, inspectTezJet } from "../github/tezjetExplorer.js";
import { executePlan } from "./executor.js";
import { isAgentFactoryTarget, planTask, shouldUseAiCommander } from "./planner.js";
import { summarizeExecution } from "./summary.js";
import { AgentRunJournal } from "../orchestration/agentRunJournal.js";
import { providerRequirementMessage, selectProviderConfig } from "./providerConfig.js";
import { getTargetRepository } from "../github/repositoryConfig.js";
import { commanderExitCode } from "./exitCode.js";
import { parseCommanderArgs } from "./commanderArgs.js";

const { goal, publication } = parseCommanderArgs(process.argv.slice(2));

if (!goal) {
  console.error("Usage: pnpm dev -- <describe the task>");
  process.exit(1);
}

const journal = new AgentRunJournal(goal, undefined, (event) => {
  console.log(JSON.stringify({ type: "agent_event", event }));
});

const provider = selectProviderConfig(process.env);
if (provider.provider === "none" && process.env.AGENT_FACTORY_PROVIDER?.trim() && process.env.AGENT_FACTORY_MODE !== "deterministic") {
  const reasons = [providerRequirementMessage(process.env)];
  journal.record("blocked", "commander", reasons[0]);
  console.log(JSON.stringify({ commander: "TezJet Commander", mode: "ai", taskId: journal.taskId, result: { status: "blocked", reasons }, events: journal.snapshot() }, null, 2));
  process.exitCode = commanderExitCode("blocked");
} else if (shouldUseAiCommander(goal, provider.provider !== "none", process.env.AGENT_FACTORY_MODE)) {
  journal.record("agent_started", "commander", "AI Commander started coordinating specialist agents.");
  const { runAiCommander } = await import("./aiCommander.js");
  const result = await runAiCommander(goal, { journal, publication });
  console.log(JSON.stringify({ commander: "TezJet Commander", mode: "ai", taskId: journal.taskId, result, events: journal.snapshot() }, null, 2));
  process.exitCode = commanderExitCode(result.status);
} else {
  if (publication) {
    throw new Error("Publishing through Commander requires an AI provider and AI mode; no files were written.");
  }
  const plan = planTask(goal);
  const targetRepository = isAgentFactoryTarget(goal) ? "erman-ksv/TezJet-Agent-Factory" : getTargetRepository();
  const targetRef = isAgentFactoryTarget(goal) ? "dev/agent-factory-core" : "main";
  const explorerPaths = isAgentFactoryTarget(goal) ? AGENT_FACTORY_EXPLORER_FILES : DEFAULT_EXPLORER_FILES;
  const securityPaths = isAgentFactoryTarget(goal) ? ["package.json", "commander/commander.ts", "commander/planner.ts", "commander/executor.ts", "commander/providerConfig.ts", "commander/modelProvider.ts", "agents/tester/agent.ts", "agents/security/agent.ts", "agents/reviewer/agent.ts", "github/tezjetRepository.ts", "github/repositoryPolicy.ts", "github/changeWorkflow.ts", "github/ciGate.ts", "orchestration/pipeline.ts", "orchestration/retryLoop.ts", "orchestration/dashboardServer.ts"] : undefined;
  const execution = await executePlan(goal, plan.steps, {
    explorer: async () => {
      const result = await inspectTezJet(explorerPaths, targetRef, targetRepository);
      const available = result.files.filter(
        (file): file is { path: string; sha: string; content: string } => "content" in file,
      );
      const unavailable = result.files.filter(
        (file): file is { path: string; error: string } => "error" in file,
      );
      if (unavailable.length > 0) {
        throw new Error(`Explorer could not inspect required repository files: ${unavailable.map((file) => `${file.path}: ${file.error}`).join("; ")}`);
      }
      return {
        repository: result.repository,
        ref: result.ref,
        inspectedFiles: available.map((file) => file.path),
        unavailableFiles: unavailable.map((file) => ({ path: file.path, error: file.error })),
        repositoryContext: available.map((file) => `FILE: ${file.path}\n${file.content}`).join("\n\n"),
      };
    },
    ...(provider.provider !== "none" ? {
      coder: async ({ goal, previousResults }) => {
        const exploration = previousResults.find((result) => result.agent === "explorer");
        const context = exploration?.output as { repositoryContext?: string } | undefined;
        if (!context?.repositoryContext) {
          throw new Error("Coder needs repository context from a successful Explorer handoff.");
        }
        return generateChanges(goal, context.repositoryContext);
      },
    } : {}),
    tester: async () => {
      const result = await inspectTests(targetRepository, targetRef);
      const isFactory = isAgentFactoryTarget(goal);
      const requiredJobs = isFactory ? ["typecheck"] : ["Typecheck and API tests"];
      const requiredSteps = isFactory ? ["Typecheck", "Test"] : [];
      const executionEvidence = await inspectRefTestExecution(
        targetRepository,
        targetRef,
        requiredJobs,
        requiredSteps,
      );
      return {
        repository: result.repository,
        ref: result.ref,
        discoveredScripts: result.scripts,
        notes: result.notes,
        executionEvidence,
        testsExecuted: executionEvidence.testsExecuted,
      };
    },
    security: async ({ previousResults }) => {
      const coder = previousResults.find((result) => result.agent === "coder");
      const generated = coder?.output as { files?: Array<{ path: string; content: string }> } | undefined;
      const proposed = generated?.files ? inspectProposedChanges(generated.files) : null;
      const repository = await inspectSecurity(securityPaths, targetRepository, targetRef);
      return {
        repository,
        proposedChanges: proposed,
        note: proposed ? "Generated files were scanned for secret-like values." : "No generated files were available for proposed-change scanning.",
      };
    },
    reviewer: async ({ goal, previousResults }) => {
      const coder = previousResults.find((result) => result.agent === "coder");
      const generated = coder?.output as { files?: Array<{ path: string; content: string }> } | undefined;
      if (!generated?.files) {
        return {
          ready: false,
          findings: [{ severity: "high", message: "No generated change set was available for review." }],
        };
      }
      return reviewChangeSet({ goal, files: generated.files, allowWorkflowChanges: process.env.AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES === "true" });
    },
  }, { journal });

  const summary = summarizeExecution(execution, { proposalOnly: true });

  console.log(JSON.stringify({
    commander: "TezJet Commander",
    mode: "deterministic",
    taskId: journal.taskId,
    events: journal.snapshot(),
    task: plan,
    execution,
    summary,
    note: "Handlers run in plan order and receive previous results. Set AGENT_FACTORY_MODE=deterministic to use this executor even when OPENAI_API_KEY is present. Code generation requires GEMINI_API_KEY or OPENAI_API_KEY in the Agent Factory runtime. Test discovery is not test execution. This mode does not publish changes or open pull requests. Agent events are emitted as JSON lines while the run is active.",
  }, null, 2));
  process.exitCode = commanderExitCode(summary.status);
}

