import assert from "node:assert/strict";
import test from "node:test";
import { planTask } from "./planner.js";

test("dispatch and matching tasks include the dispatch specialist", () => {
  const plan = planTask("Review taxi dispatch, driver matching, and FIFO driver queue fairness");
  assert.ok(plan.steps.some((step) => step.agent === "dispatch"));
});

test("unrelated copy-editing tasks do not include the dispatch specialist", () => {
  const plan = planTask("Fix a typo in the welcome screen copy");
  assert.ok(!plan.steps.some((step) => step.agent === "dispatch"));
});
