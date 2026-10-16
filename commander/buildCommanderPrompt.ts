import { planTask } from "./planner.js";
import type { AgentName } from "./taskTypes.js";

export const COMMANDER_TOOL_NAMES: Record<AgentName, string> = {
  explorer: "explore_onay",
  coder: "code_onay",
  backend: "backend_specialist",
  frontend: "frontend_mobile_specialist",
  database: "database_specialist",
  dispatch: "dispatch_ride_operations_specialist",
  product: "product_requirements",
  ux: "ux_accessibility_review",
  legal: "rasul_legal_compliance",
  devops: "devops_release_review",
  tester: "test_onay",
  security: "security_review",
  reviewer: "final_review"
};

export function buildCommanderPrompt(goal: string): string {
  const plan = planTask(goal);
  const required = plan.steps.map((step, index) =>
    `${index + 1}. ${step.agent} → ${COMMANDER_TOOL_NAMES[step.agent]}: ${step.objective}`
  );

  return [
    "User task:",
    goal,
    "",
    "Deterministic routing plan (minimum required delegation):",
    ...required,
    "",
    "Execution rules:",
    "- Invoke every listed specialist tool at least once; this plan is the minimum delegation set, not a suggestion.",
    "- You may add other specialists when the task requires them.",
    "- Do not claim a specialist ran unless its tool was actually invoked and returned.",
    "- Do not claim files were changed, commands were run, tests passed, or a PR was created unless an available tool result proves it.",
    "- Keep the main branch untouched; propose changes and verification evidence before any merge."
  ].join("\n");
}

