import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TARGET_REPOSITORY, getTargetRepository } from "./repositoryConfig.js";

test("uses Onay as the default application repository", () => {
  assert.equal(getTargetRepository({}), "erman-ksv/Onay");
  assert.equal(DEFAULT_TARGET_REPOSITORY, "erman-ksv/Onay");
});

test("trims the configured Onay repository name", () => {
  assert.equal(getTargetRepository({ ONAY_REPOSITORY: " erman-ksv/custom-onay " }), "erman-ksv/custom-onay");
});

test("blank setting falls back to Onay", () => {
  assert.equal(getTargetRepository({ ONAY_REPOSITORY: "  " }), DEFAULT_TARGET_REPOSITORY);
});
