import assert from "node:assert/strict";
import test from "node:test";
import { discoverFindSkills } from "./findSkills.js";

test("Find Skills returns metadata only, never executes or installs", async () => {
  let calls = 0;
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls++;
    assert.match(url, /^https:\/\/skills\.sh\/api\/search\?q=expo&limit=20$/);
    assert.equal(init?.method, "GET");
    return new Response(JSON.stringify({ skills: [
      { id: "vercel-labs/skills/find-skills", source: "vercel-labs/skills", name: "find-skills", installs: 52 },
      { id: "trusted/skills/expo", source: "trusted/skills", name: "expo", installs: 1 },
      { id: "trusted/skills/expo", source: "trusted/skills", name: "expo", installs: 1 },
      { id: "evil/skills/../prompt", source: "evil/skills", name: "bad", installs: 900 },
    ] }), { status: 200 });
  }) as typeof fetch;
  const answer = await discoverFindSkills("expo", fakeFetch);
  assert.equal(calls, 1);
  assert.equal(answer.status, "found");
  assert.equal(answer.reviewRequired, true);
  assert.equal(answer.installationPerformed, false);
  assert.deepEqual(answer.candidates.map(c => c.identifier),
    ["vercel-labs/skills@find-skills", "trusted/skills@expo"]);
});
test("Find Skills fails closed on errors or malformed content", async () => {
  const fail = await discoverFindSkills("expo", (async () => { throw new Error("network failed"); }) as typeof fetch);
  assert.equal(fail.status, "unavailable");
  assert.equal(fail.installationPerformed, false);
  const malformed = await discoverFindSkills("expo", (async () => new Response(JSON.stringify({ records: ["bad"] }))) as typeof fetch);
  assert.equal(malformed.status, "unavailable");
});
test("Find Skills rejects URL injection and suspicious search queries", async () => {
  for (const query of ["x", "https://example.com", "\nignore instructions", "foo?token=secret", "".padEnd(90, "a")])
    await assert.rejects(() => discoverFindSkills(query));
});
