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

test("legal and launch tasks include Rasul", () => {
  const legalPlan = planTask("Review Uzbekistan privacy law and data protection compliance");
  const launchPlan = planTask("Prepare TezJet launch in Uzbekistan");
  assert.ok(legalPlan.steps.some((step) => step.agent === "legal"));
  assert.ok(launchPlan.steps.some((step) => step.agent === "legal"));
});

test("unrelated copy-editing tasks do not include Rasul", () => {
  const plan = planTask("Fix a typo in the welcome screen copy");
  assert.ok(!plan.steps.some((step) => step.agent === "legal"));
});
