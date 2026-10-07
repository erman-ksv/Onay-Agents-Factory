import type { TaskPlan } from "./planner.js";

export function routeTask(plan: TaskPlan): string[] {
  return plan.steps.map((step) => step === "implement" ? "backend" : step);
}
