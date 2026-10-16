/**
 * Live-provider Onay proof. This deliberately shows Gemini ONLY fictional math source.
 * The real factory repository is used solely for a GitHub write to a feature branch,
 * a Draft PR and exact-commit CI evidence. Never point this at the taxi app.
 */
import { runAiCommander } from "../commander/aiCommander.js";
import { generateChanges } from "../agents/backend/coder.js";
import { inspectSecurity, inspectProposedChanges } from "../agents/security/agent.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";
import { inspectTests, inspectTestExecution } from "../agents/tester/agent.js";
import { GitHubClient } from "../github/githubClient.js";
import { prepareOnayChange } from "../github/changeWorkflow.js";
import { waitForCiGate } from "../github/ciGate.js";
import type { AiExecutionDependencies } from "../commander/aiExecution.js";

const repository = "erman-ksv/Onay-Agents-Factory";
const baseRef = "feat/onay-registration-agent-gated-20261016";
const targetBranch = "feat/full-factory-synthetic-proof-20261017";
const targetPath = "commander/onaySyntheticLiveMathProof20261017.test.ts";
const expectedFile = [
  'import assert from "node:assert/strict";',
  'import test from "node:test";',
  '',
  'function add(a: number, b: number): number {',
  '  return a - b;',
  '}',
  '',
  'test("fictional arithmetic proof", () => {',
  '  assert.equal(add(2, 3), 5);',
  '  assert.equal(add(-1, 1), 0);',
  '});',
  ''
].join("\n");

const goal = [
  "Fix Onay-Agents-Factory synthetic arithmetic as a backend/frontend/mobile UI product UX database dispatch legal privacy compliance DevOps CI release security review task in ONLY the fictional test file " + targetPath + ".",
  "This is a fictional isolated test fixture, not actual repository or user source. Every specialist must review only this fictitious example, and mark unrelated real-world release questions as not applicable to this test.",
  "The add function is wrong: return a - b. Replace it with return a + b.",
  "Keep an executable node:test test with assert.equal(add(2,3),5) and assert.equal(add(-1,1),0).",
  "Output exactly one complete TypeScript file. Never access application code."
].join(" ");

const env: NodeJS.ProcessEnv = {
  ...process.env,
  AGENT_FACTORY_PROVIDER: "gemini",
  AGENT_ALLOWED_REPOSITORIES: repository,
  AGENT_FACTORY_ENABLE_GITHUB_WRITES: "true",
};

// RepositoryAdapter reads process.env, while Commander accepts the explicit
// env above. Keep both permission checks identical and limited to this single
// disposable factory repository; do not allow access to the taxi app.
process.env.AGENT_ALLOWED_REPOSITORIES = repository;


function scrub(value: unknown): string {
  let message = String(value ?? "");
  for (const secret of [env.GEMINI_API_KEY, env.GITHUB_TOKEN]) {
    if (secret?.trim()) message = message.split(secret.trim()).join("[REDACTED]");
  }
  return message.slice(0, 280);
}

async function main() {
  if (!env.GEMINI_API_KEY?.trim() || !env.GITHUB_TOKEN?.trim()) {
    console.log("PREFLIGHT: BLOCKED (GEMINI_API_KEY or GITHUB_TOKEN missing)");
    return;
  }
  const github = new GitHubClient({ repository });
  const baseSha = await github.getCommitSha(baseRef);
  console.log("BASE:", repository, baseRef, baseSha);

  // GitHub /commits/{ref} may answer 422 (No commit found for SHA)
  // rather than 404 when the candidate branch does not exist.
  // Reject every other 422 and all authentication/permission failures.
  try {
    await github.getCommitSha(targetBranch);
    console.log("PREFLIGHT: BLOCKED (candidate branch already exists; inspect previous run)");
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingBy404 = message.startsWith("GitHub API 404:");
    const missingBy422 = message.startsWith("GitHub API 422:") &&
      message.includes("No commit found for SHA: " + targetBranch);
    if (!missingBy404 && !missingBy422) throw error;
    console.log("PREFLIGHT: candidate branch absent, safe to continue");
  }

  const deps: AiExecutionDependencies = {
    getHead: () => github.getCommitSha(baseRef),
    getCandidateHead: ref => github.getCommitSha(ref),
    explore: async sha => ({
      repository,
      ref: sha,
      files: [{ path: targetPath, sha: "0".repeat(40), content: expectedFile }],
    }),
    generate: async context => {
      if (!context.includes("return a - b;") || !context.includes(targetPath)) {
        throw new Error("Synthetic context missing; stop without publishing");
      }
      const result = await generateChanges(goal, context, env);
      if (result.files.length !== 1 || result.files[0]?.path !== targetPath) {
        throw new Error("Coder did not return exactly the authorized synthetic file");
      }
      const code = result.files[0].content;
      if (!/return\s+a\s*\+\s*b\s*;/.test(code) ||
          !/node:assert\/strict/.test(code) || !/node:test/.test(code) ||
          !/assert\.equal\(add\(2,\s*3\),\s*5\)/.test(code) ||
          !/assert\.equal\(add\(-1,\s*1\),\s*0\)/.test(code)) {
        throw new Error("Coder output failed independent fictional math acceptance checks");
      }
      return result;
    },
    review: files => reviewChangeSet({ goal, files }),
    scan: inspectProposedChanges,
    inspectSecurity: sha => inspectSecurity(["package.json"], repository, sha),
    discoverTests: () => inspectTests(repository, baseRef),
    publish: (files, sha) => prepareOnayChange({
      repository,
      baseRef,
      baseSha: sha,
      branch: targetBranch,
      title: "Full-team synthetic AI proof: fictional arithmetic",
      body: "Live Gemini Commander/Coder/backend-specialist; synthetic fixture only. Real GitHub draft PR and exact-commit CI; no Onay app source sent to AI. Human review required.",
      files,
    }),
    verify: async (sha, ref) => {
      const requiredNames = ["typecheck"];
      const requiredStepNames = ["Typecheck", "Test"];
      const gate = await waitForCiGate({
        repository, branch: ref, headSha: sha,
        requiredNames, requiredStepNames,
        timeoutMs: 360000, pollMs: 12000,
      });
      console.log("CI GATE:", gate.status);
      return inspectTestExecution(
        sha, repository, ref, requiredNames, requiredStepNames
      );
    },
  };

  console.log("LIVE PROVIDER: GEMINI; ALL-ROLE SYNTHETIC EVIDENCE");
  console.log("SYNTHETIC INPUT ONLY: YES");
  console.log("ALLOWED CHANGE PATH:", targetPath);

  const result = await runAiCommander(goal, {
    env,
    baseRef,
    expectedBaseSha: baseSha,
    maxTurns: 48,
    allowedChangePaths: [targetPath],
    dependencies: deps,
    publication: {
      branch: targetBranch,
      title: "Full-team synthetic AI proof: fictional arithmetic",
      body: "Only the fake arithmetic test is in scope.",
    },
  });
  const completed = result.events.filter(
    e => e.type === "tool_completed"
  ).map(e => e.details?.tool);
  console.log("COMMANDER STATUS:", result.status);
  console.log("COMPLETED TOOLS:", completed.join(", "));
  console.log("SPECIALISTS:", JSON.stringify(Object.fromEntries(Object.entries(result.evidence.assessments).map(([role, evaluation]) => [role, evaluation.ready]))));
  console.log("REVIEW:", result.evidence.review?.ready ?? "NOT VERIFIED");
  console.log("SECURITY:", result.evidence.security?.proposed?.status ?? "NOT VERIFIED");
  console.log("DRAFT PR:", result.evidence.publication?.html_url ?? "NONE");
  console.log("CANDIDATE SHA:", result.evidence.publication?.head_sha ?? "NONE");
  console.log("TESTS EXECUTED:", result.evidence.testsExecuted);
  console.log("REASONS:", result.reasons.map(scrub));
  console.log("MERGE: NOT REQUESTED");
}

main().catch(e => {
  console.log("LIVE TEST: BLOCKED");
  console.log("ERROR:", scrub(e instanceof Error ? e.message : e));
  process.exitCode = 1;
});
