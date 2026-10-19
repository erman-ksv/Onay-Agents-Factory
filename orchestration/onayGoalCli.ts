import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { continueOnayGoal, inspectOnayGoal, planOnayGoal, type GoalReport } from "./onayGoal.js";
import { prepareGoalRequest } from "./onayGoalPlan.js";

export function parseOnayGoalCli(args: string[]) {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!["--goal", "--state-dir", "--mode", "--output-dir"].includes(name) ||
        Object.hasOwn(values, name) || !value || value.startsWith("--")) throw new Error("Invalid Onay goal arguments.");
    values[name] = value;
  }
  if (Object.keys(values).length !== 4 || !["plan", "continue", "inspect"].includes(values["--mode"]) ||
      ["--goal", "--state-dir", "--output-dir"].some(name => !isAbsolute(values[name]) || resolve(values[name]) !== values[name]))
    throw new Error("Use --goal ABSOLUTE_JSON --state-dir ABSOLUTE_DIR --mode plan|continue|inspect --output-dir ABSOLUTE_DIR.");
  return { goal: values["--goal"], state: values["--state-dir"], mode: values["--mode"], output: values["--output-dir"] };
}
function readGoal(path: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 2 || stat.size > 24_576) throw new Error("Goal input is not a bounded JSON file.");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
}
function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 ||
      (process.getuid && stat.uid !== process.getuid())) throw new Error("Goal state and output directories must be private and owned.");
}
function saveReport(directory: string, report: GoalReport): void {
  privateDirectory(directory);
  const summary = "# Onay development batch " + report.goalId + "\nStatus: " + report.status + "\nReason: " + report.reasonCode +
    "\n\n" + report.tasks.map(task => "- " + task.id + ": " + task.status + (task.reasonCode ? " (" + task.reasonCode + ")" : "") +
      (task.url ? " — " + task.url : "")).join("\n") +
    "\n\nWhole app completed: false. Draft PRs require review/integration; legal agent disabled.\n\nUnverified:\n" +
    report.unverifiedAreas.map(item => "- " + item).join("\n") + "\n";
  for (const [name, content] of [["report.json", JSON.stringify(report, null, 2) + "\n"], ["summary.md", summary]]) {
    const temporary = join(directory, "." + name + "." + randomBytes(8).toString("hex"));
    writeFileSync(temporary, content, { mode: 0o600, flag: "wx" }); renameSync(temporary, join(directory, name));
  }
}

export async function runOnayGoalCli(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<{ code: number; report: GoalReport }> {
  const options = parseOnayGoalCli(args);
  const input = readGoal(options.goal), request = prepareGoalRequest(input);
  privateDirectory(options.state); privateDirectory(options.output);
  let report: GoalReport;
  if (options.mode === "inspect") report = inspectOnayGoal(input, options.state);
  else {
    const plan = options.mode === "plan";
    if (env.ONAY_GOAL_APPROVED !== (plan ? "PLAN_FREE_GOAL" : "RUN_FREE_GOAL_CYCLE") ||
        env.ONAY_TEAM_FREE_TIER_CONFIRMED !== "true" || env.AGENT_FACTORY_LEGAL_ENABLED !== "false" ||
        env.AGENT_FACTORY_ENABLE_GITHUB_WRITES !== (plan ? "false" : "true") ||
        env.AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES === "true" ||
        (!plan && env.ONAY_TEAM_LIVE_APPROVED !== "RUN_ONE_FREE_TASK"))
      throw new Error("The selected free-tier goal mode is not explicitly approved; no SDK, model or GitHub operation started.");
    const { createLiveGoalDependencies } = await import("./onayGoalRuntime.js");
    const dependencies = createLiveGoalDependencies(request, options.state, { ...env, AGENT_FACTORY_PROVIDER: request.provider });
    report = plan ? await planOnayGoal(input, options.state, dependencies) : await continueOnayGoal(input, options.state, dependencies);
  }
  saveReport(options.output, report);
  return { code: options.mode === "inspect" ? 0 : report.status === "blocked" ? 10 : report.status === "waiting" ? 11 : 0, report };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runOnayGoalCli(process.argv.slice(2)).then(({ code, report }) => {
    console.log(JSON.stringify(report, null, 2)); process.exitCode = code;
  }).catch(() => {
    console.error("Onay goal stopped. Inspect the private goal state, planning/task locks and exact GitHub candidates. No automatic replay.");
    process.exitCode = 10;
  });
}
