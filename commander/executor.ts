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

/**
 * Execute registered agent handlers in plan order.
 * Each agent receives the results from earlier agents as explicit handoff context.
 * Missing handlers are marked skipped rather than being reported as completed.
 * A failing agent is recorded and does not prevent independent later agents from running.
 */
export async function executePlan(
  goal: string,
  steps: PlannedAgentStep[],
  handlers: Partial<Record<string, AgentHandler>>,
): Promise<AgentStepResult[]> {
  const results: AgentStepResult[] = [];

  for (const step of steps) {
    const handler = handlers[step.agent];
    if (!handler) {
      results.push({
        agent: step.agent,
        objective: step.objective,
        status: "skipped",
        error: "No executable handler is registered for this agent yet.",
      });
      continue;
    }

    try {
      const output = await handler({ goal, step, previousResults: [...results] });
      results.push({ agent: step.agent, objective: step.objective, status: "completed", output });
    } catch (error) {
      results.push({
        agent: step.agent,
        objective: step.objective,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
