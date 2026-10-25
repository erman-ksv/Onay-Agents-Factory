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
export const CALCULATOR_KEYBOARD_BROWSER_SCENARIOS = Object.freeze([
  ...CALCULATOR_UI_BROWSER_SCENARIOS,
  "Keyboard and button calculations give the same result",
]);
export const CALCULATOR_NARROW_DOM_SELECTORS = Object.freeze([".calculator",".display",".keys",".key"]);
export const CALCULATOR_NARROW_BROWSER_SCENARIOS = Object.freeze([
  ...CALCULATOR_KEYBOARD_BROWSER_SCENARIOS,
  "At 360px controls and result work without horizontal scrolling",
]);
/** Returned by an independently configured trusted browser runner, never a model
 * or owner JSON. It must bind its execution to the exact proposal and core hash. */
export type CalculatorBrowserChecks = Readonly<{
  repository: string; taskId: string; baseSha: string; proposalDigest: string; dependencySha256: string;
  status: "passed"; testsExecuted: true; browser: string; sandboxDisabled: false;
  pageErrors: 0; blockedRequests: 0; scenarios: readonly string[];
  domSelectors?: readonly Readonly<{selector:string;matches:number}>[];
}>;
declare const brand: unique symbol;
export type CalculatorAssessmentEvidence = Readonly<{ [brand]: true }>;
export type CalculatorAssessmentEvidenceProvider = (task: CalculatorPlanTask, changes: PreparedCalculatorChanges) =>
  CalculatorAssessmentEvidence | undefined | Promise<CalculatorAssessmentEvidence | undefined>;
type Record = { taskId: string; changes: PreparedCalculatorChanges; digest: string;
  proposalChecks: CalculatorProposalTests; browserChecks: CalculatorBrowserChecks; packet: Readonly<{
  evidenceId: string; proposalDigest: string; baseSha: string;
  dependencyContract: Readonly<{ path: string; blobSha: string; sourceSha256: string; signature: string }>;
  proposalChecks: Pick<CalculatorProposalTests, "status" | "testsExecuted" | "failures">;
  browserChecks: Pick<CalculatorBrowserChecks, "status" | "testsExecuted" | "browser" | "sandboxDisabled" | "pageErrors" | "blockedRequests" | "scenarios" | "domSelectors">;
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
    const narrow = task.acceptanceIds.length === 1 && task.acceptanceIds[0] === "narrow-screen";
    const keyboard = task.acceptanceIds.length === 1 && task.acceptanceIds[0] === "keyboard";
    const paths = narrow ? ["index.html","styles.css"] : keyboard ? ["src/app.mjs", "test/ui.test.mjs"] : ["index.html", "styles.css", "src/app.mjs"];
    const scenarios = narrow ? CALCULATOR_NARROW_BROWSER_SCENARIOS : keyboard ? CALCULATOR_KEYBOARD_BROWSER_SCENARIOS : CALCULATOR_UI_BROWSER_SCENARIOS;
    if (task.role !== "frontend" || (!keyboard && !narrow && (task.acceptanceIds.length !== 2 ||
        !["clear", "backspace"].every(id => task.acceptanceIds.includes(id)))) || task.paths.length !== paths.length ||
        !paths.every(path => task.paths.includes(path)) ||
        !changes.files.length || changes.files.some(file => !task.paths.includes(file.path)) ||
        new Set(changes.files.map(file => file.path)).size !== changes.files.length ||
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
    if (!browser || Object.keys(browser).sort().join(",") !== (narrow ? "baseSha,blockedRequests,browser,dependencySha256,domSelectors,pageErrors,proposalDigest,repository,sandboxDisabled,scenarios,status,taskId,testsExecuted" : "baseSha,blockedRequests,browser,dependencySha256,pageErrors,proposalDigest,repository,sandboxDisabled,scenarios,status,taskId,testsExecuted") ||
        browser.repository !== changes.repository || browser.taskId !== task.id || browser.baseSha !== changes.baseSha ||
        browser.proposalDigest !== digest || browser.dependencySha256 !== metadata.sourceSha256 || browser.status !== "passed" ||
        browser.testsExecuted !== true || browser.sandboxDisabled !== false || browser.pageErrors !== 0 || browser.blockedRequests !== 0 ||
        typeof browser.browser !== "string" || !/^Chrome\/[0-9.]{1,40}$/.test(browser.browser) ||
        !Array.isArray(browser.scenarios) || JSON.stringify(browser.scenarios) !== JSON.stringify(scenarios) ||
        calculatorProposalDigest(changes) !== digest) return refuse();
    if(narrow&&(!Array.isArray(browser.domSelectors)||browser.domSelectors.length!==4||browser.domSelectors.some((f,i)=>Object.keys(f).sort().join(",")!=="matches,selector"||f.selector!==CALCULATOR_NARROW_DOM_SELECTORS[i]||!Number.isSafeInteger(f.matches)||f.matches<0||f.matches>1000)))return refuse();
    const packet = Object.freeze({ evidenceId: "host-checks@" + digest, proposalDigest: digest, baseSha: changes.baseSha,
      dependencyContract: Object.freeze({ path, blobSha: metadata.blobSha, sourceSha256: metadata.sourceSha256,
        signature: "calculate(left, operator, right)" }),
      // Identity occurs once above and in the outer task packet. Retain full
      // canonical checks privately; do not charge Groq for duplicate bindings.
      proposalChecks: Object.freeze({ status: proposalChecks.status, testsExecuted: proposalChecks.testsExecuted, failures: proposalChecks.failures }),
      browserChecks: Object.freeze({ status: browser.status, testsExecuted: browser.testsExecuted, browser: browser.browser,
        sandboxDisabled: browser.sandboxDisabled, pageErrors: browser.pageErrors, blockedRequests: browser.blockedRequests,
        scenarios: Object.freeze([...browser.scenarios]),...(narrow?{domSelectors:Object.freeze(browser.domSelectors!.map(f=>Object.freeze({...f})))}:{}) }),
      unverifiedAreas: Object.freeze(["Unshown unchanged source beyond the verified arithmetic export signature",
        narrow ? "Other viewport widths, browsers, physical phones and accessibility beyond the supplied scenarios" : keyboard ? "Narrow-screen layout, other browsers and phones" : "Keyboard, narrow-screen layout, chained expressions, other browsers and phones",
        "Independent model verdicts, publication, exact-candidate CI and overall completion"]), publicationAuthorized: false as const });
    const text = JSON.stringify(packet);
    if (Buffer.byteLength(text) > 3000 || scanForSecrets(text).length) return refuse();
    const token = Object.freeze({}) as CalculatorAssessmentEvidence;
    records.set(token, { taskId: task.id, changes, digest, proposalChecks,
      browserChecks: Object.freeze({ ...browser, scenarios: Object.freeze([...browser.scenarios]),...(narrow?{domSelectors:Object.freeze(browser.domSelectors!.map(f=>Object.freeze({...f})))}:{}) }), packet }); return token;
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
