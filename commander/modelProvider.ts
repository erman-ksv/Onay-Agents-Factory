import OpenAI from "openai";
import {
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
} from "@openai/agents";
import { selectProviderConfig } from "./providerConfig.js";

/** Configure the SDK once so Commander and Coder use the same selected provider. */
export function configureModelProvider(env: NodeJS.ProcessEnv = process.env) {
  const config = selectProviderConfig(env);
  if (config.provider === "none") return config;

  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.provider === "gemini" ? { baseURL: config.baseURL } : {}),
  });
  setDefaultOpenAIClient(client);

  if (config.provider === "gemini") {
    // Gemini exposes an OpenAI-compatible endpoint; don't send traces to OpenAI.
    setOpenAIAPI("chat_completions");
    setTracingDisabled(true);
  }

  return config;
}
