import assert from "node:assert/strict";
import test from "node:test";
import { inspectProposedChanges } from "./agent.js";

test("proposed changes with no secret-like values pass the content scan", () => {
  const result = inspectProposedChanges([
    { path: "src/example.ts", content: 'export const greeting = "hello";' },
  ]);
  assert.equal(result.status, "clean");
  assert.deepEqual(result.findings, []);
});

test("proposed changes containing a token-like value are blocked with path and line", () => {
  const result = inspectProposedChanges([
    { path: "src/config.ts", content: 'const apiKey = "sk-abcdefghijklmnopqrstuvwxyz1234";' },
  ]);
  assert.equal(result.status, "findings");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.path, "src/config.ts");
  assert.equal(result.findings[0]?.line, 1);
});
