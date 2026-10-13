import assert from "node:assert/strict";
import test from "node:test";
import { GEMINI_TRANSIENT_MAX_RETRIES, configureModelProvider } from "./modelProvider.js";

test("Gemini provider configures bounded HTTP retries", () => {
  assert.equal(GEMINI_TRANSIENT_MAX_RETRIES, 4);
  const result = configureModelProvider({
    AGENT_FACTORY_PROVIDER: "gemini",
    GEMINI_API_KEY: "test-key-not-real",
    GEMINI_MODEL: "gemini-3.5-flash",
  });
  assert.equal(result.provider, "gemini");
  assert.equal(result.model, "gemini-3.5-flash");
});

test("OpenAI provider selection remains independent", () => {
  const result = configureModelProvider({
    AGENT_FACTORY_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key-not-real",
    OPENAI_MODEL: "test-model",
  });
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "test-model");
});
