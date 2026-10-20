import test from "node:test";
import assert from "node:assert/strict";
import { renderCalculatorOneCycleWorkflow } from "../config/calculatorOneCycleWorkflow.js";

const factory = "a".repeat(40), image = "node@sha256:" + "b".repeat(64);

test("private evidence is collected after execution even if metadata collection failed", () => {
  const workflow = renderCalculatorOneCycleWorkflow(factory, image);
  const collect = workflow.split("      - name: Collect private execution evidence")[1]?.split("      - name: Preserve immutable private execution evidence")[0];
  assert.ok(collect);
  assert.ok(collect.includes("always() && steps.barrier.outcome == 'success' && steps.prepare.outputs.mode == 'run'"));
  assert.ok(!collect.includes("steps.collect.outcome"));
  assert.ok(collect.includes(`orchestration/calculatorExecutionArtifact.ts "$RUNNER_TEMP/calculator-one-cycle" '${factory}' '${image}'`));
  assert.ok(collect.includes("CALCULATOR_REMOTE_BARRIER_UPLOADED: 'true'"));
  assert.ok(workflow.indexOf("id: execute") < workflow.indexOf("id: collect_private"));
  for (const forbidden of ["secrets.", "GITHUB_TOKEN", "GITHUB_OUTPUT", "AGENT_FACTORY_ENABLE_GITHUB_WRITES", "calculatorCli.ts"]) {
    assert.ok(!collect.includes(forbidden));
  }
});

test("private artifact is run-only, immutable and separated from source-free artifacts", () => {
  const workflow = renderCalculatorOneCycleWorkflow(factory, image);
  const upload = workflow.split("      - name: Preserve immutable private execution evidence")[1]?.split("      - name: Preserve source-free report")[0];
  assert.ok(upload);
  assert.ok(upload.includes("always() && steps.collect_private.outcome == 'success' && steps.prepare.outputs.mode == 'run'"));
  assert.ok(upload.includes("name: calculator-cycle-execution-${{ github.run_id }}"));
  assert.ok(upload.includes("path: ${{ runner.temp }}/calculator-one-cycle/execution-artifact/"));
  assert.ok(upload.includes("if-no-files-found: error"));
  assert.ok(upload.includes("overwrite: false"));
  assert.ok(!upload.includes("**"));
  assert.ok(!upload.includes("/state/"));
  assert.ok(!upload.includes("/capsule/"));
  assert.ok(!upload.includes("/runtime-report/"));
  assert.ok(workflow.includes("paths: ['.factory/calculator-one-cycle-request.json']"));
  assert.ok(!workflow.includes("workflow_dispatch"));
  assert.ok(!workflow.includes("pull_request_target"));
  assert.equal(workflow.match(/calculator-cycle-execution-/g)?.length, 1);
});
