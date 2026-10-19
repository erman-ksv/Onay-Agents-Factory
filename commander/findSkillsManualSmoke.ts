/**
 * Manual, opt-in, one-provider-request smoke test for the Find Skills bridge.
 * This proves Cloudflare can select our read-only discovery operation. It does
 * NOT run the full multi-turn Commander SDK agent or install third-party skills.
 */
import { pathToFileURL } from "node:url";
import { createCloudflareCompatibleFetch } from "./cloudflareCompatibility.js";
import { discoverFindSkills } from "./findSkills.js";
import { selectProviderConfig } from "./providerConfig.js";

export const MANUAL_SMOKE_CONFIRM = "RUN_ONE_REQUEST";

export async function runFindSkillsManualSmoke(
  env: NodeJS.ProcessEnv,
  cloudflareFetch: typeof fetch = fetch,
  catalogFetch: typeof fetch = fetch,
) {
  if (env.FIND_SKILLS_LIVE_CONFIRM !== MANUAL_SMOKE_CONFIRM) {
    throw new Error("Manual Find Skills smoke needs explicit RUN_ONE_REQUEST approval.");
  }
  const config = selectProviderConfig({ ...env, AGENT_FACTORY_PROVIDER: "cloudflare" });
  if (config.provider !== "cloudflare") {
    throw new Error("Cloudflare Workers AI token/account is missing. No request was sent.");
  }

  // Exactly one provider request, no SDK retries and no freeform CLI arguments.
  const safeFetch = createCloudflareCompatibleFetch(cloudflareFetch, {
    maxRequests: 1, maxOutputTokens: 128, maxRequestBytes: 4096,
  });
  const response = await safeFetch(config.baseURL + "/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model, temperature: 0, n: 1, max_tokens: 128,
      messages: [
        { role: "system", content: "You are Onay Commander routing a request to a read-only host tool. Return only compact JSON with keys tool and query. The only valid routing is {\"tool\":\"find_skills\",\"query\":\"expo\"}. Do not provide instructions or code." },
        { role: "user", content: "Find a catalog skill for Expo React Native mobile development. Use the available read-only find_skills search." },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error("Cloudflare request failed with HTTP " + response.status);
  const raw = await response.text();
  if (raw.length > 20_000) throw new Error("Cloudflare response exceeded permitted size.");
  const envelope: unknown = JSON.parse(raw);
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error("Invalid Cloudflare response.");
  const choices = (envelope as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length !== 1) throw new Error("Cloudflare must return exactly one completion.");
  const message = choices[0]?.message?.content;
  if (typeof message !== "string" || message.length > 1000) throw new Error("Cloudflare did not provide a bounded text response.");
  let route: unknown;
  try { route = JSON.parse(message.trim()); } catch { throw new Error("Cloudflare did not return a valid routing JSON object."); }
  if (!route || typeof route !== "object" || Array.isArray(route) ||
      Object.keys(route).sort().join(",") !== "query,tool" ||
      (route as { tool?: unknown }).tool !== "find_skills" ||
      (route as { query?: unknown }).query !== "expo") {
    throw new Error("Cloudflare returned an unapproved tool or query; no catalog lookup was made.");
  }
  const found = await discoverFindSkills("expo", catalogFetch);
  if (found.status !== "found") throw new Error("Find Skills catalog did not return validated Expo candidates.");
  return {
    status: "verified_read_only" as const,
    provider: "cloudflare" as const,
    providerRequests: 1 as const,
    catalog: found.catalog,
    catalogStatus: found.status,
    candidates: found.candidates.map(c => ({ name: c.name, source: c.source, listingUrl: c.listingUrl })),
    installationPerformed: false as const,
    githubWritesPerformed: false as const,
    fullCommanderRun: false as const,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runFindSkillsManualSmoke(process.env);
    // Never print a credential, authorization header or raw model output.
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Manual Find Skills smoke failed.");
    process.exitCode = 1;
  }
}
