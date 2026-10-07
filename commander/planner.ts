export type TaskPlan = { goal: string; steps: string[] };

export function planTask(goal: string): TaskPlan {
  return { goal, steps: ["explore", "implement", "test", "review"] };
}
