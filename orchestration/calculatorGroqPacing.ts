import type { ProviderContextBudget } from "../commander/providerContextBudget.js";
import { DEFAULT_TASK_MODEL_BUDGET, type createTaskModelBudgetFetch } from "./taskModelBudget.js";

export type CalculatorModelTiming = { now?: () => number; wait?: (milliseconds: number) => Promise<void> };
const ERROR = "Calculator Groq admission unavailable within the existing task budget. No retry.";
/** Wait only BEFORE a fresh request. The existing sending wrappers still own
 * reservations, deadlines and terminal failures. No failed request is replayed. */
export function createCalculatorGroqPacer(context: ProviderContextBudget,
  task: Pick<ReturnType<typeof createTaskModelBudgetFetch>, "failure" | "snapshot">,
  timing: CalculatorModelTiming = {}) {
  const now = timing.now ?? (() => performance.now()), wait = timing.wait ?? (milliseconds => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  if (typeof now !== "function" || typeof wait !== "function") throw Error(ERROR);
  return async (body: string): Promise<void> => {
    const bytes = Buffer.byteLength(body, "utf8"), raw = JSON.parse(body), output = raw.max_completion_tokens;
    if (bytes > context.limits.maxRequestBytes || !Number.isSafeInteger(output) || output < 1) throw Error(ERROR);
    const input = Math.ceil(bytes / 3) + 256; let previous = now();
    for (let turn = 0; turn < 16; turn++) {
      if (!Number.isFinite(previous) || context.failure || task.failure) throw Error(ERROR);
      const remaining = DEFAULT_TASK_MODEL_BUDGET.wallTimeMs - task.snapshot().elapsedMs;
      if (remaining <= 0) throw Error(ERROR);
      const admission = context.preview(input, output);
      if (admission.status === "refused") throw Error(ERROR);
      if (admission.status === "ready") return;
      if (admission.waitMs >= remaining) throw Error(ERROR);
      await wait(Math.min(15000, admission.waitMs, remaining));
      const current = now(); if (!Number.isFinite(current) || current < previous) throw Error(ERROR); previous = current;
    }
    throw Error(ERROR);
  };
}
