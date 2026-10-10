import { inspectSecurity } from "../agents/security/agent.js";
import { inspectTests } from "../agents/tester/agent.js";
import { inspectTezJet } from "../github/tezjetExplorer.js";
import { executePlan } from "./executor.js";
import { planTask } from "./planner.js";

const goal = process.argv.slice(2).join(" ").trim();

if (!goal) {
  console.error("Usage: pnpm dev -- <describe the task>");
  process.exit(1);
}

if (process.env.OPENAI_API_KEY) {
  const { runAiCommander } = await import("./aiCommander.js");
  console.log(await runAiCommander(goal));
} else {
  const plan = planTask(goal);
  const execution = await executePlan(goal, plan.steps, {
    explorer: async () => {
      const result = await inspectTezJet();
      return {
        repository: result.repository,
        ref: result.ref,
        inspectedFiles: result.files
          .filter((file): file is { path: string; sha: string; content: string } => "content" in file)
          .map((file) => file.path),
        unavailableFiles: result.files
          .filter((file): file is { path: string; error: string } => "error" in file)
          .map((file) => ({ path: file.path, error: file.error })),
      };
    },
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
    security: async () => inspectSecurity(),
  });

  const summary = {
    completed: execution.filter((step) => step.status === "completed").length,
    failed: execution.filter((step) => step.status === "failed").length,
    skipped: execution.filter((step) => step.status === "skipped").length,
  };

  console.log(JSON.stringify({
    commander: "TezJet Commander",
    mode: "deterministic",
    task: plan,
    execution,
    summary,
    note: "Registered analysis agents ran sequentially. Skipped agents have no executable handler yet; test discovery is not the same as running tests. Set OPENAI_API_KEY to enable AI orchestration.",
  }, null, 2));
}
