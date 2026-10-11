import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TARGET_REPOSITORY, getTargetRepository } from "./repositoryConfig.js";

test("uses the default TezJet repository when no target is configured", () => {
  assert.equal(getTargetRepository({}), DEFAULT_TARGET_REPOSITORY);
});

test("trims the configured repository before using it", () => {
  assert.equal(getTargetRepository({ TEZJET_REPOSITORY: " erman-ksv/custom-repo " }), "erman-ksv/custom-repo");
});

test("falls back to the default repository for an empty configured value", () => {
  assert.equal(getTargetRepository({ TEZJET_REPOSITORY: "   " }), DEFAULT_TARGET_REPOSITORY);
});
