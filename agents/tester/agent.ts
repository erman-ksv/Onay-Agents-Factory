import { TezJetRepositoryAdapter } from "../../github/tezjetRepository.js";

export type TestScriptDiscovery = {
  scripts: string[];
  validJson: boolean;
};

export function discoverTestScripts(packageJsonContent: string): TestScriptDiscovery {
  try {
    const pkg = JSON.parse(packageJsonContent) as { scripts?: Record<string, unknown> };
    const scripts = Object.entries(pkg.scripts ?? {})
      .filter(([name, command]) => /test|check|lint|type/i.test(name) && typeof command === "string")
      .map(([name, command]) => name + ": " + command);
    return { scripts, validJson: true };
  } catch {
    return { scripts: [], validJson: false };
  }
}

export async function inspectTests(repository = process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet", ref = "main") {
  const adapter = new TezJetRepositoryAdapter(repository);
  const packageJson = await adapter.read("package.json", ref);
  const discovery = discoverTestScripts(packageJson.content);
  if (!discovery.validJson) {
    return { repository, ref, scripts: discovery.scripts, notes: ["package.json is not valid JSON"] };
  }
  return {
    repository,
    ref,
    scripts: discovery.scripts,
    notes: ["Planning only: run commands in trusted CI/runner."],
  };
}

export function runTester(input: string) {
  return { agent: "tester", input, action: "inspect test coverage and prepare validation plan" };
}
