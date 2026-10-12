import assert from "node:assert/strict";
import test from "node:test";
import { parsePipelineArgs, runPipelineCli } from "./cli.js";

test("pipeline CLI defaults to analysis-only mode", () => {
  const options = parsePipelineArgs(["--goal", "Review taxi dispatch"]);
  assert.equal(options.publish, false);
  assert.equal(options.goal, "Review taxi dispatch");
});

test("publishing requires branch, title, and body", () => {
  assert.throws(
    () => parsePipelineArgs(["--publish", "--goal", "Fix queue bug"]),
    /--branch is required with --publish/,
  );
});

test("publishing cannot target a protected branch", () => {
  assert.throws(
    () => parsePipelineArgs([
      "--publish", "--goal", "Fix queue bug", "--branch", "main",
      "--title", "Fix queue", "--body", "Summary",
    ]),
    /directly to main\/master is blocked/i,
  );
});

test("publishing requires an explicit environment write gate", async () => {
  await assert.rejects(
    () => runPipelineCli([
      "--publish", "--goal", "Fix queue bug", "--branch", "feat/queue-fix",
      "--title", "Fix queue", "--body", "Summary",
    ], {}),
    /Publishing is disabled/,
  );
});

test("help does not require a task goal", () => {
  assert.equal(parsePipelineArgs(["--help"]).help, true);
});
