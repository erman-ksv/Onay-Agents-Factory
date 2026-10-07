import { TezJetRepositoryAdapter } from "./tezjetRepository.js";

const DEFAULT_FILES = [
  "package.json",
  "server.js",
  "artifacts/api-server/src/controllers/orderController.ts",
  "artifacts/api-server/src/controllers/queueController.ts",
  "artifacts/api-server/src/store/memoryStore.ts",
  "artifacts/api-server/src/routes/order.ts",
];

export async function inspectTezJet(
  paths = DEFAULT_FILES,
  ref = "main",
) {
  const repository = process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet";
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
