import { TezJetRepositoryAdapter } from "../../github/tezjetRepository.js";

export async function inspectTests(repository = process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet", ref = "main") {
  const adapter = new TezJetRepositoryAdapter(repository);
  const packageJson = await adapter.read("package.json", ref);
  const scripts: string[] = [];
  try {
    const pkg = JSON.parse(packageJson.content) as { scripts?: Record<string, string> };
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      if (/test|check|lint|type/i.test(name)) scripts.push(name + ": " + command);
    }
  } catch {
    return { repository, ref, scripts, notes: ["package.json is not valid JSON"] };
  }
  return { repository, ref, scripts, notes: ["Planning only: run commands in trusted CI/runner."] };
}

export function runTester(input: string) {
  return { agent: "tester", input, action: "inspect test coverage and prepare validation plan" };
}