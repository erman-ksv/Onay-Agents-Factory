import { planTask } from "./planner.js";
import { routeTask } from "./router.js";
import { selectProviderConfig } from "./providerConfig.js";

const goal = process.argv.slice(2).join(" ").trim();

if (!goal) {
  console.error("Usage: pnpm dev -- <describe the task>");
  process.exit(1);
}

if (selectProviderConfig(process.env).provider !== "none") {
  const { runAiCommander } = await import("./aiCommander.js");
  console.log(await runAiCommander(goal));
} else {
  const plan = planTask(goal);
  console.log(JSON.stringify({
    commander: "TezJet Commander",
    mode: "deterministic",
    task: plan,
    execution: routeTask(plan.steps),
    note: "Set GEMINI_API_KEY or OPENAI_API_KEY to enable AI orchestration."
  }, null, 2));
}
