import { calculatorSources, type CalculatorSnapshot } from "../github/calculatorSnapshot.js";
import { scanForSecrets } from "../github/secretScanner.js";
import type { PreparedCalculatorChanges } from "../commander/calculatorChanges.js";
import type { CalculatorPlanTask } from "./calculatorPlan.js";
import { calculatorProposalDigest, validateCalculatorProposalTests, type CalculatorProposalTests } from "./calculatorExecutionEvidence.js";

export const CALCULATOR_ASSESSMENT_EVIDENCE_ERROR = "Calculator assessment evidence is unverified. No model call or publication is authorized.";
const refuse = (): never => { throw new Error(CALCULATOR_ASSESSMENT_EVIDENCE_ERROR); };
export const CALCULATOR_UI_BROWSER_SCENARIOS = Object.freeze([
  "Entering 123 then deleting the last digit displays 12",
  "Clear permits a new calculation after input",
  "Clear permits a new calculation after a result",
]);
/** Returned by an independently configured trusted browser runner, never a model
 * or owner JSON. It must bind its execution to the exact proposal and core hash. */
export type CalculatorBrowserChecks = Readonly<{
  repository: string; taskId: string; baseSha: string; proposalDigest: string; dependencySha256: string;
  status: "passed"; testsExecuted: true; browser: string; sandboxDisabled: false;
  pageErrors: 0; blockedRequests: 0; scenarios: readonly string[];
}>;
declare const brand: unique symbol;
export type CalculatorAssessmentEvidence = Readonly<{ [brand]: true }>;
export type CalculatorAssessmentEvidenceProvider = (task: CalculatorPlanTask, changes: PreparedCalculatorChanges) =>
  CalculatorAssessmentEvidence | undefined | Promise<CalculatorAssessmentEvidence | undefined>;
type Record = { taskId: string; changes: PreparedCalculatorChanges; digest: string; packet: Readonly<{
  evidenceId: string; proposalDigest: string; baseSha: string;
  dependencyContract: Readonly<{ path: string; blobSha: string; sourceSha256: string; signature: string }>;
  proposalChecks: CalculatorProposalTests; browserChecks: CalculatorBrowserChecks;
  unverifiedAreas: readonly string[]; publicationAuthorized: false;
}> };
const records = new WeakMap<CalculatorAssessmentEvidence, Record>();

/** Host capability boundary, like the sandbox/checkProposal adapter. The host
 * supplies FUNCTIONS for actual checks; serialized claims cannot create a token.
 * Core source stays in the branded snapshot. Only a fixed signature is disclosed.
 * This function neither approves roles nor permits writes or task replay. */
export async function collectCalculatorAssessmentEvidence(task: CalculatorPlanTask, changes: PreparedCalculatorChanges,
  dependencies: CalculatorSnapshot, runners: {
    checkProposal(input: { task: CalculatorPlanTask; changes: PreparedCalculatorChanges; proposalDigest: string }): Promise<CalculatorProposalTests>;
    checkBrowser(input: { task: CalculatorPlanTask; changes: PreparedCalculatorChanges; proposalDigest: string;
      dependencySha256: string }): Promise<CalculatorBrowserChecks>;
  }): Promise<CalculatorAssessmentEvidence> {
  try {
    if (task.role !== "frontend" || task.acceptanceIds.length !== 2 ||
        !["clear", "backspace"].every(id => task.acceptanceIds.includes(id)) || task.paths.length !== 3 ||
        !["index.html", "styles.css", "src/app.mjs"].every(path => task.paths.includes(path)) ||
        changes.files.length !== 3 || changes.files.some(file => !task.paths.includes(file.path)) ||
        new Set(changes.files.map(file => file.path)).size !== 3 ||
        dependencies.repository !== changes.repository || dependencies.baseRef !== changes.baseRef || dependencies.baseSha !== changes.baseSha ||
        typeof runners?.checkProposal !== "function" || typeof runners.checkBrowser !== "function") return refuse();
    const sources = calculatorSources(dependencies), path = "src/calculator.mjs", source = sources.get(path);
    const metadata = dependencies.files.find(file => file.path === path);
    // Deliberately narrow pilot contract. Unrecognized exports fail closed;
    // there is no guessed API or full-source fallback.
    if (!source || !metadata?.exists || !metadata.blobSha || !metadata.sourceSha256 ||
        !/^export[ \t]+function[ \t]+calculate[ \t]*\([ \t]*left[ \t]*,[ \t]*operator[ \t]*,[ \t]*right[ \t]*\)[ \t]*\{/.test(source)) return refuse();
    const digest = calculatorProposalDigest(changes), input = { task, changes, proposalDigest: digest };
    const proposalChecks = validateCalculatorProposalTests(await runners.checkProposal(input), task.id, changes);
    if (proposalChecks.status !== "passed" || !proposalChecks.testsExecuted) return refuse();
    const browser = await runners.checkBrowser({ ...input, dependencySha256: metadata.sourceSha256 });
    if (!browser || Object.keys(browser).sort().join(",") !== "baseSha,blockedRequests,browser,dependencySha256,pageErrors,proposalDigest,repository,sandboxDisabled,scenarios,status,taskId,testsExecuted" ||
        browser.repository !== changes.repository || browser.taskId !== task.id || browser.baseSha !== changes.baseSha ||
        browser.proposalDigest !== digest || browser.dependencySha256 !== metadata.sourceSha256 || browser.status !== "passed" ||
        browser.testsExecuted !== true || browser.sandboxDisabled !== false || browser.pageErrors !== 0 || browser.blockedRequests !== 0 ||
        typeof browser.browser !== "string" || !/^Chrome\/[0-9.]{1,40}$/.test(browser.browser) ||
        !Array.isArray(browser.scenarios) || JSON.stringify(browser.scenarios) !== JSON.stringify(CALCULATOR_UI_BROWSER_SCENARIOS) ||
        calculatorProposalDigest(changes) !== digest) return refuse();
    const packet = Object.freeze({ evidenceId: "host-checks@" + digest, proposalDigest: digest, baseSha: changes.baseSha,
      dependencyContract: Object.freeze({ path, blobSha: metadata.blobSha, sourceSha256: metadata.sourceSha256,
        signature: "calculate(left, operator, right)" }), proposalChecks,
      browserChecks: Object.freeze({ ...browser, scenarios: Object.freeze([...browser.scenarios]) }),
      unverifiedAreas: Object.freeze(["Unshown unchanged source beyond the verified arithmetic export signature",
        "Keyboard, narrow-screen layout, chained expressions, other browsers and phones",
        "Independent model verdicts, publication, exact-candidate CI and overall completion"]), publicationAuthorized: false as const });
    const text = JSON.stringify(packet);
    if (Buffer.byteLength(text) > 3000 || scanForSecrets(text).length) return refuse();
    const token = Object.freeze({}) as CalculatorAssessmentEvidence;
    records.set(token, { taskId: task.id, changes, digest, packet }); return token;
  } catch { return refuse(); }
}

/** Serialization cannot recreate the WeakMap identity or move proof to another
 * object/task/base/content. Validation precedes all model budget reservations. */
export function calculatorAssessmentEvidencePacket(token: CalculatorAssessmentEvidence, task: CalculatorPlanTask,
  changes: PreparedCalculatorChanges) {
  const record = records.get(token);
  if (!record || record.taskId !== task.id || record.changes !== changes || record.digest !== calculatorProposalDigest(changes)) return refuse();
  return record.packet;
}
