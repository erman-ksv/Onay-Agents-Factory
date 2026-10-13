import test from "node:test";
import assert from "node:assert/strict";
import { selectProviderConfig } from "./providerConfig.js";

test("prefers Gemini when both provider keys are configured", () => {
  assert.deepEqual(
    selectProviderConfig({
      GEMINI_API_KEY: " gemini-secret ",
      GEMINI_MODEL: " gemini-test-model ",
      OPENAI_API_KEY: "openai-secret"
    }),
    {
      provider: "gemini",
      apiKey: "gemini-secret",
      model: "gemini-test-model",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
    }
  );
});

test("uses the default Gemini model when no model is specified", () => {
  const config = selectProviderConfig({ GEMINI_API_KEY: "gemini-secret" });
  assert.equal(config.provider, "gemini");
  if (config.provider !== "gemini") return;
  assert.equal(config.model, "gemini-3.8-flash");
});

test("falls back to OpenAI when Gemini is not configured", () => {
  assert.deepEqual(selectProviderConfig({ OPENAI_API_KEY: " openai-secret " }), {
    provider: "openai",
    apiKey: "openai-secret"
  });
});

test("returns none when no usable provider key is configured", () => {
  assert.deepEqual(selectProviderConfig({
    GEMINI_API_KEY: "  ",
    OPENAI_API_KEY: ""
  }), { provider: "none" });
});

test("explicit OpenAI selection overrides a configured Gemini key and trims its model", () => {
  assert.deepEqual(selectProviderConfig({
    AGENT_FACTORY_PROVIDER: " openai ", GEMINI_API_KEY: "gemini-secret",
    OPENAI_API_KEY: " openai-secret ", OPENAI_MODEL: " host-selected-model ",
  }), { provider: "openai", apiKey: "openai-secret", model: "host-selected-model" });
});

test("explicit Gemini selection uses Gemini even when OpenAI is configured", () => {
  const config = selectProviderConfig({
    AGENT_FACTORY_PROVIDER: "gemini", GEMINI_API_KEY: "gemini-secret", OPENAI_API_KEY: "openai-secret",
    OPENAI_MODEL: "openai-only-model", GEMINI_MODEL: "gemini-only-model",
  });
  assert.equal(config.provider, "gemini");
  if (config.provider === "gemini") assert.equal(config.model, "gemini-only-model");
});

test("an explicit provider never falls back to another provider's configured key", () => {
  assert.deepEqual(selectProviderConfig({ AGENT_FACTORY_PROVIDER: "openai", GEMINI_API_KEY: "gemini-secret" }), { provider: "none" });
  assert.deepEqual(selectProviderConfig({ AGENT_FACTORY_PROVIDER: "gemini", OPENAI_API_KEY: "openai-secret" }), { provider: "none" });
  assert.deepEqual(selectProviderConfig({ AGENT_FACTORY_PROVIDER: "openai", OPENAI_API_KEY: "  ", GEMINI_API_KEY: "gemini-secret" }), { provider: "none" });
});

test("blank selection retains legacy behavior and blank OpenAI model retains the SDK default", () => {
  assert.equal(selectProviderConfig({ AGENT_FACTORY_PROVIDER: " ", GEMINI_API_KEY: "gemini-secret", OPENAI_API_KEY: "openai-secret" }).provider, "gemini");
  assert.deepEqual(selectProviderConfig({ AGENT_FACTORY_PROVIDER: "openai", OPENAI_API_KEY: "openai-secret", OPENAI_MODEL: "  " }), { provider: "openai", apiKey: "openai-secret" });
});

test("invalid provider selection is rejected without echoing the supplied value", () => {
  assert.throws(() => selectProviderConfig({ AGENT_FACTORY_PROVIDER: "invalid-secret-value", OPENAI_API_KEY: "openai-secret" }), {
    message: "AGENT_FACTORY_PROVIDER must be gemini or openai.",
  });
});

