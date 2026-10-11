import test from "node:test";
import assert from "node:assert/strict";
import { selectProviderConfig } from "../commander/providerConfig.js";

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
  assert.equal(config.model, "gemini-2.5-flash");
});

test("falls back to OpenAI when Gemini is not configured", () => {
  assert.deepEqual(selectProviderConfig({ OPENAI_API_KEY: "openai-secret" }), {
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
