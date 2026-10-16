import type { CoderResult, ProposedChange } from "../agents/backend/coder.js";
import type { TestExecutionEvidence } from "../agents/tester/agent.js";
import type { reviewChangeSet } from "../agents/reviewer/agent.js";
import type { inspectProposedChanges, inspectSecurity } from "../agents/security/agent.js";
import type { inspectTezJet } from "../github/onayExplorer.js";
import { AgentRunJournal } from "../orchestration/agentRunJournal.js";

type Review = ReturnType<typeof reviewChangeSet>;
type ProposedSecurity = ReturnType<typeof inspectProposedChanges>;
type RepositorySecurity = Awaited<ReturnType<typeof inspectSecurity>>;
type Exploration = Awaited<ReturnType<typeof inspectTezJet>>;
export type PublishedChange = { head_sha: string; html_url: string; number: number };
export type SpecialistAssessment = { ready: boolean; findings: Array<{ severity: "blocker" | "high" | "medium" | "low"; message: string }>; summary?: string };

export type AiExecutionDependencies = {
  getHead(): Promise<string>;
  getCandidateHead(ref: string): Promise<string>;
  explore(sha: string): Promise<Exploration>;
  generate(context: string): Promise<CoderResult>;
  review(files: ProposedChange[]): Review;
  scan(files: ProposedChange[]): ProposedSecurity;
  inspectSecurity(sha: string): Promise<RepositorySecurity>;
  discoverTests(): Promise<unknown>;
  publish(files: ProposedChange[], baseSha: string): Promise<PublishedChange>;
  verify(sha: string, ref: string): Promise<TestExecutionEvidence>;
};

export type AiExecutionOptions = {
  goal: string;
  repository: string;
  ref: string;
  requiredActors: string[];
  auditOnly: boolean;
  publication?: { branch: string; title: string; body: string };
  writesEnabled: boolean;
  journal?: AgentRunJournal;
  /** Exact repository paths authorized by the host for this task. */
  allowedChangePaths?: readonly string[];
};

/** Evidence belongs to this run, never to a model's prose or tool arguments. */
export class AiExecutionSession {
  readonly journal: AgentRunJournal;
  private baseSha?: string;
  private context?: string;
  private files: ProposedChange[] = [];
  private review?: Review;
  private security?: { repository: RepositorySecurity; proposed: ProposedSecurity | null };
  private publication?: PublishedChange;
  private tests?: TestExecutionEvidence;
  private publishAttempted = false;
  private readonly completedActors = new Set<string>();
  private readonly failures = new Map<string, string>();
  private readonly assessments = new Map<string, SpecialistAssessment>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly options: AiExecutionOptions, private readonly dependencies: AiExecutionDependencies) {
    this.journal = options.journal ?? new AgentRunJournal(options.goal);
  }

  private invalidateAssessments() {
    this.assessments.clear();
    for (const actor of this.completedActors) {
      if (actor !== "explorer") this.completedActors.delete(actor);
    }
  }

  private assertChangeScope(files: readonly ProposedChange[]) {
    const allowed = this.options.allowedChangePaths;
    if (allowed === undefined) return;
    const outsideScope = files.filter(file => !allowed.includes(file.path)).map(file => file.path);
    if (outsideScope.length) {
      throw new Error("Proposed change paths are outside the configured task scope: " + outsideScope.join(", "));
    }
  }

  /** Serialize tools so parallel model calls cannot race review against generation. */
  invoke<T>(actor: string, tool: string, action: () => Promise<T> | T): Promise<T | { error: string }> {
    const operation = this.queue.then(async () => {
      this.failures.delete(tool);
      this.completedActors.delete(actor);
      this.assessments.delete(actor);
      this.journal.handoff("commander", actor, "Commander invoked an executable tool.", { tool });
      this.journal.record("agent_started", actor, "Agent tool execution started.", { tool });
      this.journal.record("tool_started", actor, "Executing tool.", { tool });
      try {
        const result = await action();
        this.completedActors.add(actor);
        this.failures.delete(tool);
        this.journal.record("tool_completed", actor, "Tool returned successfully.", { tool });
        this.journal.record("agent_completed", actor, "Agent tool execution returned.", { tool });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.failures.set(tool, message);
        this.journal.record("tool_failed", actor, message, { tool });
        this.journal.record("agent_failed", actor, "Agent tool execution failed.", { tool });
        return { error: message };
      }
    });
    this.queue = operation;
    return operation;
  }

  async explore() {
    if (this.publishAttempted) throw new Error("Cannot replace repository context after a publication attempt.");
    // A failed refresh must not leave the previous context or its gates usable.
    this.baseSha = undefined;
    this.context = undefined;
    this.files = [];
    this.review = undefined;
    this.security = undefined;
    this.tests = undefined;
    this.invalidateAssessments();
    this.completedActors.delete("explorer");
    const sha = await this.dependencies.getHead();
    if (!sha.trim()) throw new Error("Explorer could not resolve the repository commit.");
    const exploration = await this.dependencies.explore(sha);
    const available = exploration.files.filter((file): file is { path: string; sha: string; content: string } => "content" in file);
    const unavailable = exploration.files.filter((file) => "error" in file);
    if (exploration.repository !== this.options.repository || exploration.ref !== sha || unavailable.length || !available.length) {
      throw new Error("Explorer did not return complete context for the requested repository commit.");
    }
    this.baseSha = sha;
    this.context = available.map(file => `FILE: ${file.path}\n${file.content}`).join("\n\n");
    this.journal.record("artifact_created", "explorer", "Repository context read from an immutable commit.", {
      repository: this.options.repository, baseSha: sha, files: available.map(file => file.path),
    });
    return exploration;
  }

  async generate() {
    if (this.options.auditOnly) throw new Error("This task is a read-only audit.");
    if (!this.context) throw new Error("Coder requires successful repository exploration first.");
    if (this.publishAttempted) throw new Error("Cannot regenerate files after a publication attempt.");
    // Clear old gates even if a new generation fails.
    this.files = [];
    this.review = undefined;
    this.security = undefined;
    this.tests = undefined;
    this.invalidateAssessments();
    const generated = await this.dependencies.generate(this.context);
    if (typeof generated?.summary !== "string" || !Array.isArray(generated.files) || !generated.files.length ||
      generated.files.some(file => typeof file?.path !== "string" || !file.path.trim() ||
        typeof file.content !== "string" || !file.content.trim() || typeof file.message !== "string" || !file.message.trim())) {
      throw new Error("Coder returned no valid explicit change set.");
    }
    this.assertChangeScope(generated.files);
    this.files = structuredClone(generated.files);
    this.journal.record("artifact_created", "coder", "Generated a proposed change set; files have not yet been written.", {
      files: this.files.map(file => file.path), baseSha: this.baseSha,
    });
    return generated;
  }

  reviewChanges() {
    this.review = undefined;
    if (!this.files.length) throw new Error("Independent review requires a generated change set.");
    this.review = structuredClone(this.dependencies.review(structuredClone(this.files)));
    if (this.review.ready) this.journal.record("verification_passed", "reviewer", "Change policy review passed.", { files: this.files.map(file => file.path) });
    return structuredClone(this.review);
  }

  specialistContext() {
    if (!this.context) throw new Error("Specialists require repository exploration first.");
    return this.context + (this.files.length ? "\n\nPROPOSED CHANGES:\n" + JSON.stringify(this.files) : "");
  }

  recordAdvice(actor: string, assessment: SpecialistAssessment) {
    if (typeof assessment?.ready !== "boolean" || !Array.isArray(assessment.findings) ||
      assessment.findings.some(finding => !["blocker", "high", "medium", "low"].includes(finding?.severity) || typeof finding.message !== "string")) {
      throw new Error(actor + " specialist returned an invalid assessment.");
    }
    const checked = structuredClone(assessment);
    if (checked.findings.some(finding => finding.severity === "blocker" || finding.severity === "high")) checked.ready = false;
    this.assessments.set(actor, checked);
    this.journal.record("artifact_created", actor, "Specialist assessment recorded for the current proposal.", { ready: checked.ready, findings: checked.findings });
    return { ...structuredClone(checked), verifiedExecution: false };
  }

  async inspectSecurity() {
    if (!this.baseSha) throw new Error("Security requires successful repository exploration first.");
    if (!this.options.auditOnly && !this.files.length) throw new Error("Security requires a generated change set.");
    this.security = undefined;
    const repository = structuredClone(await this.dependencies.inspectSecurity(this.baseSha));
    const proposed = this.files.length ? structuredClone(this.dependencies.scan(structuredClone(this.files))) : null;
    this.security = { repository, proposed };
    if (this.securityClean()) this.journal.record("verification_passed", "security", "Repository and proposed-change secret scans passed.");
    return structuredClone(this.security);
  }

  private securityClean() {
    return this.security?.repository.status === "clean" &&
      this.security.repository.repository === this.options.repository && this.security.repository.ref === this.baseSha &&
      (this.options.auditOnly || this.security.proposed?.status === "clean");
  }

  async publish() {
    if (this.options.auditOnly) throw new Error("This task is a read-only audit.");
    if (!this.options.publication || !this.options.writesEnabled) {
      throw new Error("Publishing requires --publish, a branch/title/body, and AGENT_FACTORY_ENABLE_GITHUB_WRITES=true.");
    }
    if (!this.baseSha || !this.files.length || !this.review?.ready || !this.securityClean()) {
      throw new Error("Publishing requires repository context, generated files, independent review and security gates.");
    }
    if (this.failures.size) throw new Error("Unresolved tool failures block publication.");
    if ([...this.assessments.values()].some(assessment => !assessment.ready)) throw new Error("A specialist assessment contains publication blockers.");
    const missing = this.options.requiredActors.filter(actor => actor !== "tester" && !this.completedActors.has(actor));
    if (missing.length) throw new Error("Required specialists have not returned: " + missing.join(", "));
    if (this.publishAttempted) throw new Error("Publication has already been attempted; inspect its branch before retrying.");
    this.assertChangeScope(this.files);
    this.publishAttempted = true;
    this.journal.record("tool_started", "github", "Publication attempt started; a failure may leave a branch requiring inspection.", {
      tool: "write_candidate", branch: this.options.publication.branch, files: this.files.map(file => file.path), baseSha: this.baseSha,
    });
    const publication = await this.dependencies.publish(structuredClone(this.files), this.baseSha);
    if (!publication.head_sha?.trim() || !publication.html_url?.trim() || !Number.isInteger(publication.number)) {
      throw new Error("GitHub did not return a verifiable draft PR and candidate commit.");
    }
    this.publication = structuredClone(publication);
    this.tests = undefined;
    this.journal.record("artifact_created", "github", "Files written and a draft PR created.", {
      repository: this.options.repository, branch: this.options.publication.branch,
      headSha: publication.head_sha, url: publication.html_url, files: this.files.map(file => file.path),
    });
    return structuredClone(this.publication);
  }

  async test() {
    this.tests = undefined;
    const discovery = await this.dependencies.discoverTests();
    const sha = this.options.auditOnly ? this.baseSha : this.publication?.head_sha;
    const ref = this.options.auditOnly ? this.options.ref : this.options.publication?.branch;
    if (!sha || !ref) return { discovery, testsExecuted: false, note: "No published candidate exists. Test discovery does not verify proposed files." };
    const evidence = structuredClone(await this.dependencies.verify(sha, ref));
    if (!this.options.auditOnly && await this.dependencies.getCandidateHead(ref) !== sha) {
      evidence.testsExecuted = false;
      evidence.status = "sha-mismatch";
      evidence.notes.push("The candidate branch head changed while its CI evidence was being verified.");
    }
    this.tests = evidence;
    if (this.testsVerified()) this.journal.record("verification_passed", "tester", "Required CI jobs and test steps passed for the exact commit.", {
      repository: this.options.repository, expectedSha: sha, runs: evidence.evidence.map(run => run.url),
    });
    return { discovery, executionEvidence: structuredClone(evidence), testsExecuted: this.testsVerified() };
  }

  private testsVerified() {
    const sha = this.options.auditOnly ? this.baseSha : this.publication?.head_sha;
    const ref = this.options.auditOnly ? this.options.ref : this.options.publication?.branch;
    return !!sha && this.tests?.testsExecuted === true && this.tests.status === "passed" &&
      this.tests.expectedSha === sha && this.tests.repository === this.options.repository && this.tests.ref === ref &&
      this.tests.evidence.length > 0 && this.tests.evidence.every(run => run.headSha === sha && run.conclusion === "success");
  }

  async verifyFinalCandidate() {
    if (this.options.auditOnly || !this.testsVerified() || !this.publication || !this.options.publication) return;
    await this.invoke("tester", "verify_final_head", async () => {
      const evidence = this.tests!;
      this.tests = undefined;
      const headSha = await this.dependencies.getCandidateHead(this.options.publication!.branch);
      if (headSha !== this.publication!.head_sha) {
        evidence.testsExecuted = false;
        evidence.status = "sha-mismatch";
        evidence.notes.push("The candidate branch changed before Commander returned its final result.");
      }
      this.tests = evidence;
      return { headSha, expectedSha: this.publication!.head_sha, verified: this.testsVerified() };
    });
  }

  finish(output: unknown, runnerError?: string) {
    const reasons: string[] = [];
    const missingActors = this.options.requiredActors.filter(actor => !this.completedActors.has(actor));
    if (missingActors.length) reasons.push("Required specialists did not execute: " + missingActors.join(", "));
    reasons.push(...this.failures.values());
    if (runnerError) reasons.push(runnerError);
    if (typeof output !== "string" || !output.trim()) reasons.push("Commander returned no final explanation.");
    if (!this.baseSha) reasons.push("Repository exploration is unverified.");
    if (!this.options.auditOnly && !this.files.length) reasons.push("No generated change set is available.");
    if (!this.options.auditOnly && !this.review?.ready) reasons.push("Independent change policy review has not passed.");
    if (!this.securityClean()) reasons.push("Security scans have not passed.");
    if ([...this.assessments.values()].some(assessment => !assessment.ready)) reasons.push("Specialist assessments contain blockers.");
    if (!this.options.auditOnly && !this.publication) reasons.push("Proposed files have not been written to a verified candidate commit.");
    if (this.publishAttempted && !this.publication) reasons.push("Publication failed after it started; inspect the requested branch for partial writes before retrying.");
    if (!this.testsVerified()) reasons.push("Required tests have not passed for the exact task commit.");
    const status = runnerError || missingActors.length || this.failures.size ? "blocked" as const : reasons.length ? "needs-review" as const : "completed" as const;
    this.journal.record(status === "completed" ? "agent_completed" : "blocked", "commander",
      status === "completed" ? "Task execution evidence verified. Merge and deployment remain separate actions." : "Task execution could not be fully verified.", { status, reasons });
    return {
      status, output, reasons, missingActors, taskId: this.journal.taskId,
      evidence: structuredClone({ repository: this.options.repository, baseSha: this.baseSha, proposedFiles: this.files.map(file => file.path),
        changedFiles: this.publication ? this.files.map(file => file.path) : [], publication: this.publication,
        publicationAttempted: this.publishAttempted, publicationBranch: this.options.publication?.branch,
        review: this.review, security: this.security, assessments: Object.fromEntries(this.assessments), tests: this.tests, testsExecuted: this.testsVerified() }),
      events: this.journal.snapshot(),
    };
  }
}
