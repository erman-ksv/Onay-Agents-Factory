import { planTask } from "./planner.js";
import { routeTask } from "./router.js";

const task = process.argv.slice(2).join(" ") || "Initialize TezJet Agent Factory";
const plan = planTask(task);
console.log(JSON.stringify({ task, plan, route: routeTask(plan) }, null, 2));
