import type { AgentStepResult } from "./executor.js";

export type CommanderSummary = {
  status: "blocked" | "needs-review" | "completed";
  canPublish: boolean;
  completed: number;
  failed: number;
  skipped: number;
  reviewReady: boolean;
  proposedSecurityClean: boolean;
};

export function summarizeExecution(execution: AgentStepResult[]): CommanderSummary {
  const reviewReady =
    (execution.find((step) => step.agent === "reviewer")?.output as { ready?: boolean } | undefined)?.ready ?? false;
  const proposedSecurityClean =
    (execution.find((step) => step.agent === "security")?.output as { proposedChanges?: { status?: string } } | undefined)
      ?.proposedChanges?.status === "clean";
  const hasIncompleteAgents = execution.some((step) => step.status !== "completed");
  const status = hasIncompleteAgents ? "blocked" : !reviewReady || !proposedSecurityClean ? "needs-review" : "completed";

  return {
    status,
    canPublish: status === "completed",
    completed: execution.filter((step) => step.status === "completed").length,
    failed: execution.filter((step) => step.status === "failed").length,
    skipped: execution.filter((step) => step.status === "skipped").length,
    reviewReady,
    proposedSecurityClean,
  };
}
