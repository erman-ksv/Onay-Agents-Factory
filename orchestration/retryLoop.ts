import { generateChanges } from "../agents/backend/coder.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";
import { inspectProposedChanges, inspectSecurity } from "../agents/security/agent.js";
import { getCiFailureContext, waitForCiGate } from "../github/ciGate.js";
import { TezJetRepositoryAdapter } from "../github/tezjetRepository.js";
import { getTargetRepository } from "../github/repositoryConfig.js";

type ChangeFile = { path: string; content: string; message: string };
const REQUIRED_TEZJET_CI_JOBS = ["Typecheck and API tests"];

export async function retryFailedCi(input: {
  goal: string;
  branch: string;
  repositoryContext: string;
  headSha: string;
  maxAttempts?: number;
}) {
  const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? 2, 3));
  const adapter = new TezJetRepositoryAdapter();
  const attempts = [];
  let headSha = input.headSha;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const failure = await getCiFailureContext(input.branch, headSha);
    if (failure.gate.status === "passed") return { status: "passed" as const, attempts, headSha };
    if (failure.gate.status !== "failed") return { status: "waiting" as const, attempts, gate: failure.gate, headSha };

    const diagnostics = JSON.stringify(failure.failures);
    const generated = await generateChanges(
      `Fix the CI failure for this TezJet task. Attempt ${attempt}. Do not change unrelated behavior. CI diagnostics:\n${diagnostics}`,
      input.repositoryContext,
    );
    if (!generated.files.length) return { status: "blocked" as const, attempts, reason: generated.summary, headSha };

    const review = reviewChangeSet({ goal: input.goal, files: generated.files });
    if (!review.ready) return { status: "blocked" as const, attempts, review, headSha };

    const proposedSecurity = inspectProposedChanges(generated.files);
    if (proposedSecurity.status !== "clean") return { status: "blocked" as const, attempts, proposedSecurity, headSha };

    const security = await inspectSecurity(undefined, getTargetRepository(), "main");
    if (security.status !== "clean") return { status: "blocked" as const, attempts, security, headSha };

    for (const file of generated.files as ChangeFile[]) {
      headSha = await adapter.write(file.path, file.content, file.message, input.branch);
    }

    const ci = await waitForCiGate({ branch: input.branch, headSha, requiredNames: REQUIRED_TEZJET_CI_JOBS });
    attempts.push({ attempt, files: generated.files.map(file => file.path), headSha, ci });
    if (ci.status === "passed") return { status: "passed" as const, attempts, headSha };
    if (ci.status !== "failed") return { status: "waiting" as const, attempts, headSha, gate: ci };
  }

  return { status: "max-attempts" as const, attempts, headSha };
}
