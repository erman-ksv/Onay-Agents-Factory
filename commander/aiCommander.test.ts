import assert from "node:assert/strict";
import test from "node:test";
import { Usage, setTracingDisabled, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { createAiCommander, runAiCommander } from "./aiCommander.js";
import type { AiExecutionDependencies } from "./aiExecution.js";
import { GitHubClient } from "../github/githubClient.js";
import { AGENT_FACTORY_EXPLORER_FILES } from "../github/onayExplorer.js";

setTracingDisabled(true);
const repository = "erman-ksv/Onay-Agents-Factory";
const factoryEnv = { AGENT_ALLOWED_REPOSITORIES: repository };
const baseSha = "a".repeat(40);
const candidateSha = "b".repeat(40);
const branch = "fix/sdk-execution-test";
const names = ["explore_onay", "code_onay", "security_review", "final_review", "publish_change_set", "test_onay"];

test("default Onay handlers reject a green job that skips API integration tests", async t => {
  t.mock.method(GitHubClient.prototype, "getCommitSha", async () => baseSha);
  t.mock.method(GitHubClient.prototype, "getFile", async (path: string) => ({
    path, sha: "c".repeat(40), content: path === "package.json" ? '{"scripts":{"test":"run-tests"}}' : "export const inspected = true;",
  }));
  t.mock.method(GitHubClient.prototype, "getWorkflowRuns", async () => [{
    id: 321, run_attempt: 1, name: "CI", status: "completed", conclusion: "success", head_sha: baseSha,
    html_url: "https://github.com/erman-ksv/Onay/actions/runs/321",
  }]);
  t.mock.method(GitHubClient.prototype, "getWorkflowJobs", async () => ({ jobs: [{
    id: 1, run_id: 321, run_attempt: 1, head_sha: baseSha, name: "Typecheck and API tests", status: "completed", conclusion: "success",
    html_url: "https://github.com/erman-ksv/Onay/actions/runs/321/job/1", steps: [
      { number: 1, name: "Typecheck", status: "completed", conclusion: "success" },
      { number: 2, name: "API integration tests", status: "completed", conclusion: "skipped" },
    ],
  }] }));
  const { session } = createAiCommander("Audit Onay repository without changing files", { env: {} });
  await session.explore();
  const result = await session.test();
  assert.equal(result.testsExecuted, false);
  assert.equal("executionEvidence" in result && result.executionEvidence?.status, "failed");
});

/** The actual SDK runner dispatches these model tool calls; no provider/network is used. */
class ScriptedModel implements Model {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly tools: string[]) {}
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const index = this.requests.push(request) - 1;
    const name = this.tools[index];
    return {
      usage: new Usage(),
      output: name ? [{ type: "function_call", callId: "call-" + index, name, arguments: "{}", status: "completed" }] :
        [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Done. The files were written and all tests passed." }] }],
    };
  }
  async *getStreamedResponse(): AsyncGenerator<never> { throw new Error("This test uses non-streaming execution."); }
}

function dependencies(calls: string[]): AiExecutionDependencies {
  return {
    getHead: async () => { calls.push("resolve-base"); return baseSha; },
    getCandidateHead: async ref => { assert.equal(ref, branch); calls.push("resolve-candidate"); return candidateSha; },
    explore: async sha => { assert.equal(sha, baseSha); calls.push("read-files"); return { repository, ref: sha, files: [{ path: "commander/summary.ts", sha: "c".repeat(40), content: "export const fixed = false;" }] }; },
    generate: async context => { assert.match(context, /fixed = false/); calls.push("generate-files"); return { summary: "Fix verification", files: [{ path: "commander/summary.ts", content: "export const fixed = true;", message: "Fix verification" }] }; },
    review: files => { assert.equal(files.length, 1); calls.push("review"); return { agent: "reviewer", ready: true, findings: [] }; },
    scan: () => { calls.push("scan-proposal"); return { agent: "security", status: "clean", findings: [] }; },
    inspectSecurity: async sha => { assert.equal(sha, baseSha); calls.push("scan-repository"); return { agent: "security", repository, ref: sha, status: "clean", findings: [] }; },
    discoverTests: async () => { calls.push("discover-tests"); return { scripts: ["test: tsx --test"] }; },
    publish: async (files, sha) => { assert.equal(sha, baseSha); assert.match(files[0].content, /fixed = true/); calls.push("write-and-open-pr"); return { head_sha: candidateSha, html_url: "https://github.com/erman-ksv/Onay-Agents-Factory/pull/123", number: 123 }; },
    verify: async (sha, ref) => { assert.equal(sha, candidateSha); assert.equal(ref, branch); calls.push("verify-ci"); return {
      testsExecuted: true, repository, ref, expectedSha: sha, status: "passed",
      evidence: [{ runId: 123, name: "Agent Factory CI", headSha: sha, conclusion: "success", url: "https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/123" }],
      checks: [{ jobName: "typecheck", name: "Test", status: "completed", conclusion: "success" }], notes: [],
    }; },
  };
}

test("SDK model tool calls execute the actual Commander handlers end to end", async () => {
  const calls: string[] = [];
  const model = new ScriptedModel(names);
  const result = await runAiCommander("Fix Onay-Agents-Factory", {
    model, env: { ...factoryEnv, AGENT_FACTORY_ENABLE_GITHUB_WRITES: "true" }, dependencies: dependencies(calls),
    publication: { branch, title: "Fix verification", body: "Test candidate execution." },
  });
  assert.equal(result.status, "completed", result.reasons.join("; "));
  assert.deepEqual(calls, ["resolve-base", "read-files", "generate-files", "scan-repository", "scan-proposal", "review", "write-and-open-pr", "discover-tests", "verify-ci", "resolve-candidate", "resolve-candidate"]);
  assert.equal(model.requests.length, names.length + 1);
  assert.deepEqual(result.evidence.changedFiles, ["commander/summary.ts"]);
  assert.equal(result.evidence.tests?.expectedSha, candidateSha);
  assert.equal(result.events.filter(event => event.type === "tool_completed").length, names.length + 1);
});

test("SDK final prose without function calls cannot claim successful execution", async () => {
  const calls: string[] = [];
  const result = await runAiCommander("Fix Onay-Agents-Factory", { model: new ScriptedModel([]), env: factoryEnv, dependencies: dependencies(calls) });
  assert.equal(result.status, "blocked");
  assert.deepEqual(calls, []);
  assert.deepEqual(result.evidence.changedFiles, []);
  assert.equal(result.evidence.testsExecuted, false);
});

test("SDK tool calls cannot enable GitHub writes without the host opt-in", async () => {
  const calls: string[] = [];
  const result = await runAiCommander("Fix Onay-Agents-Factory", {
    model: new ScriptedModel(names), env: factoryEnv, dependencies: dependencies(calls),
    publication: { branch, title: "Fix verification", body: "Explicit metadata alone does not enable writes." },
  });
  assert.equal(result.status, "blocked");
  assert.ok(!calls.includes("write-and-open-pr"));
  assert.ok(!calls.includes("verify-ci"));
  assert.ok(result.events.some(event => event.type === "tool_failed" && event.details?.tool === "publish_change_set"));
});

test("branch advancement during the final model turn invalidates completed execution", async () => {
  const calls: string[] = [];
  const deps = dependencies(calls);
  let checks = 0;
  deps.getCandidateHead = async () => ++checks === 1 ? candidateSha : "d".repeat(40);
  const result = await runAiCommander("Fix Onay-Agents-Factory", {
    model: new ScriptedModel(names), env: { ...factoryEnv, AGENT_FACTORY_ENABLE_GITHUB_WRITES: "true" }, dependencies: deps,
    publication: { branch, title: "Fix verification", body: "Check head again after the final model turn." },
  });
  assert.equal(result.status, "needs-review");
  assert.equal(result.evidence.testsExecuted, false);
  assert.equal(result.evidence.tests?.status, "sha-mismatch");
  assert.equal(checks, 2);
});

test("failed final head lookup clears SDK Commander test evidence", async () => {
  const calls: string[] = [];
  const deps = dependencies(calls);
  let checks = 0;
  deps.getCandidateHead = async () => {
    if (++checks > 1) throw new Error("Final GitHub head lookup failed");
    return candidateSha;
  };
  const result = await runAiCommander("Fix Onay-Agents-Factory", {
    model: new ScriptedModel(names), env: { ...factoryEnv, AGENT_FACTORY_ENABLE_GITHUB_WRITES: "true" }, dependencies: deps,
    publication: { branch, title: "Fix verification", body: "Require successful final head verification." },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.evidence.testsExecuted, false);
  assert.equal(result.evidence.tests, undefined);
  assert.ok(result.reasons.includes("Final GitHub head lookup failed"));
  assert.ok(result.events.some(event => event.type === "tool_failed" && event.details?.tool === "verify_final_head"));
  assert.equal(checks, 2);
});

test("factory exploration keeps the existing default base and includes journal context", async t => {
  const previousAllowed = process.env.AGENT_ALLOWED_REPOSITORIES;
  process.env.AGENT_ALLOWED_REPOSITORIES = repository;
  t.after(() => {
    if (previousAllowed === undefined) delete process.env.AGENT_ALLOWED_REPOSITORIES;
    else process.env.AGENT_ALLOWED_REPOSITORIES = previousAllowed;
  });
  const requestedRefs: string[] = [];
  const readPaths: string[] = [];
  t.mock.method(GitHubClient.prototype, "getCommitSha", async (ref: string) => {
    requestedRefs.push(ref);
    return baseSha;
  });
  t.mock.method(GitHubClient.prototype, "getFile", async (path: string, ref: string) => {
    readPaths.push(path);
    assert.equal(ref, baseSha);
    return { path, sha: "c".repeat(40), content: "export const inspected = true;" };
  });
  const { session } = createAiCommander("Audit Onay-Agents-Factory without modifying files", { env: factoryEnv });
  const exploration = await session.explore();
  assert.equal(session.options.ref, "dev/agent-factory-core");
  assert.deepEqual(requestedRefs, ["dev/agent-factory-core"]);
  assert.equal(exploration.ref, baseSha);
  assert.deepEqual(readPaths, [...AGENT_FACTORY_EXPLORER_FILES]);
  assert.ok(readPaths.includes("orchestration/agentRunJournal.ts"));
  assert.ok(readPaths.includes("orchestration/agentRunJournal.test.ts"));
});

test("a host-selected pinned base is shared by exploration, security and audit verification", async t => {
  const previousAllowed = process.env.AGENT_ALLOWED_REPOSITORIES;
  process.env.AGENT_ALLOWED_REPOSITORIES = repository;
  t.after(() => {
    if (previousAllowed === undefined) delete process.env.AGENT_ALLOWED_REPOSITORIES;
    else process.env.AGENT_ALLOWED_REPOSITORIES = previousAllowed;
  });
  const baseRef = "fix/verified-agent-execution";
  const requestedRefs: string[] = [];
  const reads: Array<{ path: string; ref: string }> = [];
  const ciRefs: string[] = [];
  t.mock.method(GitHubClient.prototype, "getCommitSha", async (ref: string) => {
    requestedRefs.push(ref);
    return baseSha;
  });
  t.mock.method(GitHubClient.prototype, "getFile", async (path: string, ref: string) => {
    reads.push({ path, ref });
    return { path, sha: "c".repeat(40), content: path === "package.json"
      ? '{"scripts":{"test":"run-tests","typecheck":"run-types"}}' : "export const inspected = true;" };
  });
  t.mock.method(GitHubClient.prototype, "getWorkflowRuns", async (ref: string, sha: string) => {
    ciRefs.push(ref);
    assert.equal(sha, baseSha);
    return [{ id: 500, run_attempt: 1, name: "Agent Factory CI", status: "completed", conclusion: "success",
      head_sha: baseSha, html_url: `https://github.com/${repository}/actions/runs/500` }];
  });
  t.mock.method(GitHubClient.prototype, "getWorkflowJobs", async () => ({ jobs: [{
    id: 501, run_id: 500, run_attempt: 1, head_sha: baseSha, name: "typecheck", status: "completed", conclusion: "success",
    html_url: `https://github.com/${repository}/actions/runs/500/job/501`, steps: [
      { number: 1, name: "Typecheck", status: "completed", conclusion: "success" },
      { number: 2, name: "Test", status: "completed", conclusion: "success" },
    ],
  }] }));
  const { session } = createAiCommander("Audit Onay-Agents-Factory without modifying files", {
    env: factoryEnv, baseRef, expectedBaseSha: baseSha.toUpperCase(),
  });
  const exploration = await session.explore();
  const security = await session.inspectSecurity();
  const tests = await session.test();
  assert.equal(session.options.ref, baseRef);
  assert.equal(exploration.ref, baseSha);
  assert.equal(security.repository.ref, baseSha);
  assert.equal(tests.testsExecuted, true);
  assert.equal("executionEvidence" in tests && tests.executionEvidence?.ref, baseRef);
  assert.ok(requestedRefs.length > 0);
  assert.ok(requestedRefs.every(ref => ref === baseRef));
  assert.ok(ciRefs.length > 0);
  assert.ok(ciRefs.every(ref => ref === baseRef));
  const branchReads = reads.filter(read => read.ref !== baseSha);
  assert.deepEqual(branchReads, [{ path: "package.json", ref: baseRef }]);
});

test("a changed pinned base blocks both exploration and early discovery before reading or writing files", async t => {
  let fileReads = 0;
  let writes = 0;
  t.mock.method(GitHubClient.prototype, "getCommitSha", async () => candidateSha);
  t.mock.method(GitHubClient.prototype, "getFile", async () => { fileReads++; throw new Error("Unexpected file read"); });
  t.mock.method(GitHubClient.prototype, "createBranch", async () => { writes++; });
  const { session } = createAiCommander("Fix Onay-Agents-Factory journal IDs", {
    env: { ...factoryEnv, AGENT_FACTORY_ENABLE_GITHUB_WRITES: "true" },
    baseRef: "fix/verified-agent-execution", expectedBaseSha: baseSha,
    publication: { branch, title: "Fix journal IDs", body: "Live run." },
  });
  await assert.rejects(session.explore(), /no longer matches the expected base commit SHA/);
  await assert.rejects(session.test(), /no longer matches the expected base commit SHA/);
  await assert.rejects(session.publish(), /requires repository context/);
  assert.equal(fileReads, 0);
  assert.equal(writes, 0);
});

test("repository allowlist rejection happens before even looking up the base", async t => {
  let lookups = 0;
  t.mock.method(GitHubClient.prototype, "getCommitSha", async () => { lookups++; return baseSha; });
  const { session } = createAiCommander("Audit Onay-Agents-Factory without modifying files", {
    env: { AGENT_ALLOWED_REPOSITORIES: "someone/other-repository" },
    baseRef: "fix/verified-agent-execution", expectedBaseSha: baseSha,
  });
  await assert.rejects(session.explore(), /not allow-listed/);
  await assert.rejects(session.test(), /not allow-listed/);
  assert.equal(lookups, 0);
});

test("invalid host base refs and shortened SHAs are rejected before execution", () => {
  for (const baseRef of ["", "refs/heads/main", "main~1", "fix/bad..ref"]) {
    assert.throws(() => createAiCommander("Fix Onay-Agents-Factory", { env: factoryEnv, baseRef }), /Invalid repository branch ref/);
  }
  for (const expectedBaseSha of ["", "abc123", "x".repeat(40)]) {
    assert.throws(() => createAiCommander("Fix Onay-Agents-Factory", { env: factoryEnv, expectedBaseSha }), /full immutable commit SHA/);
  }
});

test("the expected base guard also rejects a mismatching injected source before Coder or publication", async () => {
  const calls: string[] = [];
  const result = await runAiCommander("Fix Onay-Agents-Factory", {
    model: new ScriptedModel(["explore_onay"]), env: factoryEnv, dependencies: dependencies(calls),
    baseRef: "fix/verified-agent-execution", expectedBaseSha: candidateSha,
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(calls, ["resolve-base"]);
  assert.deepEqual(result.evidence.changedFiles, []);
  assert.equal(result.evidence.baseSha, undefined);
  assert.ok(result.events.some(event => event.type === "tool_failed" && /expected base commit SHA/.test(event.message)));
});

test("Commander applies the host-selected OpenAI model when both provider keys exist", () => {
  const configured = createAiCommander("Fix Onay-Agents-Factory", {
    env: { ...factoryEnv, AGENT_FACTORY_PROVIDER: "openai", OPENAI_API_KEY: "openai-test-key",
      OPENAI_MODEL: "selected-commander-model", GEMINI_API_KEY: "unused-gemini-key" },
  });
  assert.equal(configured.provider, "openai");
  assert.equal(configured.commander.model, "selected-commander-model");
  assert.equal("runner" in configured, false);
  assert.doesNotMatch(JSON.stringify(configured), /openai-test-key|unused-gemini-key/);
});

test("Commander rejects a missing selected key before invoking the model or any tools", async t => {
  const calls: string[] = [];
  let networkCalls = 0;
  t.mock.method(globalThis, "fetch", async () => { networkCalls++; throw new Error("Unexpected network request"); });
  const result = await runAiCommander("Fix Onay-Agents-Factory", {
    env: { ...factoryEnv, AGENT_FACTORY_PROVIDER: "openai", GEMINI_API_KEY: "unused-gemini-key" },
    dependencies: dependencies(calls),
  });
  assert.equal(result.status, "blocked");
  assert.ok(result.reasons.some(reason => /selected OpenAI provider requires OPENAI_API_KEY/.test(reason)));
  assert.deepEqual(calls, []);
  assert.equal(networkCalls, 0);
});

test("Commander and advisory specialists retain task-selected clients across provider and credential changes", async t => {
  const requests: Array<{ url: string; key: string; model: unknown }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const index = requests.push({ url, key: headers.get("authorization") ?? "", model: body.model }) - 1;
    // Configure an unrelated task while the original Commander is still running.
    if (index === 0 || index === 4) createAiCommander("Audit Onay-Agents-Factory", {
      env: index === 0 ? { ...factoryEnv, AGENT_FACTORY_PROVIDER: "openai", OPENAI_API_KEY: "unrelated-openai-key" } :
        { ...factoryEnv, AGENT_FACTORY_PROVIDER: "gemini", GEMINI_API_KEY: "unrelated-gemini-key" },
    });
    const toolName = index === 0 || index === 4 ? "explore_onay" : index === 1 || index === 5 ? "database_specialist" : undefined;
    const argumentsJson = toolName === "database_specialist" ? '{"input":"Review repository context."}' : "{}";
    const text = index === 2 || index === 6 ? '{"ready":true,"findings":[],"summary":"Context reviewed."}' : "Provider configuration verified.";
    const response = url.endsWith("/chat/completions") ? {
      id: "chat-test", object: "chat.completion", created: 1, model: body.model,
      choices: [{ index: 0, message: toolName ? { role: "assistant", content: null,
        tool_calls: [{ id: "call-" + index, type: "function", function: { name: toolName, arguments: argumentsJson } }] } :
        { role: "assistant", content: text }, finish_reason: toolName ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    } : {
      id: "resp-test", object: "response", created_at: 1, status: "completed", model: body.model,
      output: toolName ? [{ id: "fc-" + index, type: "function_call", call_id: "call-" + index,
        name: toolName, arguments: argumentsJson, status: "completed" }] :
        [{ id: "msg-test", type: "message", role: "assistant", status: "completed",
          content: [{ type: "output_text", text, annotations: [] }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2,
        input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
    };
    return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
  });
  const goal = "Audit Onay-Agents-Factory database without modifying files";
  const gemini = await runAiCommander(goal, {
    env: { ...factoryEnv, AGENT_FACTORY_PROVIDER: "gemini", GEMINI_API_KEY: "gemini-test-key", GEMINI_MODEL: "gemini-test-model" },
    dependencies: dependencies([]),
  });
  const openai = await runAiCommander(goal, {
    env: { ...factoryEnv, AGENT_FACTORY_PROVIDER: "openai", OPENAI_API_KEY: "openai-test-key", OPENAI_MODEL: "openai-test-model" },
    dependencies: dependencies([]),
  });
  await runAiCommander(goal, {
    env: { ...factoryEnv, AGENT_FACTORY_PROVIDER: "openai", OPENAI_API_KEY: "second-openai-test-key", OPENAI_MODEL: "second-openai-test-model" },
    dependencies: dependencies([]),
  });
  await runAiCommander(goal, {
    env: { ...factoryEnv, AGENT_FACTORY_PROVIDER: "gemini", GEMINI_API_KEY: "second-gemini-test-key", GEMINI_MODEL: "second-gemini-test-model" },
    dependencies: dependencies([]),
  });
  await runAiCommander(goal, {
    env: { ...factoryEnv, AGENT_FACTORY_PROVIDER: "gemini", GEMINI_API_KEY: "third-gemini-test-key", GEMINI_MODEL: "third-gemini-test-model" },
    dependencies: dependencies([]),
  });
  assert.ok(gemini.events.some(event => event.type === "tool_completed" && event.details?.tool === "database_specialist"));
  assert.ok(openai.events.some(event => event.type === "tool_completed" && event.details?.tool === "database_specialist"));
  assert.deepEqual(requests, [
    ...Array.from({ length: 4 }, () => ({ url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: "Bearer gemini-test-key", model: "gemini-test-model" })),
    ...Array.from({ length: 4 }, () => ({ url: "https://api.openai.com/v1/responses", key: "Bearer openai-test-key", model: "openai-test-model" })),
    { url: "https://api.openai.com/v1/responses", key: "Bearer second-openai-test-key", model: "second-openai-test-model" },
    { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: "Bearer second-gemini-test-key", model: "second-gemini-test-model" },
    { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: "Bearer third-gemini-test-key", model: "third-gemini-test-model" },
  ]);
});


test("Gemini SDK retries a 503 after an executed Explorer tool without executing Explorer twice", async t => {
  const calls: string[] = [];
  let httpCalls = 0;
  let explorerCalls = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    const attempt = ++httpCalls;
    if (attempt === 2) {
      return new Response(JSON.stringify({ error: { message: "temporary overload" } }), {
        status: 503, headers: { "content-type": "application/json", "retry-after-ms": "0" },
      });
    }
    const toolCall = attempt === 1;
    return new Response(JSON.stringify({
      id: "retry-test-" + attempt, object: "chat.completion", created: 1, model: "gemini-3.5-flash",
      choices: [{ index: 0, finish_reason: toolCall ? "tool_calls" : "stop",
        message: toolCall ? { role: "assistant", content: null, tool_calls: [{
          id: "call-explore", type: "function", function: { name: "explore_onay", arguments: "{}" },
        }] } : { role: "assistant", content: "Audit incomplete; more actors required." } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const deps = dependencies(calls);
  const originalExplore = deps.explore;
  deps.explore = async sha => {
    explorerCalls++;
    return originalExplore(sha);
  };
  const result = await runAiCommander("Audit Onay-Agents-Factory repository without changing files", {
    env: { ...factoryEnv, AGENT_FACTORY_PROVIDER: "gemini",
      GEMINI_API_KEY: "test-key-not-real", GEMINI_MODEL: "gemini-3.5-flash" },
    dependencies: deps,
  });
  assert.equal(httpCalls, 3);
  assert.equal(explorerCalls, 1);
  assert.equal(calls.filter(call => call === "read-files").length, 1);
  assert.equal(result.status, "blocked"); // Missing Tester and Security still block completion.
  assert.equal(result.evidence.testsExecuted, false);
  assert.ok(!calls.includes("write-and-open-pr"));
});

test("private-source Commander does not echo generated complete files to Gemini", async () => {
  const secretMarker = "PRIVATE_GENERATED_UI_ONLY_HOST_CAN_READ";
  class PrivacyModel implements Model {
    readonly requests: ModelRequest[] = [];
    async getResponse(request: ModelRequest): Promise<ModelResponse> {
      const index = this.requests.push(request) - 1;
      const name = index === 0 ? "explore_onay" : index === 1 ? "code_onay" : undefined;
      return {
        usage: new Usage(),
        output: name ? [{ type: "function_call", callId: "p-" + index, name, arguments: "{}", status: "completed" }] :
          [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Stopped before publication." }] }],
      };
    }
    async *getStreamedResponse(): AsyncGenerator<never> { throw new Error("no streaming"); }
  }
  const model = new PrivacyModel();
  const deps = dependencies([]);
  deps.generate = async () => ({ summary: "Scoped proposal", files: [{ path: "mobile/tezjet-app/app/index.tsx", content: secretMarker, message: "Fix auth" }] });
  await runAiCommander("Implement Onay passenger mobile registration", {
    model, env: { AGENT_ALLOWED_REPOSITORIES: "erman-ksv/Onay" }, dependencies: deps,
    specialistContextTransform: (context) => context,
  });
  const toolResults = JSON.stringify(model.requests.slice(2));
  assert.doesNotMatch(toolResults, /PRIVATE_GENERATED_UI_ONLY_HOST_CAN_READ/);
  assert.match(toolResults, /mobile\\/tezjet-app\\/app\\/index\\.tsx/);
});
