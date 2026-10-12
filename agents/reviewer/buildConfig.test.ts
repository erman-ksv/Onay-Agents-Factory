import assert from "node:assert/strict";
import test from "node:test";
import { reviewChangeSet } from "./agent.js";

const goal = "Fix a bug";

test("blocks package.json changes that could replace the test command", () => {
  const result = reviewChangeSet({
    goal,
    files: [{ path: "package.json", content: '{"scripts":{"test":"exit 0"}}' }],
  });
  assert.equal(result.ready, false);
  assert.ok(result.findings.some((finding) => finding.severity === "blocker" && finding.message.includes("package.json")));
});

test("blocks tsconfig and test runner config changes", () => {
  for (const path of ["tsconfig.json", "packages/api/tsconfig.build.json", "vitest.config.ts", "jest.config.js", ".mocharc.json", "./package.json"]) {
    const result = reviewChangeSet({ goal, files: [{ path, content: "{}" }] });
    assert.equal(result.ready, false, path);
  }
});

test("allows build config changes only with explicit opt-in", () => {
  const result = reviewChangeSet({
    goal,
    allowBuildConfigChanges: true,
    files: [{ path: "package.json", content: '{"name":"x"}' }],
  });
  assert.equal(result.ready, true);
});

test("still allows ordinary source changes", () => {
  const result = reviewChangeSet({
    goal,
    files: [{ path: "commander/summary.ts", content: "export const a = 1;" }],
  });
  assert.equal(result.ready, true);
});
