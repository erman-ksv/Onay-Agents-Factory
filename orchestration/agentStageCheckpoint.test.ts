import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRunJournal } from "./agentRunJournal.js";
import { StageCheckpointRecorder, inspectStageCheckpoint } from "./agentStageCheckpoint.js";

const identity = {
  goal: "Audit Onay Agent Factory", repository: "erman-ksv/Onay-Agents-Factory",
  baseRef: "feat/agent-stage-checkpoints-20261018", expectedSha: "a".repeat(40),
};
function fixture(t: { after: (callback: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "stage-guard-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "state.json");
}
test("successful read-only receipts are not treated as reusable CI evidence", t => {
  const path = fixture(t);
  const journal = new AgentRunJournal(identity.goal, "test-checkpoint");
  const recorder = new StageCheckpointRecorder(path, identity, journal);
  for (const [actor, tool] of [["explorer", "explore_onay"], ["security", "security_review"], ["tester", "test_onay"]]) {
    journal.record("tool_started", actor, "Executing.", { tool });
    journal.record("tool_completed", actor, "Completed.", { tool });
    journal.record("verification_passed", actor, "Passed.");
  }
  recorder.finish("completed");
  recorder.close();
  const advice = inspectStageCheckpoint(path, identity);
  assert.equal(advice.decision, "restart-read-only");
  assert.deepEqual(advice.verifiedActors, ["explorer", "security", "tester"]);
  assert.equal(advice.stages.length, 3);
  const data = readFileSync(path, "utf8");
  assert.ok(!data.includes("API_KEY"));
  assert.ok(!data.includes("Executing."));
  assert.ok(!data.includes("Passed."));
});
test("interrupted GitHub tool requires external reconciliation", t => {
  const path = fixture(t);
  const journal = new AgentRunJournal(identity.goal);
  const recorder = new StageCheckpointRecorder(path, identity, journal);
  journal.record("tool_started", "github", "Publishing file", { tool: "publish_change_set" });
  recorder.close();
  assert.equal(inspectStageCheckpoint(path, identity).decision, "reconcile-github");
});
test("in-flight Coder cannot automatically restart", t => {
  const path = fixture(t);
  const journal = new AgentRunJournal(identity.goal);
  const recorder = new StageCheckpointRecorder(path, identity, journal);
  journal.record("tool_started", "coder", "Generating.", { tool: "code_onay" });
  recorder.close();
  assert.equal(inspectStageCheckpoint(path, identity).decision, "pause-unknown-outcome");
});
test("successful Coder still requires separately verified immutable artifacts", t => {
  const path = fixture(t);
  const journal = new AgentRunJournal(identity.goal);
  const recorder = new StageCheckpointRecorder(path, identity, journal);
  journal.record("tool_started", "coder", "Generating.", { tool: "code_onay" });
  journal.record("tool_completed", "coder", "Generated.", { tool: "code_onay" });
  recorder.finish("needs-review");
  recorder.close();
  assert.equal(inspectStageCheckpoint(path, identity).decision, "manual-artifact-recovery");
});
test("pinned SHA and goal changes cannot adopt old checkpoint", t => {
  const path = fixture(t);
  const journal = new AgentRunJournal(identity.goal);
  const recorder = new StageCheckpointRecorder(path, identity, journal);
  recorder.finish("blocked");
  recorder.close();
  assert.throws(() => inspectStageCheckpoint(path, { ...identity, expectedSha: "b".repeat(40) }), /does not match/);
  assert.throws(() => inspectStageCheckpoint(path, { ...identity, goal: "Different task" }), /does not match/);
});
test("recorder never overwrites an existing checkpoint or allows concurrent writers", t => {
  const path = fixture(t);
  const journal = new AgentRunJournal(identity.goal);
  const recorder = new StageCheckpointRecorder(path, identity, journal);
  assert.throws(() => new StageCheckpointRecorder(path, identity, journal), /existing stage checkpoint/);
  recorder.close();
});
test("failed stages remain blocked, never replayed", t => {
  const path = fixture(t);
  const journal = new AgentRunJournal(identity.goal);
  const recorder = new StageCheckpointRecorder(path, identity, journal);
  journal.record("tool_started", "explorer", "Start", { tool: "explore_onay" });
  journal.record("tool_failed", "explorer", "Failed", { tool: "explore_onay" });
  recorder.finish("blocked");
  recorder.close();
  assert.equal(inspectStageCheckpoint(path, identity).decision, "pause-failed-tool");
});
