/**
 * Explicit live Gemini run; never imported by test discovery.
 * Sends only synthetic text. No GitHub token or write permissions required.
 */
import { Agent, Runner } from "@openai/agents";
import { ROLE_SKILLS } from "../commander/skills.js";
import { configureModelProvider } from "../commander/modelProvider.js";
import { runQualification } from "./specialistQualification.js";

async function main() {
  const env = { ...process.env, AGENT_FACTORY_PROVIDER: "gemini" };
  if (!env.GEMINI_API_KEY?.trim()) throw new Error("GEMINI_API_KEY missing.");
  const provider = configureModelProvider(env);
  if (provider.provider !== "gemini") throw new Error("Gemini provider required.");
  const runner = new Runner({ modelProvider: provider.modelProvider });
  console.log("SYNTHETIC ROLE QUALIFICATION: 16 cases; 8 advisory profiles; no application source or GitHub writes.");
  const result = await runQualification(async (fixture, prompt) => {
    console.log("START:", fixture.id, fixture.role);
    const agent = new Agent({
      name: "Onay " + fixture.role + " Specialist",
      instructions: ROLE_SKILLS[fixture.role],
      ...(provider.model ? { model: provider.model } : {}),
    });
    const response = await runner.run(agent, prompt, { maxTurns: 1 });
    return response.finalOutput;
  }, row => {
    // Preserve findings for human review; redact configured credentials before printing.
    let output = JSON.stringify(row);
    for (const secret of [env.GEMINI_API_KEY, process.env.GITHUB_TOKEN, process.env.OPENAI_API_KEY, process.env.OPENROUTER_API_KEY]) {
      if (secret?.trim()) output = output.split(secret.trim()).join("[REDACTED]");
    }
    console.log(output);
  });
  console.log("CASES PASSED:", result.results.filter(r => r.passed).length + "/16");
  console.log("QUALIFICATION:", result.passed ? "PASSED — LIMITED SYNTHETIC ROLE CHECK" : "FAILED — HUMAN REVIEW REQUIRED");
  console.log("This is not production readiness, a legal approval, or a full security audit.");
  process.exitCode = result.passed ? 0 : 1;
}

main().catch(() => {
  // Do not echo provider errors: upstream bodies may contain sensitive data.
  console.error("QUALIFICATION: BLOCKED — provider, configuration or assessment format error. No qualification established.");
  process.exitCode = 1;
});
