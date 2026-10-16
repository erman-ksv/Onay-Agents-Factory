/**
 * Opt-in live Onay task. The app source sent to Gemini is limited to selected
 * registration snippets, not the whole private project or secret-bearing files.
 * Run only after owner authorization with explicit consent env value.
 */
import OpenAI from "openai";
import { runAiCommander } from "../commander/aiCommander.js";
import { inspectProposedChanges } from "../agents/security/agent.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";
import { inspectSecurity } from "../agents/security/agent.js";
import { GitHubClient } from "../github/githubClient.js";
import { prepareOnayChange } from "../github/changeWorkflow.js";
import { waitForCiGate } from "../github/ciGate.js";
import { inspectTestExecution } from "../agents/tester/agent.js";
import { scanForSecrets } from "../github/secretScanner.js";
import type { AiExecutionDependencies } from "../commander/aiExecution.js";
import {
  applyUiEdits, assertPrivateSourceConsent, assertRegistrationResult,
  assertRegistrationUiEditScope, validateScopedPlan, ONAY_REPOSITORY,
  ONAY_TARGET_BRANCH, ONAY_UI_PATH, ONAY_HELPER_PATH, ONAY_TEST_PATH,
  ONAY_ALLOWED_CHANGE_PATHS, type ScopedPlan,
} from "./onayRegistrationPatch.js";

const BASE_SHA = "1d929ede341b1abc1f3cfc5ca0e4f6b50bd04d04";
const MODEL = "gemini-3.5-flash-lite";
const baseRef = "refactor/onay-project-brand-20261016";
const goal = [
  "Implement Onay passenger mobile registration and returning-user login in React Native UI.",
  "Registration must require separate given name and surname; normalize whitespace and combine",
  "them into existing 120-char full_name API field. Do not change backend API.",
  "Returning users must sign in by phone+OTP without requiring names.",
  "Registration and sign-in must be distinct selectable modes.",
  "Add focused helper tests. Keep existing taxi ordering/driver/queue behavior unchanged.",
  "Onay passenger registration mobile UI frontend UX backend auth API.",
].join(" ");

function scrub(error: unknown): string {
  let value = error instanceof Error ? error.message : String(error);
  for (const secret of [process.env.GEMINI_API_KEY, process.env.GITHUB_TOKEN]) {
    if (secret?.trim()) value = value.split(secret).join("[REDACTED]");
  }
  return value.slice(0, 400);
}

function safeSnippet(source: string): string {
  const between = (begin: string, end: string) => {
    const start = source.indexOf(begin);
    const stop = source.indexOf(end, start + begin.length);
    if (start < 0 || stop < 0) throw new Error("Expected registration source boundaries missing");
    return source.slice(start, stop);
  };
  // Host sends only four registration-related regions. The full app is local.
  const selected = [
    between("import AsyncStorage", "function Button("),
    between("export default function Home()", "  const [stops,"),
    between("  async function login(", "  async function switchMode("),
    between("    {sessionLoading ? ", "      {profileError ?"),
  ];
  for (const part of selected) {
    if (scanForSecrets(part).length) throw new Error("Source snippet failed secret scan");
  }
  return selected.map((text, i) => "REGION " + (i + 1) + ":\n" + text).join("\n---\n");
}

function readJson<T>(text: string): T {
  const clean = text.trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/i, "");
  return JSON.parse(clean) as T;
}

async function main() {
  // No repository read or AI call before these checks.
  if (process.env.ONAY_PRIVATE_SOURCE_CONSENT !== "I_APPROVE_ONAY_REGISTRATION_SOURCE_TO_GEMINI") {
    console.log("PREFLIGHT: BLOCKED — separate explicit private-source consent missing");
    return;
  }
  assertPrivateSourceConsent(process.env.ONAY_PRIVATE_SOURCE_CONSENT);
  if (!process.env.GEMINI_API_KEY?.trim() || !process.env.GITHUB_TOKEN?.trim()) {
    console.log("PREFLIGHT: BLOCKED — GEMINI_API_KEY or GITHUB_TOKEN missing");
    return;
  }
  const client = new GitHubClient({ repository: ONAY_REPOSITORY });
  const actual = await client.getCommitSha(baseRef);
  if (actual !== BASE_SHA) throw new Error("Onay renamed base branch moved; stop for review before running.");
  try {
    await client.getCommitSha(ONAY_TARGET_BRANCH);
    console.log("PREFLIGHT: BLOCKED — target branch already exists, inspect before retry.");
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missing = message.startsWith("GitHub API 404:") ||
      (message.startsWith("GitHub API 422:") && message.includes("No commit found for SHA: " + ONAY_TARGET_BRANCH));
    if (!missing) throw error;
  }
  for (const path of [ONAY_HELPER_PATH, ONAY_TEST_PATH]) {
    try {
      await client.getFile(path, BASE_SHA);
      throw new Error("Expected new file already exists: " + path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.startsWith("GitHub API 404:")) throw error;
    }
  }

  const ui = await client.getFile(ONAY_UI_PATH, BASE_SHA);
  const excerpt = safeSnippet(ui.content);
  const api = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    maxRetries: 0,
  });
  const env = {
    ...process.env,
    AGENT_FACTORY_PROVIDER: "gemini",
    GEMINI_MODEL: MODEL,
    AGENT_ALLOWED_REPOSITORIES: ONAY_REPOSITORY,
    AGENT_FACTORY_ENABLE_GITHUB_WRITES: "true",
  };
  // OnayRepositoryAdapter and CI are process.env readers, unlike Commander.
  process.env.AGENT_ALLOWED_REPOSITORIES = ONAY_REPOSITORY;

  const deps: AiExecutionDependencies = {
    getHead: () => client.getCommitSha(baseRef),
    getCandidateHead: ref => client.getCommitSha(ref),
    explore: async sha => ({
      repository: ONAY_REPOSITORY, ref: sha,
      files: [{ path: ONAY_UI_PATH, sha: ui.sha, content: excerpt }],
    }),
    generate: async context => {
      const response = await api.chat.completions.create({
        model: MODEL,
        temperature: 0.1,
        max_tokens: 6500,
        messages: [
          { role: "system", content: [
            "You are Onay Coder. Return ONLY valid JSON, no markdown.",
            "Schema: {edits:[{find:string,replace:string}],newFiles:[{path:string,content:string,message:string}]}",
            "Create exactly two new files: " + ONAY_HELPER_PATH + " and " + ONAY_TEST_PATH + ".",
            "Edits are exact unique textual substitutions in the registration snippets supplied.",
            "Each find must exactly match existing contiguous code and be unique.",
            "Do not edit other UI regions; max 12 edits. Use a standalone new helper.",
            "Preserve phone OTP sign-in without requiring names, and send full_name only on registration.",
            "Do not change any app repository file other than the three allowed paths.",
            "Implement node:test coverage for registrationFullName including whitespace, missing parts, and 120-char maximum.",
            "The helper must export function registrationFullName(givenName:string,familyName:string):string|null.",
            "MANDATORY UI ACCEPTANCE MARKERS: produce actual React Native components, not comments, with",
            "testID=\"registration-given-name\" on given-name TextInput and testID=\"registration-family-name\" on surname TextInput.",
            "Add selectable sign-in and sign-up controls with testID=\"auth-signin-mode\" and testID=\"auth-signup-mode\".",
            "Use a real registering status/state or variable named registering when processing new registrations.",
            "Import and CALL registrationFullName( on signup; pass normalized full_name to existing OTP endpoint ONLY for signup.",
            "Returning users must be able to request/verify phone OTP with no name input or name required.",
            "Leave driver authentication, queue, dispatch, orders and all non-allowlisted UI regions unchanged.",
            "Before returning JSON, check that all five exact markers and registrationFullName( appear in the patched UI.",
            "The host rejects partial edits that omit any marker; do not rely on explanatory text or comments.",
          ].join("\n") },
          { role: "user", content: "GOAL:\n" + goal + "\n\nSELECTED SOURCE SNIPPETS:\n" + context },
        ],
      });
      const raw = response.choices[0]?.message?.content;
      if (!raw) throw new Error("Gemini Coder returned no candidate edits.");
      const plan = readJson<ScopedPlan>(raw);
      validateScopedPlan(plan);
      assertRegistrationUiEditScope(ui.content, plan.edits);
      const patched = applyUiEdits(ui.content, plan.edits);
      const helper = plan.newFiles.find(f => f.path === ONAY_HELPER_PATH)!.content;
      const test = plan.newFiles.find(f => f.path === ONAY_TEST_PATH)!.content;
      assertRegistrationResult(patched, helper, test);
      return { summary: "Gemini Coder authored strictly scoped registration edits and tests.", files: [
        { path: ONAY_UI_PATH, content: patched, message: "feat(onay): implement OTP signup with separate names" },
        ...plan.newFiles,
      ] };
    },
    review: files => {
      const result = reviewChangeSet({ goal, files });
      const uiFile = files.find(f => f.path === ONAY_UI_PATH);
      // Fail closed if taxi, queue or booking portions of pinned source changed.
      const uiContent = uiFile?.content ?? "";
      if (!uiContent || uiContent.length < 40000 ||
        !uiContent.includes("function") || !uiContent.includes("async function")) {
        return { ...result, ready: false, findings: [
          ...result.findings, { severity: "blocker" as const, message: "UI source structure changed unexpectedly." },
        ] };
      }
      return result;
    },
    scan: inspectProposedChanges,
    inspectSecurity: sha => inspectSecurity(["package.json"], ONAY_REPOSITORY, sha),
    discoverTests: async () => {
      const pkg = await client.getFile("mobile/onay-app/package.json", BASE_SHA);
      return { repository: ONAY_REPOSITORY, ref: BASE_SHA, scripts: JSON.parse(pkg.content).scripts };
    },
    publish: (files, sha) => prepareOnayChange({
      repository: ONAY_REPOSITORY, baseRef, baseSha: sha,
      branch: ONAY_TARGET_BRANCH,
      title: "AI agents: Onay separate registration names and returning-user OTP login",
      body: "Generated by live Gemini Onay agents from narrowly scoped private source snippets with explicit owner consent. Exactly three mobile registration files allowed. Human review required. No merge.",
      files,
    }),
    verify: async (sha, ref) => {
      const names = ["Typecheck and API tests", "verify-mobile", "Real driver route and direction planning QA"];
      const gate = await waitForCiGate({
        repository: ONAY_REPOSITORY, branch: ref, headSha: sha, requiredNames: names,
        timeoutMs: 1200000, pollMs: 15000,
      });
      console.log("CI GATE:", gate.status);
      return inspectTestExecution(sha, ONAY_REPOSITORY, ref, names);
    },
  };
  console.log("PREFLIGHT: PASS; renamed Onay base", baseRef, "pin", BASE_SHA);
  console.log("CONSENT: explicit; source snippet bytes", excerpt.length);
  console.log("GEMINI MODEL:", MODEL);
  console.log("ALLOWED FILES:", ONAY_ALLOWED_CHANGE_PATHS.join(", "));
  const result = await runAiCommander(goal, {
    env, baseRef, expectedBaseSha: BASE_SHA,
    allowedChangePaths: ONAY_ALLOWED_CHANGE_PATHS, dependencies: deps,
    specialistContextTransform: (context, proposedFiles) => {
      const privateSnippets = proposedFiles.map(file => {
        const excerpt = file.path === ONAY_UI_PATH ? safeSnippet(file.content) : file.content;
        if (scanForSecrets(excerpt).length) throw new Error("Proposed specialist snippet contains a potential secret");
        return "FILE: " + file.path + "\n" + excerpt;
      });
      return context + "\n\nSCOPED PROPOSAL:\n" + privateSnippets.join("\n---\n");
    },
    publication: {
      branch: ONAY_TARGET_BRANCH,
      title: "AI agents: Onay separate registration names and returning-user OTP login",
      body: "Owner-approved limited source exposure; based on the renamed Onay app PR #47; Draft PR only.",
    },
  });
  const completed = result.events.filter(e => e.type === "tool_completed").map(e => e.details?.tool);
  console.log("COMMANDER STATUS:", result.status);
  console.log("COMPLETED TOOLS:", completed.join(", "));
  console.log("SPECIALISTS:", JSON.stringify(Object.fromEntries(Object.entries(result.evidence.assessments).map(([name, value]) => [name, value.ready]))));
  console.log("REVIEW:", result.evidence.review?.ready ?? "NOT VERIFIED");
  console.log("SECURITY:", result.evidence.security?.proposed?.status ?? "NOT VERIFIED");
  console.log("DRAFT PR:", result.evidence.publication?.html_url ?? "NONE");
  console.log("CANDIDATE SHA:", result.evidence.publication?.head_sha ?? "NONE");
  console.log("TESTS EXECUTED:", result.evidence.testsExecuted);
  console.log("REASONS:", result.reasons.map(scrub));
  console.log("MERGE: NOT REQUESTED");
}
main().catch(error => {
  console.log("LIVE TASK: BLOCKED");
  console.log("ERROR:", scrub(error));
  process.exitCode = 1;
});
