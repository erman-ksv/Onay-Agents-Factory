import assert from "node:assert/strict";
import test from "node:test";
import { executePlan } from "./executor.js";

test("agents execute in plan order and receive prior results as handoff context", async () => {
  const order: string[] = [];
  const steps = [
    { agent: "explorer", objective: "inspect" },
    { agent: "reviewer", objective: "review exploration" },
  ];

  const results = await executePlan("Improve TezJet", steps, {
    explorer: async ({ goal }) => {
      order.push("explorer");
      return { goal, files: ["package.json"] };
    },
    reviewer: async ({ previousResults }) => {
      order.push("reviewer");
      assert.equal(previousResults.length, 1);
      assert.equal(previousResults[0].status, "completed");
      assert.deepEqual(previousResults[0].output, { goal: "Improve TezJet", files: ["package.json"] });
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
