import { mkdirSync, lstatSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, parse as parsePath } from "node:path";
import { pathToFileURL } from "node:url";
import { AgentRunJournal, type AgentRunEvent } from "./agentRunJournal.js";
import type { AiCommanderOptions, runAiCommander } from "../commander/aiCommander.js";
import { selectProviderConfig } from "../commander/providerConfig.js";
import { assertCommitSha, assertValidBranchRef } from "../github/githubClient.js";
import { assertRepositoryAllowed, assertWritableBranch } from "../github/repositoryPolicy.js";

export const LIVE_CYCLE_REPOSITORY = "erman-ksv/Onay-Agents-Factory";
export const LIVE_CYCLE_PATHS = [
  "orchestration/agentRunJournal.ts",
  "orchestration/agentRunJournal.test.ts",
] as const;
export const LIVE_CYCLE_AUDIT_GOAL = "Audit Onay-Agents-Factory repository at the selected immutable commit. Inspect repository structure and journal task identifiers, security, and trusted test evidence. Report findings. This is a read-only audit.";
export const LIVE_CYCLE_CHANGE_GOAL = [
  "Fix Onay-Agents-Factory default AgentRunJournal task ID collisions.",
  "Only modify orchestration/agentRunJournal.ts and orchestration/agentRunJournal.test.ts; return complete contents for those two files and no others.",
  "The default task ID currently uses Date.now(), so two journals constructed in the same millisecond can share a task ID.",
  "Use Node crypto randomUUID() for the default task ID, preserve the task- prefix, explicit caller-supplied IDs, existing constructor API, event ordering, and observer isolation.",
  "Add regression coverage that freezes Date.now() and constructs multiple journals with unique default IDs, plus coverage that explicit IDs and the initial task event remain intact.",
  "Do not edit configuration, dependencies, workflows, scripts, other files, or documentation. Do not merge or deploy.",
  "Use executable tools, independent review and security gates, publish only the authorized draft PR, and verify required checks for its exact final commit.",
].join("\n");

export type LiveCycleOptions = {
  provider: "openai" | "gemini";
  baseRef: string;
  baseSha: string;
  outputDir: string;
  publish: boolean;
  branch?: string;
  title?: string;
  body?: string;
  help: boolean;
};

type CommanderResult = Awaited<ReturnType<typeof runAiCommander>>;
type Executor = (goal: string, options: AiCommanderOptions) => Promise<CommanderResult>;
type Stage = "audit" | "change";
type StageEvidence = { result: CommanderResult; verified: boolean; reasons: string[] };
export type LiveCycleEvidence = {
  schemaVersion: 1;
  executionMode: "live-provider" | "test-executor";
  status: "audit-passed" | "completed" | "blocked";
  /** Execution evidence does not establish that the generated change fixes the requested bug. */
  taskAcceptance: "not-applicable" | "requires-independent-review";
  liveProviderVerified: boolean;
  provider: "openai" | "gemini";
  model: string;
  credentialsPresent: { openai: boolean; gemini: boolean; github: boolean };
  repository: string;
  baseRef: string;
  baseSha: string;
  publishRequested: boolean;
  publicationBranch?: string;
  audit?: StageEvidence;
  change?: StageEvidence;
  reasons: string[];
  artifactDirectory: string;
  note: string;
};

export function parseLiveCycleArgs(args: string[]): LiveCycleOptions {
  const values = new Map<string, string>();
  let publish = false;
  let help = false;
  const flags = new Set(["--provider", "--base-ref", "--base-sha", "--output-dir", "--branch", "--title", "--body"]);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help" || flag === "-h") { help = true; continue; }
    if (flag === "--publish") {
      if (publish) throw new Error("Duplicate --publish argument.");
      publish = true;
      continue;
    }
    if (!flags.has(flag)) throw new Error("Unknown live-cycle argument. Credentials must be supplied through environment variables, never arguments.");
    if (values.has(flag)) throw new Error(`Duplicate ${flag} argument.`);
    const value = args[++index];
    if (!value?.trim() || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
    values.set(flag, value.trim());
  }
  const provider = values.get("--provider") ?? "gemini";
  if (provider !== "openai" && provider !== "gemini") throw new Error("--provider must be openai or gemini.");
  const options: LiveCycleOptions = {
    provider,
    baseRef: values.get("--base-ref") ?? "fix/verified-agent-execution",
    baseSha: values.get("--base-sha")?.toLowerCase() ?? "",
    outputDir: values.get("--output-dir") ?? "",
    publish,
    branch: values.get("--branch"), title: values.get("--title"), body: values.get("--body"), help,
  };
  if (help) return options;
  if (!options.baseSha) throw new Error("--base-sha is required; supply the full expected commit SHA.");
  assertCommitSha(options.baseSha);
  assertValidBranchRef(options.baseRef);
  if (!options.outputDir || !isAbsolute(options.outputDir)) throw new Error("--output-dir must be an absolute path to a new directory.");
  if (!publish && (options.branch || options.title || options.body)) throw new Error("Publication metadata requires --publish.");
  if (publish) {
    for (const key of ["branch", "title", "body"] as const) {
      if (!options[key]) throw new Error(`--${key} is required with --publish.`);
    }
    assertValidBranchRef(options.branch!);
    assertWritableBranch(options.branch!);
    if (options.branch === options.baseRef) throw new Error("The publication branch must differ from --base-ref.");
  }
  return options;
}

/** Exact credential values are removed from nested values and object keys. */
export function redactLiveCycleSecrets(value: unknown, env: NodeJS.ProcessEnv): unknown {
  const secrets = [...new Set([env.OPENAI_API_KEY, env.GEMINI_API_KEY, env.GITHUB_TOKEN, env.GH_TOKEN]
    .flatMap(secret => secret ? [secret, secret.trim()] : []).filter(Boolean))].sort((a, b) => b.length - a.length);
  const redact = (input: string) => secrets.reduce((safe, secret) => safe.split(secret).join("[REDACTED]"), input);
  const visit = (input: unknown): unknown => {
    if (typeof input === "string") return redact(input);
    if (Array.isArray(input)) return input.map(visit);
    if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([key, item]) => [redact(key), visit(item)]));
    return input;
  };
  return visit(value);
}

/** Reject existing paths and symlink parents so evidence cannot overwrite source or secret files. */
function prepareOutputDirectory(outputDir: string): string {
  const directory = resolve(outputDir);
  const components = directory.slice(parsePath(directory).root.length).split(/[\\/]/);
  if (components.some(component => component === ".git" || component === "node_modules" || component === ".ssh" || component === ".aws" || component.startsWith(".env"))) {
    throw new Error("The artifact directory must not be inside a source-control, dependency, or credential directory.");
  }
  let parent = dirname(directory);
  while (true) {
    const stat = lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("The artifact directory must have existing directory parents without symlinks.");
    if (parent === parsePath(parent).root) break;
    parent = dirname(parent);
  }
  mkdirSync(directory, { mode: 0o700 });
  return directory;
}

function preflight(options: LiveCycleOptions, env: NodeJS.ProcessEnv): { selectedEnv: NodeJS.ProcessEnv; model: string } {
  const selectedEnv = { ...env, AGENT_FACTORY_PROVIDER: options.provider };
  const config = selectProviderConfig(selectedEnv);
  if (config.provider === "none" || config.provider !== options.provider) {
    throw new Error(`The selected ${options.provider} provider requires ${options.provider === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY"}. No provider fallback is permitted.`);
  }
  if (!env.GITHUB_TOKEN?.trim()) throw new Error("GITHUB_TOKEN is required for the live repository audit.");
  const allowed = env.AGENT_ALLOWED_REPOSITORIES?.split(",").map(repository => repository.trim()).filter(Boolean) ?? [];
  assertRepositoryAllowed(LIVE_CYCLE_REPOSITORY, allowed);
  if (options.publish && env.AGENT_FACTORY_ENABLE_GITHUB_WRITES !== "true") {
    throw new Error("Publishing requires both --publish and AGENT_FACTORY_ENABLE_GITHUB_WRITES=true.");
  }
  return { selectedEnv, model: config.model ?? "sdk-default" };
}

function hasCompletedTool(events: AgentRunEvent[], tool: string): boolean {
  const started = events.find(event => event.type === "tool_started" && event.details?.tool === tool);
  const completed = events.find(event => event.type === "tool_completed" && event.details?.tool === tool && !!started && event.sequence > started.sequence);
  return !!started && !!completed;
}

/** Host evidence and journal events must agree; final model prose never proves completion. */
export function verifyLiveCycleStage(result: CommanderResult, options: LiveCycleOptions, stage: Stage): string[] {
  const reasons: string[] = [];
  if (result?.status !== "completed") reasons.push("Commander status is not completed.");
  if (!Array.isArray(result?.reasons) || result.reasons.length) reasons.push("Commander reported reasons or omitted reason metadata.");
  if (!Array.isArray(result?.missingActors) || result.missingActors.length) reasons.push("Required actors did not all execute or actor metadata is missing.");
  const evidence = result?.evidence;
  if (evidence?.repository !== LIVE_CYCLE_REPOSITORY || evidence.baseSha?.toLowerCase() !== options.baseSha) reasons.push("Repository or immutable base evidence does not match the host request.");
  if (evidence?.security?.repository?.status !== "clean" || evidence.security.repository.repository !== LIVE_CYCLE_REPOSITORY ||
      evidence.security.repository.ref?.toLowerCase() !== options.baseSha) reasons.push("Security metadata does not verify the requested repository commit.");
  if (evidence?.testsExecuted !== true || evidence.tests?.testsExecuted !== true || evidence.tests.status !== "passed") reasons.push("Tests were not executed successfully for this stage.");
  const events = Array.isArray(result?.events) ? result.events : [];
  const requiredTools = stage === "audit"
    ? ["explore_onay", "security_review", "test_onay"]
    : ["explore_onay", "code_onay", "security_review", "final_review", "publish_change_set", "test_onay", "verify_final_head"];
  for (const tool of requiredTools) {
    if (!hasCompletedTool(events, tool)) reasons.push(`Missing successful executable tool events for ${tool}.`);
  }
  let expectedSha = options.baseSha;
  let expectedRef = options.baseRef;
  if (stage === "audit") {
    if (evidence?.publicationAttempted !== false || evidence.publication || evidence.publicationBranch !== undefined || evidence.security?.proposed !== null ||
        !Array.isArray(evidence?.changedFiles) || evidence.changedFiles.length ||
        !Array.isArray(evidence?.proposedFiles) || evidence.proposedFiles.length ||
        events.some(event => event.details?.tool === "code_onay" || event.details?.tool === "publish_change_set" || event.details?.tool === "write_candidate")) {
      reasons.push("Read-only audit contains mutation or publication evidence.");
    }
  } else {
    if (evidence?.review?.ready !== true || evidence.security?.proposed?.status !== "clean") reasons.push("Independent review or proposed-change security metadata is missing or unsuccessful.");
    const publication = evidence?.publication;
    if (evidence?.publicationAttempted !== true || evidence.publicationBranch !== options.branch || !publication) {
      reasons.push("Actual publication evidence for the authorized branch is missing.");
    }
    const head = publication?.head_sha;
    if (!head || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(head) || head.toLowerCase() === options.baseSha) {
      reasons.push("A full new publication head SHA is required.");
    } else expectedSha = head;
    expectedRef = options.branch ?? "";
    if (!publication || !Number.isSafeInteger(publication.number) || publication.number <= 0 ||
        publication.html_url !== `https://github.com/${LIVE_CYCLE_REPOSITORY}/pull/${publication.number}`) reasons.push("Draft PR metadata is missing or invalid.");
    const changed = evidence?.changedFiles;
    const proposed = evidence?.proposedFiles;
    for (const [label, paths] of [["changed", changed], ["proposed", proposed]] as const) {
      if (!Array.isArray(paths) || paths.length !== LIVE_CYCLE_PATHS.length || LIVE_CYCLE_PATHS.some(path => !paths.includes(path))) {
        reasons.push(`The ${label} files do not exactly match the two permitted journal paths.`);
      }
    }
    const written = events.find(event => event.type === "artifact_created" && event.actor === "github" &&
      event.details?.headSha === expectedSha && event.details?.repository === LIVE_CYCLE_REPOSITORY &&
      event.details?.branch === expectedRef && event.details?.url === publication?.html_url);
    if (!written) reasons.push("The journal does not confirm publication of the exact final head.");
  }
  const tests = evidence?.tests;
  if (!tests || tests.repository !== LIVE_CYCLE_REPOSITORY || tests.ref !== expectedRef || tests.expectedSha !== expectedSha ||
      !Array.isArray(tests.evidence) || !tests.evidence.length || tests.evidence.some(run => run.headSha !== expectedSha || run.conclusion !== "success" ||
        !Number.isSafeInteger(run.runId) || run.runId <= 0 || run.url !== `https://github.com/${LIVE_CYCLE_REPOSITORY}/actions/runs/${run.runId}`)) {
    reasons.push("Trusted CI metadata does not verify the exact stage commit and branch.");
  }
  if (!events.some(event => event.type === "verification_passed" && event.actor === "tester" && event.details?.expectedSha === expectedSha)) {
    reasons.push("The journal does not confirm test verification for the exact stage commit.");
  }
  return reasons;
}

const help = {
  mode: "help" as const,
  usage: "pnpm run live-cycle -- --provider openai|gemini --base-sha FULL_SHA --output-dir /absolute/new-directory [--base-ref fix/verified-agent-execution] [--publish --branch feat/live-journal-ids --title TITLE --body BODY]",
  note: "The default is a real-provider read-only audit. Publishing also requires the existing environment write gate. No merge or deployment is performed.",
};

async function executeLiveCycle(args: string[], env: NodeJS.ProcessEnv, executor: Executor, executionMode: LiveCycleEvidence["executionMode"]) {
  const options = parseLiveCycleArgs(args);
  if (options.help) return help;
  const credentialValues = [env.OPENAI_API_KEY, env.GEMINI_API_KEY, env.GITHUB_TOKEN, env.GH_TOKEN]
    .flatMap(secret => secret ? [secret, secret.trim()] : []).filter(Boolean);
  if (args.some(arg => credentialValues.some(secret => arg.includes(secret)))) {
    throw new Error("Credentials must not appear in live-cycle arguments or publication metadata; use environment variables only.");
  }
  const artifactDirectory = prepareOutputDirectory(options.outputDir);
  const evidence: LiveCycleEvidence = {
    schemaVersion: 1, executionMode, status: "blocked", taskAcceptance: "not-applicable", liveProviderVerified: false,
    provider: options.provider, model: "unresolved",
    credentialsPresent: { openai: !!env.OPENAI_API_KEY?.trim(), gemini: !!env.GEMINI_API_KEY?.trim(), github: !!env.GITHUB_TOKEN?.trim() },
    repository: LIVE_CYCLE_REPOSITORY, baseRef: options.baseRef, baseSha: options.baseSha,
    publishRequested: options.publish, publicationBranch: options.branch,
    reasons: [], artifactDirectory,
    note: executionMode === "test-executor" ?
      "Injected test executor: this artifact is unit-test evidence, never proof of a live model run. A simulated completed status exercises execution and CI metadata checks. Requested bug behavior remains pending independent diff and behavior review whenever a change stage runs." :
      "A read-only audit verifies actual provider tool coordination and existing exact-base CI evidence. A completed publication stage confirms orchestration, publication and exact-commit CI. Requested bug behavior remains pending independent diff and behavior review. Merge and deployment remain separate.",
  };
  try {
    const { selectedEnv, model } = preflight(options, env);
    evidence.model = model;
    const executeStage = async (stage: Stage, goal: string) => {
      const eventPath = resolve(artifactDirectory, `${stage}.events.jsonl`);
      writeFileSync(eventPath, "", { flag: "wx", mode: 0o600 });
      let persistenceError: unknown;
      const journal = new AgentRunJournal(goal, undefined, event => {
        try {
          appendFileSync(eventPath, JSON.stringify(redactLiveCycleSecrets(event, env)) + "\n");
        } catch (error) {
          persistenceError = error;
          throw error;
        }
      });
      const result = await executor(goal, {
        env: selectedEnv, baseRef: options.baseRef, expectedBaseSha: options.baseSha, journal,
        ...(stage === "change" ? { publication: { branch: options.branch!, title: options.title!, body: options.body! }, allowedChangePaths: LIVE_CYCLE_PATHS } : {}),
      });
      writeFileSync(resolve(artifactDirectory, `${stage}.result.json`), JSON.stringify(redactLiveCycleSecrets(result, env), null, 2) + "\n", { flag: "wx", mode: 0o600 });
      // Production returns the same journal. A mismatched result event list cannot prove this run.
      const reasons = verifyLiveCycleStage(result, options, stage);
      if (persistenceError) reasons.push("The task journal could not be completely persisted.");
      if (JSON.stringify(result.events) !== JSON.stringify(journal.snapshot())) reasons.push("Commander returned events that do not match the persisted task journal.");
      return { result, reasons, verified: reasons.length === 0 };
    };
    evidence.audit = await executeStage("audit", LIVE_CYCLE_AUDIT_GOAL);
    if (!evidence.audit.verified) {
      evidence.reasons = evidence.audit.reasons.map(reason => "Audit: " + reason);
    } else if (!options.publish) {
      evidence.status = "audit-passed";
      evidence.liveProviderVerified = executionMode === "live-provider";
    } else {
      evidence.taskAcceptance = "requires-independent-review";
      evidence.change = await executeStage("change", LIVE_CYCLE_CHANGE_GOAL);
      evidence.reasons = evidence.change.reasons.map(reason => "Change: " + reason);
      if (evidence.change.verified) {
        evidence.status = "completed";
        evidence.liveProviderVerified = executionMode === "live-provider";
      }
    }
  } catch (error) {
    evidence.reasons.push(error instanceof Error ? error.message : String(error));
  }
  const safeEvidence = redactLiveCycleSecrets(evidence, env) as LiveCycleEvidence;
  writeFileSync(resolve(artifactDirectory, "evidence.json"), JSON.stringify(safeEvidence, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return safeEvidence;
}

/** Production entry point: no executor, model or dependency override is accepted. */
export async function runLiveCycleCli(args: string[], env: NodeJS.ProcessEnv = process.env) {
  // Import after argument/credential checks inside executeLiveCycle and only when a stage executes.
  const executor: Executor = async (goal, options) => {
    const { runAiCommander } = await import("../commander/aiCommander.js");
    return runAiCommander(goal, options);
  };
  return executeLiveCycle(args, env, executor, "live-provider");
}

/** Unit-test seam only. CLI main never calls this API or accepts an executor. */
export function runLiveCycleForTest(args: string[], env: NodeJS.ProcessEnv, executor: Executor) {
  return executeLiveCycle(args, env, executor, "test-executor");
}

async function main() {
  try {
    const result = await runLiveCycleCli(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    if ("status" in result && result.status === "blocked") process.exitCode = 1;
  } catch (error) {
    console.error(redactLiveCycleSecrets(error instanceof Error ? error.message : String(error), process.env));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
