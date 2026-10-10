import { TezJetRepositoryAdapter } from "../../github/tezjetRepository.js";
import { scanForSecrets } from "../../github/secretScanner.js";

export type ProposedFile = { path: string; content: string };

// Keep the default scan aligned with files known to exist in the current TezJet
// repository. Missing optional files such as a root .env.example must not create
// a misleading security finding, while real read errors remain fail-closed.
export const DEFAULT_SECURITY_PATHS = [
  "package.json",
  "artifacts/api-server/src/routes/order.ts",
  "artifacts/api-server/src/controllers/orderController.ts",
  "artifacts/api-server/src/controllers/queueController.ts",
  "artifacts/api-server/src/store/memoryStore.ts",
] as const;

export function inspectProposedChanges(files: ProposedFile[]) {
  const findings = files.flatMap((file) => {
    const matches = scanForSecrets(file.content);
    return matches.map((match) => ({
      path: file.path,
      line: match.line,
      pattern: match.pattern,
      message: "Potential secret detected in proposed file content.",
    }));
  });
  return {
    agent: "security" as const,
    status: findings.length ? "findings" as const : "clean" as const,
    findings,
  };
}

export async function inspectSecurity(
  paths: string[] = [...DEFAULT_SECURITY_PATHS],
  repository = process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet",
  ref = "main",
) {
  const adapter = new TezJetRepositoryAdapter(repository);
  const findings: Array<{ path: string; findings: string[] }> = [];
  for (const path of paths) {
    try {
      const file = await adapter.read(path, ref);
      const matches = scanForSecrets(file.content);
      if (matches.length) findings.push({ path, findings: matches.map((match) => `${match.pattern} at line ${match.line}`) });
    } catch (error) {
      // An inaccessible file is not evidence that the repository is clean.
      findings.push({ path, findings: ["Could not inspect file: " + String(error)] });
    }
  }
  return { agent: "security", repository, ref, status: findings.length ? "findings" : "clean", findings };
}

export function runSecurityAgent(input: string) {
  return { agent: "security", input, action: "scan repository for security risks" };
}
