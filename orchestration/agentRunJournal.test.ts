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

test("a failing observer cannot block tool events or healthy subscribers", () => {
  const journal = new AgentRunJournal("task", "task-failure", () => {
    throw new Error("Disconnected dashboard");
  });
  let failedCalls = 0;
  journal.subscribe(() => {
    failedCalls++;
    throw new Error("Disconnected observer");
  });
  const received: string[] = [];
  journal.subscribe((event) => received.push(event.type));

  journal.record("tool_started", "coder", "Writing candidate.");
  journal.record("tool_completed", "coder", "Candidate written.");

  assert.equal(failedCalls, 1);
  assert.deepEqual(received, ["tool_started", "tool_completed"]);
  assert.deepEqual(journal.snapshot().map((event) => event.type), [
    "task_received", "tool_started", "tool_completed",
  ]);
});

test("event inputs, subscribers and returned events cannot rewrite the journal", () => {
  const journal = new AgentRunJournal("task");
  const details = { files: ["verified.ts"] };
  journal.subscribe((event) => {
    event.actor = "tampered";
    event.details!.files = ["subscriber.ts"];
  });
  let receivedActor = "";
  journal.subscribe((event) => { receivedActor = event.actor; });
  const recorded = journal.record("artifact_created", "coder", "Patch created.", details);
  details.files.push("input.ts");
  recorded.details!.files = ["return.ts"];

  assert.equal(receivedActor, "coder");
  assert.equal(journal.snapshot()[1].actor, "coder");
  assert.deepEqual(journal.snapshot()[1].details?.files, ["verified.ts"]);
});
