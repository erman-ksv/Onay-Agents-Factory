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

import { buildCommanderPrompt } from "./buildCommanderPrompt.js";

test("AI Commander prompt includes Rasul for Uzbekistan launch tasks", () => {
  const prompt = buildCommanderPrompt("Prepare TezJet launch in Uzbekistan");
  assert.match(prompt, /legal → rasul_legal_compliance/);
  assert.match(prompt, /Invoke every listed specialist tool at least once/);
});

test("AI Commander prompt includes dispatch for taxi matching tasks", () => {
  const prompt = buildCommanderPrompt("Review taxi dispatch and FIFO driver matching");
  assert.match(prompt, /dispatch → dispatch_ride_operations_specialist/);
});
