/**
 * Explicit live provider run; never imported by test discovery.
 * Sends only synthetic text. No GitHub token or write permissions required.
 */
import { legalAgentEnabled } from "../commander/legalPolicy.js";
import { Agent, Runner } from "@openai/agents";
import { buildSpecialistInstructions } from "../commander/skills.js";
import { configureModelProvider } from "../commander/modelProvider.js";
import { runQualification, selectedQualificationCases, QualificationFailure, safeFailureMetadata, qualificationEnvironment, createQualificationPacer, withQualificationDeadline, qualificationModelSettings, buildQualificationPrompt, parseAssessment, evaluateAssessment, type QualificationCase, qualificationProbeCase } from "./specialistQualification.js";

async function main() {
  const env = qualificationEnvironment(process.env);
  const legalEnabled = legalAgentEnabled(env);
  const cases = selectedQualificationCases(env);
  const provider = configureModelProvider(env);
  if (provider.provider === "none") throw new Error("Selected provider is unavailable.");
  console.log("PROVIDER:", provider.provider, "MODEL:", provider.model);
  const runner = new Runner({ modelProvider: provider.modelProvider });
  // Passing a provider model object avoids SDK legacy OpenAI-name cleanup.
  const specialistModel = provider.model ? await provider.modelProvider.getModel(provider.model) : undefined;
  const probeCase = qualificationProbeCase(env.QUALIFICATION_PROBE);
  if (probeCase?.role === "legal" && !legalEnabled) throw new Error("Legal probe is disabled by host configuration.");
  const probe = probeCase?.id;
  console.log("LEGAL REVIEW:", legalEnabled ? "ENABLED" : "DISABLED — not evaluated; no legal approval established.");
  console.log(probe ? "SINGLE CASE PROBE ONLY: " + probe + "; not full qualification." :
    `SYNTHETIC ROLE QUALIFICATION: ${cases.length} cases; ${new Set(cases.map(c => c.role)).size} advisory profiles; no application source or GitHub writes.`);
  const modelSettings = qualificationModelSettings(provider.provider, provider.model);
  console.log("QUALIFICATION MODEL SETTINGS:", JSON.stringify(modelSettings));
  const pace = createQualificationPacer(provider.provider === "openrouter" ? 60_000 : provider.provider === "groq" ? 30_000 : 0, undefined,
    ms => console.log("WAIT:", ms / 1000, "seconds before next case; no request retry."));
  const assess = async (fixture: QualificationCase, prompt: string) => {
    await pace();
    console.log("START:", fixture.id, fixture.role);
    const agent = new Agent({
      name: "Onay " + fixture.role + " Specialist",
      instructions: buildSpecialistInstructions(fixture.role),
      modelSettings,
      ...(specialistModel ? { model: specialistModel } : {}),
    });
    const started = performance.now();
    const response = await withQualificationDeadline(
      signal => runner.run(agent, prompt, { maxTurns: 1, signal }),
      { onProgress: seconds => console.log("WAITING:", fixture.id, seconds, "seconds; deadline 120 seconds.") },
    );
    console.log("RESPONSE_SECONDS:", fixture.id, Math.round((performance.now() - started) / 1000));
    const last = response.rawResponses.at(-1);
    const raw = last?.providerData as {usage?: {completion_tokens_details?: {reasoning_tokens?: number}}} | undefined;
    console.log("USAGE:", JSON.stringify({
      inputTokens: last?.usage.inputTokens ?? null,
      outputTokens: last?.usage.outputTokens ?? null,
      reasoningTokensReported: raw?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
    }));
    return response.finalOutput;
  };
  const print = (value: unknown) => {
    // Preserve findings for human review; redact configured credentials before printing.
    let output = JSON.stringify(value) ?? "null";
    for (const secret of [env.GEMINI_API_KEY, process.env.GITHUB_TOKEN, process.env.OPENAI_API_KEY, process.env.OPENROUTER_API_KEY, env.GROQ_API_KEY]) {
      if (secret?.trim()) output = output.split(secret.trim()).join("[REDACTED]");
    }
    console.log(output);
  };
  if (probe) {
    const fixture = probeCase!;
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
  const result = await runQualification(assess, print, cases);
  console.log("CASES PASSED:", result.results.filter(r => r.passed).length + "/" + cases.length);
  console.log("QUALIFICATION:", result.passed ? (legalEnabled ? "PASSED — LIMITED SYNTHETIC ROLE CHECK" : "PASSED — LIMITED NON-LEGAL ROLE CHECK; LEGAL DISABLED") : "FAILED — HUMAN REVIEW REQUIRED");
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


