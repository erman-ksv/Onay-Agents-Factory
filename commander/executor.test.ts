import assert from "node:assert/strict";
import test from "node:test";
import { executePlan } from "./executor.js";

test("agents execute in plan order and receive prior results as handoff context", async () => {
  const order: string[] = [];
  const steps = [
    { agent: "explorer", objective: "inspect" },
    { agent: "reviewer", objective: "review exploration" },
  ];

  const results = await executePlan("Improve Onay", steps, {
    explorer: async ({ goal }) => {
      order.push("explorer");
      return { goal, files: ["package.json"] };
    },
    reviewer: async ({ previousResults }) => {
      order.push("reviewer");
      assert.equal(previousResults.length, 1);
      assert.equal(previousResults[0].status, "completed");
      assert.deepEqual(previousResults[0].output, { goal: "Improve Onay", files: ["package.json"] });
      return { reviewed: true };
    },
  });

  assert.deepEqual(order, ["explorer", "reviewer"]);
  assert.deepEqual(results.map((result) => result.status), ["completed", "completed"]);
});

test("missing handlers are reported as skipped, not completed", async () => {
  const results = await executePlan("task", [
    { agent: "coder", objective: "write code" },
  ], {});

  assert.equal(results[0].status, "skipped");
  assert.match(results[0].error ?? "", /No executable handler/);
});

test("a failed agent is recorded and later independent agents still run", async () => {
  const results = await executePlan("task", [
    { agent: "explorer", objective: "inspect" },
    { agent: "security", objective: "scan" },
  ], {
    explorer: () => { throw new Error("GitHub unavailable"); },
    security: () => ({ status: "clean" }),
  });

  assert.equal(results[0].status, "failed");
  assert.match(results[0].error ?? "", /GitHub unavailable/);
  assert.equal(results[1].status, "completed");
});

test("execution journal streams task, handoff, and agent outcome events in order", async () => {
  const { AgentRunJournal } = await import("../orchestration/agentRunJournal.js");
  const streamed: Array<{ type: string; actor: string; details?: Record<string, unknown> }> = [];
  const journal = new AgentRunJournal("trace the run", "task-executor-test", event => streamed.push(event));
  const results = await executePlan("trace the run", [
    { agent: "explorer", objective: "inspect repository" },
    { agent: "reviewer", objective: "review findings" },
  ], {
    explorer: async () => ({ files: ["package.json"] }),
    reviewer: async ({ previousResults }) => ({ reviewedPriorStage: previousResults[0].agent }),
  }, { journal });

  assert.deepEqual(results.map(result => result.status), ["completed", "completed"]);
  assert.equal(streamed[0].type, "task_received");
  assert.equal(streamed[1].type, "agent_started");
  assert.equal(streamed.some(event => event.type === "handoff" && event.details?.to === "reviewer"), true);
  assert.equal(streamed.at(-1)?.type, "agent_completed");
});

test("failed and skipped agents produce visible events and block the run", async () => {
  const { AgentRunJournal } = await import("../orchestration/agentRunJournal.js");
  const streamed: Array<{ type: string; actor: string }> = [];
  const journal = new AgentRunJournal("show blocked stages", "task-blocked-test", event => streamed.push(event));
  const results = await executePlan("show blocked stages", [
    { agent: "explorer", objective: "inspect" },
    { agent: "coder", objective: "write code" },
  ], {
    explorer: () => { throw new Error("repository unavailable"); },
  }, { journal });

  assert.deepEqual(results.map(result => result.status), ["failed", "skipped"]);
  assert.equal(streamed.some(event => event.type === "agent_failed" && event.actor === "explorer"), true);
  assert.equal(streamed.some(event => event.type === "agent_skipped" && event.actor === "coder"), true);
  assert.equal(streamed.at(-1)?.type, "blocked");
});
