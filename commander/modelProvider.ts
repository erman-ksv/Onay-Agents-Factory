import OpenAI from "openai";
import {
  OpenAIProvider,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
} from "@openai/agents";
import { selectProviderConfig } from "./providerConfig.js";

/** Configure the SDK for the current invocation, including provider switches. */
export function configureModelProvider(env: NodeJS.ProcessEnv = process.env) {
  const config = selectProviderConfig(env);
  if (config.provider === "none") return config;

  const client = new OpenAI({
    apiKey: config.apiKey,
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
