/**
 * Explicit live provider run; never imported by test discovery.
 * Sends only synthetic text. No GitHub token or write permissions required.
 */
import { Agent, Runner } from "@openai/agents";
import { ROLE_SKILLS } from "../commander/skills.js";
import { configureModelProvider } from "../commander/modelProvider.js";
import { runQualification, QualificationFailure, safeFailureMetadata, qualificationEnvironment, createQualificationPacer, withQualificationDeadline } from "./specialistQualification.js";

async function main() {
  const env = qualificationEnvironment(process.env);
  const provider = configureModelProvider(env);
  if (provider.provider === "none") throw new Error("Selected provider is unavailable.");
  console.log("PROVIDER:", provider.provider, "MODEL:", provider.model);
  const runner = new Runner({ modelProvider: provider.modelProvider });
  console.log("SYNTHETIC ROLE QUALIFICATION: 16 cases; 8 advisory profiles; no application source or GitHub writes.");
  const pace = createQualificationPacer(provider.provider === "openrouter" ? 60_000 : 0, undefined,
    ms => console.log("WAIT:", ms / 1000, "seconds before next case; no request retry."));
  const result = await runQualification(async (fixture, prompt) => {
    await pace();
    console.log("START:", fixture.id, fixture.role);
    const agent = new Agent({
      name: "Onay " + fixture.role + " Specialist",
      instructions: ROLE_SKILLS[fixture.role],
      ...(provider.model ? { model: provider.model } : {}),
    });
    const response = await withQualificationDeadline(
      signal => runner.run(agent, prompt, { maxTurns: 1, signal }),
      { onProgress: seconds => console.log("WAITING:", fixture.id, seconds, "seconds; deadline 120 seconds.") },
    );
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

main().catch(error => {
  // Safe metadata only; never echo provider messages, bodies, headers or keys.
  const diagnostic = error instanceof QualificationFailure
    ? { case: error.caseId, stage: error.stage, ...error.detail }
    : { stage: "configuration", ...safeFailureMetadata(error) };
  console.error("QUALIFICATION: BLOCKED", JSON.stringify(diagnostic));
  console.error("No qualification established. Stop and inspect this diagnostic before another run.");
  process.exitCode = 1;
});
