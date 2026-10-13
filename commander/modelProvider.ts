import OpenAI from "openai";
import {
  OpenAIProvider,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
} from "@openai/agents";
import { selectProviderConfig } from "./providerConfig.js";

/** Retry only failed HTTP requests inside the provider client, never an entire agent run. */
export const GEMINI_TRANSIENT_MAX_RETRIES = 4;

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
      const now = Date.now();
      const wait = Math.max(0, nextSlot - now);
      nextSlot = Math.max(now, nextSlot) + intervalMs;
      if (wait > 0) await new Promise<void>(resolve => setTimeout(resolve, wait));
      return underlyingFetch(input, init);
    });
    queue = attempt.then(() => undefined, () => undefined);
    return attempt;
  };
}

/** Configure the SDK for the current invocation, including provider switches. */
export function configureModelProvider(env: NodeJS.ProcessEnv = process.env) {
  const config = selectProviderConfig(env);
  if (config.provider === "none") return config;

  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.provider === "gemini" ? { fetch: createGeminiRateLimitedFetch() } : {}),
    // OpenAI SDK retries 408/409/429/5xx with bounded backoff and Retry-After.
    // This is scoped to a failed model HTTP request; do not replay runner.run().
    maxRetries: config.provider === "gemini" ? GEMINI_TRANSIENT_MAX_RETRIES : 2,
    baseURL: config.provider === "gemini" ? config.baseURL : "https://api.openai.com/v1",
  });
  // The SDK's shared runner/provider caches its first client. Each factory run
  // needs an explicit provider so its selected key, endpoint and API stay pinned.
  const modelProvider = new OpenAIProvider({
    openAIClient: client,
    useResponses: config.provider === "openai",
    useResponsesWebSocket: false,
  });
  setDefaultOpenAIClient(client);

  if (config.provider === "gemini") {
    // Gemini exposes an OpenAI-compatible endpoint; don't send traces to OpenAI.
    setOpenAIAPI("chat_completions");
    setTracingDisabled(true);
  } else {
    // Restore the native API after a Gemini invocation. Keep the host's tracing policy.
    setOpenAIAPI("responses");
  }

  return { ...config, modelProvider };
}
