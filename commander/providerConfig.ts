export type ProviderEnvironment = {
  AGENT_FACTORY_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
};

export type ProviderConfig =
  | { provider: "gemini"; apiKey: string; model: string; baseURL: string }
  | { provider: "openai"; apiKey: string; model?: string }
  | { provider: "none" };

/** Explicit selection never falls back; the legacy default remains Gemini first. */
export function selectProviderConfig(env: ProviderEnvironment): ProviderConfig {
  const selected = env.AGENT_FACTORY_PROVIDER?.trim();
  if (selected && selected !== "gemini" && selected !== "openai") {
    throw new Error("AGENT_FACTORY_PROVIDER must be gemini or openai.");
  }
  const geminiApiKey = env.GEMINI_API_KEY?.trim();
  if (geminiApiKey && selected !== "openai") {
    return {
      provider: "gemini",
      apiKey: geminiApiKey,
      model: env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
    };
  }

  const openAiApiKey = env.OPENAI_API_KEY?.trim();
  if (openAiApiKey && selected !== "gemini") {
    const model = env.OPENAI_MODEL?.trim();
    return { provider: "openai", apiKey: openAiApiKey, ...(model ? { model } : {}) };
  }

  return { provider: "none" };
}

export function providerRequirementMessage(env: ProviderEnvironment): string {
  const selected = env.AGENT_FACTORY_PROVIDER?.trim();
  if (selected === "openai") return "The selected OpenAI provider requires OPENAI_API_KEY in the Agent Factory runtime.";
  if (selected === "gemini") return "The selected Gemini provider requires GEMINI_API_KEY in the Agent Factory runtime.";
  return "AI execution requires GEMINI_API_KEY or OPENAI_API_KEY in the Agent Factory runtime.";
}

