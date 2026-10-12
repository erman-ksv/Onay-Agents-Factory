import assert from "node:assert/strict";
import test from "node:test";
import { Usage, setTracingDisabled, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { runAiCommander } from "./aiCommander.js";
import type { AiExecutionDependencies } from "./aiExecution.js";

setTracingDisabled(true);
const repository = "erman-ksv/TezJet-Agent-Factory";
const baseSha = "a".repeat(40);
const candidateSha = "b".repeat(40);
const branch = "fix/sdk-execution-test";
const names = ["explore_tezjet", "code_tezjet", "security_review", "final_review", "publish_change_set", "test_tezjet"];

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
    publish: async (files, sha) => { assert.equal(sha, baseSha); assert.match(files[0].content, /fixed = true/); calls.push("write-and-open-pr"); return { head_sha: candidateSha, html_url: "https://github.com/erman-ksv/TezJet-Agent-Factory/pull/123", number: 123 }; },
    verify: async (sha, ref) => { assert.equal(sha, candidateSha); assert.equal(ref, branch); calls.push("verify-ci"); return {
      testsExecuted: true, repository, ref, expectedSha: sha, status: "passed",
      evidence: [{ runId: 123, name: "Agent Factory CI", headSha: sha, conclusion: "success", url: "https://github.com/erman-ksv/TezJet-Agent-Factory/actions/runs/123" }],
      checks: [{ jobName: "typecheck", name: "Test", status: "completed", conclusion: "success" }], notes: [],
    }; },
  };
}

test("SDK model tool calls execute the actual Commander handlers end to end", async () => {
  const calls: string[] = [];
  const model = new ScriptedModel(names);
  const result = await runAiCommander("Fix TezJet-Agent-Factory", {
    model, env: { AGENT_FACTORY_ENABLE_GITHUB_WRITES: "true" }, dependencies: dependencies(calls),
    publication: { branch, title: "Fix verification", body: "Test candidate execution." },
  });
  assert.equal(result.status, "completed", result.reasons.join("; "));
  assert.deepEqual(calls, ["resolve-base", "read-files", "generate-files", "scan-repository", "scan-proposal", "review", "write-and-open-pr", "discover-tests", "verify-ci", "resolve-candidate"]);
  assert.equal(model.requests.length, names.length + 1);
  assert.deepEqual(result.evidence.changedFiles, ["commander/summary.ts"]);
  assert.equal(result.evidence.tests?.expectedSha, candidateSha);
  assert.equal(result.events.filter(event => event.type === "tool_completed").length, names.length);
});

test("SDK final prose without function calls cannot claim successful execution", async () => {
  const calls: string[] = [];
  const result = await runAiCommander("Fix TezJet-Agent-Factory", { model: new ScriptedModel([]), env: {}, dependencies: dependencies(calls) });
  assert.equal(result.status, "blocked");
  assert.deepEqual(calls, []);
  assert.deepEqual(result.evidence.changedFiles, []);
  assert.equal(result.evidence.testsExecuted, false);
});

test("SDK tool calls cannot enable GitHub writes without the host opt-in", async () => {
  const calls: string[] = [];
  const result = await runAiCommander("Fix TezJet-Agent-Factory", {
    model: new ScriptedModel(names), env: {}, dependencies: dependencies(calls),
    publication: { branch, title: "Fix verification", body: "Explicit metadata alone does not enable writes." },
  });
  assert.equal(result.status, "blocked");
  assert.ok(!calls.includes("write-and-open-pr"));
  assert.ok(!calls.includes("verify-ci"));
  assert.ok(result.events.some(event => event.type === "tool_failed" && event.details?.tool === "publish_change_set"));
});
