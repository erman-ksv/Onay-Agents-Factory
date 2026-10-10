import { TezJetRepositoryAdapter } from "./tezjetRepository.js";

export const DEFAULT_EXPLORER_FILES = [
  "package.json",
  "artifacts/api-server/src/controllers/orderController.ts",
  "artifacts/api-server/src/controllers/queueController.ts",
  "artifacts/api-server/src/store/memoryStore.ts",
  "artifacts/api-server/src/routes/order.ts",
] as const;

export async function inspectTezJet(
  paths: readonly string[] = DEFAULT_EXPLORER_FILES,
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
