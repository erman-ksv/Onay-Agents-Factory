import assert from "node:assert/strict";
import test from "node:test";
import { isGeminiCapacityError, retryGeminiCapacity } from "./geminiCapacityRetry.js";

test("503 capacity errors retry twice and then succeed", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await retryGeminiCapacity(async () => {
    if (++calls <= 2) throw { status: 503, error: { status: "UNAVAILABLE" } };
    return "ok";
  }, { sleep: async ms => { delays.push(ms); } });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [8000, 20000]);
});

test("exhausted 503 returns the actual provider error after three attempts", async () => {
  let calls = 0;
  const error = Object.assign(new Error("temporarily overloaded"), { status: 503 });
  await assert.rejects(() => retryGeminiCapacity(async () => {
    calls++;
    throw error;
  }, { sleep: async () => {} }), e => e === error);
  assert.equal(calls, 3);
});

test("permanent failures and quota errors are never retried", async () => {
  for (const code of [400, 401, 403, 429, 500]) {
    let calls = 0;
    await assert.rejects(() => retryGeminiCapacity(async () => {
      calls++;
      throw { status: code };
    }, { sleep: async () => { throw new Error("Unexpected retry"); } }));
    assert.equal(calls, 1);
  }
  assert.equal(isGeminiCapacityError(new Error("503 in a source file")), false);
});
