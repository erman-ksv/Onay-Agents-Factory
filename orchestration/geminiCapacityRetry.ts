/**
 * Retry only temporary Gemini capacity errors. Never retry permission, quota,
 * JSON validation, or code-policy failures. Keep model calls bounded.
 */
export function isGeminiCapacityError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const response = error as {
    status?: unknown;
    code?: unknown;
    error?: { code?: unknown; status?: unknown };
  };
  return response.status === 503 || response.code === 503 ||
    response.error?.code === 503 ||
    response.error?.status === "UNAVAILABLE";
}

export async function retryGeminiCapacity<T>(
  run: () => Promise<T>,
  options: {
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (nextAttempt: number, totalAttempts: number, delayMs: number) => void;
  } = {},
): Promise<T> {
  // Three attempts total with 8s and 20s pauses. No indefinite loops.
  const delays = [8000, 20000];
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await run();
    } catch (error) {
      if (!isGeminiCapacityError(error) || i === delays.length) throw error;
      options.onRetry?.(i + 2, delays.length + 1, delays[i]);
      await (options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms))))(delays[i]);
    }
  }
  throw new Error("Gemini capacity retry exhausted.");
}
