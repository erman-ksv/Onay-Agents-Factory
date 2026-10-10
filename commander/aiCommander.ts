import { Agent, run } from "@openai/agents";
import { ROLE_SKILLS } from "./skills.js";
import { buildCommanderPrompt } from "./buildCommanderPrompt.js";

const explorer = new Agent({ name: "TezJet Explorer", instructions: ROLE_SKILLS.explorer });
const coder = new Agent({ name: "TezJet Coder", instructions: ROLE_SKILLS.coder });
const backend = new Agent({ name: "TezJet Backend Specialist", instructions: ROLE_SKILLS.backend });
const frontend = new Agent({ name: "TezJet Frontend & Mobile Specialist", instructions: ROLE_SKILLS.frontend });
const database = new Agent({ name: "TezJet Database Specialist", instructions: ROLE_SKILLS.database });
const dispatch = new Agent({ name: "TezJet Dispatch & Ride Operations Specialist", instructions: ROLE_SKILLS.dispatch });
const tester = new Agent({ name: "TezJet Tester", instructions: ROLE_SKILLS.tester });
const security = new Agent({ name: "TezJet Security Specialist", instructions: ROLE_SKILLS.security });
const reviewer = new Agent({ name: "TezJet Independent Reviewer", instructions: ROLE_SKILLS.reviewer });
const legal = new Agent({ name: "Rasul — Legal & Compliance Specialist", instructions: ROLE_SKILLS.legal });
const devops = new Agent({ name: "TezJet DevOps & Release Specialist", instructions: ROLE_SKILLS.devops });
const product = new Agent({ name: "TezJet Product Analyst", instructions: ROLE_SKILLS.product });
const ux = new Agent({ name: "TezJet UX & Accessibility Specialist", instructions: ROLE_SKILLS.ux });

const commander = new Agent({
  name: "TezJet Commander",
  instructions: `You are the lead engineering orchestrator for TezJet. Select specialists according to the task; for cross-cutting work, delegate to multiple relevant roles. For legal/compliance tasks, always involve Rasul and explicitly identify jurisdiction. For production-impacting tasks, involve DevOps and Security. Start with repository exploration when context is missing, then request an explicit change set from Coder and the relevant specialists. Require testing, security review, and independent review before declaring work ready. Specialists provide advice and proposed changes; they do not gain authority to deploy, sign, send, file, negotiate, or make binding legal/financial commitments. Never claim code was written, tests ran, or changes were merged unless an actual tool result proves it. Clearly separate verified facts, assumptions, recommendations, and blockers.`,
  tools: [
    explorer.asTool({ toolName: "explore_tezjet", toolDescription: "Inspect the repository and report relevant architecture, files, constraints, and risks." }),
    coder.asTool({ toolName: "code_tezjet", toolDescription: "Produce an explicit code change set with complete contents for changed files." }),
    backend.asTool({ toolName: "backend_specialist", toolDescription: "Analyze or implement backend/API changes." }),
    frontend.asTool({ toolName: "frontend_mobile_specialist", toolDescription: "Analyze or implement Android/iOS and frontend changes." }),
    database.asTool({ toolName: "database_specialist", toolDescription: "Analyze schema, migrations, persistence, and transaction safety." }),
    dispatch.asTool({ toolName: "dispatch_ride_operations_specialist", toolDescription: "Review taxi matching, queue fairness, pickup eligibility, seat capacity, and ride lifecycle rules." }),
    tester.asTool({ toolName: "test_tezjet", toolDescription: "Design/evaluate tests and report which results are actually verified." }),
    security.asTool({ toolName: "security_review", toolDescription: "Threat-model the implementation and identify security blockers." }),
    legal.asTool({ toolName: "rasul_legal_compliance", toolDescription: "Identify legal/compliance issues, jurisdiction, primary-source research needs, risk, and questions for human counsel. Never make binding legal decisions." }),
    devops.asTool({ toolName: "devops_release_review", toolDescription: "Review CI, secrets, deployment safety, monitoring, migrations, and rollback." }),
    product.asTool({ toolName: "product_requirements", toolDescription: "Turn goals into scope, acceptance criteria, and business-rule checks." }),
    ux.asTool({ toolName: "ux_accessibility_review", toolDescription: "Review journeys, mobile UX, accessibility, permission flows, and error states." }),
    reviewer.asTool({ toolName: "final_review", toolDescription: "Perform independent engineering review and identify blockers before merge." })
  ]
});

export async function runAiCommander(goal: string) {
  const result = await run(commander, buildCommanderPrompt(goal));
  return result.finalOutput;
}
