import type { AgentName, TaskPlan } from "./taskTypes.js";
const routes:Array<[AgentName,string]>=[
["explorer","Inspect the repository and identify relevant files, architecture, constraints, and risks."],
["coder","Produce the smallest explicit code change set required by the goal. Return complete contents for changed files only."],
["backend","Implement backend/API changes when the task requires server-side work."],
["frontend","Implement UI/client changes when the task requires frontend work."],
["database","Design or implement schema, persistence, migrations, and data-access changes when required."],
["tester","Create or run tests that validate the requested behavior and regression safety."],
["security","Review the proposed solution for secrets, auth, permissions, input validation, and abuse risks."],
["reviewer","Perform a final engineering review and identify blocking issues before merge."]];
export function planTask(goal:string):TaskPlan{
const n=goal.toLowerCase();
const steps=routes.filter(([a])=>a==="frontend"?/frontend|ui|react|page|screen|component/.test(n):a==="database"?/database|db|schema|migration|postgres|redis|storage/.test(n):a==="backend"?/backend|api|server|route|controller|queue|fifo|order|driver/.test(n):true).map(([agent,objective])=>({agent,objective}));
return {id:"task-"+Date.now(),goal,steps,status:"queued"};
}