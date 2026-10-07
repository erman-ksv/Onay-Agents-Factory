import { generateChanges } from "../agents/backend/coder.js";
import { reviewChangeSet } from "../agents/reviewer/agent.js";
import { inspectSecurity } from "../agents/security/agent.js";
import { getCiFailureContext } from "../github/ciGate.js";
import { TezJetRepositoryAdapter } from "../github/tezjetRepository.js";

type ChangeFile = { path: string; content: string; message: string };

export async function retryFailedCi(input: {
  goal: string;
  branch: string;
  repositoryContext: string;
  maxAttempts?: number;
}) {
  const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? 2, 3));
  const adapter = new TezJetRepositoryAdapter();
  const attempts = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const failure = await getCiFailureContext(input.branch);
    if (failure.gate.status === "passed") return { status: "passed" as const, attempts };
    if (failure.gate.status !== "failed") return { status: "waiting" as const, attempts, gate: failure.gate };

    const diagnostics = JSON.stringify(failure.failures);
    const generated = await generateChanges(
      `Fix the CI failure for this TezJet task. Attempt ${attempt}. Do not change unrelated behavior. CI diagnostics:\n${diagnostics}`,
      input.repositoryContext,
    );
    if (!generated.files.length) return { status: "blocked" as const, attempts, reason: generated.summary };

    const review = reviewChangeSet({ goal: input.goal, files: generated.files });
    if (!review.ready) return { status: "blocked" as const, attempts, review };

    const security = await inspectSecurity(generated.files.map(file => file.path), "erman-ksv/TezJet", "main");
    if (security.status !== "clean") return { status: "blocked" as const, attempts, security };

    for (const file of generated.files as ChangeFile[]) {
      await adapter.write(file.path, file.content, file.message, input.branch);
    }
    attempts.push({ attempt, files: generated.files.map(file => file.path) });
  }

  return { status: "max-attempts" as const, attempts };
}
