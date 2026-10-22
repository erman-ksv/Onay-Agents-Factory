/** Two-worker transport audit. Its synthetic consumed barrier is test evidence,
 * not a production task receipt or permission to skip/execute a real task. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TeamTaskStore } from "./teamTaskStore.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import { calculatorAfterCiEventIdentity, prepareCalculatorAfterCiRequest, runCalculatorAfterCi } from "./calculatorAfterCi.js";
import { calculatorRuntimeAfterCiEventPath } from "./calculatorRuntime.js";
import { exportCalculatorAfterCiEventState, inspectCalculatorAfterCiEventState, restoreCalculatorAfterCiEventState, prepareCalculatorEventOrigin } from "./calculatorAfterCiEventState.js";

const ERROR = "After-CI two-worker audit failed; no production task executed.";
function refuse(): never { throw Error(ERROR); }
export async function runCalculatorEventStateAudit(args: string[], env: NodeJS.ProcessEnv = process.env) {
  if (args.length !== 2 || !["export", "restore"].includes(args[0]!) || !isAbsolute(args[1]!) || resolve(args[1]!) !== args[1] ||
      env.GITHUB_REPOSITORY !== "erman-ksv/Onay-Agents-Factory" || env.GITHUB_EVENT_NAME !== "push" ||
      env.GITHUB_REF !== "refs/heads/feat/calculator-event-state-20261022" || env.GITHUB_RUN_ATTEMPT !== "1") return refuse();
  const [mode, root] = args as [string, string];
  const origin = prepareCalculatorEventOrigin({ repository: env.GITHUB_REPOSITORY, workflowPath: ".github/workflows/calculator-event-state-audit.yml",
    runId: Number(env.GITHUB_RUN_ID), runAttempt: 1, eventSha: env.GITHUB_SHA, runtimeSha: env.GITHUB_SHA });
  const saved = JSON.parse(readFileSync(new URL("./fixtures/calculatorStep7SavedPlan.json", import.meta.url), "utf8"));
  const request = prepareCalculatorAfterCiRequest({ version: 1, planFingerprint: saved.fingerprint,
    previousTaskId: saved.proposal.tasks[0].id, expectedNextTaskId: saved.proposal.tasks[1].id, candidateSha: "5c4bc71b3119a50d2ca7ce1dbdf12bcaa000ce75" });
  const key = calculatorAfterCiEventIdentity(request);
  if (mode === "export") {
    mkdirSync(root, { mode: 0o700 }); const source = join(root, "source"); mkdirSync(source, { mode: 0o700 });
    const marker = new TeamTaskStore(source, key);
    try {
      if (marker.claim() !== "claimed") return refuse(); marker.recordStage("transport_audit_only", "running"); marker.recordStage("transport_audit_only", "blocked");
      marker.finish("blocked", "transport_audit_no_production_execution");
    } finally { marker.close(); }
    const result = exportCalculatorAfterCiEventState(source, join(root, "artifact"), request, origin);
    writeFileSync(join(root, "report.json"), JSON.stringify(result) + "\n", { mode: 0o600, flag: "wx" });
    return { status: "event-barrier-exported", ...result, transportAuditOnly: true, modelsRun: false, productionTaskExecuted: false };
  }
  if (!/^[a-f0-9]{64}$/.test(env.EXPECTED_EVENT_MANIFEST_SHA256 ?? "")) return refuse();
  const artifact = inspectCalculatorAfterCiEventState(join(root, "incoming"), { request, origin, manifestSha256: env.EXPECTED_EVENT_MANIFEST_SHA256! });
  const metadata = join(root, "metadata"); mkdirSync(metadata, { mode: 0o700 }); const store = new CalculatorPlanStore(metadata, saved.request); store.initialize(saved.proposal);
  const eventDirectory = calculatorRuntimeAfterCiEventPath(metadata); mkdirSync(dirname(eventDirectory), { recursive: true, mode: 0o700 });
  restoreCalculatorAfterCiEventState(artifact, eventDirectory);
  let toolsCalled = 0; const forbidden = async (): Promise<never> => { toolsCalled++; throw Error("Consumed event must stop before tools"); };
  const result = await runCalculatorAfterCi(store, { getHead: forbidden, readCommit: forbidden, readTree: forbidden, readBlob: forbidden }, request,
    { eventDirectory, ci: forbidden, verifyDependencies: forbidden, execution: { execution: "offline-test", maxRepairs: 0,
      team: { generate: forbidden, repair: forbidden, assess: forbidden }, tools: { ci: forbidden, publish: forbidden, checkProposal: forbidden } } });
  if (result.reasonCode !== "after_ci_event_already_recorded_no_replay" || toolsCalled !== 0) return refuse();
  return { status: "event-barrier-restored-replay-blocked", ...artifact, toolsCalled, transportAuditOnly: true,
    modelsRun: false, productionTaskExecuted: false, successorReplayed: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runCalculatorEventStateAudit(process.argv.slice(2)).then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error(ERROR); process.exitCode = 10; });
