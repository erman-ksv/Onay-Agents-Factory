/** Cloudflare Workers AI text-only Chat Completions transport.
 * Normalizes SDK content-part arrays and null assistant tool-call content.
 * Never makes paid-provider calls, retries, or silently drops non-text parts.
 */
export const CLOUDFLARE_MAX_REQUESTS = 12;
export const CLOUDFLARE_MAX_OUTPUT_TOKENS = 1024;
export const CLOUDFLARE_MAX_REQUEST_BYTES = 96_000;

type JsonMap = Record<string, unknown>;

function isMap(value: unknown): value is JsonMap {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeTextContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) throw new Error("Cloudflare text-only chat requires string content.");
  return value.map(part => {
    if (typeof part === "string") return part;
    if (isMap(part) && (part.type === "text" || part.type === "input_text") && typeof part.text === "string") {
      return part.text;
    }
    throw new Error("Cloudflare text-only model does not accept images, audio or non-text content parts.");
  }).join("\n");
}

/** Validate and normalize before hitting Cloudflare; preserve tool_calls and tool_call_id. */
export function normalizeCloudflareChatPayload(input: unknown, maxOutputTokens = CLOUDFLARE_MAX_OUTPUT_TOKENS): JsonMap {
  if (!isMap(input) || !Array.isArray(input.messages) || !input.messages.length) {
    throw new Error("Cloudflare requires a nonempty Chat Completions messages array.");
  }
  if (input.n !== undefined && input.n !== 1) {
    throw new Error("Cloudflare free mode allows only one completion per request.");
  }
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("Cloudflare output limit is invalid.");
  }
  const messages = input.messages.map((item: unknown) => {
    if (!isMap(item) || !["system", "developer", "user", "assistant", "tool"].includes(String(item.role))) {
      throw new Error("Cloudflare Chat Completions message role is unsupported.");
    }
    if (item.content === null && item.role === "assistant" && Array.isArray(item.tool_calls)) {
      return { ...item, role: "assistant", content: "" };
    }
    return { ...item, role: item.role === "developer" ? "system" : item.role, content: normalizeTextContent(item.content) };
  });
  const provided = [input.max_tokens, input.max_completion_tokens].filter(value => value !== undefined && value !== null);
  if (provided.some(value => typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)) {
    throw new Error("Cloudflare output token request must be a positive integer.");
  }
  const requested = provided.length ? Math.min(...provided as number[]) : maxOutputTokens;
  const { max_completion_tokens: _oldMax, ...payload } = input;
  return { ...payload, messages, max_tokens: Math.min(maxOutputTokens, requested), n: 1, stream: false };
}

function rejected(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message, type: status === 429 ? "rate_limit_error" : "invalid_request_error" } }), {
    status,
    headers: { "content-type": "application/json", "x-should-retry": "false" },
  });
}

/** Request cap is per configured client/run. HTTP 429 permanently stops its budget. */
export function createCloudflareCompatibleFetch(
  underlyingFetch: typeof fetch = globalThis.fetch,
  options: { maxRequests?: number; maxOutputTokens?: number; maxRequestBytes?: number } = {},
): typeof fetch {
  const maxRequests = options.maxRequests ?? CLOUDFLARE_MAX_REQUESTS;
  const maxOutputTokens = options.maxOutputTokens ?? CLOUDFLARE_MAX_OUTPUT_TOKENS;
  const maxRequestBytes = options.maxRequestBytes ?? CLOUDFLARE_MAX_REQUEST_BYTES;
  if (![maxRequests, maxOutputTokens, maxRequestBytes].every(v => Number.isSafeInteger(v) && v > 0)) {
    throw new Error("Cloudflare safety limits must be positive integers.");
  }
  let attempted = 0;
  let stopped = false;
  return async (input, init) => {
    if (stopped || attempted >= maxRequests) {
      stopped = true;
      return rejected(429, "Cloudflare local request limit or provider quota reached. Stop this run.");
    }
    let request: Request;
    let normalized: string;
    try {
      request = new Request(input, init);
      if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/ai/v1/chat/completions")) {
        return rejected(400, "Cloudflare provider supports only Chat Completions.");
      }
      const parsed = JSON.parse(await request.clone().text()) as unknown;
      normalized = JSON.stringify(normalizeCloudflareChatPayload(parsed, maxOutputTokens));
      if (Buffer.byteLength(normalized, "utf8") > maxRequestBytes) {
        stopped = true;
        return rejected(400, "Cloudflare request size exceeded the local safety limit.");
      }
    } catch {
      stopped = true;
      return rejected(400, "Cloudflare request is not a supported text-only Chat Completions payload.");
    }
    attempted += 1;
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    const response = await underlyingFetch(new Request(request, { body: normalized, headers }));
    if (response.status === 429) {
      stopped = true;
      return rejected(429, "Cloudflare provider quota or rate limit reached. Stop this run.");
    }
    return response;
  };
}
