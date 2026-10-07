import { planTask } from "./planner.js";
import { routeTask } from "./router.js";
const goal=process.argv.slice(2).join(" ").trim();
if(!goal){console.error("Usage: pnpm dev -- <describe the task>");process.exit(1);}
const plan=planTask(goal);
console.log(JSON.stringify({commander:"TezJet Commander",task:plan,execution:routeTask(plan.steps)},null,2));