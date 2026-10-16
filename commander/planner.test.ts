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
  const launchPlan = planTask("Prepare Onay launch in Uzbekistan");
  assert.ok(legalPlan.steps.some((step) => step.agent === "legal"));
  assert.ok(launchPlan.steps.some((step) => step.agent === "legal"));
});

test("unrelated copy-editing tasks do not include Rasul", () => {
  const plan = planTask("Fix a typo in the welcome screen copy");
  assert.ok(!plan.steps.some((step) => step.agent === "legal"));
});

import { buildCommanderPrompt } from "./buildCommanderPrompt.js";

test("AI Commander prompt includes Rasul for Uzbekistan launch tasks", () => {
  const prompt = buildCommanderPrompt("Prepare Onay launch in Uzbekistan");
  assert.match(prompt, /legal → rasul_legal_compliance/);
  assert.match(prompt, /Invoke every listed specialist tool at least once/);
});

test("AI Commander prompt includes dispatch for taxi matching tasks", () => {
  const prompt = buildCommanderPrompt("Review taxi dispatch and FIFO driver matching");
  assert.match(prompt, /dispatch → dispatch_ride_operations_specialist/);
});

test("Russian read-only repository audits use inspection-only stages", () => {
  const plan = planTask("Проверь структуру проекта Onay-Agents-Factory. Определи роли Commander, Explorer, Backend, Frontend, Tester, Security и Reviewer. Ничего не изменяй в файлах.");
  assert.deepEqual(plan.steps.map((step) => step.agent), ["explorer", "tester", "security"]);
});

test("Agent Factory target detection is explicit", async () => {
  const { isAgentFactoryTarget } = await import("./planner.js");
  assert.equal(isAgentFactoryTarget("Проверь Onay-Agents-Factory"), true);
  assert.equal(isAgentFactoryTarget("Проверь Onay Agents Factory"), true);
  assert.equal(isAgentFactoryTarget("Review taxi dispatch"), false);
});


test("Agent Factory tasks use executable AI tools when a provider is configured", async () => {
  const { shouldUseAiCommander } = await import("./planner.js");
  assert.equal(shouldUseAiCommander("Fix Onay-Agents-Factory executor", true), true);
  assert.equal(shouldUseAiCommander("Review Onay dispatch", true), true);
  assert.equal(shouldUseAiCommander("Review Onay dispatch", false), false);
  assert.equal(shouldUseAiCommander("Review Onay dispatch", true, "deterministic"), false);
});


test("mutation plans generate before product, UX and other proposal-dependent reviews", () => {
  const roles = planTask("Implement Onay passenger registration mobile UI auth API").steps.map(step => step.agent);
  assert.equal(roles[0], "explorer");
  assert.equal(roles[1], "coder");
  for (const role of ["product", "ux", "backend", "frontend", "legal", "security", "reviewer"]) {
    assert.ok(roles.indexOf(role) > roles.indexOf("coder"), role + " must review the current proposal");
  }
});
