import assert from "node:assert/strict";
import test from "node:test";
import { summarizeSpecialistBlockers } from "./onayRegistrationDiagnostics.js";

test("only blocking roles are reported, with bounded summaries", () => {
  const result = summarizeSpecialistBlockers({
    product: { ready: true, findings: [], summary: "Fine" },
    ux: { ready: false, findings: [{ severity: "high", message: "Missing explanation for OTP retry." }] },
    legal: { ready: false, findings: [], summary: "Human privacy review required." },
    frontend: { ready: true, findings: [{ severity: "low", message: "Minor style issue" }] },
  });
  assert.deepEqual(result, [
    { role: "ux", severity: "high", message: "Missing explanation for OTP retry." },
    { role: "legal", severity: "unspecified", message: "Human privacy review required." },
  ]);
});

test("diagnostics conceal known secret markers and truncate text", () => {
  const result = summarizeSpecialistBlockers({
    security: { ready: false, findings: [
      { severity: "blocker", message: "Secret leaked: ghp_" + "A".repeat(30) },
      { severity: "high", message: "X".repeat(900) },
    ] },
  });
  assert.equal(result[0]?.message, "[withheld: potential secret]");
  assert.equal(result[1]?.message.length, 300);
});
