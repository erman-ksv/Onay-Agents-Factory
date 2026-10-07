import { inspectTezJet } from "../github/tezjetExplorer.js";
import { inspectTests } from "../agents/tester/agent.js";
import { inspectSecurity } from "../agents/security/agent.js";

export async function analyzeTezJetTask(goal: string) {
  const [exploration, tests, security] = await Promise.all([inspectTezJet(), inspectTests(), inspectSecurity()]);
  return {
    goal,
    stages: { explorer: exploration, tester: tests, security },
    next: "Backend/Coder must produce an explicit change set; CI and final review are required before a PR."
  };
}