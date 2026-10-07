export type AgentTask = { id: string; type: string; payload: unknown; status: "queued" | "running" | "done" | "failed" };

export class TaskQueue {
  private readonly tasks: AgentTask[] = [];
  enqueue(task: AgentTask) { this.tasks.push(task); }
  next() { return this.tasks.find((task) => task.status === "queued"); }
  all() { return [...this.tasks]; }
}
