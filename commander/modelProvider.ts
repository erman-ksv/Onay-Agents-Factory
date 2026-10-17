import OpenAI from "openai";
import {
  OpenAIProvider,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
} from "@openai/agents";
import { selectProviderConfig } from "./providerConfig.js";
import { createCloudflareCompatibleFetch } from "./cloudflareCompatibility.js";
import { createMistralFreeFetch } from "./mistralFree.js";
import {
  createGroqBudgetedFetch,
  createProviderContextBudget,
  providerContextBudgetOptionsFromEnv,
  type ProviderContextBudget,
} from "./providerContextBudget.js";

/** Retry only failed HTTP requests inside the provider client, never an entire agent run. */
export const GEMINI_TRANSIENT_MAX_RETRIES = 4;

/** Quota exhaustion is not transient; retrying cannot restore a daily allowance. */
export function isGeminiDailyQuotaExhausted(body: string): boolean {
  return /GenerateRequestsPerDayPerProjectPerModel-FreeTier|GenerateRequestsPerDayPerProjectPerModel/i.test(body);
}

/** Serialize Gemini HTTP attempts to stay below the observed free-tier RPM cap.
 * Applies to SDK retries too, without replaying agent tools. */
export function createGeminiRateLimitedFetch(
  underlyingFetch: typeof fetch = globalThis.fetch,
  intervalMs = 13_000,
): typeof fetch {
  let nextSlot = 0;
  let queue = Promise.resolve();
  return (input, init) => {
    const attempt = queue.then(async () => {
      // Use a monotonic clock; Date.now() can jump when the runner syncs its clock.
      const wait = Math.max(0, nextSlot - performance.now());
      if (wait > 0) await new Promise<void>(resolve => setTimeout(resolve, wait));
      // Start the request before scheduling the next slot. A delayed timer must
      // not cause two requests to be sent back-to-back to "catch up".
      const request = underlyingFetch(input, init);
      nextSlot = performance.now() + intervalMs;
      const response = await request;
      if (response.status === 429) {
        const body = await response.clone().text();
        if (isGeminiDailyQuotaExhausted(body)) {
          // The SDK retries thrown fetch errors as connection failures.
          // Convert daily exhaustion into a non-retryable sanitized HTTP response.
          return new Response(JSON.stringify({
            error: { message: "Gemini daily request quota exhausted (HTTP 429). Stop this run and wait for quota reset.", type: "quota_exhausted" },
          }), { status: 403, headers: { "content-type": "application/json" } });
        }
      }
      return response;
    });
    queue = attempt.then(() => undefined, () => undefined);
    return attempt;
  };
}

/** Configure the SDK for the current invocation, including provider switches. */
export type ModelProviderOptions = {
  /** One run-owned ledger shared by every Groq commander, Coder and specialist. */
  contextBudget?: ProviderContextBudget;
  /** Offline/in-process transport injection. Never changes the fixed provider endpoint. */
  fetch?: typeof fetch;
};

export function configureModelProvider(env: NodeJS.ProcessEnv = process.env, options: ModelProviderOptions = {}) {
  const config = selectProviderConfig(env);
  if (config.provider === "none") return config;

  const qualificationPayload = env.AGENT_FACTORY_GROQ_QUALIFICATION === "true";
  const contextBudget = config.provider === "groq" ? (options.contextBudget ??
    (qualificationPayload ? undefined : createProviderContextBudget(providerContextBudgetOptionsFromEnv(env)))) : undefined;

  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.provider === "gemini" ? { fetch: createGeminiRateLimitedFetch(options.fetch) } :
      config.provider === "cloudflare" ? { fetch: createCloudflareCompatibleFetch(options.fetch) } :
      config.provider === "mistral" ? { fetch: createMistralFreeFetch(options.fetch) } :
      contextBudget ? { fetch: createGroqBudgetedFetch(contextBudget, options.fetch) } :
      options.fetch ? { fetch: options.fetch } : {}),
    // OpenAI SDK retries 408/409/429/5xx with bounded backoff and Retry-After.
    // This is scoped to a failed model HTTP request; do not replay runner.run().
    // Free OpenRouter and Groq requests must not multiply on a quota/rate-limit failure.
    maxRetries: (config.provider === "openrouter" || config.provider === "groq" || config.provider === "cloudflare" || config.provider === "mistral") ? 0 : config.provider === "gemini" ? GEMINI_TRANSIENT_MAX_RETRIES : 2,
    baseURL: config.provider !== "openai" ? config.baseURL : "https://api.openai.com/v1",
  });
  // The SDK's shared runner/provider caches its first client. Each factory run
  // needs an explicit provider so its selected key, endpoint and API stay pinned.
  const modelProvider = new OpenAIProvider({
    openAIClient: client,
    useResponses: config.provider === "openai",
    useResponsesWebSocket: false,
  });
  setDefaultOpenAIClient(client);

  if (config.provider !== "openai") {
    // Gemini, OpenRouter, Groq and Cloudflare expose OpenAI-compatible chat completions; don't send traces to OpenAI.
    setOpenAIAPI("chat_completions");
    setTracingDisabled(true);
  } else {
    // Restore the native API after a Gemini invocation. Keep the host's tracing policy.
    setOpenAIAPI("responses");
  }

  return { ...config, modelProvider, ...(contextBudget ? { contextBudget } : {}) };
}

