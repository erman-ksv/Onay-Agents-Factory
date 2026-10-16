import assert from "node:assert/strict";
import test from "node:test";

function add(a: number, b: number): number {
  return a + b;
}

test("synthetic publication arithmetic", () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-1, 1), 0);
});
