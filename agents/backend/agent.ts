import { inspectTezJet } from "../../github/tezjetExplorer.js";

export async function inspectBackend(paths?: string[], ref = "main") {
  const result = await inspectTezJet(paths, ref);
  return { agent: "backend", ...result };
}

export function runBackendAgent(input: string) {
  return { agent: "backend", input, action: "implement backend changes" };
}
