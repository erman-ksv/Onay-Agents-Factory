import assert from "node:assert/strict";
import test from "node:test";
import { reviewChangeSet } from "./agent.js";

test("reviewer accepts a normal non-empty change", () => {
  const result = reviewChangeSet({ goal: "Fix route validation", files: [{ path: "src/routes.ts", content: "export const route = true;\n" }] });
  assert.equal(result.ready, true);
  assert.deepEqual(result.findings, []);
});

test("reviewer blocks sensitive file names but allows the example env template", () => {
  const blocked = reviewChangeSet({ goal: "Add config", files: [{ path: ".env.production", content: "SECRET=x" }] });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.findings[0]?.severity, "blocker");

  const allowed = reviewChangeSet({ goal: "Document config", files: [{ path: ".env.example", content: "PUBLIC_URL=" }] });
  assert.equal(allowed.ready, true);
});

test("reviewer blocks traversal paths and duplicate paths", () => {
  const traversal = reviewChangeSet({ goal: "Update file", files: [{ path: "../outside.ts", content: "safe" }] });
  assert.equal(traversal.ready, false);

  const duplicate = reviewChangeSet({ goal: "Update file", files: [
    { path: "src/Route.ts", content: "a" },
    { path: "src/route.ts", content: "b" },
  ] });
  assert.equal(duplicate.ready, false);
  assert.ok(duplicate.findings.some((finding) => finding.message.includes("Duplicate path")));
});

test("reviewer blocks empty files and empty change sets", () => {
  assert.equal(reviewChangeSet({ goal: "Fix bug", files: [{ path: "src/fix.ts", content: "  " }] }).ready, false);
  assert.equal(reviewChangeSet({ goal: "Fix bug", files: [] }).ready, false);
});

test("reviewer flags oversized files for human review without silently blocking", () => {
  const result = reviewChangeSet({ goal: "Add generated data", files: [{ path: "data.txt", content: "x".repeat(1_000_001) }] });
  assert.equal(result.ready, true);
  assert.ok(result.findings.some((finding) => finding.severity === "medium"));
});

test("reviewer blocks GitHub automation changes unless explicitly enabled", () => {
  const workflow = { path: ".github/workflows/ci.yml", content: "name: CI\\n" };
  const blocked = reviewChangeSet({ goal: "Update CI", files: [workflow] });
  assert.equal(blocked.ready, false);
  assert.ok(blocked.findings.some((finding) => finding.message.includes("AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES=true")));

  const allowed = reviewChangeSet({ goal: "Update CI", files: [workflow], allowWorkflowChanges: true });
  assert.equal(allowed.ready, true);
});
