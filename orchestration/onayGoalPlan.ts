import { createHash } from "node:crypto";
import { assertCommitSha, assertValidBranchRef } from "../github/githubClient.js";
import { scanForSecrets } from "../github/secretScanner.js";
import { prepareTeamTask, type TeamTaskCard, type TeamTaskProvider } from "./teamTaskCard.js";

export type GoalRequest = {
  version: 1;
  id: string;
  goal: string;
  baseRef: string;
  baseSha: string;
  provider: TeamTaskProvider;
};
export type PreparedGoalRequest = GoalRequest & {
  repository: "erman-ksv/Onay";
  fingerprint: string;
};
export type GoalInventoryFile = { path: string; sha: string; bytes?: number };
export type ValidatedGoalPlanTask = {
  id: string;
  card: TeamTaskCard;
  dependsOn: string[];
  evidencePaths: string[];
};
export type ValidatedGoalPlan = {
  tasks: ValidatedGoalPlanTask[];
  blockers: string[];
  unverifiedAreas: string[];
  status: "planned" | "needs-owner-decision";
};

export const GOAL_PLAN_LIMITS = Object.freeze({
  maxGoalCharacters: 6_000,
  maxInventoryFiles: 300,
  maxInventoryBytes: 32_000,
  maxInspectedFiles: 8,
  maxTasks: 6,
  maxPlanBytes: 32_000,
});

const REQUEST_KEYS = ["version", "id", "goal", "baseRef", "baseSha", "provider"];
const TASK_KEYS = ["id", "goal", "acceptanceCriteria", "profile", "changePaths", "contextPaths", "dependsOn", "evidencePaths"];
const MOBILE = /^mobile\/tezjet-app\/(?:app|components|lib|test)\/[A-Za-z0-9_@()+./-]+\.(?:ts|tsx|mjs)$/;
const BACKEND = /^artifacts\/api-server\/(?:src\/(?:controllers|routes|utils|middleware|store)|test)\/[A-Za-z0-9_./-]+\.(?:ts|mjs)$/;
const READ_ONLY = new Set(["package.json", "mobile/tezjet-app/package.json", "artifacts/api-server/package.json"]);
const CODE_MARKERS = /```|(?:^|\n)\s*(?:import\s.+\sfrom\s|export\s+(?:default|const|class|function)\b|(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(|class\s+[A-Za-z_$][\w$]*\s*(?:\{|extends\b)|(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=)/m;
const CREDENTIAL_ASSIGNMENT = /\b(?:authorization|api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*["']?[^\s"']{8,}/i;

const invalidRequest = (): never => { throw new Error("Invalid Onay owner goal request. Provide bounded natural-language instructions without source or secrets."); };
const invalidInventory = (): never => { throw new Error("Invalid bounded host Onay inventory. Supply only existing allowed paths and immutable file SHAs."); };
const invalidPlan = (): never => { throw new Error("Invalid bounded Onay goal plan. Scope, dependencies and source evidence must be host-verifiable."); };

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function text(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value === value.trim() && value.length >= min && value.length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) &&
    !CODE_MARKERS.test(value) && !CREDENTIAL_ASSIGNMENT.test(value) && scanForSecrets(value).length === 0;
}
function jsonBytes(value: unknown, fail: () => never): number {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return fail(); }
}
function canonicalPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 &&
    !value.includes("\\") && !value.includes("//") &&
    value.split("/").every(part => !!part && part !== "." && part !== ".." && !part.startsWith("."));
}
function proposedPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 &&
    /^[A-Za-z0-9_@()+./-]+$/.test(value) && !value.includes("//") &&
    value.split("/").every(part => !!part && part !== "." && part !== "..");
}

/** This is an allowlist filter for host tree metadata, not a claim that any file
 * was read. Build/config/schema paths cannot become task change paths. */
export function isGoalInventoryPath(value: unknown): value is string {
  return canonicalPath(value) && (MOBILE.test(value) || BACKEND.test(value) || READ_ONLY.has(value) ||
    /^docs\/[A-Za-z0-9_./-]+\.md$/.test(value));
}

export function prepareGoalRequest(input: unknown): PreparedGoalRequest {
  if (!plain(input) || !exactKeys(input, REQUEST_KEYS) || input.version !== 1 ||
      !text(input.id, 3, 48) || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(input.id) ||
      !text(input.goal, 12, GOAL_PLAN_LIMITS.maxGoalCharacters) ||
      /onay[- ]agents[- ]factory/i.test(input.goal) ||
      !text(input.baseRef, 1, 120) || typeof input.baseSha !== "string" ||
      !["cloudflare", "groq", "gemini"].includes(String(input.provider))) return invalidRequest();
  try { assertValidBranchRef(input.baseRef); assertCommitSha(input.baseSha); } catch { return invalidRequest(); }
  const request: GoalRequest = {
    version: 1, id: input.id, goal: input.goal, baseRef: input.baseRef,
    baseSha: input.baseSha.toLowerCase(), provider: input.provider as TeamTaskProvider,
  };
  return { ...request, repository: "erman-ksv/Onay",
    fingerprint: createHash("sha256").update(JSON.stringify(request)).digest("hex") };
}

function normalizeRequest(input: GoalRequest | PreparedGoalRequest): PreparedGoalRequest {
  if (!plain(input)) return invalidRequest();
  if (!Object.hasOwn(input, "repository") && !Object.hasOwn(input, "fingerprint")) return prepareGoalRequest(input);
  if (!exactKeys(input, [...REQUEST_KEYS, "repository", "fingerprint"])) return invalidRequest();
  const record = input as unknown as Record<string, unknown>;
  const request = prepareGoalRequest(Object.fromEntries(REQUEST_KEYS.map(key => [key, record[key]])));
  if (record.repository !== request.repository || record.fingerprint !== request.fingerprint) return invalidRequest();
  return request;
}

export function prepareGoalInventory(input: unknown): GoalInventoryFile[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > GOAL_PLAN_LIMITS.maxInventoryFiles ||
      jsonBytes(input, invalidInventory) > GOAL_PLAN_LIMITS.maxInventoryBytes) return invalidInventory();
  const seen = new Set<string>();
  return input.map(item => {
    if (!plain(item) || !exactKeys(item, ["path", "sha"], ["bytes"]) || !isGoalInventoryPath(item.path) ||
        typeof item.sha !== "string" || seen.has(item.path) ||
        (Object.hasOwn(item, "bytes") && (typeof item.bytes !== "number" ||
          !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > 4 * 1024 * 1024))) return invalidInventory();
    try { assertCommitSha(item.sha); } catch { return invalidInventory(); }
    seen.add(item.path);
    return { path: item.path, sha: item.sha.toLowerCase(), ...(typeof item.bytes === "number" ? { bytes: item.bytes } : {}) };
  });
}

/** Prompt the model with these exact host-derived IDs. A fingerprint suffix
 * avoids collisions when the owner chose a long ID with the same prefix. */
export function deriveGoalTaskId(input: GoalRequest | PreparedGoalRequest, ordinal: number): string {
  const request = normalizeRequest(input);
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > GOAL_PLAN_LIMITS.maxTasks) return invalidPlan();
  return request.id.slice(0, 36) + "-" + request.fingerprint.slice(0, 6) + "-t" + String(ordinal).padStart(2, "0");
}

function stringList(value: unknown, max: number, validate: (item: unknown) => item is string): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every(validate) && new Set(value).size === value.length;
}
function boundedNotes(values: string[], label: "blockers" | "unverified areas"): string[] {
  const unique = [...new Set(values)];
  if (unique.length <= 12) return unique;
  return [...unique.slice(0, 11), String(unique.length - 11) + " additional " + label +
    " omitted; this scope remains blocked or unverified."];
}
function assertAcyclic(tasks: { id: string; dependsOn: string[] }[]): void {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const visited = new Set<string>(), active = new Set<string>();
  const visit = (id: string): void => {
    if (active.has(id)) return invalidPlan();
    if (visited.has(id)) return;
    const task = byId.get(id);
    if (!task) return invalidPlan();
    active.add(id);
    for (const dependency of task.dependsOn) visit(dependency);
    active.delete(id); visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}

/** Inventory metadata alone never proves inspected source. evidencePathsActual
 * must come from successful host reads at this goal's immutable base SHA. Model
 * text cannot supply repository/provider/ref authority or invoke any write. */
export function validateGoalPlan(
  input: GoalRequest | PreparedGoalRequest,
  inventoryInput: readonly GoalInventoryFile[],
  modelResult: unknown,
  evidencePathsActual: readonly string[] = [],
): ValidatedGoalPlan {
  const request = normalizeRequest(input);
  const inventory = prepareGoalInventory(inventoryInput);
  const inventoryPaths = new Set(inventory.map(file => file.path));
  if (!stringList(evidencePathsActual, GOAL_PLAN_LIMITS.maxInspectedFiles,
    (path): path is string => typeof path === "string" && inventoryPaths.has(path))) return invalidPlan();
  const inspected = new Set(evidencePathsActual);
  if (!plain(modelResult) || !exactKeys(modelResult, ["tasks", "blockers", "unverifiedAreas"]) ||
      jsonBytes(modelResult, invalidPlan) > GOAL_PLAN_LIMITS.maxPlanBytes ||
      !Array.isArray(modelResult.tasks) || modelResult.tasks.length > GOAL_PLAN_LIMITS.maxTasks ||
      !stringList(modelResult.blockers, 12, (value): value is string => text(value, 8, 240) && !/[\r\n\t]/.test(value)) ||
      !stringList(modelResult.unverifiedAreas, 12, (value): value is string => text(value, 8, 240) && !/[\r\n\t]/.test(value))) return invalidPlan();
  const blockers = [...modelResult.blockers];
  const unverifiedAreas = [
    "This is one proposed bounded planning batch, not a complete product roadmap or implementation evidence.",
    "Planning grants no write, merge, deployment or legal-agent authority.",
    "Runtime CI and physical Android/iPhone acceptance remain unverified by planning.", ...modelResult.unverifiedAreas];
  const unread = inventory.length - inspected.size;
  if (unread > 0) unverifiedAreas.push(String(unread) + " inventory files were not inspected; paths and SHAs alone are not source evidence.");
  if (!inspected.size) blockers.push("No source files were inspected by the host; implementation tasks need source evidence.");
  if (!modelResult.tasks.length) blockers.push("No bounded implementation tasks were proposed.");
  if (!inventoryPaths.has("package.json")) blockers.push("The root package manifest is missing from the host inventory.");

  let unsupported = false;
  const tasks: ValidatedGoalPlanTask[] = [];
  const dependencies: { id: string; dependsOn: string[] }[] = [];
  for (const [index, item] of modelResult.tasks.entries()) {
    const expectedId = deriveGoalTaskId(request, index + 1);
    if (!plain(item) || !exactKeys(item, TASK_KEYS) || item.id !== expectedId ||
        !text(item.goal, 12, 1200) ||
        !stringList(item.acceptanceCriteria, 6, (value): value is string => text(value, 8, 240)) ||
        !item.acceptanceCriteria.length || !["mobile", "backend"].includes(String(item.profile)) ||
        !stringList(item.changePaths, 3, proposedPath) || !item.changePaths.length ||
        !stringList(item.contextPaths, 5, proposedPath) ||
        !stringList(item.dependsOn, GOAL_PLAN_LIMITS.maxTasks - 1,
          (value): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(value)) ||
        !stringList(item.evidencePaths, GOAL_PLAN_LIMITS.maxInspectedFiles,
          (value): value is string => typeof value === "string" && inventoryPaths.has(value) && inspected.has(value))) return invalidPlan();
    dependencies.push({ id: expectedId, dependsOn: [...item.dependsOn] });
    let prepared: ReturnType<typeof prepareTeamTask>;
    try {
      prepared = prepareTeamTask({
        version: 1, id: expectedId, goal: item.goal, acceptanceCriteria: item.acceptanceCriteria,
        profile: item.profile, provider: request.provider, baseRef: request.baseRef, baseSha: request.baseSha,
        changePaths: item.changePaths, contextPaths: item.contextPaths,
      });
    } catch { unsupported = true; continue; }
    if ([...prepared.changePaths, ...prepared.contextPaths].some(path => !inventoryPaths.has(path))) {
      unsupported = true; continue;
    }
    if (prepared.changePaths.some(path => /(?:^|\/)(?:schema|migrations?)(?:\/|[.-])/i.test(path))) {
      unsupported = true; continue;
    }
    const taskEvidencePaths = item.evidencePaths as string[];
    const missingEvidence = prepared.changePaths.filter(path => !inspected.has(path) || !taskEvidencePaths.includes(path));
    if (missingEvidence.length) {
      blockers.push("Task " + expectedId + " needs inspected-source evidence for each proposed change file.");
      unverifiedAreas.push("Task " + expectedId + ": " + missingEvidence.length +
        " change files lack inspected-source evidence; see the task card paths.");
    }
    const card: TeamTaskCard = {
      version: 1, id: prepared.id, goal: prepared.goal, acceptanceCriteria: [...prepared.acceptanceCriteria],
      profile: prepared.profile, provider: prepared.provider, baseRef: prepared.baseRef, baseSha: prepared.baseSha,
      changePaths: [...prepared.changePaths], contextPaths: [...prepared.contextPaths],
    };
    tasks.push({ id: expectedId, card, dependsOn: [...item.dependsOn], evidencePaths: [...item.evidencePaths] });
  }
  assertAcyclic(dependencies);
  if (unsupported) blockers.push("The proposed plan requires unsupported scope, new files, configuration/schema changes, or an oversized task; obtain a separate owner decision.");
  const uniqueBlockers = boundedNotes(blockers, "blockers");
  return { tasks: unsupported ? [] : tasks, blockers: uniqueBlockers,
    unverifiedAreas: boundedNotes(unverifiedAreas, "unverified areas"),
    status: uniqueBlockers.length ? "needs-owner-decision" : "planned" };
}
