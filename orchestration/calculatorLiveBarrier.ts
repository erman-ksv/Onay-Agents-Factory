/** Host-only remote compare-and-create. Never delete, update, or retry a lock.
 * A lost response consumes admission even when the worker has no local state. */
import { createHash } from "node:crypto";
const FACTORY = "erman-ksv/Onay-Agents-Factory";
const ERROR = "Durable live event refused or uncertain; preserve the remote reference. No replay.";
export function createCalculatorLiveBarrier(config: Readonly<{
  runtimeSha: string; sourceCiRunId: number; planFingerprint: string; previousTaskId: string; candidateSha: string;
}>, env: NodeJS.ProcessEnv, transport: typeof fetch = fetch) {
  const c = Object.freeze({ ...config }), token = env.FACTORY_STATE_TOKEN;
  if (!token || env.GITHUB_REPOSITORY !== FACTORY || env.GITHUB_RUN_ATTEMPT !== "1" ||
      !/^[a-f0-9]{40}$/.test(c.runtimeSha) || !/^[a-f0-9]{40}$/.test(c.candidateSha) ||
      !/^[a-f0-9]{64}$/.test(c.planFingerprint) || !/^[a-z0-9_-]{1,64}$/.test(c.previousTaskId) ||
      !Number.isSafeInteger(c.sourceCiRunId) || c.sourceCiRunId < 1) throw Error(ERROR);
  const key = createHash("sha256").update(JSON.stringify({ repository: "erman-ksv/Onay-Factory-Calculator",
    planFingerprint: c.planFingerprint, previousTaskId: c.previousTaskId, candidateSha: c.candidateSha })).digest("hex");
  const ref = "refs/heads/state/calculator-live-event/" + key;
  const path = "/git/ref/heads/" + encodeURIComponent(ref.slice("refs/heads/".length));
  let attempted = false, admitted = false, stopped = false;
  async function request(path: string, method = "GET", body?: unknown, absent = false): Promise<any> {
    const response = await transport("https://api.github.com/repos/" + FACTORY + path, {
      method, redirect: "error", signal: AbortSignal.timeout(method === "POST" ? 30000 : 10000), headers: {
        Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "Content-Type": "application/json",
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (absent && response.status === 404) return undefined;
    if (response.status !== (method === "POST" ? 201 : 200))
      throw Object.assign(Error(ERROR), { httpStatus: response.status });
    let bytes = 0; const chunks: Uint8Array[] = [];
    if (!response.body) throw Error(ERROR);
    const reader = response.body.getReader();
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.length; if (bytes > 1048576) { await reader.cancel(); throw Error(ERROR); } chunks.push(chunk.value);
    } } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  const matches = (r: any) => r?.ref === ref && r.object?.type === "commit" && r.object.sha === c.runtimeSha;
  return Object.freeze({ ref,
    async inspectAbsent() {
      if (stopped || attempted) throw Error(ERROR);
      try { return (await request(path, "GET", undefined, true)) === undefined; }
      catch { stopped = true; throw Error(ERROR); }
    },
    async claim() {
      if (stopped || attempted) throw Error(ERROR); attempted = true;
      let phase = "source_ci";
      try {
        const run = await request("/actions/runs/" + c.sourceCiRunId);
        if (run.head_sha !== c.runtimeSha || run.path !== ".github/workflows/ci.yml" || run.run_attempt !== 1 ||
            run.status !== "completed" || run.conclusion !== "success" || run.repository?.full_name !== FACTORY)
          throw Error(ERROR);
        phase = "source_ci_jobs";
        const evidence = await request("/actions/runs/" + c.sourceCiRunId + "/jobs?per_page=100");
        if (evidence.total_count !== 1 || evidence.jobs?.length !== 1) throw Error(ERROR);
        const job = evidence.jobs[0];
        if (job.head_sha !== c.runtimeSha || job.status !== "completed" || job.conclusion !== "success" ||
            ["Typecheck", "Test"].some(name => job.steps?.filter((s: any) => s.name === name && s.status === "completed" && s.conclusion === "success").length !== 1))
          throw Error(ERROR);
        phase = "remote_absence";
        if (await request(path, "GET", undefined, true) !== undefined) throw Error(ERROR);
        phase = "remote_compare_create";
        if (!matches(await request("/git/refs", "POST", { ref, sha: c.runtimeSha }))) throw Error(ERROR);
        phase = "remote_readback";
        if (!matches(await request(path))) throw Error(ERROR);
        admitted = true;
      } catch (error) {
        stopped = true;
        const e = error as { httpStatus?: unknown; name?: unknown };
        throw Object.assign(Error(ERROR), { code: "live_barrier_" + phase,
          ...(typeof e?.httpStatus === "number" && Number.isInteger(e.httpStatus) ? { httpStatus: e.httpStatus } : {}),
          ...(e?.name === "TimeoutError" || e?.name === "AbortError" ? { transportFailure: "timeout" } : {}),
        });
      }
    },
    async assertClaimed() {
      if (stopped || !admitted) throw Error(ERROR);
      try { if (!matches(await request(path))) throw Error(ERROR); }
      catch { stopped = true; throw Error(ERROR); }
    },
  });
}
