/** Conservative three-provider audit runner. Never publishes or merges. */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { rotateReadOnlyAudit } from "./providerRotation.js";
import { runAiCommander } from "../commander/aiCommander.js";
import type { RotationRunResult } from "./providerRotation.js";

async function main(args: string[]) {
  if (args.length !== 3) throw new Error("Usage: pnpm exec tsx orchestration/providerRotationCli.ts BASE_REF FULL_BASE_SHA ABSOLUTE_CHECKPOINT_PATH");
  // The runner is network-capable. Require explicit per-invocation human opt-in,
  // never start a live model request merely because stored keys exist.
  if (process.env.AGENT_FACTORY_LIVE_READONLY_APPROVED !== "true")
    throw new Error("Live read-only audit is NOT approved. Explicit human opt-in required.");
  if (process.env.AGENT_FACTORY_ENABLE_GITHUB_WRITES !== "false" ||
      process.env.AGENT_FACTORY_LEGAL_ENABLED !== "false")
    throw new Error("Live audit requires writes and legal agent explicitly disabled.");
  if (process.env.AGENT_ALLOWED_REPOSITORIES !== "erman-ksv/Onay-Agents-Factory")
    throw new Error("Live audit requires an exact approved repository allowlist.");
  if (process.env.GROQ_API_KEY && process.env.GROQ_MODEL !== "qwen/qwen3-8b")
    throw new Error("Live audit Groq model must be the previously qualified qwen/qwen3-8b.");
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL !== "gemini-3.5-flash-lite")
    throw new Error("Live audit Gemini model must be the previously qualified gemini-3.5-flash-lite.");
  const [baseRef, baseSha, checkpointPath] = args;
  const repository = "erman-ksv/Onay-Agents-Factory";
  const goal = "Audit Onay-Agents-Factory repository without changing files";
  const result = await rotateReadOnlyAudit({
    goal, repository, baseRef, baseSha, checkpointPath, env: process.env,
    run: async (_provider, env): Promise<RotationRunResult> => {
      // Compact audit uses one host-side tool; four model turns allow tool + final summary
      // while bounding free-tier usage if a model tries unneeded extra turns.
      const output = await runAiCommander(goal, { env, baseRef, expectedBaseSha: baseSha, maxTurns: 4 });
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
