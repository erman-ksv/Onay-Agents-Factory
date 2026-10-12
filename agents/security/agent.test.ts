import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SECURITY_PATHS, inspectProposedChanges } from "./agent.js";

test("default repository scan targets known TezJet source files", () => {
  assert.deepEqual(DEFAULT_SECURITY_PATHS, [
    "package.json",
    "artifacts/api-server/src/routes/order.ts",
    "artifacts/api-server/src/controllers/orderController.ts",
    "artifacts/api-server/src/controllers/queueController.ts",
    "artifacts/api-server/src/store/memoryStore.ts",
  ]);
  assert.equal(DEFAULT_SECURITY_PATHS.includes(".env.example" as never), false);
  assert.equal(DEFAULT_SECURITY_PATHS.includes("server.js" as never), false);
});

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
