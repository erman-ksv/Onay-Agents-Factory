/** Restricted, text-only Mistral Chat Completions adapter for free-tier qualification.
 * Does not discover or enable paid billing. A human must verify Studio Free mode.
 * One client owns its request cap. No retries or provider fallback.
 */
import { normalizeCloudflareChatPayload } from "./cloudflareCompatibility.js";

export const MISTRAL_MAX_CALLS_PER_RUN = 4;
export const MISTRAL_MAX_OUTPUT_TOKENS = 512;
export const MISTRAL_MAX_REQUEST_BYTES = 32_000;
export const MISTRAL_SMALL_MODEL = "mistral-small-latest";
export const MISTRAL_CHAT_URL = "https://api.mistral.ai/v1/chat/completions";

function rejected(status: number, message: string): Response {
  return Response.json({
    error: { message, type: status === 429 ? "rate_limit_error" : "invalid_request_error" },
  }, { status, headers: { "x-should-retry": "false" } });
}

/** Text and tool-call payload normalization is tested offline with the real Agents SDK.
 * Never pass raw provider HTTP error bodies or headers back to the runner.
 */
export function createMistralFreeFetch(
  underlyingFetch: typeof fetch = globalThis.fetch,
  options: { maxCalls?: number; maxOutputTokens?: number; maxBytes?: number } = {},
): typeof fetch {
  const maxCalls = options.maxCalls ?? MISTRAL_MAX_CALLS_PER_RUN;
  const maxOutputTokens = options.maxOutputTokens ?? MISTRAL_MAX_OUTPUT_TOKENS;
  const maxBytes = options.maxBytes ?? MISTRAL_MAX_REQUEST_BYTES;
  if (![maxCalls, maxOutputTokens, maxBytes].every(v => Number.isSafeInteger(v) && v > 0)) {
    throw new Error("Mistral free safety budgets must be positive integers.");
  }
  let attempts = 0;
  let stopped = false;
  return async (input, init) => {
    if (stopped || attempts >= maxCalls) {
      stopped = true;
      return rejected(429, "Mistral free local request budget reached. Stop and review the quota.");
    }
    let request: Request;
    let rewritten: string;
    try {
      request = new Request(input, init);
      if (request.method !== "POST" || request.url !== MISTRAL_CHAT_URL) {
        stopped = true;
        return rejected(400, "Only the pinned Mistral Chat Completions endpoint is allowed.");
      }
      const original = JSON.parse(await request.clone().text()) as unknown;
      if (!original || typeof original !== "object" || Array.isArray(original) ||
          (original as { model?: unknown }).model !== MISTRAL_SMALL_MODEL) {
        stopped = true;
        return rejected(400, "Unreviewed Mistral model or malformed payload was blocked.");
      }
      rewritten = JSON.stringify(normalizeCloudflareChatPayload(original, maxOutputTokens));
      if (Buffer.byteLength(rewritten, "utf8") > maxBytes) {
        stopped = true;
        return rejected(400, "Mistral request exceeded the free run byte cap.");
      }
    } catch {
      stopped = true;
      return rejected(400, "Mistral text-only payload could not be validated.");
    }
    attempts++;
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    try {
      const response = await underlyingFetch(new Request(request, { body: rewritten, headers }));
      if (!response.ok) {
        stopped = true;
        // Scrub all upstream diagnostics: provider bodies can echo private metadata.
        const status = response.status;
        return rejected(status >= 400 && status <= 599 ? status : 502,
          "Mistral provider returned HTTP " + status + ". Stop without retrying.");
      }
      return response;
    } catch {
      stopped = true;
      return rejected(503, "Mistral provider transport failed. Stop without retrying.");
    }
  };
}
