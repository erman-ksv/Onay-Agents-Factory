import { generateChanges } from "../agents/backend/coder.js";
import { inspectProposedChanges, inspectSecurity } from "../agents/security/agent.js";
import { inspectTests } from "../agents/tester/agent.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";
import { inspectTezJet } from "../github/tezjetExplorer.js";
import { executePlan } from "./executor.js";
import { planTask } from "./planner.js";

const goal = process.argv.slice(2).join(" ").trim();

if (!goal) {
  console.error("Usage: pnpm dev -- <describe the task>");
  process.exit(1);
}

if (process.env.OPENAI_API_KEY && process.env.AGENT_FACTORY_MODE !== "deterministic") {
  const { runAiCommander } = await import("./aiCommander.js");
  console.log(await runAiCommander(goal));
} else {
  const plan = planTask(goal);
  const execution = await executePlan(goal, plan.steps, {
    explorer: async () => {
      const result = await inspectTezJet();
      const available = result.files.filter(
        (file): file is { path: string; sha: string; content: string } => "content" in file,
      );
      const unavailable = result.files.filter(
        (file): file is { path: string; error: string } => "error" in file,
      );
      return {
        repository: result.repository,
        ref: result.ref,
        inspectedFiles: available.map((file) => file.path),
        unavailableFiles: unavailable.map((file) => ({ path: file.path, error: file.error })),
        repositoryContext: available.map((file) => `FILE: ${file.path}\n${file.content}`).join("\n\n"),
      };
    },
    ...(process.env.OPENAI_API_KEY ? {
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
      const result = await inspectTests();
      return {
        repository: result.repository,
        ref: result.ref,
        discoveredScripts: result.scripts,
        notes: result.notes,
        executionEvidence: "Test commands were discovered, not executed by this agent.",
      };
    },
    security: async ({ previousResults }) => {
      const coder = previousResults.find((result) => result.agent === "coder");
      const generated = coder?.output as { files?: Array<{ path: string; content: string }> } | undefined;
      const proposed = generated?.files ? inspectProposedChanges(generated.files) : null;
      const repository = await inspectSecurity();
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
      return reviewChangeSet({ goal, files: generated.files });
    },
  });

  const reviewReady = (execution.find((step) => step.agent === "reviewer")?.output as { ready?: boolean } | undefined)?.ready ?? false;
  const proposedSecurityClean = (execution.find((step) => step.agent === "security")?.output as { proposedChanges?: { status?: string } } | undefined)?.proposedChanges?.status === "clean";
  const hasIncompleteAgents = execution.some((step) => step.status !== "completed");
  const status = hasIncompleteAgents ? "blocked" : !reviewReady || !proposedSecurityClean ? "needs-review" : "completed";

  const summary = {
    status,
    canPublish: status === "completed",
    completed: execution.filter((step) => step.status === "completed").length,
    failed: execution.filter((step) => step.status === "failed").length,
    skipped: execution.filter((step) => step.status === "skipped").length,
    reviewReady,
    proposedSecurityClean,
  };

  console.log(JSON.stringify({
    commander: "TezJet Commander",
    mode: "deterministic",
    task: plan,
    execution,
    summary,
    note: "Handlers run in plan order and receive previous results. Set AGENT_FACTORY_MODE=deterministic to use this executor even when OPENAI_API_KEY is present. Code generation requires OPENAI_API_KEY. Test discovery is not test execution. This mode does not publish changes or open pull requests.",
  }, null, 2));
}
