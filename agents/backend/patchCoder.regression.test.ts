import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { setTracingDisabled } from "@openai/agents";
import { generatePatchChanges } from "./coder.js";
import { BOUNDED_PATCH_ERROR } from "../../commander/boundedPatch.js";
import { createTaskModelBudgetFetch } from "../../orchestration/taskModelBudget.js";

setTracingDisabled(true);

const fixtureEnv: NodeJS.ProcessEnv = {
  AGENT_FACTORY_PROVIDER: "cloudflare",
  CLOUDFLARE_API_TOKEN: "offline-patch-coder-fixture",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  AGENT_FACTORY_LEGAL_ENABLED: "false",
};
const model = "@cf/zai-org/glm-4.7-flash";
const path = "src/queue.ts";
const privateMarker = "UNSELECTED_PRIVATE_PATCH_CODER_SOURCE_3920";
const before = "export const responseSeconds = 60;";
const after = "export const responseSeconds = 45;";
const sourceLines = Array.from({ length: 430 }, (_, index) =>
  index === 200 ? before : index === 420 ? `// ${privateMarker}` : `// untouched private source line ${index}`);
const source = sourceLines.join("\n") + "\n";
const sourceSha256 = createHash("sha256").update(source, "utf8").digest("hex");
const selectedContext = JSON.stringify({
  snippets: [{ path, startLine: 201, endLine: 201, text: `201 | ${before}`, contentSha256: sourceSha256 }],
  unverifiedAreas: { unshownRanges: [{ path, source: "base" }], testsAndRuntimeBehavior: true },
});
const sources = () => new Map([[path, source]]);
const validOutput = () => ({
  summary: "Adjust the configured response interval.",
  patches: [{ path, sourceSha256, edits: [{ before, after }], message: "Adjust response interval" }],
});

function completion(content: string): Response {
  return Response.json({
    id: "chatcmpl-offline-patch-coder",
    object: "chat.completion",
    created: 1,
    model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 100, completion_tokens: 60, total_tokens: 160 },
  });
}

test("patch Coder SDK sends snippets and full-source SHA while retaining unselected source in host memory", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unmocked network is forbidden in this fixture."); });
  const requests: string[] = [];
  const fake: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/ai/v1/chat/completions`);
    requests.push(await request.text());
    return completion(JSON.stringify(validOutput()));
  };
  const hostSources = sources();
  const result = await generatePatchChanges("Set the response interval to 45 seconds.", selectedContext, hostSources, fixtureEnv, { fetch: fake });

  assert.equal(requests.length, 1);
  const body = JSON.parse(requests[0]) as { model: string; messages: Array<{ content: string }> };
  assert.equal(body.model, model);
  assert.ok(body.messages.some(message => message.content.includes(before)));
  assert.ok(requests[0].includes(sourceSha256), "The model must receive the full host-file hash, not a guessed snippet hash.");
  assert.equal(requests[0].includes(privateMarker), false);
  assert.equal(requests[0].includes("untouched private source line 0"), false);
  assert.equal(requests[0].includes(JSON.stringify(source).slice(1, -1)), false);
  assert.deepEqual(result, { summary: validOutput().summary,
    files: [{ path, content: source.replace(before, after), message: "Adjust response interval" }],
    reviewPatches: [{ path, sourceSha256, edits: [{ before, after }], message: "Adjust response interval" }] });
  assert.equal(result.files[0].content.split("\n").length, source.split("\n").length);
  assert.ok(result.files[0].content.includes(privateMarker), "Unselected source is preserved only in the host proposal.");
  for (let index = 0; index < sourceLines.length; index++) {
    assert.equal(result.files[0].content.split("\n")[index], index === 200 ? after : sourceLines[index]);
  }
  assert.equal(hostSources.get(path), source);
});

test("patch Coder SDK rejects stale SHA, malformed JSON, and secret summary with fixed source-free errors", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unmocked network is forbidden in this fixture."); });
  const stale = validOutput();
  stale.patches[0].sourceSha256 = createHash("sha256").update(source + "stale").digest("hex");
  const secretSummary = { ...validOutput(), summary: "ghp_" + "A".repeat(24) };
  for (const [name, output] of [
    ["stale SHA", JSON.stringify(stale)],
    ["malformed JSON", `{"summary":"${privateMarker}`],
    ["secret summary", JSON.stringify(secretSummary)],
  ]) await t.test(name, async () => {
    let calls = 0;
    const fake: typeof fetch = async () => { calls++; return completion(output); };
    await assert.rejects(generatePatchChanges("Adjust the response interval.", selectedContext, sources(), fixtureEnv, { fetch: fake }), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, BOUNDED_PATCH_ERROR);
      assert.equal(error.message.includes(privateMarker), false);
      assert.equal(error.message.includes(secretSummary.summary), false);
      return true;
    });
    assert.equal(calls, 1);
  });
});

test("patch Coder SDK shares the task request ledger across separate model clients without a second transport", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unmocked network is forbidden in this fixture."); });
  let calls = 0;
  const fake: typeof fetch = async () => { calls++; return completion(JSON.stringify(validOutput())); };
  const budget = createTaskModelBudgetFetch({ maxRequests: 1 }, fake);
  const options = { fetch: budget.fetch };
  const first = await generatePatchChanges("Adjust the response interval.", selectedContext, sources(), fixtureEnv, options);
  assert.equal(first.files[0].content, source.replace(before, after));
  assert.equal(calls, 1);
  assert.equal(budget.snapshot().attemptedRequests, 1);

  await assert.rejects(generatePatchChanges("Adjust the response interval.", selectedContext, sources(), fixtureEnv, options), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes(privateMarker), false);
    return true;
  });
  assert.equal(calls, 1, "A new SDK client must not restore an exhausted task-owned budget.");
  assert.equal(budget.snapshot().attemptedRequests, 1);
  assert.equal(budget.snapshot().failureCode, "request_limit");
  assert.equal(budget.failure?.retryable, false);
});
