import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { AiExecutionSession } from "../commander/aiExecution.js";
import type { AiCommanderOptions, runAiCommander } from "../commander/aiCommander.js";
import {
  LIVE_CYCLE_AUDIT_GOAL, LIVE_CYCLE_CHANGE_GOAL, LIVE_CYCLE_PATHS, LIVE_CYCLE_REPOSITORY,
  parseLiveCycleArgs, redactLiveCycleSecrets, runLiveCycleCli, runLiveCycleForTest, verifyLiveCycleStage,
} from "./liveCycle.js";

const baseSha = "a".repeat(40);
const candidateSha = "b".repeat(40);
const branch = "feat/live-cycle-journal-test";
const env = {
  OPENAI_API_KEY: "test-openai-credential-not-real",
  GEMINI_API_KEY: "test-gemini-credential-not-real",
  GITHUB_TOKEN: "test-github-credential-not-real",
  AGENT_ALLOWED_REPOSITORIES: LIVE_CYCLE_REPOSITORY,
  AGENT_FACTORY_ENABLE_GITHUB_WRITES: "true",
};
type Result = Awaited<ReturnType<typeof runAiCommander>>;

function output(t: TestContext) {
  const parent = mkdtempSync(join(tmpdir(), "factory-live-unit-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, directory: join(parent, "evidence") };
}

function args(directory: string, publish = false) {
  return ["--base-sha", baseSha, "--output-dir", directory, ...(publish ? [
    "--publish", "--branch", branch, "--title", "Verify unique journal IDs", "--body", "Unit-test simulation only.",
  ] : [])];
}

/** Injected host-session simulation; it never calls a model, SDK runner, or GitHub. */
function simulatedExecutor(calls: string[], mutate?: (result: Result, audit: boolean, options: AiCommanderOptions) => void) {
  return async (goal: string, options: AiCommanderOptions): Promise<Result> => {
    calls.push(goal);
    assert.equal(options.baseRef, "fix/verified-agent-execution");
    assert.equal(options.expectedBaseSha, baseSha);
    assert.equal(options.env?.AGENT_FACTORY_PROVIDER, "gemini");
    assert.equal(options.model, undefined);
    assert.equal(options.dependencies, undefined);
    const audit = goal === LIVE_CYCLE_AUDIT_GOAL;
    if (audit) {
      assert.equal(options.publication, undefined);
      assert.equal(options.allowedChangePaths, undefined);
    } else {
      assert.equal(goal, LIVE_CYCLE_CHANGE_GOAL);
      assert.deepEqual(options.allowedChangePaths, LIVE_CYCLE_PATHS);
      assert.equal(options.publication?.branch, branch);
    }
    const session = new AiExecutionSession({
      goal, repository: LIVE_CYCLE_REPOSITORY, ref: options.baseRef!,
      auditOnly: audit, requiredActors: audit ? ["explorer", "security", "tester"] : ["explorer", "coder", "security", "reviewer", "tester"],
      writesEnabled: !audit, journal: options.journal, publication: options.publication, allowedChangePaths: options.allowedChangePaths,
    }, {
      getHead: async () => baseSha,
      getCandidateHead: async () => candidateSha,
      explore: async sha => ({ repository: LIVE_CYCLE_REPOSITORY, ref: sha, files: [{ path: LIVE_CYCLE_PATHS[0], sha, content: "// Test fixture context only." }] }),
      generate: async () => ({ summary: "Test fixture proposal", files: LIVE_CYCLE_PATHS.map(path => ({ path, content: "// Test fixture proposal only.", message: "Test fixture" })) }),
      review: () => ({ agent: "reviewer", ready: true, findings: [] }),
      scan: () => ({ agent: "security", status: "clean", findings: [] }),
      inspectSecurity: async sha => ({ agent: "security", repository: LIVE_CYCLE_REPOSITORY, ref: sha, status: "clean", findings: [] }),
      discoverTests: async () => ({ scripts: ["test: test-fixture"] }),
      publish: async () => ({ head_sha: candidateSha, html_url: `https://github.com/${LIVE_CYCLE_REPOSITORY}/pull/123`, number: 123 }),
      verify: async (sha, ref) => ({
        testsExecuted: true, repository: LIVE_CYCLE_REPOSITORY, ref, expectedSha: sha, status: "passed",
        evidence: [{ runId: 123, name: "CI fixture", headSha: sha, conclusion: "success", url: `https://github.com/${LIVE_CYCLE_REPOSITORY}/actions/runs/123` }],
        checks: [], notes: [],
      }),
    });
    await session.invoke("explorer", "explore_onay", () => session.explore());
    if (!audit) {
      await session.invoke("coder", "code_onay", () => session.generate());
      await session.invoke("reviewer", "final_review", () => session.reviewChanges());
    }
    await session.invoke("security", "security_review", () => session.inspectSecurity());
    if (!audit) await session.invoke("github", "publish_change_set", () => session.publish());
    await session.invoke("tester", "test_onay", () => session.test());
    if (!audit) await session.verifyFinalCandidate();
    const result: Result = { ...session.finish("Injected test executor completed its simulation."), legalReview: "enabled" as const };
    mutate?.(result, audit, options);
    return result;
  };
}

test("live-cycle parsing defaults to Gemini audit with a pinned base and requires explicit publication metadata", () => {
  const options = parseLiveCycleArgs(args("/tmp/new-cycle-output"));
  assert.equal(options.provider, "gemini");
  assert.equal(parseLiveCycleArgs([...args("/tmp/new-cycle-output"), "--provider", "openai"]).provider, "openai");
  assert.equal(options.baseRef, "fix/verified-agent-execution");
  assert.equal(options.publish, false);
  assert.throws(() => parseLiveCycleArgs(["--base-sha", "abc123", "--output-dir", "/tmp/new"]), /full immutable commit SHA/);
  assert.throws(() => parseLiveCycleArgs(["--base-sha", baseSha, "--output-dir", "relative"]), /absolute/);
  assert.throws(() => parseLiveCycleArgs([...args("/tmp/new"), "--provider", "other"]), /openai or gemini/);
  assert.throws(() => parseLiveCycleArgs([...args("/tmp/new"), "--publish"]), /--branch is required/);
  assert.throws(() => parseLiveCycleArgs([...args("/tmp/new"), "--branch", branch]), /requires --publish/);
  assert.throws(() => parseLiveCycleArgs([...args("/tmp/new", true), "--provider", "openai", "--provider", "gemini"]), /Duplicate/);
  assert.throws(() => parseLiveCycleArgs([...args("/tmp/new"), "--api-key", "never-print-this-key"]), /Credentials must be supplied/);
});

test("publication rejects the base itself and protected or alternate branch spellings before any execution", () => {
  for (const invalidBranch of ["fix/verified-agent-execution", "main", "master", "refs/heads/feature", "bad..ref"]) {
    const publishArgs = args("/tmp/new", true);
    publishArgs[publishArgs.indexOf("--branch") + 1] = invalidBranch;
    assert.throws(() => parseLiveCycleArgs(publishArgs), /must differ|protected|Invalid repository branch ref/);
  }
});

test("help performs no provider configuration, file writes, or execution", async () => {
  let invoked = false;
  const result = await runLiveCycleForTest(["--help"], {}, async () => { invoked = true; throw new Error("Unexpected executor"); });
  assert.equal("mode" in result && result.mode, "help");
  assert.equal(invoked, false);
});

test("all live preflight credential, allowlist, and write gates fail closed without requests", async t => {
  const { parent } = output(t);
  const cases: Array<{ patch: NodeJS.ProcessEnv; publish?: boolean; expected: RegExp }> = [
    { patch: { GEMINI_API_KEY: "" }, expected: /GEMINI_API_KEY/ },
    { patch: { GITHUB_TOKEN: "" }, expected: /GITHUB_TOKEN/ },
    { patch: { AGENT_ALLOWED_REPOSITORIES: "" }, expected: /not allow-listed/ },
    { patch: { AGENT_ALLOWED_REPOSITORIES: "other/repository" }, expected: /not allow-listed/ },
    { patch: { AGENT_FACTORY_ENABLE_GITHUB_WRITES: "false" }, publish: true, expected: /both --publish/ },
  ];
  let executions = 0;
  for (const [index, entry] of cases.entries()) {
    const directory = join(parent, "case-" + index);
    const result = await runLiveCycleForTest(args(directory, entry.publish), { ...env, ...entry.patch }, async () => { executions++; throw new Error("Unexpected executor"); });
    assert.ok("status" in result);
    assert.equal(result.status, "blocked");
    assert.match(result.reasons.join("; "), entry.expected);
    assert.equal(result.liveProviderVerified, false);
    assert.deepEqual(readdirSync(directory), ["evidence.json"]);
  }
  assert.equal(executions, 0);
});

test("production entry point rejects missing selected credentials before loading or running a provider", async t => {
  const { directory } = output(t);
  const result = await runLiveCycleCli(args(directory), { ...env, GEMINI_API_KEY: "" });
  assert.ok("status" in result);
  assert.equal(result.executionMode, "live-provider");
  assert.equal(result.status, "blocked");
  assert.equal(result.liveProviderVerified, false);
  assert.match(result.reasons.join("; "), /GEMINI_API_KEY/);
});

test("explicit provider selection never falls back to the other available key", async t => {
  const { directory } = output(t);
  let invoked = false;
  const result = await runLiveCycleForTest([...args(directory), "--provider", "gemini"], { ...env, GEMINI_API_KEY: "" }, async () => { invoked = true; throw new Error("Unexpected fallback"); });
  assert.ok("status" in result);
  assert.match(result.reasons.join("; "), /GEMINI_API_KEY/);
  assert.equal(invoked, false);
});

test("explicit OpenAI selection fails without its key even when the selected-runtime Gemini key exists", async t => {
  const { directory } = output(t);
  let invoked = false;
  const result = await runLiveCycleForTest([...args(directory), "--provider", "openai"], { ...env, OPENAI_API_KEY: "" }, async () => { invoked = true; throw new Error("Unexpected fallback"); });
  assert.ok("status" in result);
  assert.match(result.reasons.join("; "), /OPENAI_API_KEY/);
  assert.equal(invoked, false);
});

test("successful simulated audit persists ordered journal and proves no file changes or live-provider execution", async t => {
  const { directory } = output(t);
  const calls: string[] = [];
  const result = await runLiveCycleForTest(args(directory), env, simulatedExecutor(calls));
  assert.ok("status" in result);
  assert.equal(result.status, "audit-passed", result.reasons.join("; "));
  assert.equal(result.taskAcceptance, "not-applicable");
  assert.equal(result.executionMode, "test-executor");
  assert.equal(result.liveProviderVerified, false);
  assert.equal(result.change, undefined);
  assert.deepEqual(calls, [LIVE_CYCLE_AUDIT_GOAL]);
  assert.deepEqual(result.audit?.result.evidence.changedFiles, []);
  const events = readFileSync(join(directory, "audit.events.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(events, result.audit?.result.events);
  assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index + 1));
  assert.equal(events[0].type, "task_received");
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(directory, "evidence.json")).mode & 0o777, 0o600);
});

test("failed audit blocks the change stage even with publication enabled", async t => {
  const { directory } = output(t);
  const calls: string[] = [];
  const result = await runLiveCycleForTest(args(directory, true), env, simulatedExecutor(calls, candidate => {
    candidate.evidence.testsExecuted = false;
    candidate.status = "needs-review";
    candidate.reasons.push("Pending CI.");
  }));
  assert.ok("status" in result);
  assert.equal(result.status, "blocked");
  assert.equal(result.taskAcceptance, "not-applicable");
  assert.deepEqual(calls, [LIVE_CYCLE_AUDIT_GOAL]);
  assert.equal(result.change, undefined);
  assert.ok(result.reasons.every(reason => reason.startsWith("Audit:")));
});

test("a verified simulation requires publication, new exact SHA, scoped files, CI, final-head tool and every actor", async t => {
  const { directory } = output(t);
  const calls: string[] = [];
  const result = await runLiveCycleForTest(args(directory, true), env, simulatedExecutor(calls));
  assert.ok("status" in result);
  assert.equal(result.status, "completed", result.reasons.join("; "));
  assert.equal(result.taskAcceptance, "requires-independent-review");
  assert.deepEqual(calls, [LIVE_CYCLE_AUDIT_GOAL, LIVE_CYCLE_CHANGE_GOAL]);
  assert.equal(result.change?.result.evidence.publication?.head_sha, candidateSha);
  assert.equal(result.change?.result.evidence.tests?.expectedSha, candidateSha);
  assert.equal(result.change?.result.evidence.testsExecuted, true);
  assert.deepEqual(result.change?.result.evidence.changedFiles, LIVE_CYCLE_PATHS);
  assert.equal(result.liveProviderVerified, false);
  assert.match(result.note, /never proof of a live model run/);
  assert.match(result.note, /Requested bug behavior remains pending independent diff and behavior review/);
  assert.deepEqual(readdirSync(directory).sort(), ["audit.events.jsonl", "audit.result.json", "change.events.jsonl", "change.result.json", "evidence.json"]);
});

test("an attempted change stage retains pending independent task acceptance even when execution blocks", async t => {
  const { directory } = output(t);
  const result = await runLiveCycleForTest(args(directory, true), env, simulatedExecutor([], (candidate, audit) => {
    if (!audit) {
      candidate.status = "needs-review";
      candidate.reasons.push("The generated implementation still needs review.");
    }
  }));
  assert.ok("status" in result);
  assert.equal(result.status, "blocked");
  assert.equal(result.taskAcceptance, "requires-independent-review");
  assert.equal(result.liveProviderVerified, false);
});

test("host verification rejects missing, stale, unknown and inconsistent success evidence", async t => {
  const { directory } = output(t);
  let changeResult: Result | undefined;
  await runLiveCycleForTest(args(directory, true), env, simulatedExecutor([], (result, audit) => { if (!audit) changeResult = structuredClone(result); }));
  assert.ok(changeResult);
  const options = parseLiveCycleArgs(args("/tmp/unused", true));
  const alterations: Array<[string, (result: Result) => void, RegExp]> = [
    ["status", result => { result.status = "needs-review"; }, /not completed/],
    ["missing actor", result => { result.missingActors = ["reviewer"]; }, /actors did not all/],
    ["reasons", result => { result.reasons.push("Unresolved failure"); }, /reported reasons/],
    ["base", result => { result.evidence.baseSha = candidateSha; }, /immutable base/],
    ["head", result => { result.evidence.publication!.head_sha = "unknown"; }, /full new publication/],
    ["same head", result => { result.evidence.publication!.head_sha = baseSha; }, /full new publication/],
    ["PR number", result => { result.evidence.publication!.number = 0; }, /PR metadata/],
    ["branch", result => { result.evidence.publicationBranch = "feat/other"; }, /authorized branch/],
    ["files", result => { result.evidence.changedFiles = ["commander/commander.ts"]; }, /two permitted journal paths/],
    ["proposed files", result => { result.evidence.proposedFiles.push("package.json"); }, /two permitted journal paths/],
    ["old tests", result => { result.evidence.tests!.expectedSha = baseSha; }, /exact stage commit/],
    ["unexecuted", result => { result.evidence.testsExecuted = false; }, /not executed/],
    ["missing runs", result => { result.evidence.tests!.evidence = []; }, /CI metadata/],
    ["missing final head", result => { result.events = result.events.filter(event => event.details?.tool !== "verify_final_head"); }, /verify_final_head/],
    ["missing started", result => { result.events = result.events.filter(event => !(event.type === "tool_started" && event.details?.tool === "code_onay")); }, /code_onay/],
    ["missing verified event", result => { result.events = result.events.filter(event => !(event.type === "verification_passed" && event.actor === "tester")); }, /journal does not confirm test/],
  ];
  for (const [name, alter, expected] of alterations) {
    const result = structuredClone(changeResult);
    alter(result);
    assert.match(verifyLiveCycleStage(result, options, "change").join("; "), expected, name);
  }
});

test("audit evidence cannot report changes or invoke mutation tools", async t => {
  const { directory } = output(t);
  const result = await runLiveCycleForTest(args(directory), env, simulatedExecutor([], candidate => {
    candidate.evidence.changedFiles = [LIVE_CYCLE_PATHS[0]];
  }));
  assert.ok("status" in result);
  assert.equal(result.status, "blocked");
  assert.match(result.reasons.join("; "), /Read-only audit contains mutation/);
});

test("audit requires successful exact-base test evidence and strictly read-only metadata", async t => {
  const { directory } = output(t);
  let auditResult: Result | undefined;
  await runLiveCycleForTest(args(directory), env, simulatedExecutor([], result => { auditResult = structuredClone(result); }));
  assert.ok(auditResult);
  const options = parseLiveCycleArgs(args("/tmp/unused"));
  const alterations: Array<[(result: Result) => void, RegExp]> = [
    [result => { result.evidence.testsExecuted = false; }, /not executed/],
    [result => { result.evidence.tests!.testsExecuted = false; }, /not executed/],
    [result => { result.evidence.tests!.expectedSha = candidateSha; }, /exact stage commit/],
    [result => { result.evidence.tests!.ref = "other/base"; }, /exact stage commit/],
    [result => { result.evidence.tests!.evidence[0].headSha = candidateSha; }, /exact stage commit/],
    [result => { result.evidence.tests!.evidence[0].conclusion = "skipped"; }, /exact stage commit/],
    [result => { result.evidence.publicationBranch = branch; }, /Read-only audit/],
    [result => { result.evidence.security!.proposed = { agent: "security", status: "clean", findings: [] }; }, /Read-only audit/],
    [result => { result.evidence.proposedFiles = [LIVE_CYCLE_PATHS[0]]; }, /Read-only audit/],
    [result => { result.events[0].details = { tool: "publish_change_set" }; }, /Read-only audit/],
  ];
  for (const [alter, expected] of alterations) {
    const result = structuredClone(auditResult);
    alter(result);
    assert.match(verifyLiveCycleStage(result, options, "audit").join("; "), expected);
  }
});

test("detached or invented result events cannot replace the streamed task journal", async t => {
  const { directory } = output(t);
  const result = await runLiveCycleForTest(args(directory), env, simulatedExecutor([], candidate => {
    candidate.events[0].message = "Invented event detached from the task journal";
  }));
  assert.ok("status" in result);
  assert.equal(result.status, "blocked");
  assert.match(result.reasons.join("; "), /do not match the persisted task journal/);
});

test("provider and GitHub credentials are redacted recursively in outputs, errors and event artifacts", async t => {
  const { directory } = output(t);
  const result = await runLiveCycleForTest(args(directory), env, simulatedExecutor([], (candidate, _audit, options) => {
    options.journal!.record("tool_failed", "test-fixture", `${env.OPENAI_API_KEY} ${env.GEMINI_API_KEY} ${env.GITHUB_TOKEN}`, {
      nested: { [env.GITHUB_TOKEN]: [env.OPENAI_API_KEY, env.GEMINI_API_KEY] },
    });
    candidate.output = env.OPENAI_API_KEY;
    candidate.events = options.journal!.snapshot();
  }));
  const serialized = JSON.stringify(result);
  for (const secret of [env.OPENAI_API_KEY, env.GEMINI_API_KEY, env.GITHUB_TOKEN]) {
    assert.ok(!serialized.includes(secret));
    for (const artifact of readdirSync(directory)) assert.ok(!readFileSync(join(directory, artifact), "utf8").includes(secret), artifact);
  }
  assert.match(serialized, /\[REDACTED\]/);
  assert.deepEqual(redactLiveCycleSecrets({ [env.GITHUB_TOKEN]: [{ deep: env.OPENAI_API_KEY }] }, env), {
    "[REDACTED]": [{ deep: "[REDACTED]" }],
  });
});

test("existing output directories and symlink parents fail before execution and are not overwritten", async t => {
  const { parent } = output(t);
  let called = false;
  const executor = async () => { called = true; throw new Error("Unexpected executor"); };
  await assert.rejects(runLiveCycleForTest(args(parent), env, executor), /EEXIST/);
  const link = join(parent, "linked-parent");
  symlinkSync(parent, link);
  await assert.rejects(runLiveCycleForTest(args(join(link, "result")), env, executor), /without symlinks/);
  assert.equal(called, false);
});

test("known credentials embedded in publication metadata are rejected before a request or artifact write", async t => {
  const { parent, directory } = output(t);
  const publishArgs = args(directory, true);
  publishArgs[publishArgs.indexOf("--body") + 1] = "Accidental credential: " + env.GITHUB_TOKEN;
  let called = false;
  await assert.rejects(runLiveCycleForTest(publishArgs, env, async () => { called = true; throw new Error("Unexpected executor"); }), /must not appear/);
  assert.equal(called, false);
  assert.deepEqual(readdirSync(parent), []);
});

test("executor failure persists blocked evidence without claiming that remote writes were rolled back", async t => {
  const { directory } = output(t);
  const result = await runLiveCycleForTest(args(directory), env, async () => {
    throw new Error(`Remote request failed: ${env.GITHUB_TOKEN}`);
  });
  assert.ok("status" in result);
  assert.equal(result.status, "blocked");
  assert.equal(result.liveProviderVerified, false);
  assert.match(readFileSync(join(directory, "evidence.json"), "utf8"), /Remote request failed: \[REDACTED\]/);
  assert.equal(readFileSync(join(directory, "audit.events.jsonl"), "utf8").trim().split("\n").length, 1);
});

