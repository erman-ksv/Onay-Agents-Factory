import type { AgentName, TaskPlan } from "./taskTypes.js";

const routes: Array<[AgentName, string, RegExp | null]> = [
  ["explorer", "Inspect the repository and identify relevant files, architecture, constraints, and risks.", null],
  ["product", "Define user problem, scope, non-goals, business rules, and testable acceptance criteria.", /feature|requirement|product|business rule|workflow|booking|fare|pricing|pool|seat|driver|passenger|order|roadmap/i],
  ["ux", "Review user journeys, mobile usability, accessibility, permission requests, and failure states.", /frontend|ui|ux|react|page|screen|component|mobile|android|ios|accessibility|map|location|booking flow/i],
  ["coder", "Produce the smallest explicit code change set required by the goal. Return complete contents for changed files only.", null],
  ["backend", "Implement backend/API changes with server-side validation, authorization, transactions, and integration tests when relevant.", /backend|api|server|route|controller|queue|fifo|order|driver|auth|socket|endpoint/i],
  ["frontend", "Implement accessible frontend/client changes and cover loading, empty, offline, and error states.", /frontend|ui|react|page|screen|component|mobile|android|ios|map|location/i],
  ["database", "Design or implement schema, persistence, migrations, indexes, transactions, and data-access changes when required.", /database|db|schema|migration|postgres|redis|storage|persist|transaction|order state/i],
  ["legal", "Rasul: identify legal/compliance issues, jurisdiction and date, verified primary sources, risk, and questions for licensed human counsel.", /legal|law|contract|compliance|privacy|terms|policy|license|licensing|regulat|tax|insurance|consumer|driver agreement|transport permit|data protection/i],
  ["devops", "Review CI, environment/secrets, deployment, observability, backup, migration rollout, and rollback safety.", /deploy|deployment|ci|cd|release|production|secret|infrastructure|hosting|monitor|backup|rollback|pipeline/i],
  ["tester", "Design or run tests that validate requested behavior, edge cases, concurrency, and regression safety.", null],
  ["security", "Review the proposed solution for secrets, authentication, permissions, input validation, data exposure, and abuse risks.", null],
  ["reviewer", "Perform an independent engineering review and identify blocking issues before merge.", null]
];

export function planTask(goal: string): TaskPlan {
  const steps = routes
    .filter(([agent, , pattern]) => {
      if (agent === "explorer" || agent === "coder" || agent === "tester" || agent === "security" || agent === "reviewer") return true;
      return pattern?.test(goal) ?? false;
    })
    .map(([agent, objective]) => ({ agent, objective }));

  return { id: "task-" + Date.now(), goal, steps, status: "queued" };
}
