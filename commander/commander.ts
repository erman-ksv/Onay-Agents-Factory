import { planTask } from "./planner.js";
import { routeTask } from "./router.js";

const goal = process.argv.slice(2).join(" ").trim();

if (!goal) {
  console.error("Usage: pnpm dev -- <describe the task>");
  process.exit(1);
}

if (process.env.OPENAI_API_KEY) {
  const { runAiCommander } = await import("./aiCommander.js");
  console.log(await runAiCommander(goal));
} else {
  const plan = planTask(goal);
  console.log(JSON.stringify({
    commander: "TezJet Commander",
    mode: "deterministic",
    task: plan,
    execution: routeTask(plan.steps),
    note: "Set OPENAI_API_KEY to enable AI orchestration."
  }, null, 2));
}
