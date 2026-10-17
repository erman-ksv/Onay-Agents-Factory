import assert from "node:assert/strict";
import test from "node:test";
import { searchSkillCatalog } from "./skillDiscovery.js";

test("skill discovery only returns bounded, typed read-only catalog metadata", async () => {
  let requested = "";
  const mock = (async (url: string, init?: RequestInit) => {
    requested = url;
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    const skills = Array.from({ length: 20 }, (_, i) => ({
      id: "trusted/repository/test-" + i, name: "Safe skill " + i,
      source: "trusted/repository", installs: i + 1,
    }));
    return new Response(JSON.stringify({ skills }), { status: 200 });
  }) as typeof fetch;
  const response = await searchSkillCatalog("react native testing", mock);
  assert.match(requested, /^https:\/\/skills\.sh\/api\/search\?/);
  assert.equal(new URL(requested).searchParams.get("q"), "react native testing");
  assert.equal(response.skills.length, 8);
  assert.equal(response.installationEnabled, false);
  assert.equal(response.contentReviewed, false);
  assert.equal(response.skills[0]?.url, "https://skills.sh/trusted/repository/test-0");
});

test("skill discovery rejects credentials and invalid requests before network", async () => {
  let calls = 0;
  const mock = (async () => { calls++; throw new Error("Unexpected network call"); }) as typeof fetch;
  for (const query of ["", "x", "x".repeat(101), "line\nbreak", "sk-" + "z".repeat(40)]) {
    await assert.rejects(searchSkillCatalog(query, mock));
  }
  assert.equal(calls, 0);
});

test("skill discovery discards untrusted source identifiers and returns explicit catalog errors", async () => {
  const mock = (async () => new Response(JSON.stringify({ skills: [
    { id: "../bad", source: "test/repo", name: "danger", installs: 1 },
    { id: "test/repo/valid", source: "test/repo", name: "safe", installs: 20 },
    { id: "test/repo/valid", source: "test/repo", name: "duplicate", installs: 2 },
    { id: "evil/other/x", source: "https://bad.example", installs: 100 },
  ] }), { status: 200 })) as typeof fetch;
  const result = await searchSkillCatalog("test", mock);
  assert.deepEqual(result.skills.map(s => s.slug), ["valid"]);
  const error = (async () => new Response("fail", { status: 503 })) as typeof fetch;
  await assert.rejects(searchSkillCatalog("test", error), /HTTP 503/);
});

test("skill discovery rejects inconsistent fully-qualified catalog identifiers", async () => {
  const fake = (async () => new Response(JSON.stringify({ skills: [
    { id: "other/repo/unsafe", source: "trusted/repo", name: "Mismatch", installs: 10 },
  ] }), { status: 200 })) as typeof fetch;
  await assert.rejects(searchSkillCatalog("react", fake), /none matched/);
});
