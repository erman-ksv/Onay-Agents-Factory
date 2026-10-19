/** One host-owned ledger for every model client in a single task. It does not
 * discover provider quota or retry a rejected task. Serialized request bytes
 * include instructions, tools and model history, independently of tokenizers. */
export type TaskModelBudgetOptions = {
  maxRequests?: number;
  maxRequestBytes?: number;
  maxRunBytes?: number;
  maxOutputTokens?: number;
  wallTimeMs?: number;
  /** Monotonic clock injection for offline tests. Real deadlines still apply. */
  now?: () => number;
};

export const DEFAULT_TASK_MODEL_BUDGET = Object.freeze({
  maxRequests: 16,
  maxRequestBytes: 24_000,
  maxRunBytes: 192_000,
  maxOutputTokens: 1_200,
  wallTimeMs: 120_000,
});

export const HARD_TASK_MODEL_BUDGET = Object.freeze({
  maxRequests: 32,
  maxRequestBytes: 64_000,
  maxRunBytes: 512_000,
  maxOutputTokens: 2_048,
  wallTimeMs: 180_000,
});

export type TaskModelBudgetFailureCode = "request_limit" | "request_bytes_limit" |
  "run_bytes_limit" | "task_timeout" | "invalid_request" | "rate_limited" |
  "transport_error" | "request_aborted";

export type TaskModelBudgetFailure = {
  code: TaskModelBudgetFailureCode;
  retryable: false;
  message: string;
};

export type TaskModelBudgetSnapshot = {
  attemptedRequests: number;
  totalRequestBytes: number;
  remainingRequests: number;
  remainingRunBytes: number;
  elapsedMs: number;
  failureCode?: TaskModelBudgetFailureCode;
};

const MESSAGES: Record<TaskModelBudgetFailureCode, string> = {
  request_limit: "Task model request limit reached. This task is stopped.",
  request_bytes_limit: "Task model request is too large. This task is stopped.",
  run_bytes_limit: "Task cumulative model context limit reached. This task is stopped.",
  task_timeout: "Task model deadline reached. This task is stopped.",
  invalid_request: "Task model request could not be safely bounded. This task is stopped.",
  rate_limited: "Model provider returned HTTP 429. This task is stopped without retry.",
  transport_error: "Model transport failed. This task is stopped without retry.",
  request_aborted: "Model request was cancelled. This task is stopped.",
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function failureResponse(problem: TaskModelBudgetFailure): Response {
  const status = problem.code === "rate_limited" ? 429 :
    problem.code === "task_timeout" ? 408 : problem.code === "transport_error" ? 502 : 400;
  return new Response(JSON.stringify({ error: {
    message: problem.message,
    type: "task_model_budget_error",
    code: problem.code,
    taskBudgetFailure: problem,
  } }), { status, headers: {
    "content-type": "application/json",
    "x-should-retry": "false",
  } });
}

/** Input failures and upstream errors expose fixed, source-free diagnostics.
 * Reservations happen synchronously before transport, so concurrent specialists
 * cannot overspend. Failed attempts remain charged because usage is unknown. */
export function createTaskModelBudgetFetch(
  options: TaskModelBudgetOptions = {},
  underlyingFetch: typeof fetch = globalThis.fetch,
): {
  fetch: typeof fetch;
  snapshot(): TaskModelBudgetSnapshot;
  readonly failure: TaskModelBudgetFailure | undefined;
} {
  const { now = () => performance.now(), ...overrides } = options;
  const limits = { ...DEFAULT_TASK_MODEL_BUDGET, ...overrides };
  for (const key of Object.keys(DEFAULT_TASK_MODEL_BUDGET) as (keyof typeof DEFAULT_TASK_MODEL_BUDGET)[]) {
    if (!isPositiveInteger(limits[key]) || limits[key] > HARD_TASK_MODEL_BUDGET[key]) {
      throw new Error("Task model limits must be positive safe integers within the host ceilings.");
    }
  }
  if (typeof now !== "function" || typeof underlyingFetch !== "function") {
    throw new Error("Task model budget requires a clock and transport.");
  }
  const started = now();
  if (!Number.isFinite(started)) throw new Error("Task model budget requires a finite monotonic clock.");
  let lastNow = started;
  let attemptedRequests = 0;
  let totalRequestBytes = 0;
  let stopped: TaskModelBudgetFailure | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const active = new Set<AbortController>();
  const pendingReaders = new Set<() => void>();

  function elapsed(): number {
    const current = now();
    // Moving the injected clock back cannot restore budget or extend a deadline.
    if (Number.isFinite(current)) lastNow = Math.max(lastNow, current);
    return Math.max(0, Math.floor(lastNow - started));
  }
  function stop(code: TaskModelBudgetFailureCode): TaskModelBudgetFailure {
    stopped ??= { code, retryable: false, message: MESSAGES[code] };
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    for (const controller of active) controller.abort();
    for (const cancel of pendingReaders) cancel();
    return { ...stopped };
  }
  function checkDeadline(): void {
    if (!stopped && elapsed() >= limits.wallTimeMs) stop("task_timeout");
  }

  // Do not keep an otherwise finished CLI alive merely to expire this ledger.
  deadlineTimer = setTimeout(() => stop("task_timeout"), limits.wallTimeMs);
  deadlineTimer.unref();

  async function inputBody(input: RequestInfo | URL, init?: RequestInit): Promise<string | undefined> {
    if (typeof init?.body === "string") return init.body;
    if (init?.body !== undefined && init.body !== null) return undefined;
    if (!(input instanceof Request) || !input.body) return undefined;
    // The consumed body is replaced with the bounded serialized JSON before
    // transport. Avoid clone()/tee(), which could leave an unread stream alive.
    const reader = input.body.getReader();
    if (!reader) return undefined;
    const chunks: Uint8Array[] = [];
    let size = 0;
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    pendingReaders.add(cancel);
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limits.maxRequestBytes) {
          void reader.cancel().catch(() => undefined);
          stop("request_bytes_limit");
          return undefined;
        }
        chunks.push(chunk.value);
      }
      return Buffer.concat(chunks).toString("utf8");
    } finally {
      pendingReaders.delete(cancel);
      reader.releaseLock();
    }
  }

  const budgetedFetch: typeof fetch = async (input, init) => {
    checkDeadline();
    if (stopped) return failureResponse(stopped);
    let request: Record<string, unknown>;
    let headers: Headers;
    try {
      const original = await inputBody(input, init);
      checkDeadline();
      if (stopped) return failureResponse(stopped);
      if (!original) return failureResponse(stop("invalid_request"));
      if (Buffer.byteLength(original, "utf8") > limits.maxRequestBytes) {
        return failureResponse(stop("request_bytes_limit"));
      }
      const parsed: unknown = JSON.parse(original);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return failureResponse(stop("invalid_request"));
      }
      request = parsed as Record<string, unknown>;
      if (request.n !== undefined && request.n !== 1) return failureResponse(stop("invalid_request"));
      let outputTokens = limits.maxOutputTokens;
      for (const key of ["max_tokens", "max_completion_tokens"] as const) {
        if (request[key] === undefined) continue;
        if (!isPositiveInteger(request[key])) return failureResponse(stop("invalid_request"));
        outputTokens = Math.min(outputTokens, request[key]);
      }
      // Preserve provider-specific field choice. The inner Groq wrapper may
      // normalize max_tokens to max_completion_tokens and apply a tighter cap.
      if (request.max_completion_tokens !== undefined) {
        request.max_completion_tokens = outputTokens;
        delete request.max_tokens;
      } else request.max_tokens = outputTokens;
      headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.delete("content-length");
    } catch {
      return failureResponse(stop("invalid_request"));
    }
    const body = JSON.stringify(request);
    const bytes = Buffer.byteLength(body, "utf8");
    checkDeadline();
    if (stopped) return failureResponse(stopped);
    if (bytes > limits.maxRequestBytes) return failureResponse(stop("request_bytes_limit"));
    if (attemptedRequests >= limits.maxRequests) return failureResponse(stop("request_limit"));
    if (bytes > limits.maxRunBytes - totalRequestBytes) return failureResponse(stop("run_bytes_limit"));

    // No await between these checks, reservation and registering cancellation.
    attemptedRequests++;
    totalRequestBytes += bytes;
    const controller = new AbortController();
    active.add(controller);
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const onCallerAbort = () => stop("request_aborted");
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    if (callerSignal?.aborted) onCallerAbort();
    let onAbort: (() => void) | undefined;
    let bodyPending = false;
    const release = () => {
      if (onAbort) controller.signal.removeEventListener("abort", onAbort);
      callerSignal?.removeEventListener("abort", onCallerAbort);
      active.delete(controller);
    };
    try {
      if (stopped) return failureResponse(stopped);
      const cancelled = new Promise<Response>((resolve) => {
        onAbort = () => resolve(failureResponse(stopped ?? stop("request_aborted")));
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      const transport = Promise.resolve().then(() => {
        // A concurrent request can stop the ledger before this microtask runs.
        if (stopped) return failureResponse(stopped);
        return underlyingFetch(input, { ...init, headers, body, signal: controller.signal });
      }).then((response) => {
        if (stopped) {
          void response.body?.cancel().catch(() => undefined);
          return failureResponse(stopped);
        }
        if (!response.ok) {
          // Provider bodies and headers may echo secrets or private context.
          void response.body?.cancel().catch(() => undefined);
          return failureResponse(stop(response.status === 429 ? "rate_limited" : "transport_error"));
        }
        return response;
      }, () => failureResponse(stop(controller.signal.aborted ? "request_aborted" : "transport_error")));
      const response = await Promise.race([transport, cancelled]);
      if (stopped || !response.body) return response;
      // fetch resolves at headers. Retain deadline cancellation until the model
      // has consumed its body, including providers which stream indefinitely.
      const reader = response.body.getReader();
      let closed = false;
      let cancelBody: () => void;
      const finishBody = () => {
        pendingReaders.delete(cancelBody);
        bodyPending = false;
        release();
      };
      const bodyStream = new ReadableStream<Uint8Array>({
        start(stream) {
          cancelBody = () => {
            if (closed) return;
            closed = true;
            void reader.cancel().catch(() => undefined);
            stream.error(new Error(stopped?.message ?? MESSAGES.request_aborted));
            finishBody();
          };
          pendingReaders.add(cancelBody);
        },
        async pull(stream) {
          try {
            const chunk = await reader.read();
            if (closed) return;
            if (chunk.done) {
              closed = true;
              stream.close();
              finishBody();
            } else stream.enqueue(chunk.value);
          } catch {
            if (!closed) stop("transport_error");
          }
        },
        cancel() {
          if (closed) return;
          closed = true;
          void reader.cancel().catch(() => undefined);
          finishBody();
        },
      });
      bodyPending = true;
      return new Response(bodyStream, { status: response.status, headers: response.headers });
    } finally {
      if (!bodyPending) release();
    }
  };

  return {
    fetch: budgetedFetch,
    get failure() { checkDeadline(); return stopped ? { ...stopped } : undefined; },
    snapshot() {
      checkDeadline();
      return { attemptedRequests, totalRequestBytes,
        remainingRequests: Math.max(0, limits.maxRequests - attemptedRequests),
        remainingRunBytes: Math.max(0, limits.maxRunBytes - totalRequestBytes),
        elapsedMs: elapsed(), ...(stopped ? { failureCode: stopped.code } : {}) };
    },
  };
}
