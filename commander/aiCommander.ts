import OpenAI from "openai";
import {
  Agent,
  run,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled
} from "@openai/agents";

// Gemini exposes an OpenAI-compatible Chat Completions endpoint.
// Prefer Gemini when GEMINI_API_KEY is configured; otherwise retain OpenAI behavior.
const geminiApiKey = process.env.GEMINI_API_KEY;
const model = geminiApiKey
  ? (process.env.GEMINI_MODEL || "gemini-2.5-flash")
  : undefined;

if (geminiApiKey) {
  const client = new OpenAI({
    apiKey: geminiApiKey,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
  });

  setDefaultOpenAIClient(client);
  setOpenAIAPI("chat_completions");
  // Do not send traces to OpenAI when using a non-OpenAI provider.
  setTracingDisabled(true);
}

const modelOptions = model ? { model } : {};

const explorer = new Agent({ name: "TezJet Explorer", ...modelOptions, instructions: "Inspect and explain the TezJet codebase. Identify relevant files, architecture, dependencies, constraints, and risks. Do not modify code." });
const coder = new Agent({ name: "TezJet Coder", ...modelOptions, instructions: "Produce a minimal explicit TezJet change set from repository context and goal. Return complete changed-file contents, never secrets, and never claim files were written unless a GitHub tool actually wrote them." });
const backend = new Agent({ name: "TezJet Backend Specialist", ...modelOptions, instructions: "Design and implement backend/API changes for TezJet. Respect existing business rules, FIFO dispatch, pooling, authentication, validation, and tests." });
const tester = new Agent({ name: "TezJet Tester", ...modelOptions, instructions: "Design and run focused tests for requested changes. Look for regressions and verify business behavior. Report failures clearly." });
const security = new Agent({ name: "TezJet Security Specialist", ...modelOptions, instructions: "Review changes for secrets, authentication, authorization, input validation, dependency, CORS, data exposure, and other security risks." });
const reviewer = new Agent({ name: "TezJet Reviewer", ...modelOptions, instructions: "Perform a final engineering review. Check correctness, maintainability, tests, architecture, and readiness. Identify blockers before merge." });

const commander = new Agent({
  name: "TezJet Commander",
  ...modelOptions,
  instructions: "You are the lead engineering orchestrator for TezJet. Keep ownership of the workflow and final decision. Start with exploration when repository context is missing, then use Coder for an explicit change set. Require testing, security review, and final review before declaring work ready. Never claim a change was implemented unless a tool actually performed it.",
  tools: [
    explorer.asTool({ toolName: "explore_tezjet", toolDescription: "Inspect the TezJet repository and report relevant architecture, files, constraints, and risks." }),
    coder.asTool({ toolName: "code_tezjet", toolDescription: "Produce an explicit TezJet change set with complete contents for changed files." }),
    backend.asTool({ toolName: "backend_specialist", toolDescription: "Analyze or implement backend/API work for TezJet." }),
    tester.asTool({ toolName: "test_tezjet", toolDescription: "Create or evaluate tests and report regression risks for the requested change." }),
    security.asTool({ toolName: "security_review", toolDescription: "Review the requested implementation for security risks and blockers." }),
    reviewer.asTool({ toolName: "final_review", toolDescription: "Perform a final engineering readiness review of the proposed work." })
  ]
});

export async function runAiCommander(goal: string) {
  const result = await run(commander, goal);
  return result.finalOutput;
}
