import { TezJetRepositoryAdapter } from "./tezjetRepository.js";
import { getTargetRepository } from "./repositoryConfig.js";

export const DEFAULT_EXPLORER_FILES = [
  "package.json",
  "artifacts/api-server/src/controllers/orderController.ts",
  "artifacts/api-server/src/controllers/queueController.ts",
  "artifacts/api-server/src/store/memoryStore.ts",
  "artifacts/api-server/src/routes/order.ts",
] as const;

export const AGENT_FACTORY_EXPLORER_FILES = [
  "package.json",
  "commander/commander.ts",
  "commander/planner.ts",
  "commander/executor.ts",
  "commander/aiCommander.ts",
  "commander/providerConfig.ts",
  "commander/modelProvider.ts",
  "commander/summary.ts",
  "agents/tester/agent.ts",
  "agents/security/agent.ts",
  "agents/reviewer/agent.ts",
  "github/tezjetRepository.ts",
  "github/repositoryPolicy.ts",
  "github/changeWorkflow.ts",
  "github/ciGate.ts",
  "github/githubClient.ts",
  "orchestration/pipeline.ts",
  "orchestration/retryLoop.ts",
  "orchestration/dashboardServer.ts",
] as const;

export async function inspectTezJet(
  paths: readonly string[] = DEFAULT_EXPLORER_FILES,
  ref = "main",
  repository = getTargetRepository(),
) {
  const adapter = new TezJetRepositoryAdapter(repository);
  const files = [];
  for (const path of paths) {
    try {
      files.push(await adapter.read(path, ref));
    } catch (error) {
      files.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { repository, ref, files };
}
