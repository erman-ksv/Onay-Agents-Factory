export type AgentRunEventType =
  | "task_received"
  | "agent_started"
  | "handoff"
  | "artifact_created"
  | "verification_passed"
  | "blocked"
  | "agent_completed";

export type AgentRunEvent = {
  sequence: number;
  timestamp: string;
  type: AgentRunEventType;
  actor: string;
  message: string;
  details?: Record<string, unknown>;
};

/**
 * Ordered event journal for a single task run. Its event shape can be streamed
 * to a UI or persisted later without coupling execution to a frontend/database.
 */
export class AgentRunJournal {
  readonly taskId: string;
  readonly goal: string;
  private sequence = 0;
  private readonly entries: AgentRunEvent[] = [];
  private readonly listeners = new Set<(event: AgentRunEvent) => void>();

  constructor(goal: string, taskId = `task-${Date.now()}`) {
    if (!goal.trim()) throw new Error("A task goal is required.");
    this.goal = goal;
    this.taskId = taskId;
    this.record("task_received", "commander", "Task received by Commander.", { goal });
  }

  record(
    type: AgentRunEventType,
    actor: string,
    message: string,
    details?: Record<string, unknown>,
  ): AgentRunEvent {
    const event: AgentRunEvent = {
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      type,
      actor,
      message,
      ...(details ? { details } : {}),
    };
    this.entries.push(event);
    for (const listener of this.listeners) listener(event);
    return event;
  }

  handoff(from: string, to: string, message: string, details?: Record<string, unknown>) {
    return this.record("handoff", from, message, { to, ...details });
  }

  snapshot(): AgentRunEvent[] {
    return this.entries.map((event) => ({
      ...event,
      ...(event.details ? { details: structuredClone(event.details) } : {}),
    }));
  }

  subscribe(listener: (event: AgentRunEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
