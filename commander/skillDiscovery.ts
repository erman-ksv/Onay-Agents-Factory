/**
 * Read-only discovery from the same public skills.sh search endpoint used by
 * the upstream Skills CLI. No npm/npx execution, installation, or repo writes.
 *
 * This legacy endpoint is not a guaranteed stable public API. Fail explicitly
 * if it becomes unavailable; never silently substitute a paid provider.
 */
export type FoundSkill = {
  name: string;
  source: string;
  slug: string;
  installs: number;
  url: string;
};

export type SkillSearchResult = {
  query: string;
  registry: "skills.sh";
  installationEnabled: false;
  contentReviewed: false;
  skills: FoundSkill[];
};

const SOURCE = /^[a-z0-9][a-z0-9._-]{0,90}\\/[a-z0-9][a-z0-9._-]{0,90}$/i;
const SLUG = /^[a-z0-9][a-z0-9._-]{0,90}$/i;
const SUSPICIOUS = /(?:\\bBearer\\s+\\S+|(?:sk-|gh[pousr]_|AIza)[A-Za-z0-9_-]{12,}|[A-Za-z0-9_-]{48,})/i;
const ENDPOINT = "https://skills.sh/api/search";
const MAX_RESULTS = 8;

function cleanLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\\x00-\\x1f\\x7f]/g, " ").trim().slice(0, 100);
}

export async function searchSkillCatalog(
  rawQuery: string,
  fetchFn: typeof fetch = fetch,
): Promise<SkillSearchResult> {
  if (typeof rawQuery !== "string") throw new Error("Skill search query must be text.");
  const query = rawQuery.trim();
  if (query.length < 2 || query.length > 100 || /[\\x00-\\x1f\\x7f]/.test(query) || SUSPICIOUS.test(query)) {
    throw new Error("Skill search requires 2-100 safe keyword characters without credentials or private data.");
  }
  const url = ENDPOINT + "?" + new URLSearchParams({ q: query, limit: String(MAX_RESULTS) });
  const response = await fetchFn(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("skills.sh catalog search failed (HTTP " + response.status + ").");
  const body = await response.text();
  if (body.length > 128_000) throw new Error("skills.sh catalog response exceeded size limit.");
  let payload: unknown;
  try { payload = JSON.parse(body); }
  catch { throw new Error("skills.sh catalog returned invalid JSON."); }
  if (!payload || typeof payload !== "object" || !("skills" in payload) ||
      !Array.isArray(payload.skills)) {
    throw new Error("skills.sh catalog returned an unexpected response format.");
  }
  const results: FoundSkill[] = [];
  const seen = new Set<string>();
  for (const entry of payload.skills as unknown[]) {
    if (!entry || typeof entry !== "object") continue;
    const skill = entry as Record<string, unknown>;
    const source = typeof skill.source === "string" ? skill.source : "";
    const slug = typeof skill.id === "string" ? skill.id : "";
    if (!SOURCE.test(source) || !SLUG.test(slug) || seen.has(source + "/" + slug)) continue;
    const name = cleanLabel(skill.name) || slug;
    const installs = typeof skill.installs === "number" && Number.isSafeInteger(skill.installs) &&
      skill.installs >= 0 ? skill.installs : 0;
    results.push({ name, source, slug, installs, url: "https://skills.sh/" + source + "/" + slug });
    seen.add(source + "/" + slug);
    if (results.length >= MAX_RESULTS) break;
  }
  return { query, registry: "skills.sh", installationEnabled: false, contentReviewed: false, skills: results };
}
