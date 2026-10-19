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
  if (cleanQuery !== query || !queryPattern.test(cleanQuery)) throw new Error("Find Skills query must be 2–80 plain characters.");
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
      // Official Vercel Skills API uses source="owner/repository", id="skill-slug".
      // Do not confuse the slug with the full skills.sh listing URL.
      const sourceParts = row.source.split("/");
      if (sourceParts.length !== 2 || !sourceParts.every(v => repositoryName.test(v)) ||
          !skillName.test(row.id) || seen.has(row.source + "@" + row.id)) continue;
      const name = typeof row.name === "string" && skillName.test(row.name) ? row.name : row.id;
      const installs = typeof row.installs === "number" && Number.isSafeInteger(row.installs) &&
        row.installs >= 0 ? row.installs : 0;
      seen.add(row.source + "@" + row.id);
      candidates.push({
        name, source: row.source, identifier: row.source + "@" + row.id,
        listingUrl: "https://skills.sh/" + row.source + "/" + row.id, installs,
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
