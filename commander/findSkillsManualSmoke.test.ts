import assert from "node:assert/strict";
import test from "node:test";
import { runFindSkillsManualSmoke } from "./findSkillsManualSmoke.js";

const env = {
  FIND_SKILLS_LIVE_CONFIRM: "RUN_ONE_REQUEST",
  CLOUDFLARE_API_TOKEN: "dummy-never-live",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
};

test("manual smoke makes precisely one Cloudflare POST and a metadata-only catalog lookup", async () => {
  let providerCalls = 0;
  let catalogCalls = 0;
  const provider = (async (_url: string, init?: RequestInit) => {
    providerCalls++;
    const req = new Request(_url, init);
    assert.match(req.url, /api\.cloudflare\.com\/client\/v4\/accounts\/[a-f0-9]{32}\/ai\/v1\/chat\/completions$/);
    const body = await req.json();
    assert.equal(body.max_tokens, 128);
    assert.equal(req.method, "POST");
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ tool: "find_skills", query: "expo" }) } }],
    }), { status: 200 });
  }) as typeof fetch;
  const catalog = (async (_url: string) => {
    catalogCalls++;
    assert.match(_url, /^https:\/\/skills\.sh\/api\/search\?q=expo&limit=20$/);
    return new Response(JSON.stringify({ skills: [
      { id: "expo", name: "expo", source: "trusted/mobile", installs: 42 },
    ] }), { status: 200 });
  }) as typeof fetch;
  const result = await runFindSkillsManualSmoke(env, provider, catalog);
  assert.equal(result.status, "verified_read_only");
  assert.equal(result.providerRequests, 1);
  assert.equal(result.installationPerformed, false);
  assert.equal(result.githubWritesPerformed, false);
  assert.equal(result.fullCommanderRun, false);
  assert.equal(providerCalls, 1);
  assert.equal(catalogCalls, 1);
});

test("manual smoke requires explicit opt-in and rejects unauthorized model routes before catalog use", async () => {
  let catalogCalls = 0;
  const catalog = (async () => { catalogCalls++; return new Response("{}"); }) as typeof fetch;
  let providerCalls = 0;
  const provider = (async () => {
    providerCalls++;
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"tool":"install_skills","query":"expo"}' } }],
    }), { status: 200 });
  }) as typeof fetch;
  await assert.rejects(() => runFindSkillsManualSmoke({ ...env, FIND_SKILLS_LIVE_CONFIRM: "" }, provider, catalog),
    /explicit RUN_ONE_REQUEST/);
  assert.equal(providerCalls, 0);
  await assert.rejects(() => runFindSkillsManualSmoke(env, provider, catalog), /unapproved tool/);
  assert.equal(providerCalls, 1);
  assert.equal(catalogCalls, 0);
});

test("manual smoke blocks missing credentials without provider calls", async () => {
  let calls = 0;
  await assert.rejects(() => runFindSkillsManualSmoke({
    FIND_SKILLS_LIVE_CONFIRM: "RUN_ONE_REQUEST",
  }, (async () => { calls++; throw Error("must not call"); }) as typeof fetch), /token\/account is missing/);
  assert.equal(calls, 0);
});
