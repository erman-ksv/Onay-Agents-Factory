/**
 * Explicit live provider run; never imported by test discovery.
 * Sends only synthetic text. No GitHub token or write permissions required.
 */
import { Agent, Runner } from "@openai/agents";
import { ROLE_SKILLS } from "../commander/skills.js";
import { configureModelProvider } from "../commander/modelProvider.js";
import { runQualification, QualificationFailure, safeFailureMetadata, qualificationEnvironment, createQualificationPacer, withQualificationDeadline, qualificationModelSettings, QUALIFICATION_CASES, buildQualificationPrompt, parseAssessment, evaluateAssessment, type QualificationCase } from "./specialistQualification.js";

async function main() {
  const env = qualificationEnvironment(process.env);
  const provider = configureModelProvider(env);
  if (provider.provider === "none") throw new Error("Selected provider is unavailable.");
  console.log("PROVIDER:", provider.provider, "MODEL:", provider.model);
  const runner = new Runner({ modelProvider: provider.modelProvider });
  // Passing a provider model object avoids SDK legacy OpenAI-name cleanup.
  const specialistModel = provider.model ? await provider.modelProvider.getModel(provider.model) : undefined;
  const probe = env.QUALIFICATION_PROBE;
  if (probe && probe !== "backend-b") throw new Error("Only backend-b is supported as a latency probe.");
  console.log(probe ? "LATENCY PROBE ONLY: backend-b; not full qualification." :
    "SYNTHETIC ROLE QUALIFICATION: 16 cases; 8 advisory profiles; no application source or GitHub writes.");
  const modelSettings = qualificationModelSettings(provider.provider, provider.model);
  console.log("QUALIFICATION MODEL SETTINGS:", JSON.stringify(modelSettings));
  const pace = createQualificationPacer(provider.provider === "openrouter" ? 60_000 : 0, undefined,
    ms => console.log("WAIT:", ms / 1000, "seconds before next case; no request retry."));
  const assess = async (fixture: QualificationCase, prompt: string) => {
    await pace();
    console.log("START:", fixture.id, fixture.role);
    const agent = new Agent({
      name: "Onay " + fixture.role + " Specialist",
      instructions: ROLE_SKILLS[fixture.role],
      modelSettings,
      ...(specialistModel ? { model: specialistModel } : {}),
    });
    const started = performance.now();
    const response = await withQualificationDeadline(
      signal => runner.run(agent, prompt, { maxTurns: 1, signal }),
      { onProgress: seconds => console.log("WAITING:", fixture.id, seconds, "seconds; deadline 120 seconds.") },
    );
    console.log("RESPONSE_SECONDS:", fixture.id, Math.round((performance.now() - started) / 1000));
    return response.finalOutput;
  };
  const print = (value: unknown) => {
    // Preserve findings for human review; redact configured credentials before printing.
    let output = JSON.stringify(value) ?? "null";
    for (const secret of [env.GEMINI_API_KEY, process.env.GITHUB_TOKEN, process.env.OPENAI_API_KEY, process.env.OPENROUTER_API_KEY]) {
      if (secret?.trim()) output = output.split(secret.trim()).join("[REDACTED]");
    }
    console.log(output);
  };
  if (probe) {
    const fixture = QUALIFICATION_CASES.find(c => c.id === probe)!;
    let raw: unknown;
    try { raw = await assess(fixture, buildQualificationPrompt(fixture)); }
    catch (error) { throw new QualificationFailure(fixture.id, "provider", safeFailureMetadata(error)); }
    let assessment;
    try { assessment = parseAssessment(raw); }
    catch { throw new QualificationFailure(fixture.id, "assessment", {kind: "invalid-assessment"}); }
    const outcome = evaluateAssessment(fixture, assessment);
    print({probe: fixture.id, ...outcome, assessment});
    console.log("PROBE ONLY — full qualification not performed.");
    process.exitCode = outcome.passed ? 0 : 1;
    return;
  }
  const result = await runQualification(assess, print);
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
