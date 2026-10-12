export type TaskStatus = "queued" | "running" | "completed" | "failed";
export type AgentName =
  | "explorer"
  | "coder"
  | "backend"
  | "frontend"
  | "database"
  | "dispatch"
  | "product"
  | "ux"
  | "legal"
  | "devops"
  | "tester"
  | "security"
  | "reviewer";
export type TaskPlan = {
  id: string;
  goal: string;
  steps: Array<{ agent: AgentName; objective: string }>;
  status: TaskStatus;
};
