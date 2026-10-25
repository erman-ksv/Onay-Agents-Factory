import { createHash } from "node:crypto";
import type { PreparedCalculatorChanges } from "../commander/calculatorChanges.js";
import { CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
import { loadCalculatorSnapshot, type CalculatorSnapshotReader, type CalculatorSnapshot, type CalculatorTreeEntry } from "../github/calculatorSnapshot.js";
import type { CalculatorPlan, CalculatorPlanTask } from "./calculatorPlan.js";
import { assertCalculatorT02InspectedSuccessorPreview, type CalculatorT02ReadOnlyPreselection } from "./calculatorT02SuccessorPreview.js";
import { consumeCalculatorT02ExecutionPermit, type CalculatorT02ExecutionPermit } from "./calculatorT02Admission.js";
import { CalculatorPlanStore, type CalculatorDependencyEvidence, type CalculatorSelection } from "./calculatorPlanStore.js";
import type { TeamTaskSnapshot, TeamTaskStore } from "./teamTaskStore.js";

export const CALCULATOR_WORKSPACE_ERROR = "Calculator workspace refused: stale base, missing integration or unverified task checks. No write is authorized.";
function refuse(): never { throw new Error(CALCULATOR_WORKSPACE_ERROR); }
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
export type CalculatorWorkspace = Readonly<{
  repository: string; planFingerprint: string; ref: string; sha: string;
  publicationAuthorized: false; wholeAppCompleted: false;
}>;
type HostWorkspace = { plan: CalculatorPlan; store: CalculatorPlanStore; reader: CalculatorSnapshotReader };
const workspaces = new WeakMap<CalculatorWorkspace, HostWorkspace>();
/** This is a host tool contract, not a model assessment. Checks must actually run
 * against currentSha; candidate review alone cannot validate subsequent edits. */
export type CalculatorCurrentChecks = {
  repository: string; planFingerprint: string; taskId: string; candidateSha: string; currentSha: string;
  securityReady: true; independentReviewReady: true; taskChecksPassed: true; testsExecuted: true;
};
export type CalculatorCheckRunner = (input: Readonly<{
  repository: string; planFingerprint: string; task: CalculatorPlanTask;
  candidateSha: string; currentSha: string; changedSinceCandidate: readonly string[];
}>) => Promise<CalculatorCurrentChecks | undefined>;

async function fresh(workspace: CalculatorWorkspace): Promise<HostWorkspace> {
  const host = workspaces.get(workspace);
  if (!host || host.store.inspect()?.fingerprint !== workspace.planFingerprint ||
      await host.reader.getHead(workspace.ref) !== workspace.sha) return refuse();
  return host;
}
/** Explicit host ref, never a 404 fallback. After any execution receipt exists,
 * only the project branch is eligible. Opening does not claim or execute work. */
export async function openCalculatorWorkspace(store: CalculatorPlanStore, reader: CalculatorSnapshotReader,
  ref: string, expectedSha: string): Promise<CalculatorWorkspace> {
  try {
    const plan = store.inspect();
    if (!plan || plan.status !== "planned" || !sha(expectedSha) || ![plan.owner.baseRef, plan.branch].includes(ref)) return refuse();
    let started = false;
    for (const task of plan.tasks) {
      const receipt = store.taskReceipt(plan, task);
      try { if (receipt.inspectExisting()) started = true; } finally { receipt.close(); }
    }
    if ((started && ref !== plan.branch) || (!started && expectedSha !== plan.owner.baseSha) ||
        await reader.getHead(ref) !== expectedSha) return refuse();
    const workspace: CalculatorWorkspace = Object.freeze({ repository: plan.owner.repository, planFingerprint: plan.fingerprint,
      ref, sha: expectedSha, publicationAuthorized: false, wholeAppCompleted: false });
    workspaces.set(workspace, { plan, store, reader });
    await fresh(workspace); return workspace;
  } catch { return refuse(); }
}
export async function assertCalculatorWorkspaceCurrent(workspace: CalculatorWorkspace): Promise<void> {
  try { await fresh(workspace); } catch { return refuse(); }
}

/** Complete parent traversal is bounded to 64 commits. A missing proof is a stop,
 * never permission to infer integration from a PR/status or use an old snapshot. */
async function ancestors(reader: CalculatorSnapshotReader, current: string, targets: readonly string[]): Promise<void> {
  const needed = new Set(targets), visited = new Set<string>(), pending = [current];
  while (pending.length && needed.size) {
    const next = pending.shift()!; if (visited.has(next)) continue;
    if (visited.size >= 64) return refuse();
    const commit = await reader.readCommit(next);
    if (commit.sha !== next || !sha(commit.treeSha) || !Array.isArray(commit.parents) || commit.parents.length > 16 ||
        commit.parents.some(parent => !sha(parent)) || commit.parents.includes(next)) return refuse();
    visited.add(next); needed.delete(next);
    for (const parent of commit.parents) if (!visited.has(parent) && !pending.includes(parent)) pending.push(parent);
  }
  if (needed.size) refuse();
}
async function taskBlobs(reader: CalculatorSnapshotReader, commitSha: string, task: CalculatorPlanTask): Promise<Map<string, string>> {
  const commit = await reader.readCommit(commitSha);
  if (commit.sha !== commitSha || !sha(commit.treeSha)) return refuse();
  const result = await reader.readTree(commit.treeSha);
  if (result.sha !== commit.treeSha || result.truncated !== false || !Array.isArray(result.tree) ||
      result.tree.length > CALCULATOR_PROFILE.maxTreeEntries) return refuse();
  const entries = new Map<string, CalculatorTreeEntry>();
  for (const entry of result.tree) {
    if (!entry || typeof entry.path !== "string" || !sha(entry.sha) || entries.has(entry.path)) return refuse();
    entries.set(entry.path, entry);
  }
  const blobs = new Map<string, string>();
  for (const path of task.paths) {
    const entry = entries.get(path);
    if (!entry || entry.type !== "blob" || entry.mode !== "100644") return refuse();
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++) {
      const parent = entries.get(parts.slice(0, index).join("/"));
      if (!parent || parent.type !== "tree" || parent.mode !== "040000") return refuse();
    }
    blobs.set(path, entry.sha);
  }
  return blobs;
}
export async function verifyCalculatorWorkspaceDependency(workspace:CalculatorWorkspace,taskId:string,runner:CalculatorCheckRunner){
  const host=await fresh(workspace),task=host.plan.tasks.find(t=>t.id===taskId);if(!task)return refuse();
  const store=host.store.taskReceipt(host.plan,task);
  try{
    const receipt=store.inspectExisting();
    if(!receipt||store.inspectExistingLock()||receipt.status!=='needs-review'||!receipt.publication||
      !receipt.stages.some(s=>s.stage==='publish_candidate'&&s.status==='passed'))return refuse();
    const before=JSON.stringify(receipt),result=await verifyDependency(workspace,task,receipt,runner);
    if(!result||store.inspectExistingLock()||JSON.stringify(store.inspectExisting())!==before)return refuse();
    return result;
  }finally{store.close();}
}
async function verifyDependency(workspace: CalculatorWorkspace, task: CalculatorPlanTask, receipt: TeamTaskSnapshot,
  runner?: CalculatorCheckRunner, historical?: CalculatorT02ReadOnlyPreselection): Promise<CalculatorDependencyEvidence | undefined> {
  const host = await fresh(workspace);
  let candidateSha = receipt.publication?.headSha;
  if (!candidateSha && historical && task.id === historical.previousTaskId) {
    assertCalculatorT02InspectedSuccessorPreview(historical);
    if (historical.status !== "candidate-preview-only" || historical.readOnly !== true ||
        historical.executionAuthorized !== false || historical.planFingerprint !== workspace.planFingerprint ||
        historical.candidateSha !== workspace.sha ||
        receipt.status !== "needs-review" ||
        receipt.reasonCode !== "publication_or_ci_uncertain_inspect_no_replay") return undefined;
    candidateSha = historical.candidateSha;
  }
  if (!runner || !sha(candidateSha)) return undefined;
  await ancestors(host.reader, workspace.sha, [host.plan.owner.baseSha, candidateSha]);
  await ancestors(host.reader, candidateSha, [host.plan.owner.baseSha]);
  const candidate = await taskBlobs(host.reader, candidateSha, task);
  const current = await taskBlobs(host.reader, workspace.sha, task);
  const changed = Object.freeze(task.paths.filter(path => candidate.get(path) !== current.get(path)));
  const checks = await runner(Object.freeze({ repository: workspace.repository, planFingerprint: workspace.planFingerprint,
    task, candidateSha, currentSha: workspace.sha, changedSinceCandidate: changed }));
  if (!checks || checks.repository !== workspace.repository || checks.planFingerprint !== workspace.planFingerprint ||
      checks.taskId !== task.id || checks.candidateSha !== candidateSha || checks.currentSha !== workspace.sha ||
      checks.securityReady !== true || checks.independentReviewReady !== true || checks.taskChecksPassed !== true || checks.testsExecuted !== true)
    return undefined;
  await fresh(workspace);
  return { repository: workspace.repository, taskId: task.id, candidateSha, integratedAtSha: workspace.sha,
    securityReady: true, independentReviewReady: true, taskChecksPassed: true, testsExecuted: true };
}
export async function selectCalculatorWorkspaceTask(workspace: CalculatorWorkspace, runner?: CalculatorCheckRunner,
  historical?: Readonly<{ inspectedT02: CalculatorT02ReadOnlyPreselection; eventDirectory: string; admittedPermit?:CalculatorT02ExecutionPermit }>
): Promise<CalculatorSelection> {
  try {
    const host = await fresh(workspace);
    const selection = await host.store.select({ currentBaseSha: workspace.sha,
      ...(historical ? { inspectedT02: historical.inspectedT02, eventDirectory: historical.eventDirectory, ...(historical.admittedPermit?{admittedPermit:historical.admittedPermit}:{}) } : {}),
      verifyTask: (task, receipt) => verifyDependency(workspace, task, receipt, runner, historical?.inspectedT02) });
    await fresh(workspace); return selection;
  } catch { return refuse(); }
}
/** Claim is persisted before future model execution. Movement after claim leaves
 * a blocked receipt; it must not erase the barrier and automatically replay. */
export async function claimCalculatorWorkspaceTask(workspace: CalculatorWorkspace, runner?: CalculatorCheckRunner):
  Promise<{ selection: CalculatorSelection; store?: TeamTaskStore }> {
  let claimed: TeamTaskStore | undefined;
  try {
    const host = await fresh(workspace);
    if (workspace.ref !== host.plan.branch) return refuse();
    const result = await host.store.claimNext({ currentBaseSha: workspace.sha,
      verifyTask: (task, receipt) => verifyDependency(workspace, task, receipt, runner) });
    claimed = result.store; await fresh(workspace); return result;
  } catch {
    if (claimed) {
      try { claimed.finish("blocked", "working_base_changed_after_claim"); } finally { claimed.close(); }
    }
    return refuse();
  }
}
/** Special historical claim: no generic caller can supply a preview to claimNext.
 * Only a workspace-bound, one-use permit issued after the external event barrier
 * can cause this atomic receipt claim. Recheck all dependencies before claiming. */
export async function claimHistoricalCalculatorT03(workspace:CalculatorWorkspace,
  permit:CalculatorT02ExecutionPermit,runner?:CalculatorCheckRunner):
  Promise<{selection:CalculatorSelection;store?:TeamTaskStore}> {
  let claimed:TeamTaskStore|undefined;
  try {
    const context=consumeCalculatorT02ExecutionPermit(workspace,permit);
    const host=await fresh(workspace);
    if(workspace.ref!==host.plan.branch || !runner) return refuse();
    const selection=await selectCalculatorWorkspaceTask(workspace,runner,{...context,admittedPermit:permit});
    if(selection.status!=="ready" || selection.task?.id!==context.taskId ||
       !selection.verifiedTaskIds.includes(context.inspectedT02.previousTaskId))return {selection};
    const receipt=host.store.taskReceipt(host.plan,selection.task);
    if(receipt.claim()!=="claimed"){receipt.close();return refuse();}
    claimed=receipt;
    await fresh(workspace);
    return {selection,store:claimed};
  }catch{
    if(claimed){try{claimed.finish("blocked","historical_claim_interrupted_no_replay");}finally{claimed.close();}}
    return refuse();
  }
}
/** Existing private source capability loaded only at the pinned current base. */
export async function loadCalculatorWorkspaceTask(workspace: CalculatorWorkspace, taskId: string): Promise<CalculatorSnapshot> {
  try {
    const host = await fresh(workspace), task = host.plan.tasks.find(item => item.id === taskId);
    if (!task) return refuse();
    const snapshot = await loadCalculatorSnapshot({ repository: workspace.repository, baseRef: workspace.ref,
      baseSha: workspace.sha, changePaths: task.paths }, host.reader);
    await fresh(workspace); return snapshot;
  } catch { return refuse(); }
}

/** Trusted plan access for the executor, with the same current-head guard. */
export async function calculatorWorkspacePlan(workspace: CalculatorWorkspace): Promise<CalculatorPlan> {
  try { return (await fresh(workspace)).plan; } catch { return refuse(); }
}
/** After publication the old workspace SHA is intentionally stale. Verify the
 * exact single-parent candidate and every published blob, without adopting it. */
export async function assertCalculatorPublishedCandidate(workspace: CalculatorWorkspace, candidateSha: string,
  changes: PreparedCalculatorChanges): Promise<void> {
  try {
    const host = workspaces.get(workspace);
    if (!host || host.store.inspect()?.fingerprint !== workspace.planFingerprint || !sha(candidateSha) || candidateSha === workspace.sha ||
        changes.repository !== workspace.repository || changes.baseRef !== workspace.ref || changes.baseSha !== workspace.sha ||
        await host.reader.getHead(workspace.ref) !== candidateSha) return refuse();
    const commit = await host.reader.readCommit(candidateSha);
    if (commit.sha !== candidateSha || !sha(commit.treeSha) || !Array.isArray(commit.parents) ||
        commit.parents.length !== 1 || commit.parents[0] !== workspace.sha) return refuse();
    const result = await host.reader.readTree(commit.treeSha);
    if (result.sha !== commit.treeSha || result.truncated !== false || !Array.isArray(result.tree) ||
        result.tree.length > CALCULATOR_PROFILE.maxTreeEntries || new Set(result.tree.map(entry => entry.path)).size !== result.tree.length) return refuse();
    const baseCommit = await host.reader.readCommit(workspace.sha);
    if (baseCommit.sha !== workspace.sha || !sha(baseCommit.treeSha)) return refuse();
    const base = await host.reader.readTree(baseCommit.treeSha);
    if (base.sha !== baseCommit.treeSha || base.truncated !== false || !Array.isArray(base.tree) ||
        base.tree.length > CALCULATOR_PROFILE.maxTreeEntries || new Set(base.tree.map(entry => entry.path)).size !== base.tree.length) return refuse();
    const old = new Map(base.tree.map(entry => [entry.path, entry]));
    const paths = new Set(changes.files.map(file => file.path));
    for (const entry of result.tree) {
      if (!sha(entry.sha)) return refuse();
      if (paths.has(entry.path)) continue;
      if (changes.files.some(file => file.path.startsWith(entry.path + "/")) && entry.type === "tree" && entry.mode === "040000") continue;
      const before = old.get(entry.path);
      if (!before || before.sha !== entry.sha || before.mode !== entry.mode || before.type !== entry.type) return refuse();
    }
    if (base.tree.some(entry => !result.tree.some(item => item.path === entry.path))) return refuse();
    for (const file of changes.files) {
      const parts = file.path.split("/");
      for (let index = 1; index < parts.length; index++) {
        const parent = result.tree.find(item => item.path === parts.slice(0, index).join("/"));
        if (!parent || parent.type !== "tree" || parent.mode !== "040000") return refuse();
      }
      const data = Buffer.from(file.content), expected = createHash("sha1").update(Buffer.concat([Buffer.from("blob " + data.length + "\0"), data])).digest("hex");
      const entry = result.tree.find(item => item.path === file.path);
      if (!entry || entry.type !== "blob" || entry.mode !== "100644" || entry.sha !== expected) return refuse();
    }
    if (await host.reader.getHead(workspace.ref) !== candidateSha) return refuse();
  } catch { return refuse(); }
}
