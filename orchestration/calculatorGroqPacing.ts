import type { ProviderContextBudget, ProviderFailureCode } from "../commander/providerContextBudget.js";
import { calculatorHostModelBudget, DEFAULT_TASK_MODEL_BUDGET, type CalculatorHostPreset, type createTaskModelBudgetFetch, type TaskModelBudgetFailureCode } from "./taskModelBudget.js";

export type CalculatorModelTiming = { now?: () => number; wait?: (milliseconds: number) => Promise<void> };
const ERROR = "Calculator Groq admission unavailable within the existing task budget. No retry.";
export type CalculatorAdmissionCode = ProviderFailureCode | "task_budget_stopped" | "task_deadline_exceeded" |
  "task_request_limit" | "task_run_bytes_limit" | "wait_exceeds_deadline" | "invalid_clock" | "wait_failed" | "wait_limit";
export type CalculatorModelAdmissionDiagnostic = Readonly<{
  code: CalculatorAdmissionCode; requestBytes: number; estimatedInputTokens: number; reservedOutputTokens: number;
  contextTokenLimit: number; runTokenLimit: number; reservedRunTokens: number; remainingRunTokens: number;
  tpmTokenLimit: number; reservedWindowTokens: number; remainingTaskMs: number; waitMs?: number;
  taskBudgetCode?: TaskModelBudgetFailureCode; contextBudgetCode?: ProviderFailureCode;
}>;
const taskCodes = new Set<TaskModelBudgetFailureCode>(["request_limit", "request_bytes_limit", "run_bytes_limit", "task_timeout",
  "invalid_request", "rate_limited", "transport_error", "request_aborted"]);
const providerCodes = new Set<ProviderFailureCode>(["context_budget_exceeded", "run_budget_exceeded", "tpm_budget_exceeded",
  "request_bytes_exceeded", "invalid_budget_request", "rate_limited"]);
const admissionCodes = new Set<CalculatorAdmissionCode>([...providerCodes, "task_budget_stopped", "task_deadline_exceeded",
  "task_request_limit", "task_run_bytes_limit", "wait_exceeds_deadline", "invalid_clock", "wait_failed", "wait_limit"]);
const numericFields = ["requestBytes", "estimatedInputTokens", "reservedOutputTokens", "contextTokenLimit", "runTokenLimit",
  "reservedRunTokens", "remainingRunTokens", "tpmTokenLimit", "reservedWindowTokens", "remainingTaskMs"] as const;

/** An owned, source-free diagnostic. Never retain the body or an upstream Error. */
export class CalculatorModelAdmissionError extends Error {
  readonly diagnostic: CalculatorModelAdmissionDiagnostic;
  constructor(diagnostic: CalculatorModelAdmissionDiagnostic) {
    super(ERROR);
    this.name = "CalculatorModelAdmissionError";
    if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic) ||
        Object.keys(diagnostic).some(key => !["code", ...numericFields, "waitMs", "taskBudgetCode", "contextBudgetCode"].includes(key)) ||
        !admissionCodes.has(diagnostic.code) || numericFields.some(key => !Number.isSafeInteger(diagnostic[key]) || diagnostic[key] < 0) ||
        (diagnostic.waitMs !== undefined && (!Number.isSafeInteger(diagnostic.waitMs) || diagnostic.waitMs < 0)) ||
        (diagnostic.taskBudgetCode !== undefined && !taskCodes.has(diagnostic.taskBudgetCode)) ||
        (diagnostic.contextBudgetCode !== undefined && !providerCodes.has(diagnostic.contextBudgetCode))) throw Error(ERROR);
    // Copy only the allowlist even if the caller later mutates its input object.
    this.diagnostic = Object.freeze({ code: diagnostic.code,
      ...Object.fromEntries(numericFields.map(key => [key, diagnostic[key]])),
      ...(diagnostic.waitMs === undefined ? {} : { waitMs: diagnostic.waitMs }),
      ...(diagnostic.taskBudgetCode === undefined ? {} : { taskBudgetCode: diagnostic.taskBudgetCode }),
      ...(diagnostic.contextBudgetCode === undefined ? {} : { contextBudgetCode: diagnostic.contextBudgetCode }),
    }) as CalculatorModelAdmissionDiagnostic;
  }
}
/** Wait only BEFORE a fresh request. The existing sending wrappers still own
 * reservations, deadlines and terminal failures. No failed request is replayed. */
export function createCalculatorGroqPacer(context: ProviderContextBudget,
  task: Pick<ReturnType<typeof createTaskModelBudgetFetch>, "failure" | "snapshot">,
  timing: CalculatorModelTiming = {}, wallTimeMs: number = DEFAULT_TASK_MODEL_BUDGET.wallTimeMs,
  hostPreset?: CalculatorHostPreset) {
  const now = timing.now ?? (() => performance.now()), wait = timing.wait ?? (milliseconds => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  const preset = hostPreset === undefined ? undefined : calculatorHostModelBudget(hostPreset);
  if (typeof now !== "function" || typeof wait !== "function" || !Number.isSafeInteger(wallTimeMs) ||
      wallTimeMs < 1 || wallTimeMs > (preset?.wallTimeMs ?? DEFAULT_TASK_MODEL_BUDGET.wallTimeMs) ||
      (preset !== undefined && wallTimeMs !== preset.wallTimeMs)) throw Error(ERROR);
  return async (body: string): Promise<void> => {
    const bytes = typeof body === "string" ? Buffer.byteLength(body, "utf8") : 0;
    const input = Math.ceil(bytes / 3) + 256;
    let output = 0;
    function reject(code: CalculatorAdmissionCode, waitMs?: number): never {
      const ledger = context.snapshot(), taskLedger = task.snapshot();
      const taskCode = task.failure?.code, contextCode = context.failure?.code;
      throw new CalculatorModelAdmissionError({ code, requestBytes: bytes, estimatedInputTokens: input, reservedOutputTokens: output,
        contextTokenLimit: context.limits.maxContextTokens, runTokenLimit: context.limits.maxRunTokens,
        reservedRunTokens: ledger.reservedRunTokens, remainingRunTokens: Math.max(0, context.limits.maxRunTokens - ledger.reservedRunTokens),
        tpmTokenLimit: context.limits.maxTokensPerMinute, reservedWindowTokens: ledger.reservedWindowTokens,
        remainingTaskMs: Math.max(0, wallTimeMs - taskLedger.elapsedMs), ...(waitMs === undefined ? {} : { waitMs }),
        ...(taskCode && taskCodes.has(taskCode) ? { taskBudgetCode: taskCode } : {}),
        ...(contextCode && providerCodes.has(contextCode) ? { contextBudgetCode: contextCode } : {}),
      });
    }
    if (bytes > context.limits.maxRequestBytes) reject("request_bytes_exceeded");
    try {
      const raw: unknown = JSON.parse(body);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) reject("invalid_budget_request");
      const value = (raw as Record<string, unknown>).max_completion_tokens;
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) reject("invalid_budget_request");
      output = value;
    } catch (error) {
      if (error instanceof CalculatorModelAdmissionError) throw error;
      reject("invalid_budget_request");
    }
    let previous = now();
    for (let turn = 0; turn < 16; turn++) {
      if (!Number.isFinite(previous)) reject("invalid_clock");
      const problem = context.failure;
      if (problem) reject(providerCodes.has(problem.code) ? problem.code : "invalid_budget_request");
      if (task.failure) reject("task_budget_stopped");
      const taskLedger = task.snapshot(), remaining = wallTimeMs - taskLedger.elapsedMs;
      if (remaining <= 0) reject("task_deadline_exceeded");
      if (taskLedger.remainingRequests < 1) reject("task_request_limit");
      if (bytes > taskLedger.remainingRunBytes) reject("task_run_bytes_limit");
      const admission = context.preview(input, output);
      if (admission.status === "refused") reject(providerCodes.has(admission.failure.code) ? admission.failure.code : "invalid_budget_request");
      if (admission.status === "ready") return;
      if (admission.waitMs >= remaining) reject("wait_exceeds_deadline", admission.waitMs);
      try { await wait(Math.min(15000, admission.waitMs, remaining)); } catch { reject("wait_failed"); }
      const current = now();
      if (!Number.isFinite(current) || current < previous) reject("invalid_clock");
      previous = current;
    }
    reject("wait_limit");
  };
}
