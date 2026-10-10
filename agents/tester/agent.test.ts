import assert from "node:assert/strict";
import test from "node:test";
import { discoverTestScripts } from "./agent.js";

test("discovers test, check, lint, and type scripts", () => {
  const result = discoverTestScripts(JSON.stringify({
    scripts: {
      test: "vitest run",
      typecheck: "tsc --noEmit",
      lint: "eslint .",
      build: "vite build",
      dev: "vite",
    },
  }));

  assert.equal(result.validJson, true);
  assert.deepEqual(result.scripts, [
    "test: vitest run",
    "typecheck: tsc --noEmit",
    "lint: eslint .",
  ]);
});

test("reports valid package JSON with no matching scripts", () => {
  const result = discoverTestScripts(JSON.stringify({ scripts: { build: "vite build" } }));

  assert.equal(result.validJson, true);
  assert.deepEqual(result.scripts, []);
});

test("handles malformed package JSON without throwing", () => {
  const result = discoverTestScripts("{not json");

  assert.equal(result.validJson, false);
  assert.deepEqual(result.scripts, []);
});
