import { createHash } from "node:crypto";
import { CALCULATOR_PROFILE, calculatorBranch, validateCalculatorScope } from "../config/calculatorProfile.js";
import { CALCULATOR_TEAM, buildCalculatorRoleInstructions } from "../commander/calculatorTeam.js";
import { scanForSecrets } from "../github/secretScanner.js";

export const CALCULATOR_PLAN_ERROR = "Calculator plan refused: invalid owner identity, scope, dependencies, or acceptance coverage.";
export function refuseCalculatorPlan(): never { throw new Error(CALCULATOR_PLAN_ERROR); }
export const CALCULATOR_REQUIREMENTS_SHA256 = "8e83351512d4a2aa58688590865cd6710a22bb4a97f268e521586abd2d0c5a27";
export const CALCULATOR_ACCEPTANCE = Object.freeze([
  { id: "addition", scenario: "2 + 3 = 5" },
  { id: "negative-result", scenario: "7 - 10 = -3" },
  { id: "multiplication", scenario: "6 * 4 = 24" },
  { id: "division", scenario: "9 / 3 = 3" },
  { id: "decimals", scenario: "0.5 * 4 = 2" },
  { id: "decimal-display", scenario: "0.1 + 0.2 displays 0.3 without a binary floating-point tail" },
  { id: "zero-recovery", scenario: "8 / 0 gives a clear error and subsequent input works" },
  { id: "backspace", scenario: "Entering 123 then deleting the last digit displays 12" },
  { id: "clear", scenario: "Clear permits a new calculation after input or a result" },
  { id: "keyboard", scenario: "Keyboard and button calculations give the same result" },
  { id: "narrow-screen", scenario: "At 360px controls and result work without horizontal scrolling" },
].map(item => Object.freeze(item)));
export type CalculatorGoalRequest = {
  version: 1; id: string; goal: string; baseRef: string; baseSha: string;
  provider: "cloudflare" | "groq" | "gemini";
};
export type PreparedCalculatorGoal = Readonly<CalculatorGoalRequest & {
  repository: string; requirementsSha256: string; ownerFingerprint: string;
}>;
export type CalculatorPlanTask = Readonly<{
  id: string; role: "coder" | "frontend"; goal: string;
  acceptanceIds: readonly string[]; paths: readonly string[]; dependsOn: readonly string[];
}>;
type Proposal = Readonly<{ tasks: readonly CalculatorPlanTask[]; blockers: readonly string[]; unverifiedAreas: readonly string[] }>;
export type CalculatorPlan = Readonly<{
  version: 1; request: Readonly<CalculatorGoalRequest>; owner: PreparedCalculatorGoal;
  fingerprint: string; branch: string; proposal: Proposal; tasks: readonly CalculatorPlanTask[];
  blockers: readonly string[]; unverifiedAreas: readonly string[]; status: "planned" | "blocked";
  wholeAppCompleted: false; publicationAuthorized: false;
}>;
export function planObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
export function planKeys(value: Record<string, unknown>, names: string[]): boolean {
  return Object.keys(value).length === names.length && names.every(key => Object.hasOwn(value, key));
}
function text(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value === value.trim() && value.length >= min && value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value) && !/```|\b(?:export\s+(?:const|function)|import\s.+from)\b/.test(value) && !scanForSecrets(value).length;
}
function list(value: unknown, max: number, valid: (item: unknown) => item is string): value is string[] {
  return Array.isArray(value) && value.length <= max && new Set(value).size === value.length && value.every(valid);
}
export function calculatorPlanDigest(value: unknown): string {
  try { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); } catch { return refuseCalculatorPlan(); }
}
function bounded(value: unknown): boolean {
  try { return Buffer.byteLength(JSON.stringify(value)) <= 24_576; } catch { return false; }
}
export function prepareCalculatorGoal(input: unknown): PreparedCalculatorGoal {
  if (!planObject(input) || !planKeys(input, ["version", "id", "goal", "baseRef", "baseSha", "provider"]) ||
      input.version !== 1 || !text(input.id, 3, 48) || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(input.id) ||
      !text(input.goal, 12, 4_000) || !text(input.baseRef, 1, 120) || typeof input.baseSha !== "string" ||
      !/^[a-f0-9]{40}$/.test(input.baseSha) || typeof input.provider !== "string" ||
      !["cloudflare", "groq", "gemini"].includes(input.provider)) return refuseCalculatorPlan();
  try { validateCalculatorScope({ repository: CALCULATOR_PROFILE.repository, baseRef: input.baseRef, baseSha: input.baseSha, changePaths: ["index.html"] }); }
  catch { return refuseCalculatorPlan(); }
  const request: CalculatorGoalRequest = { version: 1, id: input.id, goal: input.goal,
    baseRef: input.baseRef, baseSha: input.baseSha, provider: input.provider as CalculatorGoalRequest["provider"] };
  const identity = { ...request, repository: CALCULATOR_PROFILE.repository, requirementsSha256: CALCULATOR_REQUIREMENTS_SHA256 };
  return Object.freeze({ ...identity, ownerFingerprint: calculatorPlanDigest(identity) });
}
export function calculatorPlanTaskId(ownerRequest: unknown, index: number): string {
  const owner = prepareCalculatorGoal(ownerRequest);
  if (!Number.isSafeInteger(index) || index < 1 || index > 8) return refuseCalculatorPlan();
  return owner.id.slice(0, 30) + "-" + owner.ownerFingerprint.slice(0, 6) + "-t" + String(index).padStart(2, "0");
}

/** The model proposes tasks only. Repository, requirements, IDs, fingerprints,
 * provider, branch and statuses stay host-derived. No model call or I/O here. */
export function createCalculatorPlan(ownerRequest: unknown, modelResult: unknown): CalculatorPlan {
  const owner = prepareCalculatorGoal(ownerRequest);
  if (!planObject(modelResult) || !planKeys(modelResult, ["tasks", "blockers", "unverifiedAreas"]) || !bounded(modelResult) ||
      !Array.isArray(modelResult.tasks) || modelResult.tasks.length > 8 ||
      !list(modelResult.blockers, 8, (item): item is string => text(item, 8, 240)) ||
      !list(modelResult.unverifiedAreas, 8, (item): item is string => text(item, 8, 240))) return refuseCalculatorPlan();
  const ids = modelResult.tasks.map((_, index) => calculatorPlanTaskId(ownerRequest, index + 1));
  const knownCriteria = new Set(CALCULATOR_ACCEPTANCE.map(item => item.id));
  const tasks: CalculatorPlanTask[] = [];
  for (const [index, item] of modelResult.tasks.entries()) {
    if (!planObject(item) || !planKeys(item, ["id", "role", "goal", "acceptanceIds", "paths", "dependsOn"]) ||
        item.id !== ids[index] || (item.role !== "coder" && item.role !== "frontend") || !text(item.goal, 12, 800) ||
        !list(item.acceptanceIds, 11, (value): value is string => typeof value === "string" && knownCriteria.has(value)) || !item.acceptanceIds.length ||
        !list(item.paths, 3, (value): value is string => typeof value === "string" && CALCULATOR_TEAM[item.role as "coder" | "frontend"].writablePaths.includes(value)) || !item.paths.length ||
        !list(item.dependsOn, 7, (value): value is string => typeof value === "string" && ids.includes(value)) || item.dependsOn.includes(ids[index]))
      return refuseCalculatorPlan();
    tasks.push(Object.freeze({ id: ids[index], role: item.role, goal: item.goal,
      acceptanceIds: Object.freeze([...item.acceptanceIds]), paths: Object.freeze([...item.paths]), dependsOn: Object.freeze([...item.dependsOn]) }));
  }
  const byId = new Map(tasks.map(task => [task.id, task])), active = new Set<string>(), done = new Set<string>();
  function visit(id: string): void {
    if (active.has(id)) return refuseCalculatorPlan(); if (done.has(id)) return;
    active.add(id); for (const dep of byId.get(id)!.dependsOn) visit(dep); active.delete(id); done.add(id);
  }
  tasks.forEach(task => visit(task.id));
  function depends(task: CalculatorPlanTask, id: string): boolean {
    return task.dependsOn.includes(id) || task.dependsOn.some(dep => depends(byId.get(dep)!, id));
  }
  for (const a of tasks) for (const b of tasks) if (a.id !== b.id && a.paths.some(path => b.paths.includes(path)) &&
      !depends(a, b.id) && !depends(b, a.id)) return refuseCalculatorPlan();
  const core = tasks.filter(task => task.paths.includes("src/calculator.mjs"));
  for (const task of tasks.filter(task => task.paths.includes("src/app.mjs")))
    if (!core.some(producer => depends(task, producer.id))) return refuseCalculatorPlan();
  const blockers = [...modelResult.blockers];
  const uiPaths = ["index.html", "styles.css", "src/app.mjs"];
  for (const task of tasks.filter(item => item.role === "frontend"))
    if (uiPaths.some(path => !tasks.some(producer => producer.paths.includes(path) && (producer.id === task.id || depends(task, producer.id)))))
      blockers.push("Frontend task lacks a complete UI source group in its dependency base: " + task.id + ".");
  const missingCriteria = CALCULATOR_ACCEPTANCE.filter(item => !tasks.some(task => task.acceptanceIds.includes(item.id))).map(item => item.id);
  const missingFiles = CALCULATOR_PROFILE.writablePaths.filter(path => !tasks.some(task => task.paths.includes(path)));
  if (missingCriteria.length) blockers.push("Missing acceptance coverage: " + missingCriteria.join(", ") + ".");
  if (missingFiles.length) blockers.push("Missing source/test coverage: " + missingFiles.join(", ") + ".");
  const request: Readonly<CalculatorGoalRequest> = Object.freeze({ version: 1, id: owner.id, goal: owner.goal,
    baseRef: owner.baseRef, baseSha: owner.baseSha, provider: owner.provider });
  const proposal: Proposal = Object.freeze({ tasks: Object.freeze(tasks), blockers: Object.freeze([...modelResult.blockers]),
    unverifiedAreas: Object.freeze([...modelResult.unverifiedAreas]) });
  const fingerprint = calculatorPlanDigest({ request, repository: owner.repository, requirementsSha256: owner.requirementsSha256, proposal });
  return Object.freeze({ version: 1, request, owner, fingerprint, branch: calculatorBranch(owner.id), proposal, tasks: proposal.tasks,
    blockers: Object.freeze([...new Set(blockers)]), unverifiedAreas: Object.freeze([
      "A proposed plan is not source inspection, execution, integration or product completion evidence.",
      "Security, independent review, exact-candidate CI, browser checks and delivery documentation remain unverified.",
      ...proposal.unverifiedAreas,
    ]), status: blockers.length ? "blocked" : "planned", wholeAppCompleted: false, publicationAuthorized: false });
}

export function buildCalculatorPlanningInstructions(ownerRequest: unknown): string {
  const owner = prepareCalculatorGoal(ownerRequest);
  return buildCalculatorRoleInstructions("commander") + "\n\n" + JSON.stringify({
    ownerGoal: owner.goal, repository: owner.repository, baseSha: owner.baseSha, requirementsSha256: owner.requirementsSha256,
    fixedAcceptance: CALCULATOR_ACCEPTANCE, rolePaths: { coder: CALCULATOR_TEAM.coder.writablePaths, frontend: CALCULATOR_TEAM.frontend.writablePaths },
    exactSequentialTaskIds: Array.from({ length: 8 }, (_, index) => calculatorPlanTaskId(ownerRequest, index + 1)),
    instruction: "Propose the full calculator source/test plan, at most 8 tasks and 3 paths/task. Cover every fixed acceptance ID and all six source/test paths. App wiring must depend on the arithmetic producer; overlapping paths need ordered dependencies. Do not infer source defects or file absence without actual host evidence. Unknown work is a blocker; no runtime actions or permissions are implied.",
    outputSchema: '{"tasks":[{"id":string,"role":"coder"|"frontend","goal":string,"acceptanceIds":[string],"paths":[string],"dependsOn":[string]}],"blockers":[string],"unverifiedAreas":[string]}',
  });
}
