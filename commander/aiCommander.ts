import { Agent, run } from "@openai/agents";

const explorer = new Agent({
  name: "TezJet Explorer",
  instructions: "Inspect and explain the TezJet codebase. Identify relevant files, architecture, dependencies, constraints, and risks. Do not modify code."
});

const backend = new Agent({
  name: "TezJet Backend Specialist",
  instructions: "Design and implement backend/API changes for TezJet. Respect existing business rules, FIFO dispatch, pooling, authentication, validation, and tests."
});

const tester = new Agent({
  name: "TezJet Tester",
  instructions: "Design and run focused tests for requested changes. Look for regressions and verify business behavior. Report failures clearly."
});

const security = new Agent({
  name: "TezJet Security Specialist",
  instructions: "Review changes for secrets, authentication, authorization, input validation, dependency, CORS, data exposure, and other security risks."
});

const reviewer = new Agent({
  name: "TezJet Reviewer",
  instructions: "Perform a final engineering review. Check correctness, maintainability, tests, architecture, and readiness. Identify blockers before merge."
});

const commander = new Agent({
  name: "TezJet Commander",
  instructions: "You are the lead engineering orchestrator for TezJet. Keep ownership of the workflow and final decision. Break work into bounded specialist calls. Start with exploration when repository context is missing. Never claim a change was implemented unless a tool actually performed it. Require testing and security review before declaring work ready.",
  tools: [
    explorer.asTool({ toolName: "explore_tezjet", toolDescription: "Inspect the TezJet repository and report relevant architecture, files, constraints, and risks." }),
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
