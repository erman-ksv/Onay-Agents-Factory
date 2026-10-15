export type ProviderEnvironment = {
  AGENT_FACTORY_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
};

export type ProviderConfig =
  | { provider: "gemini"; apiKey: string; model: string; baseURL: string }
  | { provider: "openai"; apiKey: string; model?: string }
  | { provider: "openrouter"; apiKey: string; model: string; baseURL: string }
  | { provider: "none" };

/** Allow only no-cost OpenRouter routes. Paid slugs must never reach the API. */
export function isFreeOpenRouterModel(model: string): boolean {
  return model === "openrouter/free" ||
    /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*:free$/i.test(model);
}

function openRouterConfig(env: ProviderEnvironment, key: string): ProviderConfig {
  const model = env.OPENROUTER_MODEL?.trim() || "openrouter/free";
  if (!isFreeOpenRouterModel(model)) {
    throw new Error("OPENROUTER_MODEL must be openrouter/free or an explicit :free model. Paid routes are disabled.");
  }
  return { provider: "openrouter", apiKey: key, model, baseURL: "https://openrouter.ai/api/v1" };
}

/** Explicit provider selection never falls back or resumes an interrupted agent run. */
export function selectProviderConfig(env: ProviderEnvironment): ProviderConfig {
  const selected = env.AGENT_FACTORY_PROVIDER?.trim();
  if (selected && selected !== "gemini" && selected !== "openai" && selected !== "openrouter") {
    throw new Error("AGENT_FACTORY_PROVIDER must be gemini, openai or openrouter.");
  }

  const geminiApiKey = env.GEMINI_API_KEY?.trim();
  if (geminiApiKey && selected !== "openai" && selected !== "openrouter") {
    return {
      provider: "gemini",
      apiKey: geminiApiKey,
      model: env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
    };
  }

  const openAiApiKey = env.OPENAI_API_KEY?.trim();
  if (openAiApiKey && selected !== "gemini" && selected !== "openrouter") {
    const model = env.OPENAI_MODEL?.trim();
    return { provider: "openai", apiKey: openAiApiKey, ...(model ? { model } : {}) };
  }

  const openRouterApiKey = env.OPENROUTER_API_KEY?.trim();
  if (openRouterApiKey && (selected === "openrouter" || !selected)) {
    return openRouterConfig(env, openRouterApiKey);
  }

  return { provider: "none" };
}

export function providerRequirementMessage(env: ProviderEnvironment): string {
  const selected = env.AGENT_FACTORY_PROVIDER?.trim();
  if (selected === "openai") return "The selected OpenAI provider requires OPENAI_API_KEY in the Agent Factory runtime.";
  if (selected === "gemini") return "The selected Gemini provider requires GEMINI_API_KEY in the Agent Factory runtime.";
  if (selected === "openrouter") return "The selected OpenRouter provider requires OPENROUTER_API_KEY in the Agent Factory runtime.";
  return "AI execution requires GEMINI_API_KEY, OPENAI_API_KEY or OPENROUTER_API_KEY in the Agent Factory runtime.";
}
