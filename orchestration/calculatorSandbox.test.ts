import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
import type { PreparedCalculatorChanges } from "../commander/calculatorChanges.js";
import type { CalculatorPlanTask } from "./calculatorPlan.js";
import { calculatorProposalDigest } from "./calculatorExecutionEvidence.js";
import { createCalculatorSandbox, type CalculatorSandboxProcess } from "./calculatorSandbox.js";

const A = "a".repeat(40), image = "node@sha256:" + "b".repeat(64);
const task: CalculatorPlanTask = { id: "sandbox-task", role: "coder", goal: "Implement arithmetic and meaningful module tests.",
  acceptanceIds: ["addition", "negative-result", "multiplication", "division", "decimals", "decimal-display", "zero-recovery"],
  paths: ["src/calculator.mjs", "test/calculator.test.mjs"], dependsOn: [] };
function changes(): PreparedCalculatorChanges {
  return { repository: CALCULATOR_PROFILE.repository, baseRef: "feat/calculator-agent/sandbox-pilot", baseSha: A, summary: "Add arithmetic and tests",
    files: [{ path: "src/calculator.mjs", content: "export const calculate = (a, op, b) => a + b;", message: "Add module" },
      { path: "test/calculator.test.mjs", content: "import test from 'node:test'; test('example', () => {});", message: "Add tests" }], reviewEvidence: "fixture-not-model-evidence",
    gates: { secretScan: "passed", policyReview: "passed", independentReview: "required", tests: "required", publicationAuthorized: false } };
}
function fixture(options: { main?: (args: readonly string[], manifest: { expected: string[] }) => { code: number | null; stdout: string; stderr: string; timedOut?: boolean }; preflight?: string; baseSources?: ReadonlyMap<string, string> } = {}) {
  const calls: readonly string[][] = [] as string[][], staged: string[] = [];
  const mutableCalls = calls as string[][];
  const runner: CalculatorSandboxProcess = async (args, processOptions) => {
    mutableCalls.push([...args]);
    assert.ok(!("GITHUB_TOKEN" in processOptions.env)); assert.ok(!("GROQ_API_KEY" in processOptions.env)); assert.ok(!("DOCKER_HOST" in processOptions.env));
    assert.equal(args[0], "--host=unix:///var/run/docker.sock"); assert.equal(processOptions.env.DOCKER_CONFIG, "/tmp/reviewed-docker-config");
    if (args.includes("info")) return options.preflight === "daemon" ? { code: 1, stdout: "", stderr: "private daemon diagnostics" } : { code: 0, stdout: "27.1.1\n", stderr: "" };
    if (args.includes("inspect")) return options.preflight === "image" ? { code: 1, stdout: "", stderr: "private image diagnostics" } : { code: 0, stdout: JSON.stringify([image]), stderr: "" };
    if (args.includes("--version")) return { code: 0, stdout: options.preflight === "runtime" ? "v20.18.0\n" : "v22.16.0\n", stderr: "" };
    if (args.includes("rm")) return { code: 0, stdout: "", stderr: "" };
    const mount = args.find(arg => arg.endsWith(",dst=/manifest.json,readonly")); assert.ok(mount);
    const path = mount!.split("src=")[1].split(",dst=")[0], manifest = JSON.parse(readFileSync(path, "utf8"));
    staged.push(path.slice(0, -"manifest.json".length));
    assert.equal(statSync(path).mode & 0o777, 0o600); assert.equal(statSync(staged.at(-1)!).mode & 0o777, 0o700);
    assert.equal(statSync(join(staged.at(-1)!, "app/src/calculator.mjs")).mode & 0o777, 0o600);
    return options.main?.(args, manifest) ?? { code: 0, stdout: JSON.stringify({ version: 1, status: "passed", checks: manifest.expected, failures: [] }), stderr: "" };
  };
  const sandbox = createCalculatorSandbox({ image, baseSha: A, baseSources: options.baseSources ?? new Map() }, {
    PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_CONFIG: "/tmp/reviewed-docker-config", GITHUB_TOKEN: "fixture-token", GROQ_API_KEY: "fixture-key", DOCKER_HOST: "tcp://wrong-daemon:2375",
  }, runner);
  const proposal = changes();
  return { sandbox, proposal, calls: mutableCalls, staged, input: { task, changes: proposal, proposalDigest: calculatorProposalDigest(proposal) } };
}

test("host-pinned Docker preflight fails closed before source execution", async t => {
  for (const name of ["daemon", "image", "runtime"]) await t.test(name, async () => {
    const f = fixture({ preflight: name });
    const readiness = await f.sandbox.preflight(); assert.equal(readiness.ready, false);
    const result = await f.sandbox.checkProposal(f.input);
    assert.equal(result.status, "unverified"); assert.equal(result.testsExecuted, false); assert.equal(f.staged.length, 0);
    assert.ok(!JSON.stringify(result).includes("private"));
  });
});
test("mutable tags, arbitrary repositories and absent image digests never reach Docker", async t => {
  for (const candidate of ["node:22", "attacker/node@sha256:" + "b".repeat(64), image + " --privileged", "", "node@sha256:short"]) await t.test(candidate || "empty", async () => {
    let calls = 0;
    const sandbox = createCalculatorSandbox({ image: candidate, baseSha: A, baseSources: new Map() }, {}, async () => { calls++; throw new Error("not called"); });
    assert.equal((await sandbox.preflight()).reasonCode, "configuration_unverified"); assert.equal(calls, 0);
  });
});
test("successful trusted harness evidence is bound to task, base and full proposal digest", async () => {
  const f = fixture(); const result = await f.sandbox.checkProposal(f.input);
  assert.equal(result.status, "passed"); assert.equal(result.testsExecuted, true); assert.deepEqual(result.failures, []);
  assert.equal(result.repository, CALCULATOR_PROFILE.repository); assert.equal(result.taskId, task.id); assert.equal(result.baseSha, A);
  assert.equal(result.proposalDigest, calculatorProposalDigest(f.proposal)); assert.equal(f.staged.length, 1);
  assert.ok(!existsSync(f.staged[0])); assert.equal(f.calls.filter(args => args.some(arg => arg.startsWith("--name="))).length, 1);
  assert.ok(f.calls.some(args => args.includes("rm") && args.includes("--force")));
});
test("runtime command has no network, Docker socket, secrets, writable app or arbitrary shell", async () => {
  const f = fixture(); await f.sandbox.checkProposal(f.input);
  const args = f.calls.find(args => args.some(arg => arg.startsWith("--name=")))!;
  for (const required of ["--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=32", "--memory=256m", "--cpus=1", "--entrypoint=/usr/local/bin/node", "--disable-sigusr1", "/harness.mjs"])
    assert.ok(args.includes(required), required);
  assert.ok(args.some(arg => arg.includes("dst=/app,readonly"))); assert.ok(args.some(arg => arg.includes("dst=/harness.mjs,readonly")));
  for (const forbidden of ["--privileged", "--network=host", "docker.sock,", "/workspace", "fixture-token", "fixture-key", "sh", "-c"])
    assert.ok(!args.some(arg => arg === forbidden || arg.includes(forbidden + ",")), forbidden);
  for (const required of ["--env=HTTP_PROXY=", "--env=HTTPS_PROXY=", "--env=FTP_PROXY=", "--env=ftp_proxy=", "--env=ALL_PROXY=", "--env=NODE_OPTIONS="]) assert.ok(args.includes(required));
});
test("known failed acceptance checks are source-free failed execution, not unverified or success", async () => {
  const f = fixture({ main: (_args, manifest) => ({ code: 1, stdout: JSON.stringify({ version: 1, status: "failed", checks: manifest.expected, failures: ["decimal-display", "zero-recovery"] }), stderr: "private candidate stack trace" }) });
  const result = await f.sandbox.checkProposal(f.input);
  assert.equal(result.status, "failed"); assert.equal(result.testsExecuted, true); assert.equal(result.failures.length, 2);
  assert.ok(result.failures[0].includes("decimal-display")); assert.ok(!JSON.stringify(result).includes("private"));
});
test("empty exit-zero output, malformed proof, missing checks and unrecognized messages cannot pass", async t => {
  for (const name of ["empty", "bad-json", "missing-check", "extra-field", "unknown-failure", "exit-mismatch", "timeout", "docker-error"]) await t.test(name, async () => {
    const f = fixture({ main: (_args, manifest) => {
      if (name === "empty") return { code: 0, stdout: "", stderr: "" };
      if (name === "bad-json") return { code: 0, stdout: "private source dump", stderr: "" };
      if (name === "timeout") return { code: null, timedOut: true, stdout: "", stderr: "" };
      if (name === "docker-error") return { code: 125, stdout: "", stderr: "private Docker error" };
      const proof: Record<string, unknown> = { version: 1, status: "passed", checks: manifest.expected, failures: [] };
      if (name === "missing-check") proof.checks = ["syntax"];
      if (name === "extra-field") proof.source = "private source";
      if (name === "unknown-failure") { proof.status = "failed"; proof.failures = ["private source"]; }
      return { code: name === "exit-mismatch" || name === "unknown-failure" ? 1 : 0, stdout: JSON.stringify(proof), stderr: "" };
    } });
    const result = await f.sandbox.checkProposal(f.input);
    assert.equal(result.status, "unverified"); assert.equal(result.testsExecuted, false);
    assert.ok(!JSON.stringify(result).includes("private")); assert.equal(f.staged.length, 1); assert.ok(!existsSync(f.staged[0]));
  });
});
test("wrong digest, base, role or escaping paths stop before preflight and staging", async t => {
  for (const name of ["digest", "base", "role", "path", "repository", "surrogate", "secret", "missing-core"]) await t.test(name, async () => {
    const f = fixture(); const proposal = changes();
    const currentTask = { ...task, paths: [...task.paths] };
    if (name === "base") Object.assign(proposal, { baseSha: "c".repeat(40) });
    if (name === "role") Object.assign(currentTask, { role: "security" });
    if (name === "path") Object.assign(proposal.files[0], { path: "../escape.mjs" });
    if (name === "repository") Object.assign(proposal, { repository: "erman-ksv/Onay" });
    if (name === "surrogate") Object.assign(proposal.files[0], { content: "\ud800" });
    if (name === "secret") Object.assign(proposal.files[0], { content: "const key = 'ghp_" + "A".repeat(32) + "';" });
    if (name === "missing-core") { Object.assign(proposal, { files: [proposal.files[1]] }); currentTask.paths = ["test/calculator.test.mjs"]; }
    const result = await f.sandbox.checkProposal({ task: currentTask, changes: proposal, proposalDigest: name === "digest" ? "0".repeat(64) : calculatorProposalDigest(proposal) });
    assert.equal(result.status, "unverified"); assert.equal(result.testsExecuted, false); assert.equal(f.calls.length, 0); assert.equal(f.staged.length, 0);
  });
});
test("host base map is copied and only allowlisted files enter the staged payload", async () => {
  const sources = new Map([["index.html", "original UI source"]]); let staged = "";
  const f = fixture();
  const sandbox = createCalculatorSandbox({ image, baseSha: A, baseSources: sources }, {}, async (args, options) => {
    // Reuse a fixture process without reading the process environment.
    if (args.includes("info")) return { code: 0, stdout: "27.1.1", stderr: "" };
    if (args.includes("inspect")) return { code: 0, stdout: JSON.stringify([image]), stderr: "" };
    if (args.includes("--version")) return { code: 0, stdout: "v22.16.0", stderr: "" };
    if (args.includes("rm")) return { code: 0, stdout: "", stderr: "" };
    const mount = args.find(arg => arg.includes(",dst=/manifest.json,"))!;
    const manifestPath = mount.split("src=")[1].split(",dst=")[0];
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")); staged = manifestPath.slice(0, -"manifest.json".length);
    assert.equal(readFileSync(join(staged, "app/index.html"), "utf8"), "original UI source");
    assert.ok(!existsSync(join(staged, "app/.env"))); assert.ok(options.timeoutMs <= 30_000);
    return { code: 0, stdout: JSON.stringify({ version: 1, status: "passed", checks: manifest.expected, failures: [] }), stderr: "" };
  });
  sources.set("index.html", "changed host source"); sources.set(".env", "not approved");
  const result = await sandbox.checkProposal(f.input); assert.equal(result.status, "passed"); assert.ok(!existsSync(staged));
});
test("invalid base source scope and resource bounds fail configuration without running a process", async () => {
  for (const config of [
    { image, baseSha: A, baseSources: new Map([[".env", "not approved"]]) },
    { image, baseSha: A, baseSources: new Map<string, string>(), timeoutMs: 30_001 },
    { image, baseSha: "short", baseSources: new Map<string, string>() },
  ]) {
    let calls = 0; const sandbox = createCalculatorSandbox(config, {}, async () => { calls++; throw new Error("not called"); });
    assert.equal((await sandbox.preflight()).ready, false); assert.equal(calls, 0);
  }
});
test("frontend task evidence requires its explicit structural check and retains arithmetic regressions", async () => {
  const f = fixture({ baseSources: new Map([["src/calculator.mjs", "export const calculate = (a, op, b) => a + b;"]]),
    main: (_args, manifest) => {
      assert.deepEqual(manifest.expected, ["syntax", "fixed-arithmetic", "ui-structure"]);
      return { code: 0, stdout: JSON.stringify({ version: 1, status: "passed", checks: ["syntax", "fixed-arithmetic"], failures: [] }), stderr: "" };
    } });
  const proposal: PreparedCalculatorChanges = { ...f.proposal, files: [
    { path: "index.html", content: "<html><meta name='viewport'><output></output><button>1</button><script type='module' src='./src/app.mjs'></script><link href='./styles.css'></html>", message: "Add controls" },
    { path: "styles.css", content: "body { margin: 0; }", message: "Add mobile styles" },
    { path: "src/app.mjs", content: "console.log('fixture app');", message: "Add interaction" },
  ] };
  const uiTask: CalculatorPlanTask = { ...task, role: "frontend", paths: proposal.files.map(file => file.path), acceptanceIds: ["keyboard", "narrow-screen"] };
  const result = await f.sandbox.checkProposal({ task: uiTask, changes: proposal, proposalDigest: calculatorProposalDigest(proposal) });
  assert.equal(result.status, "unverified"); assert.equal(result.testsExecuted, false);
});
test("trusted supervisor keeps assertions outside the candidate process and fixes all arithmetic answers", () => {
  const script = readFileSync(new URL("../config/calculator-harness/check.mjs", import.meta.url), "utf8");
  for (const fragment of ["left: 2, op: '+', right: 3, expected: 5", "left: 7, op: '-', right: 10, expected: -3",
    "left: 6, op: '*', right: 4, expected: 24", "left: 9, op: '/', right: 3, expected: 3", "left: 0.5, op: '*', right: 4, expected: 2",
    "left: 0.1, op: '+', right: 0.2, expected: 0.3", "left: 8, op: '/', right: 0, error: true", "--permission", "--allow-fs-read=/app", "result.code !== 0"])
    assert.ok(script.includes(fragment), fragment);
  assert.ok(!script.includes("await import('/app/src/calculator.mjs')"));
});
