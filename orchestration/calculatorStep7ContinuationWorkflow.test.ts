import test from "node:test";
import assert from "node:assert/strict";
import { renderCalculatorContinuationWorkflow } from "../config/calculatorContinuationWorkflow.js";

const pin = "a".repeat(40), image = "node@sha256:" + "b".repeat(64);
test("continuation uses an immutable runtime and exactly one model-capable command behind its barrier", () => {
  const workflow = renderCalculatorContinuationWorkflow(pin, image);
  assert.ok(workflow.includes("branches: ['feat/calculator-step7-regeneration-20261020']"));
  assert.ok(workflow.includes("paths: ['.factory/calculator-step7-continuation-request.json']"));
  assert.ok(workflow.includes("ref: " + pin));
  assert.ok(workflow.includes("persist-credentials: false"));
  assert.equal(workflow.match(/calculatorStep7Continuation.ts execute/g)?.length, 1);
  assert.ok(workflow.indexOf("id: barrier") < workflow.indexOf("calculatorStep7Continuation.ts execute"));
  assert.ok(workflow.includes("CALCULATOR_CONTINUATION_BARRIER_UPLOADED: 'true'"));
  assert.ok(workflow.includes("pull '" + image + "'"));
  for (const forbidden of ["workflow_dispatch", "pull_request_target", "github.head_ref", "continue-on-error", "gemini", "OPENAI_API_KEY"]) assert.ok(!workflow.includes(forbidden));
  for (const [sha, img] of [["main", image], [pin, "node:latest"], [pin + "\nrun: bad", image]])
    assert.throws(() => renderCalculatorContinuationWorkflow(sha, img));
});
test("old evidence is downloaded by fixed identities and new artifacts cannot replace it", () => {
  const workflow = renderCalculatorContinuationWorkflow(pin, image);
  for (const value of ["artifact-ids: '12318598151'", "run-id: 39538233432", "/prior-evidence"])
    assert.ok(workflow.includes(value));
  const upload = workflow.split("      - name: Preserve immutable private continuation evidence")[1]?.split("      - name: Preserve source-free execution report")[0];
  assert.ok(upload?.includes("always() && steps.collect.outcome == 'success'"));
  assert.ok(upload?.includes("/continuation-artifact/"));
  assert.ok(upload?.includes("overwrite: false"));
  assert.ok(!upload?.includes("/prior-evidence"));
  assert.ok(!upload?.includes("**"));
});
test("only execution receives model credentials and collection stays token-free after failure", () => {
  const workflow = renderCalculatorContinuationWorkflow(pin, image);
  const prepare = workflow.split("      - name: Verify preserved proposal")[1]?.split("      - name: Persist immutable continuation barrier")[0];
  const execute = workflow.split("      - name: Continue the saved proposal")[1]?.split("      - name: Collect bounded private evidence")[0];
  const collect = workflow.split("      - name: Collect bounded private evidence")[1]?.split("      - name: Preserve immutable private continuation evidence")[0];
  assert.ok(prepare?.includes("GITHUB_TOKEN: ${{ github.token }}"));
  assert.ok(!prepare?.includes("secrets."));
  assert.ok(execute?.includes("GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}"));
  assert.ok(execute?.includes("FACTORY_HISTORY_TOKEN: ${{ github.token }}"));
  assert.ok(execute?.includes("GITHUB_TOKEN: ${{ secrets.CALCULATOR_GITHUB_TOKEN }}"));
  assert.ok(collect?.includes("always() && steps.barrier.outcome == 'success'"));
  for (const forbidden of ["secrets.", "GITHUB_TOKEN", "FACTORY_HISTORY_TOKEN", "GROQ_API_KEY", "GITHUB_OUTPUT", "--mode run"]) assert.ok(!collect?.includes(forbidden));
});
