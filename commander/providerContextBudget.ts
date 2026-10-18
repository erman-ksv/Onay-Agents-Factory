/** Host-owned Groq limits. Reservations cover estimated input plus maximum output.
 * The exact byte cap is independent of the token estimate (UTF-8 bytes / 3 plus
 * framing). Tokenization varies; this is a local guard, not discovered quota. */
export type ProviderContextBudgetOptions = {
  maxContextTokens?: number;
  maxRunTokens?: number;
  maxTokensPerMinute?: number;
  reservedOutputTokens?: number;
  maxRequestBytes?: number;
  /** Monotonic clock injection for offline tests. */
  now?: () => number;
};

export const DEFAULT_GROQ_CONTEXT_BUDGET = Object.freeze({
  maxContextTokens: 6000,
  maxRunTokens: 16000,
  maxTokensPerMinute: 6000,
  reservedOutputTokens: 512,
  maxRequestBytes: 24000,
});

export type ProviderFailureCode = "context_budget_exceeded" | "run_budget_exceeded" |
  "tpm_budget_exceeded" | "request_bytes_exceeded" | "invalid_budget_request" | "rate_limited";

export type ProviderFailure = {
  provider: "groq";
  code: ProviderFailureCode;
  retryable: false;
  message: string;
  estimatedInputTokens?: number;
  reservedOutputTokens?: number;
  requestedTokens?: number;
  limitTokens?: number;
  requestBytes?: number;
  limitBytes?: number;
  retryAfter?: string;
};

const FAILURE_MESSAGES: Record<ProviderFailureCode, string> = {
  context_budget_exceeded: "Groq context budget exceeded before sending a request. Stop this run and reduce the context.",
  run_budget_exceeded: "Groq cumulative run token budget exceeded before sending a request. Stop this run.",
  tpm_budget_exceeded: "Groq local tokens-per-minute budget exceeded before sending a request. Stop this run and wait for the budget window.",
  request_bytes_exceeded: "Groq serialized request byte limit exceeded before sending a request. Stop this run and reduce the context.",
  invalid_budget_request: "Groq request could not be safely bounded before sending. Stop this run.",
  rate_limited: "Groq rate limit reached (HTTP 429). Stop this run and respect Retry-After before starting another run.",
};

function failure(code: ProviderFailureCode, details: Partial<ProviderFailure> = {}): ProviderFailure {
  return { ...details, provider: "groq", code, retryable: false, message: FAILURE_MESSAGES[code] };
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** Values are deliberately never included in configuration errors. */
export function providerContextBudgetOptionsFromEnv(env: NodeJS.ProcessEnv): ProviderContextBudgetOptions {
  const names = {
    maxContextTokens: "GROQ_CONTEXT_BUDGET_TOKENS",
    maxRunTokens: "GROQ_RUN_BUDGET_TOKENS",
    maxTokensPerMinute: "GROQ_TPM_BUDGET_TOKENS",
    reservedOutputTokens: "GROQ_RESERVED_OUTPUT_TOKENS",
    maxRequestBytes: "GROQ_MAX_REQUEST_BYTES",
  } as const;
  const options: ProviderContextBudgetOptions = {};
  for (const [key, name] of Object.entries(names) as [keyof typeof names, string][]) {
    const raw = env[name]?.trim();
    if (!raw) continue;
    const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!positiveInteger(value)) throw new Error("Groq token budget settings must be positive safe integers.");
    options[key] = value;
  }
  return options;
}

export type ProviderBudgetSnapshot = {
  reservedRunTokens: number;
  reservedWindowTokens: number;
  attemptedRequests: number;
};

/** Share this instance across commander, Coder and specialist clients for ONE run.
 * Reservations are synchronous, so concurrent specialists cannot oversubscribe it.
 * Once sent, even a failed HTTP attempt stays reserved: usage may be unknown.
 * A budget rejection or HTTP 429 permanently stops this ledger's run. */
export class ProviderContextBudget {
  readonly limits: Readonly<Required<Omit<ProviderContextBudgetOptions, "now">>>;
  private readonly now: () => number;
  private reservedRunTokens = 0;
  private attemptedRequests = 0;
  private readonly window: { at: number; tokens: number }[] = [];
  private stopped?: ProviderFailure;

  constructor(options: ProviderContextBudgetOptions = {}) {
    const { now, ...limits } = options;
    const effective = { ...DEFAULT_GROQ_CONTEXT_BUDGET, ...limits };
    if (!Object.values(effective).every(positiveInteger) ||
        effective.reservedOutputTokens >= effective.maxContextTokens ||
        effective.reservedOutputTokens >= effective.maxRunTokens ||
        effective.reservedOutputTokens >= effective.maxTokensPerMinute) {
      throw new Error("Groq token budget settings must be positive safe integers with room for input and reserved output.");
    }
    this.limits = Object.freeze(effective);
    this.now = now ?? (() => performance.now());
  }

  private currentWindow(): { now: number; reserved: number } {
    const now = this.now();
    // A monotonic clock is used in production. If a test/host clock goes back,
    // retain reservations instead of creating additional quota.
    while (this.window.length && now - this.window[0].at >= 60_000) this.window.shift();
    return { now, reserved: this.window.reduce((sum, item) => sum + item.tokens, 0) };
  }

  snapshot(): ProviderBudgetSnapshot {
    return { reservedRunTokens: this.reservedRunTokens,
      reservedWindowTokens: this.currentWindow().reserved, attemptedRequests: this.attemptedRequests };
  }

  /** A caught specialist/tool error must not allow this run to send more requests. */
  get failure(): ProviderFailure | undefined {
    return this.stopped ? { ...this.stopped } : undefined;
  }

  stop(problem: ProviderFailure): ProviderFailure {
    this.stopped ??= extractProviderFailure({ providerFailure: problem }) ?? failure("invalid_budget_request");
    return { ...this.stopped };
  }

  reserve(estimatedInputTokens: number, reservedOutputTokens = this.limits.reservedOutputTokens): ProviderFailure | undefined {
    if (this.stopped) return this.failure;
    if (!positiveInteger(estimatedInputTokens) || !positiveInteger(reservedOutputTokens) ||
        reservedOutputTokens > this.limits.reservedOutputTokens ||
        !Number.isSafeInteger(estimatedInputTokens + reservedOutputTokens)) {
      return this.stop(failure("invalid_budget_request"));
    }
    const requestedTokens = estimatedInputTokens + reservedOutputTokens;
    const details = { estimatedInputTokens, reservedOutputTokens, requestedTokens };
    if (requestedTokens > this.limits.maxContextTokens) {
      return this.stop(failure("context_budget_exceeded", { ...details, limitTokens: this.limits.maxContextTokens }));
    }
    if (requestedTokens > this.limits.maxRunTokens - this.reservedRunTokens) {
      return this.stop(failure("run_budget_exceeded", { ...details, limitTokens: this.limits.maxRunTokens }));
    }
    const window = this.currentWindow();
    if (requestedTokens > this.limits.maxTokensPerMinute - window.reserved) {
      return this.stop(failure("tpm_budget_exceeded", { ...details, limitTokens: this.limits.maxTokensPerMinute }));
    }
    this.reservedRunTokens += requestedTokens;
    this.attemptedRequests++;
    this.window.push({ at: window.now, tokens: requestedTokens });
    return undefined;
  }
}

export function createProviderContextBudget(options: ProviderContextBudgetOptions = {}): ProviderContextBudget {
  return new ProviderContextBudget(options);
}

/** Allow only Retry-After's numeric or IMF-fixdate forms; never echo arbitrary headers. */
export function safeRetryAfter(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 64) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(trimmed) && Number.isFinite(Number(trimmed)) && Number(trimmed) <= Number.MAX_SAFE_INTEGER) {
    return trimmed;
  }
  if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed)) {
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed) && new Date(parsed).toUTCString() === trimmed) return trimmed;
  }
  return undefined;
}

function failureResponse(problem: ProviderFailure): Response {
  const status = problem.code === "rate_limited" ? 429 : 400;
  return new Response(JSON.stringify({ error: {
    message: problem.message, type: status === 429 ? "rate_limit_error" : "provider_budget_error",
    code: problem.code, providerFailure: problem,
  } }), { status, headers: {
    "content-type": "application/json", "x-should-retry": "false",
    ...(problem.retryAfter ? { "retry-after": problem.retryAfter } : {}),
  } });
}

/** Reserve the complete outbound JSON (including instructions, tools and history),
 * then cap output. Reject unknown/non-JSON bodies without contacting a provider. */
export function createGroqBudgetedFetch(
  budget: ProviderContextBudget,
  underlyingFetch: typeof fetch = globalThis.fetch,
  onUpstreamRateLimit?: () => void,
): typeof fetch {
  return async (input, init) => {
    const stopped = budget.failure;
    if (stopped) return failureResponse(stopped);
    let request: Record<string, unknown>;
    try {
      const body = typeof init?.body === "string" ? init.body :
        !init?.body && input instanceof Request ? await input.clone().text() : undefined;
      if (!body) return failureResponse(budget.stop(failure("invalid_budget_request")));
      const parsed: unknown = JSON.parse(body);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return failureResponse(budget.stop(failure("invalid_budget_request")));
      }
      request = parsed as Record<string, unknown>;
    } catch {
      return failureResponse(budget.stop(failure("invalid_budget_request")));
    }
    // Multiple completions would multiply output consumption beyond one reservation.
    if (request.n !== undefined && request.n !== 1) {
      return failureResponse(budget.stop(failure("invalid_budget_request")));
    }
    let outputTokens = budget.limits.reservedOutputTokens;
    for (const key of ["max_tokens", "max_completion_tokens"] as const) {
      if (request[key] === undefined || request[key] === null) continue;
      if (typeof request[key] !== "number" || !positiveInteger(request[key])) {
        return failureResponse(budget.stop(failure("invalid_budget_request")));
      }
      outputTokens = Math.min(outputTokens, request[key]);
    }
    delete request.max_tokens;
    request.max_completion_tokens = outputTokens;
    const body = JSON.stringify(request);
    const requestBytes = Buffer.byteLength(body, "utf8");
    if (requestBytes > budget.limits.maxRequestBytes) {
      return failureResponse(budget.stop(failure("request_bytes_exceeded", {
        requestBytes, limitBytes: budget.limits.maxRequestBytes,
      })));
    }
    const estimatedInputTokens = Math.ceil(requestBytes / 3) + 256;
    const rejected = budget.reserve(estimatedInputTokens, outputTokens);
    if (rejected) return failureResponse(rejected);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.delete("content-length");
    const response = await underlyingFetch(input, { ...init, headers, body });
    if (response.status !== 429) return response;
    // Never read, parse or retain a provider error body; it can echo input/secrets.
    onUpstreamRateLimit?.();
    const retryAfter = safeRetryAfter(response.headers.get("retry-after"));
    void response.body?.cancel().catch(() => undefined);
    return failureResponse(budget.stop(failure("rate_limited", retryAfter ? { retryAfter } : {})));
  };
}

/** Extract ONLY our allowlisted structured fields, never the SDK message/body/cause. */
export function extractProviderFailure(error: unknown): ProviderFailure | undefined {
  if (!error || typeof error !== "object") return undefined;
  const outer = error as Record<string, unknown>;
  const nested = outer.error && typeof outer.error === "object" ? outer.error as Record<string, unknown> : outer;
  const candidate = nested.providerFailure;
  if (!candidate || typeof candidate !== "object") return undefined;
  const record = candidate as Record<string, unknown>;
  if (record.provider !== "groq" || typeof record.code !== "string" ||
      !Object.hasOwn(FAILURE_MESSAGES, record.code)) return undefined;
  const code = record.code as ProviderFailureCode;
  const details: Partial<ProviderFailure> = {};
  for (const key of ["estimatedInputTokens", "reservedOutputTokens", "requestedTokens", "limitTokens", "requestBytes", "limitBytes"] as const) {
    if (typeof record[key] === "number" && positiveInteger(record[key])) details[key] = record[key];
  }
  const retryAfter = typeof record.retryAfter === "string" ? safeRetryAfter(record.retryAfter) : undefined;
  if (retryAfter) details.retryAfter = retryAfter;
  return failure(code, details);
}
