export type ProviderEnvironment = {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string;
};

export type ProviderConfig =
  | { provider: "gemini"; apiKey: string; model: string; baseURL: string }
  | { provider: "openai"; apiKey: string }
  | { provider: "none" };

/** Select the configured provider deterministically; Gemini takes precedence. */
export function selectProviderConfig(env: ProviderEnvironment): ProviderConfig {
  const geminiApiKey = env.GEMINI_API_KEY?.trim();
  if (geminiApiKey) {
    return {
      provider: "gemini",
      apiKey: geminiApiKey,
      model: env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
    };
  }

  const openAiApiKey = env.OPENAI_API_KEY?.trim();
  if (openAiApiKey) return { provider: "openai", apiKey: openAiApiKey };

  return { provider: "none" };
}
