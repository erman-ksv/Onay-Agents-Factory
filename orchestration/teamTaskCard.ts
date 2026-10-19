import { createHash } from "node:crypto";
import { assertValidBranchRef, assertCommitSha } from "../github/githubClient.js";
import { scanForSecrets } from "../github/secretScanner.js";
import { ONAY_MOBILE_REQUIRED_CI } from "../commander/onayMobileScope.js";

export type TeamTaskProvider = "cloudflare" | "groq" | "gemini";
export type TeamTaskProfile = "mobile" | "backend";
export type TeamTaskCard = {
  version: 1;
  id: string;
  goal: string;
  acceptanceCriteria: string[];
  profile: TeamTaskProfile;
  provider: TeamTaskProvider;
  baseRef: string;
  baseSha: string;
  changePaths: string[];
  contextPaths: string[];
};
export type PreparedTeamTask = TeamTaskCard & {
  repository: "erman-ksv/Onay";
  branch: string;
  fingerprint: string;
  explorerPaths: string[];
  requiredActors: string[];
  advisoryActors: string[];
  requiredCiNames: string[];
  requiredCiSteps: string[];
};

const MOBILE = /^mobile\/tezjet-app\/(?:app|components|lib|test)\/[A-Za-z0-9_@()+./-]+\.(?:ts|tsx|mjs)$/;
const BACKEND = /^artifacts\/api-server\/(?:src\/(?:controllers|routes|utils|middleware|store)|test)\/[A-Za-z0-9_./-]+\.(?:ts|mjs)$/;
const fail = (): never => { throw new Error("Invalid bounded Onay task card; inspect its schema, scope and acceptance criteria."); };
function pathValid(path: unknown): path is string {
  return typeof path === "string" && path.length <= 200 &&
    !path.includes("\\") && !path.includes("//") &&
    path.split("/").every(part => !!part && part !== "." && part !== ".." && !part.startsWith("."));
}
function textValid(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value === value.trim() && value.length >= min &&
    value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

/** Card fields come from the owner, never a model or an external skill. */
export function prepareTeamTask(input: unknown): PreparedTeamTask {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
  const card = input as Record<string, unknown>;
  const keys = ["version", "id", "goal", "acceptanceCriteria", "profile", "provider",
    "baseRef", "baseSha", "changePaths", "contextPaths"];
  if (Object.keys(card).some(key => !keys.includes(key)) || card.version !== 1 ||
      !textValid(card.id, 3, 48) || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(card.id) ||
      !textValid(card.goal, 12, 1200) || /onay[- ]agents[- ]factory/i.test(card.goal) ||
      !["mobile", "backend"].includes(String(card.profile)) ||
      !["cloudflare", "groq", "gemini"].includes(String(card.provider)) ||
      !Array.isArray(card.acceptanceCriteria) || card.acceptanceCriteria.length < 1 ||
      card.acceptanceCriteria.length > 6 ||
      !card.acceptanceCriteria.every(item => textValid(item, 8, 240)) ||
      !textValid(card.baseRef, 1, 120) || typeof card.baseSha !== "string") return fail();
  try { assertValidBranchRef(card.baseRef); assertCommitSha(card.baseSha); } catch { return fail(); }
  const pattern = card.profile === "mobile" ? MOBILE : BACKEND;
  if (!Array.isArray(card.changePaths) || card.changePaths.length < 1 || card.changePaths.length > 3 ||
      !card.changePaths.every(path => pathValid(path) && pattern.test(path)) ||
      new Set(card.changePaths).size !== card.changePaths.length ||
      !Array.isArray(card.contextPaths) || card.contextPaths.length > 5 ||
      !card.contextPaths.every(path => pathValid(path) &&
        (pattern.test(path) || ["package.json", card.profile === "mobile" ?
          "mobile/tezjet-app/package.json" : "artifacts/api-server/package.json"].includes(path))) ||
      new Set(card.contextPaths).size !== card.contextPaths.length ||
      scanForSecrets(JSON.stringify(card)).length) return fail();
  const normalized: TeamTaskCard = {
    version: 1, id: card.id, goal: card.goal,
    acceptanceCriteria: [...card.acceptanceCriteria] as string[],
    profile: card.profile as TeamTaskProfile, provider: card.provider as TeamTaskProvider,
    baseRef: card.baseRef, baseSha: card.baseSha.toLowerCase(),
    changePaths: [...card.changePaths] as string[], contextPaths: [...card.contextPaths] as string[],
  };
  if (taskGoal(normalized).length > 1_200) return fail();
  const branch = "feat/onay-agent/" + normalized.id;
  if (branch === normalized.baseRef) return fail();
  const advisoryActors = normalized.profile === "mobile"
    ? ["product", "ux", "frontend", "backend", "dispatch"]
    : ["product", "backend", "database", "dispatch"];
  return {
    ...normalized, repository: "erman-ksv/Onay", branch,
    fingerprint: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
    explorerPaths: [...new Set(["package.json", ...normalized.contextPaths, ...normalized.changePaths])],
    advisoryActors,
    requiredActors: ["explorer", "coder", ...advisoryActors, "security", "reviewer", "tester"],
    requiredCiNames: normalized.profile === "mobile" ? [...ONAY_MOBILE_REQUIRED_CI.names] : ["Typecheck and API tests"],
    requiredCiSteps: normalized.profile === "mobile" ? [...ONAY_MOBILE_REQUIRED_CI.steps] : ["Typecheck", "API integration tests"],
  };
}

export function taskGoal(task: Pick<TeamTaskCard, "goal" | "acceptanceCriteria">): string {
  return task.goal + "\nAcceptance criteria:\n" +
    task.acceptanceCriteria.map((item, index) => String(index + 1) + ". " + item).join("\n") +
    "\nOnly the approved change paths may be edited. Missing evidence must be reported. " +
    "Do not merge, deploy, install skills, change business policy or invoke a legal agent.";
}
