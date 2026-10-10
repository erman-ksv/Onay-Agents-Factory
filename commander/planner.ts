import type { AgentName, TaskPlan } from "./taskTypes.js";

const routes: Array<[AgentName, string, RegExp | null]> = [
  ["explorer", "Inspect the repository and identify relevant files, architecture, constraints, and risks.", null],
  ["product", "Define user problem, scope, non-goals, business rules, and testable acceptance criteria.", /feature|requirement|product|business rule|workflow|booking|fare|pricing|pool|seat|driver|passenger|order|roadmap/i],
  ["ux", "Review user journeys, mobile usability, accessibility, permission requests, and failure states.", /frontend|ui|ux|react|page|screen|component|mobile|android|ios|accessibility|map|location|booking flow/i],
  ["coder", "Produce the smallest explicit code change set required by the goal. Return complete contents for changed files only.", null],
  ["backend", "Implement backend/API changes with server-side validation, authorization, transactions, and integration tests when relevant.", /backend|api|server|route|controller|queue|fifo|order|driver|auth|socket|endpoint/i],
  ["frontend", "Implement accessible frontend/client changes and cover loading, empty, offline, and error states.", /frontend|ui|react|page|screen|component|mobile|android|ios|map|location/i],
  ["database", "Design or implement schema, persistence, migrations, indexes, transactions, and data-access changes when required.", /database|db|schema|migration|postgres|redis|storage|persist|transaction|order state/i],
  ["dispatch", "Validate taxi dispatch, driver matching, queue fairness, pickup eligibility, seat capacity, and ride lifecycle invariants.", /dispatch|matching|nearest driver|driver queue|fifo|pickup|drop.?off|seat capacity|shared ride|pooling|ride lifecycle|driver offer|order assignment|taxi availability/i],
  ["legal", "Rasul: mandatory ongoing compliance gate for relevant TezJet product changes; identify jurisdiction/date, verify official sources, document risks and release blockers, and flag need for human counsel.", /legal|law|contract|compliance|privacy|terms|policy|license|licensing|regulat|tax|insurance|consumer|driver agreement|transport permit|data protection|launch|release|onboard|signup|registration|fare|pricing|payment|refund|cancel|location|gps|personal data|passenger|driver|vehicle|trip|ride|booking|safety|hosting|vendor|cross.border|country|jurisdiction/i],
  ["devops", "Review CI, environment/secrets, deployment, observability, backup, migration rollout, and rollback safety.", /deploy|deployment|ci|cd|release|production|secret|infrastructure|hosting|monitor|backup|rollback|pipeline/i],
  ["tester", "Design or run tests that validate requested behavior, edge cases, concurrency, and regression safety.", null],
  ["security", "Review the proposed solution for secrets, authentication, permissions, input validation, data exposure, and abuse risks.", null],
  ["reviewer", "Perform an independent engineering review and identify blocking issues before merge.", null]
];

const READ_ONLY_AUDIT = /\b(inspect|audit|check|analy[sz]e|report|explain|identify|verify|проверь|проверить|анализ|структуру|структура|определи|сообщи)\b/i;
const MUTATION_INTENT = /\b(implement|build|create|add|change|modify|fix|refactor|write|generate|develop|update|remove|delete|создай|измени|исправь|добавь|реализуй|напиши)\b/i;
const FACTORY_TARGET = /tezjet-agent-factory|agent factory/i;

export function isReadOnlyRepositoryAudit(goal: string): boolean {
  return READ_ONLY_AUDIT.test(goal) && !MUTATION_INTENT.test(goal);
}

export function isAgentFactoryTarget(goal: string): boolean {
  return FACTORY_TARGET.test(goal);
}

export function planTask(goal: string): TaskPlan {
  const auditOnly = isReadOnlyRepositoryAudit(goal);
  const steps = auditOnly
    ? routes
        .filter(([agent]) => agent === "explorer" || agent === "tester" || agent === "security")
        .map(([agent, objective]) => ({ agent, objective }))
    : routes
        .filter(([agent, , pattern]) => {
          if (agent === "explorer" || agent === "coder" || agent === "tester" || agent === "security" || agent === "reviewer") return true;
          return pattern?.test(goal) ?? false;
        })
        .map(([agent, objective]) => ({ agent, objective }));

  return { id: "task-" + Date.now(), goal, steps, status: "queued" };
}
