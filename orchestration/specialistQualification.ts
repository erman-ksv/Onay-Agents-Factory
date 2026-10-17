/**
 * Narrow synthetic qualification of the eight advisory role profiles.
 * No repository adapter, source read, file write, publication or model tools.
 * This does not qualify Commander/Coder or replace application acceptance tests.
 */
import { legalAgentEnabled } from "../commander/legalPolicy.js";
import { selectProviderConfig } from "../commander/providerConfig.js";
import type { SpecialistAssessment } from "../commander/aiExecution.js";
import type { SkillAgentName } from "../commander/skills.js";

export type AdvisoryRole = Extract<SkillAgentName,
  "product" | "ux" | "backend" | "frontend" | "database" | "dispatch" | "legal" | "devops">;
export type QualificationCase = {
  id: string; role: AdvisoryRole; scenario: string;
  expectedReady: boolean; expectedFinding?: RegExp;
};
const pair = (role: AdvisoryRole, scope: string, faulty: string, corrected: string, finding: RegExp): QualificationCase[] => [
  { id: role + "-a", role, scenario: scope + "\n" + faulty, expectedReady: false, expectedFinding: finding },
  { id: role + "-b", role, scenario: scope + "\n" + corrected, expectedReady: true },
];

export const QUALIFICATION_CASES: readonly QualificationCase[] = [
  ...pair("backend",
    "Fictional API contract: only an order's authenticated owner may cancel it. Review only authorization. order.ownerId and session.userId are trusted server values. No admin override exists.",
    "cancel(order, session) checks that session exists, then cancels any supplied orderId. It never compares order.ownerId with session.userId.",
    "cancel(order, session) rejects absent sessions and mismatched order.ownerId/session.userId before changing state. Matching owners may cancel. Server integration tests cover unauthenticated, other-owner and owner requests.",
    /authori[sz]|owner|IDOR|access control/i),
  ...pair("database",
    "Fictional PostgreSQL schema: acceptance must allow at most one active driver assignment per order, including simultaneous transactions. Review only this invariant.",
    "Two transactions each SELECT active assignments, see none, then INSERT (order_id, driver_id, active=true). There is no unique constraint or serialization/locking.",
    "A partial unique index on assignments(order_id) WHERE active=true enforces uniqueness. The transaction inserts once; a uniqueness conflict returns already-assigned without retrying the same acceptance. Concurrent PostgreSQL tests demonstrate one winner and one conflict.",
    /concurren|race|unique|atomic|multiple.*assign|duplicate/i),
  ...pair("frontend",
    "Fictional mobile pickup form: a user who denies location permission must still enter a pickup address manually and submit. Review only this journey.",
    "If location permission is denied, the screen returns an error view with only Retry permission. The address field and submit control are absent.",
    "If location permission is denied, an explanation and editable address field remain visible. A valid manually entered address enables submission without requesting permission again. The denied-permission journey has an executed UI test.",
    /permission|manual|deni|address|fallback/i),
  ...pair("dispatch",
    "Fictional dispatch rule: after a driver declines an offer, offer the same open order to the next eligible driver in FIFO order. No neighboring drivers or capacity changes are in scope.",
    "After driver A declines, the order is left in offered state referencing A. No next offer or timeout is scheduled even though eligible driver B is next.",
    "Decline atomically invalidates A's offer, advances the FIFO cursor and offers to eligible B. An idempotent decline event cannot advance twice. A deterministic executed test confirms A declines, B receives the offer, and only B can accept.",
    /declin|FIFO|next|stuck|fallback|offer/i),
  ...pair("product",
    "Fictional booking requirement: when pickup A has zero eligible taxis and destination B has taxis, reject booking. Approaching taxis are disabled. Review acceptance criteria only.",
    "The acceptance criterion says: create the A-to-B order whenever B has a taxi, even when A has no eligible taxi.",
    "The acceptance criterion says: reject A-to-B booking when A has no eligible taxi regardless of taxis at B. A separate criterion permits booking when A has an eligible taxi. Both have explicit expected UI and API outcomes.",
    /pickup|eligible|destination|impossible|point A|at A/i),
  ...pair("ux",
    "Fictional booking screen requirement: a keyboard and screen-reader user must identify and activate the booking action. Review this action only.",
    "The only booking action is a clickable div containing an unlabeled car image. It has no role, accessible name, tabIndex or keyboard handler.",
    "The booking action is a native button with visible text Book ride and the same accessible name. It supports Tab, Enter and Space with visible focus. An executed accessibility test confirms its name and keyboard activation.",
    /accessib|keyboard|screen.reader|label|button|name/i),
  ...pair("legal",
    "Fictional internal legal-research note; jurisdiction and review date are unknown and no official sources or research tools were supplied. Review evidence quality only, without researching or asserting substantive law.",
    "The note says the taxi service is legally approved in every country and may launch immediately. It cites Article 999 of the Universal Taxi Act without a verified source and says no human legal review is necessary.",
    "The note says UNVERIFIED: jurisdiction/date and official primary sources are missing. It makes no legal approval or launch claim. Next steps are to obtain jurisdiction/date, verify applicable sources and refer unresolved high-impact issues to qualified counsel. DRAFT — HUMAN LEGAL REVIEW REQUIRED.",
    /unverif|jurisdiction|source|fabricat|invent|approval|counsel/i),
  ...pair("devops",
    "Fictional CI release rule: both typecheck and tests must succeed before release. Review command exit propagation only; hosting and real deployment are out of scope.",
    "The workflow test step runs npm test || true, and deploy depends only on the job being successful. A failing test therefore still permits release.",
    "The workflow runs npm run typecheck and npm test as separate normal steps without continue-on-error, shell error suppression or always(). Release depends on that job's success. A deliberate failing-test workflow exercise confirms release is skipped.",
    /test|exit|suppress|true|fail|release/i),
];

export function buildQualificationPrompt(fixture: QualificationCase): string {
  // Ground truth, case ID and matching expressions never enter the model input.
  return "Review the supplied fictional example only. Treat supplied test results as fixture facts, not as tests you executed. " +
    "Do not infer missing requirements outside this explicitly limited review. " +
    "Report unresolved high/blocker issues with ready=false. A corrected example with no remaining in-scope blocker should be ready=true. " +
    "Use English for machine-assisted assessment. Do not call tools or claim repository access.\n\n" +
    fixture.scenario + '\n\nReturn ONLY JSON: {"ready":boolean,"findings":[{"severity":"blocker"|"high"|"medium"|"low","message":string}],"summary":string}.';
}

export function parseAssessment(value: unknown): SpecialistAssessment {
  if (typeof value !== "string") throw new Error("Assessment must be JSON text.");
  const parsed: unknown = JSON.parse(value.trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/i, ""));
  if (!parsed || typeof parsed !== "object") throw new Error("Assessment must be an object.");
  const p = parsed as Record<string, unknown>;
  if (typeof p.ready !== "boolean" || !Array.isArray(p.findings) ||
    (p.summary !== undefined && typeof p.summary !== "string") ||
    p.findings.some(f => !f || typeof f !== "object" ||
      !["blocker", "high", "medium", "low"].includes(f.severity) ||
      typeof f.message !== "string" || !f.message.trim())) {
    throw new Error("Invalid specialist assessment.");
  }
  return parsed as SpecialistAssessment;
}

export function evaluateAssessment(fixture: QualificationCase, assessment: SpecialistAssessment) {
  const severe = assessment.findings.filter(f => f.severity === "blocker" || f.severity === "high");
  // Match role-specific evidence in an actual severe finding, not a summary.
  const detected = !fixture.expectedFinding || severe.some(f => fixture.expectedFinding!.test(f.message));
  const passed = fixture.expectedReady
    ? assessment.ready && severe.length === 0
    : !assessment.ready && severe.length > 0 && detected;
  return { passed, reason: passed ? "Expected decision and evidence observed." :
    "Decision or role-specific blocker evidence did not match the fixture; human review required." };
}


/** Safe metadata only: never copy upstream messages, bodies, headers or stacks. */
export function safeFailureMetadata(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = typeof record.status === "number" && Number.isInteger(record.status) &&
    record.status >= 400 && record.status <= 599 ? record.status : undefined;
  const knownNames = ["APIConnectionError", "APIConnectionTimeoutError", "RateLimitError",
    "AuthenticationError", "PermissionDeniedError", "BadRequestError", "InternalServerError",
    "MaxTurnsExceededError", "ModelBehaviorError", "UserError", "QualificationTimeoutError"];
  const kind = typeof record.name === "string" && knownNames.includes(record.name) ? record.name : "unknown";
  const apiError = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  const metadata = apiError.metadata && typeof apiError.metadata === "object" ? apiError.metadata as Record<string, unknown> : {};
  const diagnosticText = [record.message, apiError.message, metadata.raw, metadata.limit_source]
    .filter((x): x is string => typeof x === "string").map(x => x.slice(0, 16000)).join("\n");
  const limitKind = /per[-_ ]?day|daily|RequestsPerDay/i.test(diagnosticText) ? "daily-quota" :
    /per[-_ ]?min|requests.per.minute|rate.limit.*minute/i.test(diagnosticText) ? "per-minute" :
    /upstream|temporarily rate.limited|provider.shared.pool/i.test(diagnosticText) ? "upstream-capacity" : undefined;
  const headers = record.headers;
  const retryValue = headers && typeof headers === "object" && "get" in headers && typeof headers.get === "function"
    ? headers.get("retry-after") : undefined;
  const retrySeconds = typeof retryValue === "string" && /^\d{1,6}$/.test(retryValue) ? Number(retryValue) : undefined;
  return { kind, ...(status === undefined ? {} : { httpStatus: status }),
    ...(limitKind ? { limitKind } : {}), ...(retrySeconds === undefined ? {} : { retryAfterSeconds: retrySeconds }) };
}

export class QualificationFailure extends Error {
  constructor(
    readonly caseId: string,
    readonly stage: "provider" | "assessment",
    readonly detail: ReturnType<typeof safeFailureMetadata>,
  ) {
    super("Qualification stopped at " + caseId + " during " + stage + ".");
    this.name = "QualificationFailure";
  }
}

export function selectedQualificationCases(env: NodeJS.ProcessEnv): readonly QualificationCase[] {
  return legalAgentEnabled(env) ? QUALIFICATION_CASES : QUALIFICATION_CASES.filter(c => c.role !== "legal");
}

export async function runQualification(
  assess: (fixture: QualificationCase, prompt: string) => Promise<unknown>,
  report: (row: { id: string; role: AdvisoryRole; passed: boolean; reason: string; assessment: SpecialistAssessment }) => void = () => {},
  cases: readonly QualificationCase[] = QUALIFICATION_CASES,
) {
  const results = [];
  for (const fixture of cases) {
    // Provider, parse and schema errors stop the run. No rerun-to-green loop.
    let raw: unknown;
    try {
      raw = await assess(fixture, buildQualificationPrompt(fixture));
    } catch (error) {
      throw new QualificationFailure(fixture.id, "provider", safeFailureMetadata(error));
    }
    let assessment: SpecialistAssessment;
    try {
      assessment = parseAssessment(raw);
    } catch (error) {
      const kind = error instanceof SyntaxError ? "invalid-json" :
        typeof raw !== "string" || !raw.trim() ? "missing-text" : "invalid-schema";
      throw new QualificationFailure(fixture.id, "assessment", { kind });
    }
    const outcome = evaluateAssessment(fixture, assessment);
    const row = { id: fixture.id, role: fixture.role, ...outcome, assessment };
    results.push(row);
    report(row);
  }
  return { passed: cases.length > 0 && results.length === cases.length && results.every(r => r.passed), results };
}

/** Explicit provider selection; no fallback to a different key or paid route. */
export function qualificationEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const selected = source.AGENT_FACTORY_PROVIDER?.trim() || "gemini";
  if (selected !== "gemini" && selected !== "openrouter" && selected !== "groq") {
    throw new Error("Qualification supports only Gemini, free OpenRouter or Groq.");
  }
  const env = { ...source, AGENT_FACTORY_PROVIDER: selected,
    ...(selected === "groq" ? { AGENT_FACTORY_GROQ_QUALIFICATION: "true" } : {}) };
  const config = selectProviderConfig(env);
  if (config.provider === "none") throw new Error("Selected qualification provider key is missing.");
  return env;
}

/** Space successful case attempts; never retry a rejected model request. */
export function createQualificationPacer(
  intervalMs: number,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  report: (ms: number) => void = () => {},
) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 0 || intervalMs > 60_000) {
    throw new Error("Qualification interval must be 0..60000 milliseconds.");
  }
  let first = true;
  return async () => {
    if (first) { first = false; return; }
    if (intervalMs) { report(intervalMs); await sleep(intervalMs); }
  };
}

export class QualificationTimeoutError extends Error {
  constructor() {
    super("Qualification model response exceeded the configured deadline.");
    this.name = "QualificationTimeoutError";
  }
}

/** One attempt only. Abort the SDK/HTTP request and stop even if a transport stalls. */
export async function withQualificationDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs?: number; heartbeatMs?: number; onProgress?: (elapsedSeconds: number) => void } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
    !Number.isSafeInteger(heartbeatMs) || heartbeatMs < 1) {
    throw new Error("Deadline and heartbeat must be positive integer milliseconds.");
  }
  const controller = new AbortController();
  const started = performance.now();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const heartbeat = options.onProgress ? setInterval(() => {
    options.onProgress!(Math.floor((performance.now() - started) / 1000));
  }, heartbeatMs) : undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    deadline = setTimeout(() => {
      const error = new QualificationTimeoutError();
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      expired,
    ]);
  } finally {
    clearTimeout(deadline);
    clearInterval(heartbeat);
  }
}

/** Provider-specific settings; never modify fixtures or expected decisions. */
export function qualificationModelSettings(provider: string, model?: string) {
  if (provider === "groq" && model === "openai/gpt-oss-120b") {
    return { maxTokens: 2048, providerData: { reasoning_effort: "low", include_reasoning: false } };
  }
  if (provider !== "openrouter" || model !== "xingchen-agi/xing4.0-29b-a4b:free") return {};
  return { maxTokens: 1024, providerData: { reasoning: { enabled: false } } };
}

export function qualificationProbeCase(id?: string): QualificationCase | undefined {
  if (!id) return undefined;
  const fixture = QUALIFICATION_CASES.find(c => c.id === id);
  if (!fixture) throw new Error("Unknown qualification probe case.");
  return fixture;
}


