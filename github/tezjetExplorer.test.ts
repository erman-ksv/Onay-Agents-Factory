import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_EXPLORER_FILES } from "./tezjetExplorer.js";

test("Explorer defaults only to files confirmed to exist in the TezJet repository", () => {
  assert.deepEqual(DEFAULT_EXPLORER_FILES, [
    "package.json",
    "artifacts/api-server/src/controllers/orderController.ts",
    "artifacts/api-server/src/controllers/queueController.ts",
    "artifacts/api-server/src/store/memoryStore.ts",
    "artifacts/api-server/src/routes/order.ts",
  ]);
  assert.equal(DEFAULT_EXPLORER_FILES.includes("server.js" as never), false);
});
