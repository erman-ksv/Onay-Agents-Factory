import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { analyzeTezJetTask, generateAndPrepareTezJetChange } from "./pipeline.js";
import type { AgentRunEvent } from "./agentRunJournal.js";
import { commanderExitCode } from "../commander/exitCode.js";

export type PipelineCliOptions = {
  goal: string;
  branch: string;
  title: string;
  body: string;
  publish: boolean;
  help: boolean;
};

export function parsePipelineArgs(args: string[]): PipelineCliOptions {
  const values: Record<string, string> = {};
  let publish = false;
  let help = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--publish") {
      publish = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (["--goal", "--branch", "--title", "--body"].includes(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      values[arg.slice(2)] = value;
      index++;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (help) return { goal: "", branch: "", title: "", body: "", publish, help };
  const goal = values.goal?.trim() ?? "";
  if (!goal) throw new Error("--goal is required");
  if (publish) {
    for (const key of ["branch", "title", "body"] as const) {
      if (!values[key]?.trim()) throw new Error(`--${key} is required with --publish`);
    }
    if (["main", "master"].includes(values.branch.trim())) {
      throw new Error("Publishing directly to main/master is blocked; use a feature branch.");
    }
  }

  return {
    goal,
    branch: values.branch?.trim() ?? "",
    title: values.title?.trim() ?? "",
    body: values.body?.trim() ?? "",
    publish,
    help,
  };
}

export async function runPipelineCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  onEvent?: (event: AgentRunEvent) => void,
) {
  const options = parsePipelineArgs(args);
  if (options.help) {
    return {
      mode: "help",
      usage: "pnpm run pipeline -- --goal \"Describe the task\" [--publish --branch feat/name --title \"PR title\" --body \"PR summary\"]",
      note: "Read-only analysis is the default. Publishing requires both --publish and AGENT_FACTORY_ENABLE_GITHUB_WRITES=true.",
    };
  }

  if (!options.publish) {
    const analysis = await analyzeTezJetTask(options.goal);
    return { mode: "analysis-only", analysis, note: "No branch or pull request was created. Add --publish and explicitly enable writes to publish a draft PR." };
  }

  if (env.AGENT_FACTORY_ENABLE_GITHUB_WRITES !== "true") {
    throw new Error("Publishing is disabled. Set AGENT_FACTORY_ENABLE_GITHUB_WRITES=true and pass --publish to allow GitHub writes.");
  }

  const result = await generateAndPrepareTezJetChange({
    goal: options.goal,
    branch: options.branch,
    title: options.title,
    body: options.body,
    onEvent,
  });
  return { mode: "publish", result };
}

async function main() {
  try {
    const result = await runPipelineCli(process.argv.slice(2), process.env, (event) => {
      console.log(JSON.stringify({ type: "agent_event", event }));
    });
    console.log(JSON.stringify(result, null, 2));
    if ("result" in result) process.exitCode = commanderExitCode(result.result.status);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
