/** Explicit, one-use host recovery of the reviewed failed step-7 planning attempt.
 * The old failed receipt stays intact. This is not a retry policy or new goal. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, chmodSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { prepareCalculatorLaunchRequest, readCalculatorLaunchState, calculatorLaunchManifest, sanitizeCalculatorLaunchReport } from "./calculatorLaunchState.js";
import { prepareCalculatorGoal, createCalculatorPlan } from "./calculatorPlan.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { TeamTaskStore } from "./teamTaskStore.js";
import { createCalculatorModelTeam } from "./calculatorModelTeam.js";
import { runCalculatorRuntime } from "./calculatorRuntime.js";

const REPOSITORY = "erman-ksv/Onay-Agents-Factory", BRANCH = "feat/onay-task-runner-20261019";
const PATH = ".github/workflows/calculator-step7-recovery.yml";
const OLD_RUN = 39437299742, OLD_SHA = "08a2386f181cc615af58bf4f605ea8c4f1226fa1";
const OLD_RUNTIME = "d733e078800505534cd7c39f15406822416e7f24";
const CAPSULE = 12272791735, BARRIER = 12272402010;
const BINDING = "3e960ac2f9771c75719df71a75cdcf6c63f1905ca10f32e4510c3f283a891aed";
const ERROR = "Calculator step-7 recovery refused; preserve all state and do not replay.";
// Prior usage was not recorded. Charge the full old request/context ceilings and
// 30 seconds (the observed CLI took < 9 seconds), rather than claiming zero cost.
export const CALCULATOR_RECOVERY_CHARGE = Object.freeze({ attemptedRequests: 1, totalRequestBytes: 24000, reservedRunTokens: 6000, elapsedMs: 30000 });
function refuse(): never { throw Error(ERROR); }
function hash(value: unknown): string { if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) return refuse(); return value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function read(path: string): unknown {
  const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 32768) return refuse();
  return JSON.parse(readFileSync(path, "utf8"));
}
function put(path: string, value: unknown): void { writeFileSync(path, JSON.stringify(value) + "\n", { mode: 0o600, flag: "wx" }); }
function privateDirectory(path: string): void {
  const stat = lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) return refuse();
  chmodSync(path, 0o700);
}
export function validateCalculatorRecoveryRequest(value: unknown, runtimeSha: string) {
  const raw = value as Record<string, unknown>;
  if (!raw || Object.keys(raw).sort().join(",") !== "approval,priorRunId,request,runtimeSha,version" || raw.version !== 1 ||
      raw.approval !== "ONE_REVIEWED_STEP7_RECOVERY" || raw.priorRunId !== OLD_RUN || raw.runtimeSha !== hash(runtimeSha)) return refuse();
  const request = prepareCalculatorLaunchRequest(raw.request, OLD_RUNTIME);
  if (request.mode !== "plan" || request.goal.id !== "calculator-pilot-step7-v1" || request.goal.provider !== "groq" ||
      request.goal.baseSha !== "2c1218f2b020962ad93adf68d902a847271a7e72") return refuse();
  return request;
}
export function validateCalculatorFailedPlanningCapsule(root: string, request: ReturnType<typeof prepareCalculatorLaunchRequest>) {
  const capsule = join(root, "prior-capsule"), barrier = join(root, "prior-barrier");
  privateDirectory(capsule); privateDirectory(barrier);
  if (readdirSync(capsule).sort().join(",") !== "completion.json,launch.json,report,state" || readdirSync(barrier).join(",") !== "launch.json") return refuse();
  const launch = read(join(capsule, "launch.json")) as ReturnType<typeof calculatorLaunchManifest>;
  const expected = calculatorLaunchManifest(request, OLD_RUN, OLD_SHA, hash(launch.requestBlobSha));
  if (JSON.stringify(launch) !== JSON.stringify(expected) || JSON.stringify(read(join(barrier, "launch.json"))) !== JSON.stringify(expected) || launch.binding !== BINDING) return refuse();
  for (const name of ["state", "report"]) privateDirectory(join(capsule, name));
  if (readdirSync(join(capsule, "report")).join(",") !== "calculator-report.json") return refuse();
  for (const name of readdirSync(join(capsule, "state"))) {
    const path = join(capsule, "state", name), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 32768) return refuse(); chmodSync(path, 0o600);
  }
  const state = readCalculatorLaunchState(join(capsule, "state"), request);
  const name = "calc-planning-" + request.goal.id + ".json", data = state.get(name);
  if (state.size !== 1 || !data) return refuse();
  const receipt = JSON.parse(data.toString("utf8")), completion = read(join(capsule, "completion.json")) as Record<string, unknown>;
  const report = sanitizeCalculatorLaunchReport(read(join(capsule, "report/calculator-report.json")), request);
  if (receipt.status !== "blocked" || receipt.reasonCode !== "planning_interrupted_no_replay" || receipt.publication ||
      JSON.stringify(receipt.stages) !== '[{"stage":"model_plan","status":"running"}]' ||
      Object.keys(completion).sort().join(",") !== "exitCode,manifestDigest,reportDigest,stateDigests,version" || completion.version !== 1 || completion.exitCode !== 10 ||
      completion.manifestDigest !== digest(expected) || completion.reportDigest !== digest(report) || report.status !== "blocked" ||
      JSON.stringify(completion.stateDigests) !== JSON.stringify({ [name]: createHash("sha256").update(data).digest("hex") })) return refuse();
  return { request, state, priorManifestDigest: digest(expected), priorStateDigest: digest(completion.stateDigests) };
}
export async function verifyCalculatorRecoveryHistory(env: NodeJS.ProcessEnv, transport: typeof fetch = globalThis.fetch): Promise<void> {
  if (!env.GITHUB_TOKEN || env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== "refs/heads/" + BRANCH || env.GITHUB_EVENT_NAME !== "push" ||
      env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_RUN_NUMBER !== "1" || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "")) return refuse();
  let calls = 0;
  async function get(endpoint: string) {
    if (++calls > 8) return refuse();
    const response = await transport("https://api.github.com/repos/" + REPOSITORY + endpoint, { method: "GET", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { Authorization: "Bearer " + env.GITHUB_TOKEN, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
    if (!response.ok || !response.body) { void response.body?.cancel().catch(() => undefined); return refuse(); }
    const stream = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const part = await stream.read(); if (part.done) break; size += part.value.byteLength; if (size > 1048576) { await stream.cancel(); return refuse(); } chunks.push(part.value); } }
    finally { stream.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  function scope(run: Record<string, any>, path: string) {
    if (run.path !== path || run.head_branch !== BRANCH || run.event !== "push" || run.run_attempt !== 1 ||
        run.repository?.full_name !== REPOSITORY || run.head_repository?.full_name !== REPOSITORY) return refuse();
  }
  const current = await get("/actions/runs/" + env.GITHUB_RUN_ID); scope(current, PATH);
  if (current.head_sha !== hash(env.GITHUB_SHA) || current.run_number !== 1 || current.id !== Number(env.GITHUB_RUN_ID)) return refuse();
  const listed = await get("/actions/workflows/" + current.workflow_id + "/runs?per_page=100");
  if (listed.total_count !== 1 || listed.workflow_runs?.length !== 1 || listed.workflow_runs[0].id !== current.id) return refuse();
  const old = await get("/actions/runs/" + OLD_RUN); scope(old, ".github/workflows/calculator-one-cycle.yml");
  if (old.id !== OLD_RUN || old.head_sha !== OLD_SHA || old.status !== "completed" || old.conclusion !== "failure" || old.run_number !== 1 ||
      !Number.isFinite(Date.parse(old.updated_at)) || Date.now() - Date.parse(old.updated_at) < 60000) return refuse();
  const oldRuns = await get("/actions/workflows/" + old.workflow_id + "/runs?per_page=100");
  if (oldRuns.total_count !== 1 || oldRuns.workflow_runs?.length !== 1 || oldRuns.workflow_runs[0].id !== OLD_RUN) return refuse();
  const artifacts = await get("/actions/runs/" + OLD_RUN + "/artifacts?per_page=100");
  if (artifacts.total_count !== 3 || artifacts.artifacts?.length !== 3) return refuse();
  for (const [id, checksum] of [[CAPSULE, "bc64073a4fba21a9998e6cfdd7e389b32d461f5394995f0f16efcf20531f2262"], [BARRIER, "2701db5727ec692a3a28f816592d0c4aaf7dcfc7cd70193a233ae6bd542352fc"]] as const) {
    const artifact = artifacts.artifacts.find((item: { id: number }) => item.id === id);
    if (!artifact || artifact.expired !== false || artifact.digest !== "sha256:" + checksum || artifact.size_in_bytes < 1 || artifact.size_in_bytes > 1048576 ||
        artifact.workflow_run?.id !== OLD_RUN || artifact.workflow_run?.head_sha !== OLD_SHA) return refuse();
  }
  const after = await get("/actions/workflows/" + current.workflow_id + "/runs?per_page=100");
  if (after.total_count !== 1 || after.workflow_runs?.length !== 1 || after.workflow_runs[0].id !== current.id) return refuse();
}
export async function runCalculatorStep7Recovery(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (args.length !== 3 || !["prepare", "execute"].includes(args[0]) || !isAbsolute(args[1]) || resolve(args[1]) !== args[1]) return refuse();
  const [phase, root, runtimeSha] = args; hash(runtimeSha);
  if (phase === "prepare") {
    await verifyCalculatorRecoveryHistory(env);
    privateDirectory(root);
    const raw = read(join(env.GITHUB_WORKSPACE!, "request/.factory/calculator-step7-recovery-request.json"));
    const request = validateCalculatorRecoveryRequest(raw, runtimeSha), prior = validateCalculatorFailedPlanningCapsule(root, request);
    mkdirSync(join(root, "state"), { mode: 0o700 }); mkdirSync(join(root, "barrier"), { mode: 0o700 });
    for (const [name, bytes] of prior.state) writeFileSync(join(root, "state", name), bytes, { mode: 0o600, flag: "wx" });
    put(join(root, "context.json"), { version: 1, runtimeSha, eventSha: hash(env.GITHUB_SHA), runId: env.GITHUB_RUN_ID, request });
    put(join(root, "barrier/recovery.json"), { version: 1, goalId: request.goal.id, priorRunId: OLD_RUN, recoveryRunId: env.GITHUB_RUN_ID,
      runtimeSha, eventSha: hash(env.GITHUB_SHA), priorManifestDigest: prior.priorManifestDigest, priorStateDigest: prior.priorStateDigest,
      conservativePriorCharge: CALCULATOR_RECOVERY_CHARGE, authorization: "ONE_REVIEWED_STEP7_RECOVERY", automaticReplay: false });
    return;
  }
  privateDirectory(root);
  const context = read(join(root, "context.json")) as { runtimeSha: string; eventSha: string; runId: string; request: unknown };
  const barrier = read(join(root, "barrier/recovery.json")) as { conservativePriorCharge: unknown; recoveryRunId: string; eventSha: string; runtimeSha: string };
  if (env.CALCULATOR_RECOVERY_BARRIER_UPLOADED !== "true" || context.runtimeSha !== runtimeSha || context.eventSha !== env.GITHUB_SHA || context.runId !== env.GITHUB_RUN_ID ||
      barrier.runtimeSha !== runtimeSha || barrier.recoveryRunId !== env.GITHUB_RUN_ID || barrier.eventSha !== env.GITHUB_SHA ||
      digest(barrier.conservativePriorCharge) !== digest(CALCULATOR_RECOVERY_CHARGE)) return refuse();
  const request = prepareCalculatorLaunchRequest(context.request, OLD_RUNTIME), owner = prepareCalculatorGoal(request.goal);
  const prior = validateCalculatorFailedPlanningCapsule(root, request), active = readCalculatorLaunchState(join(root, "state"), request);
  if (active.size !== 1 || [...active].some(([name, bytes]) => !bytes.equals(prior.state.get(name)!))) return refuse();
  if (env.AGENT_FACTORY_PROVIDER !== "groq" || env.GROQ_MODEL || env.AGENT_FACTORY_LEGAL_ENABLED !== "false") return refuse();
  const marker = new TeamTaskStore(join(root, "state"), { id: "calc-recovery-" + owner.id, fingerprint: digest(barrier) });
  let team: ReturnType<typeof createCalculatorModelTeam> | undefined;
  try {
    if (marker.claim() !== "claimed") return refuse();
    const readiness = await runCalculatorRuntime(request.goal, request.config, join(root, "state"), "preflight", env);
    if (readiness.status !== "ready-for-explicit-plan-or-run") return refuse();
    marker.recordStage("recovery_plan", "running");
    team = createCalculatorModelTeam(request.goal, env, globalThis.fetch, {}, CALCULATOR_RECOVERY_CHARGE);
    const plan = await team.plan(), checked = createCalculatorPlan(request.goal, plan.proposal), first = checked.tasks[0];
    if (checked.status !== "planned" || checked.fingerprint !== plan.fingerprint || !first || first.role !== "coder" || first.dependsOn.length ||
        [...first.paths].sort().join(",") !== "src/calculator.mjs,test/calculator.test.mjs") return refuse();
    new CalculatorPlanStore(join(root, "state"), request.goal).initialize(plan.proposal);
    marker.recordStage("recovery_plan", "passed");
    console.log(JSON.stringify({ event: "calculator_recovery_plan_saved", planFingerprint: plan.fingerprint,
      tasks: plan.tasks.map(({ id, role, paths, dependsOn, acceptanceIds }) => ({ id, role, paths, dependsOn, acceptanceIds })),
      modelAccounting: team.snapshot(), legalEnabled: false, wholeAppCompleted: false }));
    put(join(root, "planning-accounting.json"), team.snapshot());
    // One explicit task only. The unchanged runtime still requires every role,
    // scoped snapshots, host proposal tests, atomic publication and exact CI.
    marker.recordStage("one_task", "running");
    const result = await runCalculatorRuntime(request.goal, request.config, join(root, "state"), "run", env);
    marker.recordStage("one_task", result.status === "blocked" ? "blocked" : "passed");
    marker.finish(result.status === "blocked" ? "blocked" : "needs-review", "one_recovery_task_attempted_no_replay");
    put(join(root, "calculator-report.json"), result); console.log(JSON.stringify(result));
    if (result.status === "blocked") process.exitCode = 10;
  } catch {
    if (team) console.error(JSON.stringify({ event: "calculator_recovery_stopped", ...team.diagnostic() }));
    try { marker.finish("blocked", "recovery_stopped_no_replay"); } catch { /* Existing terminal marker remains intact. */ }
    throw Error(ERROR);
  } finally { marker.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runCalculatorStep7Recovery(process.argv.slice(2)).catch(() => { console.error(ERROR); process.exitCode = 10; });
