import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOnayGoalCli, runOnayGoalCli } from "./onayGoalCli.js";
import { planOnayGoal } from "./onayGoal.js";

const goal = { version: 1, id: "onay-owner-goal", goal: "Разработать Onay для общих поездок по сельской линии, с очередью водителей и проверкой мест.",
  baseRef: "dev/onay-working", baseSha: "a".repeat(40), provider: "groq" };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "onay-goal-cli-"));
  const input = join(root, "goal.json"), state = join(root, "state"), output = join(root, "output");
  mkdirSync(state, { mode: 0o700 }); writeFileSync(input, JSON.stringify(goal), { mode: 0o600 });
  return { root, input, state, output, args: ["--goal", input, "--state-dir", state, "--mode", "inspect", "--output-dir", output] };
}
test("goal CLI strictly parses absolute paths and its three bounded modes", () => {
  const args = ["--goal", "/tmp/goal.json", "--state-dir", "/tmp/state", "--mode", "inspect", "--output-dir", "/tmp/report"];
  assert.equal(parseOnayGoalCli(args).mode, "inspect");
  for (const bad of [args.concat(["--mode", "plan"]), args.slice(1), args.map(value => value === "inspect" ? "run" : value),
    args.map(value => value === "/tmp/goal.json" ? "relative.json" : value), args.concat(["--provider", "openai"])])
    assert.throws(() => parseOnayGoalCli(bad));
});
test("offline inspect emits metadata without model packages, credentials or GitHub", async () => {
  const f = fixture();
  try {
    await planOnayGoal(goal, f.state, { getHead: async () => goal.baseSha,
      plan: async () => ({ tasks: [], blockers: ["Source evidence remains unverified."], unverifiedAreas: [], status: "needs-owner-decision" }) });
    const result = await runOnayGoalCli(f.args, {});
    assert.equal(result.code, 0); assert.equal(result.report.wholeAppCompleted, false);
    assert.equal(result.report.reasonCode, "offline_receipt_inspection_only");
    assert.equal(JSON.parse(readFileSync(join(f.output, "report.json"), "utf8")).legalReview, "disabled");
    assert.doesNotMatch(readFileSync(join(f.output, "summary.md"), "utf8"), /api[_-]?key/i);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test("plan and continuation refuse absent or mixed approval before SDK import", async () => {
  for (const mode of ["plan", "continue"]) {
    const f = fixture();
    try {
      const args = f.args.map(value => value === "inspect" ? mode : value);
      await assert.rejects(runOnayGoalCli(args, {}), /not explicitly approved/);
      await assert.rejects(runOnayGoalCli(args, { ONAY_GOAL_APPROVED: mode === "plan" ? "PLAN_FREE_GOAL" : "RUN_FREE_GOAL_CYCLE",
        ONAY_TEAM_FREE_TIER_CONFIRMED: "true", AGENT_FACTORY_ENABLE_GITHUB_WRITES: mode === "plan" ? "true" : "false",
        AGENT_FACTORY_LEGAL_ENABLED: "false" }), /not explicitly approved/);
      assert.deepEqual(readdirSync(f.state), []);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});
test("goal JSON cannot be a source symlink or an oversized input", async () => {
  const f = fixture();
  try {
    const link = join(f.root, "linked.json"); symlinkSync(f.input, link);
    await assert.rejects(runOnayGoalCli(f.args.map(value => value === f.input ? link : value), {}));
    writeFileSync(f.input, " ".repeat(24_577));
    await assert.rejects(runOnayGoalCli(f.args, {}), /bounded JSON/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
