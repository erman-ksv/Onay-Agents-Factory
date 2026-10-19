import test from "node:test";
import assert from "node:assert/strict";
import { CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
import { loadCalculatorSnapshot, type CalculatorSnapshotReader } from "../github/calculatorSnapshot.js";
import { ROLE_SKILLS } from "./skills.js";
import { assertCalculatorHandoff, buildCalculatorRoleInstructions, calculatorRole, CALCULATOR_TEAM, CALCULATOR_TEAM_ERROR,
  prepareCalculatorRoleChanges, validateCalculatorAssessment } from "./calculatorTeam.js";

const roles = Object.keys(CALCULATOR_TEAM);
const error = (value: unknown) => { assert.ok(value instanceof Error); assert.equal(value.message, CALCULATOR_TEAM_ERROR); return true; };
const pass = () => ({ ready: true, summary: "The supplied acceptance criteria are covered.", findings: [], unverifiedAreas: [] as string[] });
const issue = (severity = "high", evidenceRefs = ["criterion:addition"]) => ({ severity, message: "The observed change violates the supplied requirement.", evidenceRefs });
async function snapshot(paths: string[]) {
  const reader: CalculatorSnapshotReader = {
    getHead: async () => "a".repeat(40), readCommit: async () => ({ sha: "a".repeat(40), treeSha: "b".repeat(40) }),
    readTree: async () => ({ sha: "b".repeat(40), truncated: false, tree: [] }),
    readBlob: async () => { throw new Error("Unexpected source read"); },
  };
  return loadCalculatorSnapshot({ repository: CALCULATOR_PROFILE.repository, baseRef: "feat/calculator-pilot-bootstrap",
    baseSha: "a".repeat(40), changePaths: paths }, reader);
}
function proposal(path: string) {
  return { summary: "Create the approved isolated fixture.", changes: [
    { operation: "create", path, content: "// bounded role fixture\n", message: "Create fixture" },
  ] };
}

test("all calculator roles are explicit, frozen and bound to the fixed target", () => {
  assert.deepEqual(roles, ["commander", "product", "explorer", "ux", "coder", "frontend", "tester", "security", "reviewer"]);
  assert.ok(Object.isFrozen(CALCULATOR_TEAM));
  for (const role of roles) {
    const name = calculatorRole(role), config = CALCULATOR_TEAM[name];
    assert.ok(Object.isFrozen(config)); assert.ok(Object.isFrozen(config.writablePaths));
    assert.ok(config.purpose && config.inputs && config.outputs);
    assert.ok(buildCalculatorRoleInstructions(role).includes(CALCULATOR_PROFILE.repository));
    assert.ok(buildCalculatorRoleInstructions(role).includes("legal agent"));
    for (const path of config.writablePaths) assert.ok(CALCULATOR_PROFILE.writablePaths.includes(path));
  }
  for (const required of CALCULATOR_PROFILE.requiredActors) assert.equal(calculatorRole(required), required);
});
test("legal, taxi-specific and invented roles cannot be selected", () => {
  for (const role of ["legal", "backend", "database", "dispatch", "devops", "admin", "__proto__", "constructor", "frontend ", "Frontend", null, {}, 1]) {
    assert.throws(() => calculatorRole(role), error);
    assert.throws(() => buildCalculatorRoleInstructions(role), error);
  }
});
test("calculator instructions preserve original Onay/qualification skills while adapting browser roles", () => {
  const before = JSON.stringify(ROLE_SKILLS);
  for (const role of roles) buildCalculatorRoleInstructions(role);
  assert.equal(JSON.stringify(ROLE_SKILLS), before);
  assert.ok(ROLE_SKILLS.frontend.includes("React and Expo"));
  assert.ok(ROLE_SKILLS.product.includes("FIFO"));
  assert.match(buildCalculatorRoleInstructions("frontend"), /plain HTML, CSS and browser JavaScript/);
  assert.doesNotMatch(buildCalculatorRoleInstructions("frontend"), /specialist for React and Expo/);
  assert.doesNotMatch(buildCalculatorRoleInstructions("product"), /FIFO|eligible taxi/);
  assert.match(buildCalculatorRoleInstructions("coder"), /changes:\[\] and a blocked summary/);
});
test("all specialist handoffs and repair requests go through Commander", () => {
  for (const from of roles) for (const to of roles) {
    if (from !== to && (from === "commander" || to === "commander")) assert.doesNotThrow(() => assertCalculatorHandoff(from, to));
    else assert.throws(() => assertCalculatorHandoff(from, to), error);
  }
  assert.throws(() => assertCalculatorHandoff("commander", "legal"), error);
});
test("Coder and Frontend may prepare proposals only for their host-assigned paths", async t => {
  for (const role of ["coder", "frontend"] as const) for (const path of CALCULATOR_PROFILE.writablePaths) await t.test(role + ":" + path, async () => {
    const verified = await snapshot([path]);
    if (CALCULATOR_TEAM[role].writablePaths.includes(path)) {
      const result = prepareCalculatorRoleChanges(role, proposal(path), verified);
      assert.equal(result.files[0].path, path); assert.equal(result.gates.publicationAuthorized, false);
      assert.equal(result.gates.independentReview, "required"); assert.equal(result.gates.tests, "required");
    } else assert.throws(() => prepareCalculatorRoleChanges(role, proposal(path), verified), error);
  });
});
test("read-only roles and model-declared role switches cannot create source", async () => {
  const verified = await snapshot(["index.html"]);
  for (const role of ["commander", "product", "explorer", "ux", "tester", "security", "reviewer", "legal"])
    assert.throws(() => prepareCalculatorRoleChanges(role, proposal("index.html"), verified), error);
  assert.throws(() => prepareCalculatorRoleChanges("frontend", { ...proposal("index.html"), role: "coder" }, verified));
  assert.throws(() => prepareCalculatorRoleChanges("frontend", proposal("index.html"), { ...verified }));
});
test("assessments cannot assert execution, publication or overall completion", () => {
  for (const role of ["product", "ux", "tester", "security", "reviewer"]) {
    const result = validateCalculatorAssessment(role, pass(), ["criterion:addition"]);
    assert.equal(result.ready, true); assert.equal(result.testsExecuted, false);
    assert.equal(result.overallTaskCompletionVerified, false); assert.equal(result.publicationAuthorized, false);
    assert.ok(result.unverifiedAreas.some(area => area.includes("does not prove test execution")));
    assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.findings));
  }
  for (const name of ["testsExecuted", "publicationAuthorized", "overallTaskCompletionVerified", "repository", "role"])
    assert.throws(() => validateCalculatorAssessment("reviewer", { ...pass(), [name]: true }, ["criterion:addition"]), error);
});
test("blocker/high findings stop approval even when the model says ready", () => {
  for (const severity of ["blocker", "high"]) {
    const result = validateCalculatorAssessment("reviewer", { ...pass(), findings: [issue(severity)] }, ["criterion:addition"]);
    assert.equal(result.ready, false); assert.equal(result.findings[0].evidenceStatus, "supplied");
  }
  const declined = validateCalculatorAssessment("security", { ...pass(), ready: false }, ["criterion:addition"]);
  assert.equal(declined.ready, false);
});
test("missing evidence remains explicit and cannot manufacture a clean approval", () => {
  const empty = validateCalculatorAssessment("reviewer", pass(), []);
  assert.equal(empty.ready, false); assert.ok(empty.unverifiedAreas.some(area => area.includes("No scoped evidence")));
  const result = validateCalculatorAssessment("security", { ...pass(), findings: [issue("high", [])] }, ["criterion:addition"]);
  assert.equal(result.ready, false); assert.equal(result.findings[0].evidenceStatus, "missing");
  assert.ok(result.unverifiedAreas.some(area => area.includes("lack supplied evidence")));
  assert.throws(() => validateCalculatorAssessment("reviewer", { ...pass(), findings: [issue("high", ["source:unseen"])] }, ["criterion:addition"]), error);
});
test("review roles do not accept developer/Commander output or forged evidence lists", () => {
  for (const role of ["commander", "explorer", "coder", "frontend", "legal"])
    assert.throws(() => validateCalculatorAssessment(role, pass(), ["criterion:addition"]), error);
  for (const refs of [["criterion:addition", "criterion:addition"], ["../bad evidence"], Array.from({ length: 17 }, (_, i) => "source:" + i)])
    assert.throws(() => validateCalculatorAssessment("reviewer", pass(), refs), error);
});
test("oversized, malformed, secret-bearing or cyclic reviews refuse without dropping late blockers", () => {
  const secret = "ghp_" + "A".repeat(24);
  const bad: unknown[] = [null, { ...pass(), ready: "true" }, { ...pass(), summary: secret },
    { ...pass(), findings: [{ ...issue(), message: secret }] }, { ...pass(), findings: [{ ...issue(), severity: "critical" }] },
    { ...pass(), findings: [{ ...issue(), evidenceRefs: ["criterion:addition", "criterion:addition"] }] },
    { ...pass(), findings: [...Array.from({ length: 12 }, () => issue("low")), issue("blocker")] },
    { ...pass(), findings: [{ ...issue(), bypass: true }] }, { ...pass(), summary: "x".repeat(601) },
    { ...pass(), unverifiedAreas: [secret] }, { ...pass(), unverifiedAreas: Array.from({ length: 9 }, () => "Unshown scope") },
    { ...pass(), findings: Array.from({ length: 12 }, () => ({ ...issue("low"), message: "x".repeat(400),
      evidenceRefs: Array.from({ length: 16 }, (_, i) => "source:" + "x".repeat(180) + i) })) },
  ];
  const circular = pass(); (circular.findings as unknown[]).push(circular); bad.push(circular);
  for (const input of bad) assert.throws(() => validateCalculatorAssessment("reviewer", input, ["criterion:addition"]), error);
});
