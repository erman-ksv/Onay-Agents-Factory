import { constants, openSync, closeSync, fstatSync, readFileSync, mkdirSync, lstatSync, writeFileSync, renameSync } from "node:fs";
import { isAbsolute, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { prepareTeamTask } from "./teamTaskCard.js";
import { runTeamTask, teamTaskSummary } from "./teamTask.js";
import { verifyRecordedTeamTask } from "./teamTaskVerification.js";

export function parseTeamTaskCli(args: string[]) {
  const values: Record<string, string> = {};
  const allowed = new Set(["--task", "--state-dir", "--mode", "--output-dir"]);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!allowed.has(name) || Object.hasOwn(values, name) || !value || value.startsWith("--"))
      throw new Error("Invalid team-task arguments.");
    values[name] = value;
  }
  if (Object.keys(values).length !== 4 || !["plan", "run", "verify"].includes(values["--mode"]) ||
      ["--task", "--state-dir", "--output-dir"].some(name => !isAbsolute(values[name]) || resolve(values[name]) !== values[name]))
    throw new Error("Use --task ABSOLUTE_JSON --state-dir ABSOLUTE_DIR --mode plan|run|verify --output-dir ABSOLUTE_DIR.");
  return { task: values["--task"], state: values["--state-dir"], mode: values["--mode"], output: values["--output-dir"] };
}

function readCard(path: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.size < 2 || info.size > 8_192)
      throw new Error("Task card must be a bounded regular JSON file.");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
}
function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o022) ||
      (process.getuid && info.uid !== process.getuid()))
    throw new Error("Task output/state directory must be owned and private.");
}
function writeReport(directory: string, report: unknown, summary: string): void {
  privateDirectory(directory);
  for (const [name, content] of [["report.json", JSON.stringify(report, null, 2) + "\n"], ["summary.md", summary]]) {
    const temporary = join(directory, "." + name + "." + randomBytes(8).toString("hex"));
    writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
    renameSync(temporary, join(directory, name));
  }
}

export async function runTeamTaskCli(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<{ code: number; report: unknown }> {
  const options = parseTeamTaskCli(args);
  const input = readCard(options.task);
  const task = prepareTeamTask(input);
  privateDirectory(options.output);
  if (options.mode === "plan") {
    const report = {
      mode: "plan", taskId: task.id, fingerprint: task.fingerprint, repository: task.repository,
      goal: task.goal, acceptanceCriteria: task.acceptanceCriteria,
      baseRef: task.baseRef, baseSha: task.baseSha, branch: task.branch,
      changePaths: task.changePaths, explorerPaths: task.explorerPaths,
      requiredActors: task.requiredActors, requiredCiNames: task.requiredCiNames, requiredCiSteps: task.requiredCiSteps,
      modelRequests: 0, githubWrites: false, legalReview: "disabled",
      note: "Plan only. One explicit run approval is required; no installation, model call or GitHub request occurred.",
    };
    writeReport(options.output, report, "# Onay task plan " + task.id + "\n" + task.goal +
      "\n\nOnly the exact approved paths may change. No model/GitHub call was made.\n");
    return { code: 0, report };
  }
  privateDirectory(options.state);
  if (options.mode === "verify") {
    if (env.AGENT_FACTORY_ENABLE_GITHUB_WRITES !== "false" || env.AGENT_FACTORY_LEGAL_ENABLED !== "false" || !env.GITHUB_TOKEN)
      throw new Error("Verification needs read access, writes explicitly disabled and legal disabled.");
    for (const name of ["GITHUB_TOKEN", "ONAY_REPOSITORY", "AGENT_ALLOWED_REPOSITORIES"] as const) {
      if (env[name] !== process.env[name]) throw new Error("Verification repository configuration must match the host environment.");
    }
    const { GitHubClient } = await import("../github/githubClient.js");
    const { inspectTestExecution } = await import("../agents/tester/agent.js");
    const github = new GitHubClient({ repository: task.repository, token: env.GITHUB_TOKEN });
    const report = await verifyRecordedTeamTask(input, options.state, {
      getCandidateHead: branch => github.getCommitSha(branch),
      getPullRequest: async number => {
        const response = await fetch("https://api.github.com/repos/" + task.repository + "/pulls/" + number, {
          headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + env.GITHUB_TOKEN },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error("Draft PR identity could not be verified.");
        return response.json();
      },
      verify: (sha, branch) => inspectTestExecution(sha, task.repository, branch, task.requiredCiNames, task.requiredCiSteps),
    });
    writeReport(options.output, report, "# Onay CI verification " + task.id + "\nStatus: " + report.status +
      "\nModels: 0; writes: 0. This verifies current CI only; receipts do not prove prior agent execution.\n");
    return { code: report.status === "ci-verified" ? 0 : report.status === "needs-review" ? 11 : 10, report };
  }
  // Validate BEFORE importing the SDK or reading provider configuration.
  if (env.ONAY_TEAM_LIVE_APPROVED !== "RUN_ONE_FREE_TASK" || env.ONAY_TEAM_FREE_TIER_CONFIRMED !== "true" ||
      env.AGENT_FACTORY_ENABLE_GITHUB_WRITES !== "true" || env.AGENT_FACTORY_LEGAL_ENABLED !== "false" ||
      env.AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES === "true")
    throw new Error("One free-tier task/Draft PR is not explicitly approved; no models or GitHub writes started.");
  const { createLiveTaskDependencies } = await import("./teamTaskRuntime.js");
  const configured = createLiveTaskDependencies(task, { ...env, AGENT_FACTORY_PROVIDER: task.provider });
  const result = await runTeamTask(input, {
    stateDirectory: options.state, env, dependencies: configured.dependencies, execution: "live",
  });
  const report = { ...result, modelBudget: configured.budget.snapshot() };
  writeReport(options.output, report, teamTaskSummary(result));
  return { code: result.status === "completed" ? 0 : ["needs-review", "already-recorded"].includes(result.status) ? 11 : 10, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runTeamTaskCli(process.argv.slice(2)).then(({ code, report }) => {
    console.log(JSON.stringify(report, null, 2)); process.exitCode = code;
  }).catch(() => {
    console.error("Onay team task stopped. Inspect the bounded task card, approval, private receipt and GitHub candidate; no automatic replay.");
    process.exitCode = 10;
  });
}
