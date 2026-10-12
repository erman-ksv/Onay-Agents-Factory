import assert from "node:assert/strict";
import test from "node:test";
import { AgentRunJournal } from "./agentRunJournal.js";

test("journal preserves ordered agent messages and handoffs", () => {
  const journal = new AgentRunJournal("Implement a verified agent workflow", "task-test");
  const streamed: number[] = [];
  const unsubscribe = journal.subscribe((event) => streamed.push(event.sequence));

  journal.record("agent_started", "explorer", "Inspecting repository.");
  journal.handoff("explorer", "coder", "Repository context is ready.", { files: 4 });
  journal.record("artifact_created", "coder", "Proposed patch created.", { files: ["src/a.ts"] });
  journal.record("verification_passed", "tester", "Required checks passed.", { sha: "abc123" });
  unsubscribe();

  const events = journal.snapshot();
  assert.equal(journal.taskId, "task-test");
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4, 5]);
  assert.deepEqual(streamed, [2, 3, 4, 5]);
  assert.equal(events[2].type, "handoff");
  assert.equal(events[2].details?.to, "coder");
  assert.equal(events[4].details?.sha, "abc123");
});

test("journal rejects an empty task goal", () => {
  assert.throws(() => new AgentRunJournal("   "), /task goal is required/i);
});

test("snapshot does not expose mutable event details", () => {
  const journal = new AgentRunJournal("task");
  journal.record("artifact_created", "coder", "Patch created.", { files: ["a.ts"] });
  const snapshot = journal.snapshot();
  snapshot[1].details!.files = ["tampered.ts"];
  assert.deepEqual(journal.snapshot()[1].details?.files, ["a.ts"]);
});

test("constructor streams the initial task event immediately", () => {
  const streamed: string[] = [];
  const journal = new AgentRunJournal("stream this task", "task-stream", (event) => streamed.push(event.type));
  journal.record("agent_started", "explorer", "Starting exploration.");
  assert.deepEqual(streamed, ["task_received", "agent_started"]);
});
