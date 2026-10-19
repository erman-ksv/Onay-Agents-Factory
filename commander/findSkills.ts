/**
 * Read-only Find Skills discovery using the same skills.sh catalog endpoint
 * as https://github.com/vercel-labs/skills (src/find.ts).
 *
 * No package installation, local shell execution, or remote skill instructions.
 * Search data is untrusted metadata, never privileged agent instructions.
 */
export type SkillCandidate = {
  name: string;
  source: string;
  identifier: string;
  listingUrl: string;
  installs: number;
};

export type SkillDiscovery = {
  status: "found" | "empty" | "unavailable";
  catalog: "skills.sh";
  candidates: SkillCandidate[];
  reviewRequired: true;
  installationPerformed: false;
};

const repositoryName = /^[a-z\d][a-z\d._-]{0,99}$/i;
const skillName = /^[a-z\d][a-z\d._-]{0,79}$/i;
const queryPattern = /^[a-z\d][a-z\d ._+/-]{1,79}$/i;
const catalog = "https://skills.sh/api/search";

export async function discoverFindSkills(query: string, fetcher: typeof fetch = fetch): Promise<SkillDiscovery> {
  const cleanQuery = query.trim();
  if (!queryPattern.test(cleanQuery)) throw new Error("Find Skills query must be 2–80 plain characters.");
  const unavailable: SkillDiscovery = { status: "unavailable", catalog: "skills.sh",
    candidates: [], reviewRequired: true, installationPerformed: false };
  try {
    const url = new URL(catalog);
    url.searchParams.set("q", cleanQuery);
    url.searchParams.set("limit", "20");
    // Fixed HTTPS origin and a short timeout. The query cannot provide a URL.
    const response = await fetcher(url.toString(), {
      method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return unavailable;
    const raw = await response.text();
    if (raw.length > 64_000) return unavailable;
    const payload: unknown = JSON.parse(raw);
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        !Array.isArray((payload as Record<string, unknown>).skills)) return unavailable;
    const rows = (payload as { skills: unknown[] }).skills.slice(0, 20);
    const candidates: SkillCandidate[] = [];
    const seen = new Set<string>();
    for (const item of rows) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      if (typeof row.source !== "string" || typeof row.id !== "string") continue;
      const sourceParts = row.source.split("/");
      const parts = row.id.split("/");
      if (sourceParts.length !== 2 || parts.length !== 3 ||
          !sourceParts.every(v => repositoryName.test(v)) || !skillName.test(parts[2]!) ||
          parts[0] !== sourceParts[0] || parts[1] !== sourceParts[1] || seen.has(row.id)) continue;
      const name = typeof row.name === "string" && skillName.test(row.name) ? row.name : parts[2]!;
      const installs = typeof row.installs === "number" && Number.isSafeInteger(row.installs) &&
        row.installs >= 0 ? row.installs : 0;
      seen.add(row.id);
      candidates.push({
        name, source: row.source, identifier: row.source + "@" + parts[2],
        listingUrl: "https://skills.sh/" + row.id, installs,
      });
      if (candidates.length >= 8) break;
    }
    candidates.sort((a, b) => b.installs - a.installs);
    return { status: candidates.length ? "found" : "empty", catalog: "skills.sh",
      candidates, reviewRequired: true, installationPerformed: false };
  } catch {
    return unavailable;
  }
}
