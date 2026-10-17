export type ProviderEnvironment = {
  AGENT_FACTORY_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_MODEL?: string;
};

export type ProviderConfig =
  | { provider: "gemini"; apiKey: string; model: string; baseURL: string }
  | { provider: "openai"; apiKey: string; model?: string }
  | { provider: "openrouter"; apiKey: string; model: string; baseURL: string }
  | { provider: "groq"; apiKey: string; model: string; baseURL: string }
  | { provider: "cloudflare"; apiKey: string; model: string; baseURL: string }
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
  if (selected && selected !== "gemini" && selected !== "openai" && selected !== "openrouter" && selected !== "groq" && selected !== "cloudflare") {
    throw new Error("AGENT_FACTORY_PROVIDER must be gemini, openai, openrouter, groq or cloudflare.");
  }

  // Explicit-only Cloudflare selection prevents its key changing legacy routing.
  if (selected === "cloudflare") {
    const apiKey = env.CLOUDFLARE_API_TOKEN?.trim();
    const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
    if (!apiKey || !accountId) return { provider: "none" };
    if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error("CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account ID.");
    const model = env.CLOUDFLARE_MODEL?.trim() || "@cf/zai-org/glm-4.7-flash";
    // Restrict use to the explicitly reviewed Workers AI free-tier model.
    if (model !== "@cf/zai-org/glm-4.7-flash") throw new Error("CLOUDFLARE_MODEL is not approved for the Workers AI free-tier route.");
    return { provider: "cloudflare", apiKey, model,
      baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1` };
  }

  // Groq is opt-in: a new key never changes legacy provider priority.
  if (selected === "groq") {
    const apiKey = env.GROQ_API_KEY?.trim();
    if (!apiKey) return { provider: "none" };
    return { provider: "groq", apiKey, model: env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
      baseURL: "https://api.groq.com/openai/v1" };
  }

  const geminiApiKey = env.GEMINI_API_KEY?.trim();
  if (geminiApiKey && selected !== "openai" && selected !== "openrouter" && selected !== "groq" && selected !== "cloudflare") {
    return {
      provider: "gemini",
      apiKey: geminiApiKey,
      model: env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
    };
  }

  const openAiApiKey = env.OPENAI_API_KEY?.trim();
  if (openAiApiKey && selected !== "gemini" && selected !== "openrouter" && selected !== "groq" && selected !== "cloudflare") {
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
  if (selected === "cloudflare") return "The selected Cloudflare provider requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the Agent Factory runtime.";
  if (selected === "groq") return "The selected Groq provider requires GROQ_API_KEY in the Agent Factory runtime.";
  if (selected === "openai") return "The selected OpenAI provider requires OPENAI_API_KEY in the Agent Factory runtime.";
  if (selected === "gemini") return "The selected Gemini provider requires GEMINI_API_KEY in the Agent Factory runtime.";
  if (selected === "openrouter") return "The selected OpenRouter provider requires OPENROUTER_API_KEY in the Agent Factory runtime.";
  return "AI execution requires a configured provider API key in the Agent Factory runtime.";
}

