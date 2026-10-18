import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAiCommander } from "../commander/aiCommander.js";
import type { AiExecutionDependencies } from "../commander/aiExecution.js";
import { rotateReadOnlyAudit, type RotationProvider } from "./providerRotation.js";

const repository = "erman-ksv/Onay-Agents-Factory";
const goal = "Audit Onay-Agents-Factory repository without changing files";
const ref = "feat/commander-autonomous-backlog-20261017";
const sha = "a".repeat(40);

function dependencies(traces: string[]): AiExecutionDependencies {
  const forbid = (action: string): never => { throw new Error("Unexpected mutation: " + action); };
  return {
    getHead: async () => { traces.push("get-head"); return sha; },
    getCandidateHead: async () => forbid("get-candidate-head"),
    explore: async head => {
      assert.equal(head, sha);
      traces.push("explore");
      return { repository, ref: head, files: [{
        path: "package.json", sha: "c".repeat(40), content: '{"scripts":{"test":"tsx --test"}}',
      }] };
    },
    generate: async () => forbid("Coder"),
    review: () => forbid("Reviewer"),
    scan: () => forbid("proposal scan"),
    inspectSecurity: async head => {
      assert.equal(head, sha);
      traces.push("security");
      return { agent: "security", repository, ref: head, status: "clean", findings: [] };
    },
    discoverTests: async () => { traces.push("discover"); return { scripts: ["test"] }; },
    publish: async () => forbid("publish"),
    verify: async (head, targetRef) => {
      assert.equal(head, sha);
      assert.equal(targetRef, ref);
      traces.push("verify");
      return {
        testsExecuted: true, repository, ref: targetRef, expectedSha: head, status: "passed",
        evidence: [{ runId: 100, name: "CI mock", headSha: head, conclusion: "success",
          url: "https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/100" }],
        checks: [{ jobName: "typecheck", name: "Test", status: "completed", conclusion: "success" }],
        notes: [],
      };
    },
  };
}

function completion(turn: number): Response {
  const tool = turn === 1;
  return Response.json({
    id: "chatcmpl-offline-" + turn,
    object: "chat.completion",
    created: 1,
    model: "gemini-3.5-flash-lite",
    choices: [{
      index: 0,
      finish_reason: tool ? "tool_calls" : "stop",
      message: tool ? {
        role: "assistant", content: null,
        tool_calls: [{
          id: "call-readonly-1", type: "function",
          function: { name: "audit_onay_read_only", arguments: "{}" },
        }],
      } : { role: "assistant", content: "Pinned SHA audit verified." },
    }],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
  });
}

test("SDK Commander uses three free providers in order with host-proven quota and no GitHub writes", async t => {
  const dir = mkdtempSync(join(tmpdir(), "three-provider-sdk-fixture-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const checkpointPath = join(dir, "rotation.json");
  const providerCalls: RotationProvider[] = [];
  const transportCalls: RotationProvider[] = [];
  const toolCalls: string[] = [];
  let geminiTurns = 0;

  const result = await rotateReadOnlyAudit({
    goal, repository, baseRef: ref, baseSha: sha, checkpointPath,
    env: {
      CLOUDFLARE_API_TOKEN: "offline-cloudflare",
      CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
      GROQ_API_KEY: "offline-groq",
      GEMINI_API_KEY: "offline-gemini",
      GEMINI_MODEL: "gemini-3.5-flash-lite",
      AGENT_ALLOWED_REPOSITORIES: repository,
      AGENT_FACTORY_ENABLE_GITHUB_WRITES: "false",
      AGENT_FACTORY_LEGAL_ENABLED: "false",
    },
    run: async (provider, env) => {
      providerCalls.push(provider);
      const fakeFetch: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        const host = new URL(request.url).hostname;
        if (provider === "cloudflare") assert.equal(host, "api.cloudflare.com");
        if (provider === "groq") assert.equal(host, "api.groq.com");
        if (provider === "gemini") assert.ok(host.includes("generativelanguage.googleapis.com"));
        transportCalls.push(provider);
        if (provider === "cloudflare") {
          return Response.json({ error: { message: "fixture upstream limit" } }, { status: 429 });
        }
        if (provider === "groq") {
          return Response.json({ error: { message: "fixture upstream limit" } },
            { status: 429, headers: { "retry-after": "7" } });
        }
        const turn = ++geminiTurns;
        assert.ok(turn <= 2, "Gemini compact audit cannot have extra model turns");
        return completion(turn);
      };
      const evidence = await runAiCommander(goal, {
        env, baseRef: ref, expectedBaseSha: sha,
        dependencies: dependencies(toolCalls),
        modelFetch: fakeFetch,
        maxTurns: 5,
      });
      if (provider === "cloudflare" || provider === "groq") {
        assert.equal(evidence.status, "blocked");
        assert.equal(evidence.upstreamRateLimitVerified, true);
        assert.equal(evidence.events.filter(x => x.type === "tool_started").length, 0);
      }
      return evidence;
    },
  });

  assert.equal(result.status, "completed", result.reason);
  assert.equal(result.provider, "gemini");
  assert.deepEqual(providerCalls, ["cloudflare", "groq", "gemini"]);
  assert.deepEqual(transportCalls, ["cloudflare", "groq", "gemini", "gemini"]);
  assert.deepEqual(toolCalls, ["get-head", "explore", "security", "discover", "verify"]);
  assert.deepEqual(result.attempts.map(attempt => attempt.outcome), ["quota", "quota", "completed"]);
  assert.deepEqual(result.attempts[2].verifiedTools,
    ["explore_onay", "security_review", "test_onay"]);
  const serialized = readFileSync(checkpointPath, "utf8");
  for (const credential of ["offline-cloudflare", "offline-groq", "offline-gemini"]) {
    assert.ok(!serialized.includes(credential), "no credentials in state");
  }

  const second = await rotateReadOnlyAudit({
    goal, repository, baseRef: ref, baseSha: sha,
    checkpointPath, env: { AGENT_FACTORY_ENABLE_GITHUB_WRITES: "false" },
    run: async () => { throw new Error("Verified audit must not rerun"); },
  });
  assert.equal(second.status, "completed");
});
