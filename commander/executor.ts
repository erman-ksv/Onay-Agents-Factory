import { AgentRunJournal } from "../orchestration/agentRunJournal.js";

export type PlannedAgentStep = { agent: string; objective: string };
export type AgentStepResult = {
  agent: string;
  objective: string;
  status: "completed" | "failed" | "skipped";
  output?: unknown;
  error?: string;
};
export type AgentExecutionContext = {
  goal: string;
  step: PlannedAgentStep;
  previousResults: AgentStepResult[];
};
export type AgentHandler = (context: AgentExecutionContext) => unknown | Promise<unknown>;

export type ExecutePlanOptions = { journal?: AgentRunJournal };

/**
 * Execute registered agents in plan order. Every handoff and outcome is written
 * to a shared run journal so the CLI/UI can observe the real execution timeline.
 */
export async function executePlan(
  goal: string,
  steps: PlannedAgentStep[],
  handlers: Partial<Record<string, AgentHandler>>,
  options: ExecutePlanOptions = {},
): Promise<AgentStepResult[]> {
  const results: AgentStepResult[] = [];
  const journal = options.journal ?? new AgentRunJournal(goal);

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (!step) continue;
    const handler = handlers[step.agent];

    if (index > 0) {
      const previous = steps[index - 1];
      journal.handoff(previous.agent, step.agent, `Passing task context to ${step.agent}.`, {
        previousStatus: results[index - 1]?.status ?? "unknown",
      });
    }

    if (!handler) {
      const result: AgentStepResult = {
        agent: step.agent,
        objective: step.objective,
        status: "skipped",
        error: "No executable handler is registered for this agent yet.",
      };
      results.push(result);
      journal.record("agent_skipped", step.agent, result.error, { objective: step.objective });
      continue;
    }

    journal.record("agent_started", step.agent, step.objective);
    try {
      const output = await handler({ goal, step, previousResults: [...results] });
      const result: AgentStepResult = { agent: step.agent, objective: step.objective, status: "completed", output };
      results.push(result);
      journal.record("agent_completed", step.agent, `${step.agent} finished its stage.`, { objective: step.objective });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ agent: step.agent, objective: step.objective, status: "failed", error: message });
      journal.record("agent_failed", step.agent, message, { objective: step.objective });
    }
  }

  const hasFailures = results.some(result => result.status !== "completed");
  journal.record(
    hasFailures ? "blocked" : "agent_completed",
    "commander",
    hasFailures ? "Run finished with failed or skipped stages; result is not verified." : "All planned agent handlers completed; verification gates still determine readiness.",
    { completed: results.filter(result => result.status === "completed").length, failed: results.filter(result => result.status === "failed").length, skipped: results.filter(result => result.status === "skipped").length },
  );
  return results;
}
