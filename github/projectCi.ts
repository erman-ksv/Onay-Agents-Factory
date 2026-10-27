import {createHash} from 'node:crypto';
import {assertValidBranchRef,type WorkflowRun} from './githubClient.js';
import {evaluateCiJobs,type CiJob} from './ciGate.js';
import {registeredProjectTargetProfile,type ApprovedProjectTarget} from '../orchestration/projectTargetRegistry.js';
import {scanForSecrets} from './secretScanner.js';
export const PROJECT_CI_ERROR='Project exact-candidate CI is unverified, stale or incomplete. No task advance, republish or merge is authorized.';
type Pin=Readonly<{id:number;path:string;blobSha:string}>;
export type ProjectCiInput=Readonly<{repository:string;branch:string;candidateSha:string}>;
export type ProjectCiPolicy=Readonly<{targetProfileSha256:string;sha256:string;workflowPins:readonly Pin[]}>;
const policies=new WeakMap<ProjectCiPolicy,{target:ApprovedProjectTarget;pins:readonly Pin[]}>();
export type ProjectCiEvidence=ProjectCiInput&Readonly<{targetProfileSha256:string;policySha256:string;status:'passed'|'pending'|'failed'|'no-runs';verifiedRunIds:readonly number[];provenance:'native-github'|'simulated';mergeAuthorized:false;wholeAppCompleted:false}>;
const records=new WeakMap<ProjectCiEvidence,{target:ApprovedProjectTarget;assertCurrent:()=>Promise<void>}>();
const eventRuns=new WeakMap<ProjectCiEvidence,readonly Readonly<{id:number;attempt:number}>[]>();
export function projectCiEvidenceBinding(value:ProjectCiEvidence){const r=records.get(value);if(!r)return refuse();return r;}
/** Event metadata is untrusted. Match it against the attempt actually read by
 * the native/simulated CI collector, never against the relay's success flag. */
export function projectCiEventRunMatches(value:ProjectCiEvidence,runId:number,attempt:number){return eventRuns.get(value)?.some(r=>r.id===runId&&r.attempt===attempt)===true;}
type RawRun = Omit<WorkflowRun, "head_sha" | "run_attempt"> & { head_sha: string; run_attempt: number; workflow_id: number; path: string; head_branch: string; event: string };
const SHA = /^[a-f0-9]{40}$/;

const STATUS = new Set(["queued", "in_progress", "completed", "requested", "waiting", "pending"]);
const CONCLUSION = new Set(["success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required", "stale", "startup_failure"]);
const MAX_REQUESTS = 128, MAX_RUNS = 100, MAX_JOBS = 500;
function refuse(): never { throw new Error(PROJECT_CI_ERROR); }
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return refuse();
  return input as Record<string, unknown>;
}
function id(input: unknown): number { if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 1) return refuse(); return input; }
function hash(input: unknown): string { if (typeof input !== "string" || !SHA.test(input)) return refuse(); return input; }
function text(input: unknown, max = 200): string {
  if (typeof input !== "string" || !input.trim() || input.length > max || /[\u0000-\u001f\u007f]/.test(input)) return refuse();
  return input;
}
function state(input: unknown): string { const value = text(input, 32); if (!STATUS.has(value)) return refuse(); return value; }
function conclusion(input: unknown): string | null {
  if (input === null) return null; const value = text(input, 32); if (!CONCLUSION.has(value)) return refuse(); return value;
}
function path(input: unknown): string {
  const value = text(input, 240);
  if (value.includes("\\") || value.split("/").some(part => !part || part === "." || part === "..")) return refuse(); return value;
}
function sameRun(before: RawRun, after: RawRun): boolean {
  return before.id === after.id && before.workflow_id === after.workflow_id && before.path === after.path &&
    before.head_sha === after.head_sha && before.head_branch === after.head_branch && before.run_attempt === after.run_attempt &&
    before.status === after.status && before.conclusion === after.conclusion && before.event === after.event;
}


/** HOST ONLY immutable workflow pins, never model-selected job names. */
export function createProjectCiPolicy(target:ApprovedProjectTarget,input:readonly Pin[]):ProjectCiPolicy{
 try{const profile=registeredProjectTargetProfile(target);if(!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype||input.length<1||input.length>8||Reflect.ownKeys(input).length!==input.length+1)return refuse();const pins=Array.from({length:input.length},(_,i)=>{const descriptor=Object.getOwnPropertyDescriptor(input,String(i));if(!descriptor||!Object.hasOwn(descriptor,'value'))return refuse();const p=descriptor.value;if(!p||Object.getPrototypeOf(p)!==Object.prototype||Reflect.ownKeys(p).length!==3||!['id','path','blobSha'].every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(p,k)??{},'value'))||typeof p.path!=='string'||!/^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9_-]*\.yml$/.test(p.path))return refuse();return Object.freeze({id:id(p.id),path:p.path,blobSha:hash(p.blobSha)});});if(new Set(pins.map(p=>p.id)).size!==pins.length||new Set(pins.map(p=>p.path)).size!==pins.length)return refuse();const policy=Object.freeze({targetProfileSha256:profile.sha256,sha256:createHash('sha256').update(JSON.stringify(pins)).digest('hex'),workflowPins:Object.freeze(pins)});policies.set(policy,{target,pins:policy.workflowPins});return policy;}catch{return refuse();}
}
export function createProjectCiReader(policy:ProjectCiPolicy,env:NodeJS.ProcessEnv){return reader(policy,env,fetch,'native-github');}
export function createProjectCiReaderForTests(policy:ProjectCiPolicy,env:NodeJS.ProcessEnv,transport:typeof fetch){return reader(policy,env,transport,'simulated');}
function reader(policy:ProjectCiPolicy,env:NodeJS.ProcessEnv,transport:typeof fetch,mode:ProjectCiEvidence['provenance']){
 const p=policies.get(policy);if(!p)return refuse();const {target,pins}=p,profile=registeredProjectTargetProfile(target),repository=profile.repository,token=env.GITHUB_TOKEN;
 if(!token||env.AGENT_FACTORY_TARGET_PROFILE!==profile.id||!env.AGENT_ALLOWED_REPOSITORIES?.split(',').map(s=>s.trim()).includes(repository)||typeof transport!=='function')return refuse();
  return async (input: ProjectCiInput): Promise<ProjectCiEvidence> => {
    try {
      if (!input || input.repository !== repository || typeof input.branch !== "string") return refuse();
      assertValidBranchRef(input.branch);if(!input.branch.startsWith(profile.branchPrefix))return refuse();
      const approved = Object.freeze({ repository, branch: input.branch, candidateSha: hash(input.candidateSha) });
      const started = performance.now(); let requests = 0;
      async function read(endpoint: string): Promise<unknown> {
        if (++requests > MAX_REQUESTS) return refuse();
        const remaining = 45_000 - (performance.now() - started); if (remaining <= 0) return refuse();
        const response = await transport("https://api.github.com/repos/" + repository + endpoint, {
          method: "GET", redirect: "error", signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(15_000, remaining)))),
          headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28" },
        });
        if (!response.ok || !response.body) { void response.body?.cancel().catch(() => undefined); return refuse(); }
        const stream = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const chunk = await stream.read(); if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 1_048_576) { await stream.cancel(); return refuse(); }
            chunks.push(chunk.value);
          }
        } finally { stream.releaseLock(); }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      }
      async function current(): Promise<void> {
        const ref = object(await read("/git/ref/heads/" + encodeURIComponent(approved.branch)));
        if (ref.ref !== "refs/heads/" + approved.branch || object(ref.object).type !== "commit" || hash(object(ref.object).sha) !== approved.candidateSha) return refuse();
      }
      async function pages(endpoint: string, key: "workflow_runs" | "jobs", perPage: number, maximum: number): Promise<unknown[]> {
        const result: unknown[] = []; let expected: number | undefined;
        for (let page = 1; page <= maximum / perPage; page++) {
          const data = object(await read(endpoint + (endpoint.includes("?") ? "&" : "?") + "per_page=" + perPage + "&page=" + page));
          if (typeof data.total_count !== "number" || !Number.isSafeInteger(data.total_count) || data.total_count < 0 || data.total_count > maximum ||
              (expected !== undefined && expected !== data.total_count) || !Array.isArray(data[key]) || data[key].length > perPage) return refuse();
          expected = data.total_count; result.push(...data[key]);
          if (result.length > expected) return refuse();
          if (result.length === expected) return result;
          if (data[key].length < perPage) return refuse();
        }
        return refuse();
      }
      function run(raw: unknown): RawRun {
        const value = object(raw), runId = id(value.id), workflowId = id(value.workflow_id);
        if (object(value.repository).full_name !== repository || object(value.head_repository).full_name !== repository ||
            value.head_branch !== approved.branch || hash(value.head_sha) !== approved.candidateSha ||
            value.html_url !== "https://github.com/" + repository + "/actions/runs/" + runId) return refuse();
        const runPath = path(value.path), pinned = pins.find(pin => pin.id === workflowId), event = text(value.event, 40);
        // PR merge-ref and pull_request_target runs do not prove execution of the
        // exact published candidate. Trusted calculator workflows use push or dispatch.
        if (pinned && !["push", "workflow_dispatch"].includes(event)) return refuse();
        if ((pinned && pinned.path !== runPath) || pins.some(pin => pin.path === runPath && pin.id !== workflowId)) return refuse();
        return { id: runId, name: text(value.name), status: state(value.status), conclusion: conclusion(value.conclusion),
          html_url: "https://github.com/" + repository + "/actions/runs/" + runId, head_sha: approved.candidateSha, run_attempt: id(value.run_attempt),
          workflow_id: workflowId, path: runPath, head_branch: approved.branch, event };
      }
      await current();
      const commit = object(await read("/git/commits/" + approved.candidateSha));
      if (hash(commit.sha) !== approved.candidateSha) return refuse();
      const treeSha = hash(object(commit.tree).sha), tree = object(await read("/git/trees/" + treeSha + "?recursive=1"));
      if (hash(tree.sha) !== treeSha || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 1024) return refuse();
      const entries = new Map<string, Record<string, unknown>>();
      for (const raw of tree.tree) {
        const entry = object(raw), name = path(entry.path); hash(entry.sha);
        if (entries.has(name)) return refuse(); entries.set(name, entry);
      }
      for (const directory of [".github", ".github/workflows"]) {
        const entry = entries.get(directory); if (!entry || entry.type !== "tree" || entry.mode !== "040000") return refuse();
      }
      for (const pin of pins) {
        const entry = entries.get(pin.path);
        if (!entry || entry.type !== "blob" || entry.mode !== "100644" || entry.sha !== pin.blobSha) return refuse();
        const workflow = object(await read("/actions/workflows/" + pin.id));
        if (id(workflow.id) !== pin.id || workflow.path !== pin.path || workflow.state !== "active") return refuse();
      }
      const listed = (await pages("/actions/runs?head_sha=" + approved.candidateSha + "&branch=" + encodeURIComponent(approved.branch),
        "workflow_runs", 20, MAX_RUNS)).map(run);
      if (new Set(listed.map(value => value.id)).size !== listed.length) return refuse();
      const runs: WorkflowRun[] = [], jobs: CiJob[] = [], verifiedRunIds: number[] = [];
      for (const initial of listed) {
        const latest = run(await read("/actions/runs/" + initial.id));
        if (!sameRun(initial, latest)) return refuse();
        if (pins.some(pin => pin.id === latest.workflow_id)) {
          const fetched = await pages("/actions/runs/" + latest.id + "/attempts/" + latest.run_attempt + "/jobs", "jobs", 100, MAX_JOBS);
          const ids = new Set<number>();
          for (const raw of fetched) {
            const job = object(raw), jobId = id(job.id);
            if (ids.has(jobId) || id(job.run_id) !== latest.id || id(job.run_attempt) !== latest.run_attempt ||
                hash(job.head_sha) !== approved.candidateSha || (job.html_url !== "https://github.com/" + repository + "/actions/runs/" + latest.id + "/job/" + jobId &&
                  job.html_url !== "https://github.com/" + repository + "/runs/" + jobId) ||
                !Array.isArray(job.steps) || job.steps.length > 64) return refuse();
            ids.add(jobId);
            const stepNumbers = new Set<number>();
            const steps = job.steps.map(rawStep => {
              const step = object(rawStep), number = id(step.number); if (stepNumbers.has(number)) return refuse(); stepNumbers.add(number);
              return { name: text(step.name), status: state(step.status), conclusion: conclusion(step.conclusion) };
            });
            jobs.push({ name: text(job.name), status: state(job.status), conclusion: conclusion(job.conclusion),
              run_id: latest.id, run_attempt: latest.run_attempt, head_sha: approved.candidateSha, steps });
          }
          verifiedRunIds.push(latest.id);
        }
        const after = run(await read("/actions/runs/" + latest.id));
        if (!sameRun(latest, after)) return refuse();
        runs.push({ id: after.id, name: after.name, status: after.status, conclusion: after.conclusion,
          html_url: after.html_url, head_sha: approved.candidateSha, run_attempt: after.run_attempt });
      }
      const finalList = (await pages("/actions/runs?head_sha=" + approved.candidateSha + "&branch=" + encodeURIComponent(approved.branch),
        "workflow_runs", 20, MAX_RUNS)).map(run);
      if (finalList.length !== listed.length || new Set(finalList.map(value => value.id)).size !== finalList.length ||
          listed.some(before => !finalList.some(after => sameRun(before, after)))) return refuse();
      await current();
      const gate=evaluateCiJobs(runs,jobs,[...profile.requiredCiNames],[...profile.requiredCiSteps]);
      const evidence:ProjectCiEvidence=Object.freeze({...approved,targetProfileSha256:profile.sha256,policySha256:policy.sha256,status:gate.status,verifiedRunIds:Object.freeze(verifiedRunIds),provenance:mode,mergeAuthorized:false,wholeAppCompleted:false});
      eventRuns.set(evidence,Object.freeze(listed.filter(r=>verifiedRunIds.includes(r.id)).map(r=>Object.freeze({id:r.id,attempt:r.run_attempt}))));
      records.set(evidence,{target,assertCurrent:async()=>{await current();const latest=(await pages('/actions/runs?head_sha='+approved.candidateSha+'&branch='+encodeURIComponent(approved.branch),'workflow_runs',20,MAX_RUNS)).map(run);if(latest.length!==listed.length||listed.some(before=>!latest.some(after=>sameRun(before,after))))return refuse();for(const before of listed)if(!sameRun(before,run(await read('/actions/runs/'+before.id))))return refuse();await current();}});return evidence;
    } catch { return refuse(); }
  };
}
