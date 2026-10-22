/** Real host composition. No replacement app code, default success, image pull,
 * dependency install, provider call, remote admission or publication here. */
import { calculatorSources, type CalculatorSnapshotReader, type CalculatorSnapshot } from "../github/calculatorSnapshot.js";
import { createCalculatorRepairArchiveLoader, type CalculatorRepairArchive } from "./calculatorAgentRepairArchive.js";
import { collectCalculatorAssessmentEvidence, type CalculatorBrowserChecks } from "./calculatorAssessmentEvidence.js";
import { createCalculatorSandbox, type CalculatorSandboxProcess } from "./calculatorSandbox.js";
import type { CalculatorAgentRepairHost } from "./calculatorAgentRepair.js";
import type { CalculatorPlan, CalculatorPlanTask } from "./calculatorPlan.js";
import type { PreparedCalculatorChanges } from "../commander/calculatorChanges.js";

export const CALCULATOR_REPAIR_HOST_ERROR = "Repair checks unavailable or stale; no model call or publication is authorized.";
const refuse = (): never => { throw Error(CALCULATOR_REPAIR_HOST_ERROR); };
/** Independently configured trusted isolated browser runner. A readiness JSON or
 * model verdict is not a runner. No browser implementation/fallback is invented
 * when its isolation, binary or fixed acceptance scenarios are unavailable. */
export type CalculatorRepairBrowserRunner = Readonly<{
  preflight(): Promise<Readonly<{ ready: true; sandboxDisabled: false; networkIsolated: true; credentialsExcluded: true }>>;
  check(input: Readonly<{ task: CalculatorPlanTask; changes: PreparedCalculatorChanges; proposalDigest: string;
    dependencySha256: string; baseSources: ReadonlyMap<string, string> }>): Promise<CalculatorBrowserChecks>;
}>;
export function createCalculatorRepairHost(archive: CalculatorRepairArchive, reader: CalculatorSnapshotReader,
  config: Readonly<{ nodeImage: string; browser: CalculatorRepairBrowserRunner }>, env: NodeJS.ProcessEnv = process.env,
  processRunner?: CalculatorSandboxProcess): CalculatorAgentRepairHost {
  if (!config || typeof config.nodeImage !== "string" || typeof config.browser?.preflight !== "function" ||
      typeof config.browser.check !== "function") return refuse();
  const load = createCalculatorRepairArchiveLoader(archive, reader), image = config.nodeImage;
  const preflightBrowser = config.browser.preflight.bind(config.browser), checkBrowser = config.browser.check.bind(config.browser);
  let active: { task: CalculatorPlanTask; snapshot: CalculatorSnapshot; dependencies: CalculatorSnapshot;
    sources: ReadonlyMap<string, string>; sandbox: ReturnType<typeof createCalculatorSandbox> } | undefined;
  let checked = false;
  return Object.freeze({
    async loadAuthenticatedFailure(plan: CalculatorPlan, task: CalculatorPlanTask, snapshot: CalculatorSnapshot) {
      const source = await load(plan, task, snapshot);
      if (active || task.role !== "frontend" || task.acceptanceIds.length !== 2 ||
          !["clear", "backspace"].every(id => task.acceptanceIds.includes(id))) return refuse();
      const sources = new Map([...calculatorSources(snapshot), ...calculatorSources(source.dependencySnapshot)]);
      if (!sources.has("src/calculator.mjs") || !sources.has("test/calculator.test.mjs")) return refuse();
      const sandbox = createCalculatorSandbox({ image, baseSha: snapshot.baseSha, baseSources: sources }, env, processRunner);
      if (!(await sandbox.preflight()).ready) return refuse();
      const browser = await preflightBrowser();
      if (!browser || browser.ready !== true || browser.sandboxDisabled !== false ||
          browser.networkIsolated !== true || browser.credentialsExcluded !== true) return refuse();
      if (await reader.getHead(snapshot.baseRef) !== snapshot.baseSha) return refuse();
      active = { task, snapshot, dependencies: source.dependencySnapshot, sources, sandbox }; return source;
    },
    async verifyRepairedProposal(task: CalculatorPlanTask, changes: PreparedCalculatorChanges, snapshot: CalculatorSnapshot) {
      if (checked || !active || task !== active.task || snapshot !== active.snapshot ||
          changes.repository !== snapshot.repository || changes.baseRef !== snapshot.baseRef || changes.baseSha !== snapshot.baseSha) return refuse();
      checked = true;
      if (await reader.getHead(snapshot.baseRef) !== snapshot.baseSha) return refuse();
      const state = active;
      const evidence = await collectCalculatorAssessmentEvidence(task, changes, state.dependencies, {
        checkProposal: state.sandbox.checkProposal,
        checkBrowser: input => checkBrowser({ ...input, baseSources: new Map(state.sources) }),
      });
      if (await reader.getHead(snapshot.baseRef) !== snapshot.baseSha) return refuse();
      return evidence;
    },
  });
}
