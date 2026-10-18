/** Conservative three-provider audit runner. Never publishes or merges. */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { rotateReadOnlyAudit } from "./providerRotation.js";
import { runAiCommander } from "../commander/aiCommander.js";
import type { RotationRunResult } from "./providerRotation.js";

async function main(args: string[]) {
  if (args.length !== 3) throw new Error("Usage: pnpm exec tsx orchestration/providerRotationCli.ts BASE_REF FULL_BASE_SHA ABSOLUTE_CHECKPOINT_PATH");
  const [baseRef, baseSha, checkpointPath] = args;
  const repository = "erman-ksv/Onay-Agents-Factory";
  const goal = "Audit Onay-Agents-Factory repository without changing files";
  const result = await rotateReadOnlyAudit({
    goal, repository, baseRef, baseSha, checkpointPath, env: process.env,
    run: async (_provider, env): Promise<RotationRunResult> => {
      const output = await runAiCommander(goal, { env, baseRef, expectedBaseSha: baseSha });
      return output;
    },
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "completed") process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(process.argv.slice(2)); }
  catch (error) {
    console.error(error instanceof Error ? error.message : "Audit rotation failed");
    process.exitCode = 1;
  }
}
