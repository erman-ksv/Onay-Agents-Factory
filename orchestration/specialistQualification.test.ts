import assert from "node:assert/strict";
import test from "node:test";
import { QUALIFICATION_CASES, buildQualificationPrompt, evaluateAssessment, parseAssessment, runQualification } from "./specialistQualification.js";

test("qualification covers every advisory role with faulty and corrected cases", () => {
  const roles = ["backend", "database", "frontend", "dispatch", "product", "ux", "legal", "devops"];
  assert.equal(QUALIFICATION_CASES.length, 16);
  assert.equal(new Set(QUALIFICATION_CASES.map(c => c.id)).size, 16);
  for (const role of roles) {
    assert.equal(QUALIFICATION_CASES.filter(c => c.role === role && c.expectedReady).length, 1);
    assert.equal(QUALIFICATION_CASES.filter(c => c.role === role && !c.expectedReady).length, 1);
  }
});
test("blanket approval, blanket rejection and vague blockers cannot qualify", () => {
  for (const c of QUALIFICATION_CASES) {
    if (!c.expectedReady) {
      assert.equal(evaluateAssessment(c, { ready: true, findings: [] }).passed, false);
      assert.equal(evaluateAssessment(c, { ready: false, findings: [{severity: "high", message: "Something needs improvement."}] }).passed, false);
    } else {
      assert.equal(evaluateAssessment(c, { ready: false, findings: [{severity: "high", message: "Rejected."}] }).passed, false);
      assert.equal(evaluateAssessment(c, { ready: true, findings: [{severity: "high", message: "Still blocked."}] }).passed, false);
    }
  }
});
test("blocker evidence must be severe and inside findings", () => {
  const c = QUALIFICATION_CASES.find(c => c.role === "backend" && !c.expectedReady)!;
  assert.equal(evaluateAssessment(c, {ready: false, findings: [], summary: "IDOR"}).passed, false);
  assert.equal(evaluateAssessment(c, {ready: false, findings: [{severity: "low", message: "IDOR"}]}).passed, false);
  assert.equal(evaluateAssessment(c, {ready: false, findings: [{severity: "high", message: "Missing owner authorization creates IDOR."}]}).passed, true);
});
test("malformed assessments fail closed and fenced valid JSON is accepted", () => {
  for (const value of [null, "", "{}", '{"ready":"false","findings":[]}', '{"ready":false,"findings":[{"severity":"critical","message":"bad"}]}', '{"ready":false,"findings":[{"severity":"high","message":""}]}']) {
    assert.throws(() => parseAssessment(value));
  }
  assert.equal(parseAssessment('\`\`\`json\n{"ready":true,"findings":[]}\n\`\`\`').ready, true);
});
test("model prompt contains fixture but excludes ground-truth fields", () => {
  for (const c of QUALIFICATION_CASES) {
    const prompt = buildQualificationPrompt(c);
    assert.ok(prompt.includes(c.scenario));
    assert.ok(!prompt.includes("expectedReady"));
    assert.ok(!prompt.includes("expectedFinding"));
  }
});
test("provider errors stop further calls and cannot produce a passing report", async () => {
  let calls = 0;
  await assert.rejects(runQualification(async () => { calls++; throw new Error("provider unavailable"); }));
  assert.equal(calls, 1);
});
test("every fixture must pass; a single false approval fails the overall result", async () => {
  const result = await runQualification(async () => '{"ready":true,"findings":[]}');
  assert.equal(result.passed, false);
  assert.equal(result.results.length, 16);
  assert.equal(result.results.filter(r => r.passed).length, 8);
});
