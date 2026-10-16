import { inspectOnay } from "../../github/onayExplorer.js";

export async function inspectBackend(paths?: string[], ref = "main") {
  const result = await inspectOnay(paths, ref);
  return { agent: "backend", ...result };
}

export function runBackendAgent(input: string) {
  return { agent: "backend", input, action: "implement backend changes" };
}
