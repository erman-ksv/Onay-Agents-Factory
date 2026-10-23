import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createCalculatorBrowserSandbox } from "./calculatorBrowserSandbox.js";
import { calculatorProposalDigest } from "./calculatorExecutionEvidence.js";
import { CALCULATOR_UI_BROWSER_SCENARIOS, CALCULATOR_KEYBOARD_BROWSER_SCENARIOS } from "./calculatorAssessmentEvidence.js";
import { createCalculatorPlan } from "./calculatorPlan.js";
import type { PreparedCalculatorChanges } from "../commander/calculatorChanges.js";
import type { CalculatorSandboxProcess } from "./calculatorSandbox.js";

const saved = JSON.parse(readFileSync(new URL("./fixtures/calculatorStep7SavedPlan.json", import.meta.url), "utf8"));
const plan = createCalculatorPlan(saved.request, saved.proposal), task = plan.tasks[1]!;
const image = "mcr.microsoft.com/playwright@sha256:" + "1".repeat(64), core = "export function calculate(left, operator, right) {return left+right;}";
const changes: PreparedCalculatorChanges = { repository: plan.owner.repository, baseRef: plan.branch, baseSha: "a".repeat(40),
  summary: "Offline browser protocol fixture", files: task.paths.map(path => ({ path, content: "fixture", message: "fixture" })), reviewEvidence: "{}",
  gates: { secretScan: "passed", policyReview: "passed", independentReview: "required", tests: "required", publicationAuthorized: false } };
const input = { task, changes, proposalDigest: calculatorProposalDigest(changes),
  dependencySha256: createHash("sha256").update(core).digest("hex"), baseSources: new Map([["src/calculator.mjs", core]]) };
function fixture(mode = "ready") {
  let runs = 0, cleanups = 0;
  const run: CalculatorSandboxProcess = async (args, options) => {
    assert.equal(args[0], "--host=unix:///var/run/docker.sock");
    assert.equal(options.env.GROQ_API_KEY, undefined); assert.equal(options.env.GITHUB_TOKEN, undefined);
    if (args.includes("inspect")) return { code: 0, stdout: JSON.stringify(mode === "wrong-image" ? [] : [image]), stderr: "" };
    if (args.includes("rm")) { cleanups++; return { code: 0, stdout: "", stderr: "" }; }
    runs++; assert.ok(args.includes("--network=none")); assert.ok(args.includes("--pull=never"));
    assert.ok(args.includes("--read-only")); assert.ok(args.includes("--cap-drop=ALL")); assert.ok(args.includes("--security-opt=no-new-privileges"));
    assert.ok(!args.some(a => /--privileged|--no-sandbox|--network=host|--pid=host/.test(a)));
    assert.ok(!args.some(a => a.includes("docker.sock,") || a.includes("fixture-secret")));
    const policy = args.find(a => a.startsWith("--security-opt=seccomp="))!.slice("--security-opt=seccomp=".length);
    assert.equal(JSON.parse(readFileSync(policy, "utf8")).defaultAction, "SCMP_ACT_ERRNO");
    const mount = args.find(a => a.startsWith("--mount=type=bind,src=") && a.endsWith(",dst=/manifest.json,readonly"))!;
    const path = mount.slice("--mount=type=bind,src=".length, -",dst=/manifest.json,readonly".length);
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    const proof = manifest.mode === "preflight" ? { version: 1, mode: "preflight", browser: "Chrome/155.0.0.0", ready: true,
      sandboxDisabled: mode === "unsafe-sandbox", networkIsolated: true, credentialsExcluded: true } :
      { version: 1, mode: "check", browser: "Chrome/155.0.0.0", sandboxDisabled: false, status: "passed", testsExecuted: true,
        pageErrors: 0, blockedRequests: mode === "external-request" ? 1 : 0, scenarios: manifest.suite === "keyboard" ? CALCULATOR_KEYBOARD_BROWSER_SCENARIOS : CALCULATOR_UI_BROWSER_SCENARIOS };
    return { code: mode === "runtime-failed" ? 1 : 0, stdout: mode === "malformed" ? "not JSON" : JSON.stringify(proof), stderr: "" };
  };
  return { run, runs: () => runs, cleanups: () => cleanups };
}
test("the browser uses a networkless nonprivileged container and binds proof to exact proposal/core hashes", async () => {
  const f = fixture(), runner = createCalculatorBrowserSandbox({ image }, { GROQ_API_KEY: "fixture-secret", GITHUB_TOKEN: "fixture-secret" }, f.run);
  await assert.rejects(() => runner.check(input));
  await runner.preflight(); const proof = await runner.check(input);
  assert.equal(proof.proposalDigest, input.proposalDigest); assert.equal(proof.dependencySha256, input.dependencySha256);
  assert.equal(f.runs(), 2); assert.equal(f.cleanups(), 2);
  await assert.rejects(() => runner.preflight()); await assert.rejects(() => runner.check(input)); assert.equal(f.runs(), 2);
});
test("unpinned images, wrong image, disabled sandbox, failed process or malformed proof never succeed", async t => {
  assert.throws(() => createCalculatorBrowserSandbox({ image: "mcr.microsoft.com/playwright:latest" }));
  for (const mode of ["wrong-image", "unsafe-sandbox", "runtime-failed", "malformed"]) await t.test(mode, async () => {
    const f = fixture(mode), runner = createCalculatorBrowserSandbox({ image }, {}, f.run);
    await assert.rejects(() => runner.preflight()); await assert.rejects(() => runner.preflight());
    assert.ok(f.runs() <= 1);
  });
});
test("a changed dependency hash or external request blocks proof without retry", async t => {
  for (const mode of ["hash-mismatch", "external-request"]) await t.test(mode, async () => {
    const f = fixture(mode), runner = createCalculatorBrowserSandbox({ image }, {}, f.run);
    await runner.preflight(); await assert.rejects(() => runner.check(mode === "hash-mismatch" ? { ...input, dependencySha256: "0".repeat(64) } : input));
    const runs = f.runs(); await assert.rejects(() => runner.check(input)); assert.equal(f.runs(), runs);
  });
});

test("keyboard task requires its own real-runner scenario set and cannot pass with only clear/backspace proof", async () => {
  const selected = plan.tasks[2]!;
  const changes2 = { ...changes, files: selected.paths.map(path => ({ path, content: "fixture", message: "fixture" })) };
  const f = fixture(), runner = createCalculatorBrowserSandbox({ image }, {}, f.run);
  await runner.preflight();
  const proof = await runner.check({ ...input, task: selected, changes: changes2, proposalDigest: calculatorProposalDigest(changes2),
    baseSources: new Map([["src/calculator.mjs",core],["index.html","fixture"],["styles.css","fixture"]]) });
  assert.deepEqual(proof.scenarios, CALCULATOR_KEYBOARD_BROWSER_SCENARIOS);
  assert.equal(proof.scenarios.length, 4);
});
