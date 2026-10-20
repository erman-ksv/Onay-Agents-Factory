import { AiExecutionSession, type AiExecutionDependencies, type SpecialistAssessment } from "../commander/aiExecution.js";
import type { CoderResult } from "../agents/backend/coder.js";
import { TeamTaskStore } from "./teamTaskStore.js";
import { prepareTeamTask, taskGoal } from "./teamTaskCard.js";
import { createHash } from "node:crypto";
import { scanForSecrets } from "../github/secretScanner.js";
import { applyBoundedPatches, type BoundedPatch } from "../commander/boundedPatch.js";

export type TeamTaskDependencies = Omit<AiExecutionDependencies, "generate"> & {
  generatePatch(context: string, sources: ReadonlyMap<string, string>): Promise<CoderResult & { reviewPatches?: BoundedPatch[] }>;
  assess(role: string, context: string): Promise<SpecialistAssessment>;
};
export type TeamTaskReport = {
  version: 1; taskId: string; fingerprint: string;
  execution: "live" | "offline-test"; status: "completed" | "blocked" | "needs-review" | "already-recorded";
  reasonCode: string; repository: string; baseSha: string; branch: string;
  legalReview: "disabled"; mergePerformed: false; deploymentPerformed: false;
  publication?: { number: number; headSha: string; url: string };
  readPaths: string[]; proposedPaths: string[]; changedPaths: string[]; testedSha?: string;
  contextCoverage: Record<string, unknown>;
  advisoryFindings: Record<string, { ready: boolean; findings: Array<{ severity: string; message: string }>; omittedFindings: number }>;
  gates: { security: boolean; policyReview: boolean; testsExecuted: boolean; independentAdvice: boolean };
  unverifiedAreas: string[];
};

function approved(env: NodeJS.ProcessEnv): boolean {
  return env.ONAY_TEAM_LIVE_APPROVED === "RUN_ONE_FREE_TASK" &&
    env.ONAY_TEAM_FREE_TIER_CONFIRMED === "true" &&
    env.AGENT_FACTORY_ENABLE_GITHUB_WRITES === "true" &&
    env.AGENT_FACTORY_LEGAL_ENABLED === "false" &&
    env.AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES !== "true";
}

/** Expose complete changed text, never complete unrelated files, to the independent reviewer.
 * A large noncontiguous change refuses review instead of silently hiding part of a diff. */
function changeEvidence(originals: ReadonlyMap<string, string>, proposed: CoderResult["files"], patches?: BoundedPatch[]): string {
  if (patches) {
    const rebuilt = applyBoundedPatches(patches, originals, proposed.map(file => file.path));
    if (rebuilt.length !== proposed.length || rebuilt.some(file => !proposed.some(candidate =>
      candidate.path === file.path && candidate.content === file.content))) throw new Error("Review patches do not match the host proposal.");
    const result = JSON.stringify({ changes: patches, completeChangedTextShown: true,
      unverified: ["Unchanged and unshown source", "Runtime behavior until exact-commit CI passes"] });
    if (result.length > 6_000 || scanForSecrets(result).length) throw new Error("Change evidence exceeds the safe review budget.");
    return result;
  }
  // Strict offline fixtures may use whole-file proposals. Live execution always
  // supplies exact patch evidence, so unrelated text between edits never leaves the host.
  const changes = proposed.map(file => {
    const before = originals.get(file.path);
    if (before === undefined) throw new Error("Change evidence has no approved base file.");
    let prefix = 0, suffix = 0;
    while (prefix < before.length && prefix < file.content.length && before[prefix] === file.content[prefix]) prefix++;
    while (suffix < before.length - prefix && suffix < file.content.length - prefix &&
      before[before.length - 1 - suffix] === file.content[file.content.length - 1 - suffix]) suffix++;
    return { path: file.path, sourceSha256: createHash("sha256").update(before).digest("hex"),
      candidateSha256: createHash("sha256").update(file.content).digest("hex"),
      before: before.slice(prefix, before.length - suffix), after: file.content.slice(prefix, file.content.length - suffix) };
  });
  const result = JSON.stringify({ changes, completeChangedTextShown: true,
    unverified: ["Unchanged and unshown source", "Runtime behavior until exact-commit CI passes"] });
  if (result.length > 6_000 || scanForSecrets(result).length) throw new Error("Change evidence exceeds the safe review budget.");
  return result;
}

/** One host-directed team task. The model cannot reorder gates, widen scope or publish itself.
 * Existing session gates still determine completion; no automatic repair or whole-task replay. */
export async function runTeamTask(input: unknown, options: {
  stateDirectory: string; env: NodeJS.ProcessEnv; dependencies: TeamTaskDependencies;
  execution?: "live" | "offline-test";
}): Promise<TeamTaskReport> {
  const task = prepareTeamTask(input);
  const execution = options.execution ?? "live";
  if (execution === "live" && !approved(options.env)) throw new Error("One bounded free-tier task and Draft PR require explicit host approval; legal must remain disabled.");
  const store = new TeamTaskStore(options.stateDirectory, { id: task.id, fingerprint: task.fingerprint });
  let session: AiExecutionSession | undefined;
  let proposed: CoderResult["files"] = [];
  let reviewPatches: BoundedPatch[] | undefined;
  const originals = new Map<string, string>();
  let publication: TeamTaskReport["publication"];
  let reasonCode = "task_not_started";
  let independentAdvice = false;
  const report = (status: TeamTaskReport["status"]): TeamTaskReport => {
    const evidence = session?.finish("Host-directed bounded task; see tool evidence.").evidence;
    const assessments: Record<string, SpecialistAssessment> = evidence?.assessments ?? {};
    return {
      version: 1, taskId: task.id, fingerprint: task.fingerprint, execution, status, reasonCode,
      repository: task.repository, baseSha: task.baseSha, branch: task.branch,
      legalReview: "disabled", mergePerformed: false, deploymentPerformed: false,
      ...(publication ? { publication } : {}), readPaths: [...originals.keys()],
      proposedPaths: proposed.map(file => file.path), changedPaths: publication ? proposed.map(file => file.path) : [],
      contextCoverage: evidence?.contextCoverage ?? {},
      advisoryFindings: Object.fromEntries(Object.entries(assessments).map(([actor, assessment]) => [actor, {
        ready: assessment.ready, findings: assessment.findings.slice(0, 16).map(finding => ({ severity: finding.severity,
          message: session!.safeErrorMessage(finding.message) })), omittedFindings: Math.max(0, assessment.findings.length - 16),
      }])),
      ...(evidence?.testsExecuted ? { testedSha: publication?.headSha } : {}),
      gates: { security: evidence?.security?.repository.status === "clean" && evidence.security.proposed?.status === "clean",
        policyReview: evidence?.review?.ready === true, testsExecuted: evidence?.testsExecuted === true, independentAdvice },
      unverifiedAreas: ["Unshown source remains unverified.", "Physical Android/iPhone acceptance was not performed.",
        ...(!evidence?.testsExecuted ? ["Required exact-commit CI remains unverified."] : []),
        "No release, merge, deployment or legal approval is implied."],
    };
  };
  const run = async <T>(actor: string, name: string, action: () => Promise<T> | T): Promise<T> => {
    store.recordStage(name, "running");
    const value = await session!.invoke(actor, name, action);
    if (value && typeof value === "object" && "error" in value) {
      store.recordStage(name, "blocked"); reasonCode = name + "_failed";
      throw new Error("Task stage failed.");
    }
    store.recordStage(name, "passed");
    return value as T;
  };
  try {
    if (store.claim() === "already-recorded") {
      reasonCode = "inspect_existing_receipt_no_replay";
      const saved = store.snapshot().publication;
      if (saved) publication = { number: saved.number, headSha: saved.headSha, url: saved.url };
      return report("already-recorded");
    }
    const deps = options.dependencies;
    session = new AiExecutionSession({
      goal: taskGoal(task), repository: task.repository, ref: task.baseRef,
      requiredActors: task.requiredActors, auditOnly: false,
      writesEnabled: execution === "offline-test" || approved(options.env),
      allowedChangePaths: task.changePaths,
      publication: { branch: task.branch, title: "Onay task: " + task.id,
        body: "Owner task " + task.id + ".\n\n" + taskGoal(task) +
          "\n\nHost task fingerprint: " + task.fingerprint +
          "\nLegal agent disabled. Draft only; independent review and exact-commit CI are required." },
    }, {
      ...deps,
      getHead: async () => {
        const sha = await deps.getHead();
        if (sha.toLowerCase() !== task.baseSha) throw new Error("Task base branch changed; replan against its exact SHA.");
        return sha;
      },
      explore: async sha => {
        const result = await deps.explore(sha);
        if (result.files.length !== task.explorerPaths.length ||
          result.files.some(file => !task.explorerPaths.includes(file.path)) ||
          new Set(result.files.map(file => file.path)).size !== task.explorerPaths.length)
          throw new Error("Explorer returned a different task scope.");
        for (const file of result.files) {
          if (!("content" in file) || Buffer.byteLength(file.content, "utf8") > 128 * 1024)
            throw new Error("Task source unavailable or too large.");
          originals.set(file.path, file.content);
        }
        return result;
      },
      generate: async () => {
        const sources = new Map(task.changePaths.map(path => [path, originals.get(path)!]));
        const generated = await deps.generatePatch(session!.specialistContext("coder", "Prepare only the owner-approved bounded patch."), sources);
        proposed = generated.files;
        reviewPatches = generated.reviewPatches;
        if (execution === "live" && !reviewPatches) throw new Error("Live task requires exact bounded patch review evidence.");
        return { summary: "Host-retained bounded patch proposal.", files: proposed };
      },
      publish: async (files, sha) => {
        if (sha !== task.baseSha || (await deps.getHead()).toLowerCase() !== task.baseSha)
          throw new Error("Task base changed before publication.");
        const candidate = await deps.publish(files, sha);
        publication = { number: candidate.number, headSha: candidate.head_sha, url: candidate.html_url };
        // A persisted receipt is required immediately after the verified GitHub result.
        store.recordPublication({ branch: task.branch, ...publication });
        return candidate;
      },
    });
    await run("explorer", "explore_onay", () => session!.explore());
    await run("security", "preflight_security", async () => {
      const security = await deps.inspectSecurity(task.baseSha);
      if (security.repository !== task.repository || security.ref !== task.baseSha || security.status !== "clean")
        throw new Error("Base repository security is unverified.");
      return { status: "clean" };
    });
    await run("coder", "code_onay", () => session!.generate());
    const changed = changeEvidence(originals, proposed, reviewPatches);
    for (const role of task.advisoryActors) {
      await run(role, role + "_assessment", async () => {
        const packet = session!.specialistContext(role, "Review the task acceptance criteria and all shown change evidence.");
        const context = packet + "\nHOST COMPLETE CHANGE EVIDENCE:\n" + changed;
        if (context.length > 12_000) throw new Error("Specialist review context exceeded task limit.");
        const assessment = session!.recordAdvice(role, await deps.assess(role, context));
        if (!assessment.ready) throw new Error("A specialist found an unresolved blocker.");
        return { ready: true };
      });
    }
    await run("reviewer", "review_onay_changes", () => {
      const review = session!.reviewChanges();
      if (!review.ready) throw new Error("Independent change policy rejected the proposal.");
      return { ready: true };
    });
    // Independent AI review follows policy review; neither replaces the other.
    await run("reviewer", "final_independent_review", async () => {
      const assessment = session!.recordAdvice("reviewer", await deps.assess("reviewer",
        session!.specialistContext("reviewer", "Final independent review; all changes must satisfy owner acceptance criteria.") +
        "\nHOST COMPLETE CHANGE EVIDENCE:\n" + changed));
      if (!assessment.ready) throw new Error("Final independent review rejected the proposal.");
      return { ready: true };
    });
    independentAdvice = true;
    await run("security", "security_review", async () => {
      const security = await session!.inspectSecurity();
      if (security.repository.status !== "clean" || security.proposed?.status !== "clean")
        throw new Error("Final security checks failed.");
      return { status: "clean" };
    });
    await run("github", "publish_change_set", () => session!.publish());
    await run("tester", "test_onay", () => session!.test());
    await session.verifyFinalCandidate();
    const final = session.finish("One bounded task executed; completion requires exact-commit evidence.");
    reasonCode = final.status === "completed" ? "verified_candidate" : "candidate_requires_ci_or_review";
    const status = final.status;
    store.finish(status, reasonCode);
    return report(status);
  } catch {
    reasonCode = reasonCode === "task_not_started" ? "task_failed_inspect_receipt" : reasonCode;
    try { store.finish("blocked", reasonCode); } catch { reasonCode = "state_persistence_failed_inspect_github"; }
    return report("blocked");
  } finally {
    store.close();
  }
}

export function teamTaskSummary(report: TeamTaskReport): string {
  return [
    "# Onay team task " + report.taskId,
    "Status: " + report.status + " (" + report.reasonCode + ")",
    "Mode: " + report.execution,
    "Repository: " + report.repository,
    "Base SHA: " + report.baseSha,
    "Branch: " + report.branch,
    ...(report.publication ? ["Draft PR: " + report.publication.url, "Candidate SHA: " + report.publication.headSha] : []),
    "Security: " + report.gates.security + "; policy review: " + report.gates.policyReview +
      "; independent advice: " + report.gates.independentAdvice + "; exact-commit tests: " + report.gates.testsExecuted,
    "Legal agent: disabled. Merge/deployment: not performed.",
    ...Object.entries(report.advisoryFindings).flatMap(([actor, assessment]) => assessment.findings.map(finding =>
      actor + " [" + finding.severity + "]: " + finding.message)),
    ...report.unverifiedAreas.map(item => "- " + item),
  ].join("\n") + "\n";
}
