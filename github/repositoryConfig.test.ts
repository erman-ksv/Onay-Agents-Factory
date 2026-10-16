import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TARGET_REPOSITORY, getTargetRepository } from "./repositoryConfig.js";

test("uses the Onay application repository after GitHub rename", () => {
  assert.equal(getTargetRepository({}), DEFAULT_TARGET_REPOSITORY);
});

test("trims the legacy configured repository before using it", () => {
  assert.equal(getTargetRepository({ TEZJET_REPOSITORY: " erman-ksv/custom-repo " }), "erman-ksv/custom-repo");
});

test("falls back to the default repository for an empty configured value", () => {
  assert.equal(getTargetRepository({ TEZJET_REPOSITORY: "   " }), DEFAULT_TARGET_REPOSITORY);
});

test("new Onay setting takes precedence over the legacy app setting", () => {
  assert.equal(getTargetRepository({ ONAY_REPOSITORY: " erman-ksv/Onay ", TEZJET_REPOSITORY: "erman-ksv/TezJet" }), "erman-ksv/Onay");
});

test("blank Onay setting falls back to legacy app setting", () => {
  assert.equal(getTargetRepository({ ONAY_REPOSITORY: "  ", TEZJET_REPOSITORY: "erman-ksv/TezJet" }), "erman-ksv/TezJet");
});
