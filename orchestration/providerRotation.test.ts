import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rotateReadOnlyAudit, isModelQuotaFailure, type RotationRunResult } from "./providerRotation.js";

const repo = "erman-ksv/Onay-Agents-Factory";
const sha = "a".repeat(40);
const goal = "Audit Onay-Agents-Factory repository without changing files";
const base = {
  goal, repository: repo, baseRef: "feat/safe-three-provider-rotation-20261018", baseSha: sha,
  env: { CLOUDFLARE_API_TOKEN: "fixture", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    GROQ_API_KEY: "fixture", GEMINI_API_KEY: "fixture", AGENT_FACTORY_ENABLE_GITHUB_WRITES: "false",
    AGENT_FACTORY_LEGAL_ENABLED: "false", AGENT_ALLOWED_REPOSITORIES: repo },
};
function success(): RotationRunResult {
  return { status: "completed", reasons: [], missingActors: [],
    evidence: { repository: repo, baseSha: sha, publicationAttempted: false,
      security: { repository: { status: "clean" } }, testsExecuted: true,
      tests: { status: "passed", testsExecuted: true, expectedSha: sha, repository: repo, evidence: [{ headSha: sha, conclusion: "success" }] }, changedFiles: [], proposedFiles: [] },
    events: ["explore_onay", "security_review", "test_onay"].map(tool =>
      ({ type: "tool_completed", details: { tool } })) };
}
function folder(t: { after: (cb: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "rotation-fixture-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "checkpoint.json");
}
test("recognized provider quota rotates once and retains completed read-only stages", async t => {
  const checkpointPath = folder(t);
  const called: string[] = [];
  const result = await rotateReadOnlyAudit({ ...base, checkpointPath,
    run: async provider => {
      called.push(provider);
      if (provider === "cloudflare") return { status: "blocked",
        reasons: ["429 Provider rate limit"], upstreamRateLimitVerified: true, events: [] };
      return success();
    },
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(called, ["cloudflare", "groq"]);
  assert.deepEqual(result.attempts.map(x => x.outcome), ["quota", "completed"]);
  assert.deepEqual(result.attempts[1].verifiedTools, ["explore_onay", "security_review", "test_onay"]);
  const again = await rotateReadOnlyAudit({ ...base, checkpointPath,
    run: async () => { throw new Error("Never replay completed work"); },
  });
  assert.equal(again.status, "completed");
});
test("quota from Gemini is allowed but GitHub 429 never rotates", () => {
  assert.equal(isModelQuotaFailure({ status: "blocked", reasons: ["Gemini daily request quota exhausted (HTTP 429)"] }, "gemini"), true);
  assert.equal(isModelQuotaFailure({ status: "blocked", reasons: ["GitHub API 429 provider rate limited"] }, "groq"), false);
  assert.equal(isModelQuotaFailure({ status: "blocked", reasons: ["503 unknown provider failure"] }, "groq"), false);
});
test("unexpected tool mutations fail closed; no second provider runs", async t => {
  const checkpointPath = folder(t);
  const called: string[] = [];
  const result = await rotateReadOnlyAudit({ ...base, checkpointPath,
    run: async provider => { called.push(provider); return {
      status: "blocked", reasons: ["429 provider quota"], events: [{ type: "tool_started", details: { tool: "publish_change_set" } }],
    }; },
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(called, ["cloudflare"]);
});
test("no key and no write opt-in never calls provider", async t => {
  const checkpointPath = folder(t);
  const run = async () => { throw new Error("Unexpected API"); };
  const unavailable = await rotateReadOnlyAudit({ ...base, checkpointPath, env: {},
    run });
  assert.equal(unavailable.status, "blocked");
  assert.deepEqual(unavailable.attempts, []);
  await assert.rejects(rotateReadOnlyAudit({ ...base, checkpointPath: folder(t),
    env: { ...base.env, AGENT_FACTORY_ENABLE_GITHUB_WRITES: "true" }, run }), /read-only/);
});
test("a stale task fingerprint blocks without requests", async t => {
  const checkpointPath = folder(t);
  await rotateReadOnlyAudit({ ...base, checkpointPath, run: async () => success() });
  await assert.rejects(rotateReadOnlyAudit({ ...base, goal: goal + " changed", checkpointPath,
    run: async () => { throw new Error("Unexpected API"); } }), /does not match/);
});
test("checkpoint stores no credentials", async t => {
  const checkpointPath = folder(t);
  await rotateReadOnlyAudit({ ...base, checkpointPath, run: async () => success() });
  const data = readFileSync(checkpointPath, "utf8");
  assert.ok(!data.includes("GEMINI_API_KEY"));
  assert.ok(!data.includes("fixture"));
});

test("two quota failures rotate to third configured provider without re-running previous providers", async t => {
  const checkpointPath = folder(t);
  const called: string[] = [];
  const result = await rotateReadOnlyAudit({ ...base, checkpointPath, run: async provider => {
    called.push(provider);
    return provider === "gemini" ? success() : { status: "blocked", reasons: ["429 Provider rate limit"], upstreamRateLimitVerified: true, events: [] };
  } });
  assert.equal(result.status, "completed");
  assert.equal(result.provider, "gemini");
  assert.deepEqual(called, ["cloudflare", "groq", "gemini"]);
  assert.deepEqual(result.attempts.map(a => a.outcome), ["quota", "quota", "completed"]);
  const retained = JSON.parse(readFileSync(checkpointPath, "utf8"));
  assert.equal(retained.status, "completed");
  assert.deepEqual(retained.attempts.map((a: { provider: string }) => a.provider), called);
});

test("interrupted provider attempt pauses instead of replaying model, tools or publication", async t => {
  const checkpointPath = folder(t);
  const first = await rotateReadOnlyAudit({ ...base, checkpointPath, run: async () =>
    ({ status: "blocked", reasons: ["429 Provider quota exhausted"], events: [] }) });
  assert.equal(first.status, "exhausted");
  const state = JSON.parse(readFileSync(checkpointPath, "utf8"));
  state.status = "running";
  state.attempts = [{ provider: "cloudflare", outcome: "running", verifiedTools: [] }];
  const { writeFileSync } = await import("node:fs");
  writeFileSync(checkpointPath, JSON.stringify(state), { mode: 0o600 });
  let calls = 0;
  const paused = await rotateReadOnlyAudit({ ...base, checkpointPath, run: async () => {
    calls++;
    throw new Error("No model call allowed");
  } });
  assert.equal(paused.status, "paused");
  assert.equal(calls, 0);
  const again = await rotateReadOnlyAudit({ ...base, checkpointPath, run: async () => {
    calls++;
    throw new Error("No model call allowed");
  } });
  assert.equal(again.status, "paused");
  assert.equal(calls, 0);
});

test("non-provider tool failure cannot trigger quota switch", async t => {
  const checkpointPath = folder(t);
  const called: string[] = [];
  const result = await rotateReadOnlyAudit({ ...base, checkpointPath, run: async provider => {
    called.push(provider);
    return { status: "blocked", reasons: ["429 Provider rate limit"], events: [
      { type: "tool_started", details: { tool: "explore_onay" } },
      { type: "tool_failed", details: { tool: "explore_onay" } },
    ] };
  } });
  assert.equal(result.status, "blocked");
  assert.deepEqual(called, ["cloudflare"]);
});

test("Cloudflare SDK text 429 is not enough to rotate without upstream transport evidence", async t => {
  const checkpointPath = folder(t);
  const called: string[] = [];
  const result = await rotateReadOnlyAudit({ ...base, checkpointPath, run: async provider => {
    called.push(provider);
    return { status: "blocked", reasons: ["429 Provider quota"], events: [] };
  } });
  assert.equal(result.status, "blocked");
  assert.deepEqual(called, ["cloudflare"]);
});
