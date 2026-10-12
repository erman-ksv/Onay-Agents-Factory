import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_FACTORY_EXPLORER_FILES, DEFAULT_EXPLORER_FILES } from "./tezjetExplorer.js";

test("TezJet Explorer defaults only to files confirmed to exist in the TezJet repository", () => {
  assert.deepEqual(DEFAULT_EXPLORER_FILES, [
    "package.json",
    "artifacts/api-server/src/controllers/orderController.ts",
    "artifacts/api-server/src/controllers/queueController.ts",
    "artifacts/api-server/src/store/memoryStore.ts",
    "artifacts/api-server/src/routes/order.ts",
  ]);
});

test("Agent Factory self-audit includes the real Commander, provider, and repository-write paths", () => {
  for (const path of [
    "commander/commander.ts",
    "commander/executor.ts",
    "commander/providerConfig.ts",
    "commander/modelProvider.ts",
    "github/tezjetRepository.ts",
    "github/repositoryPolicy.ts",
    "github/changeWorkflow.ts",
    "github/ciGate.ts",
    "orchestration/pipeline.ts",
    "orchestration/retryLoop.ts",
  ]) {
    assert.ok(AGENT_FACTORY_EXPLORER_FILES.includes(path as never), `missing critical self-audit path: ${path}`);
  }
});
