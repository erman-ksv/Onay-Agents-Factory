import assert from "node:assert/strict";
import test from "node:test";
import { assertRepositoryAllowed, assertWritableBranch, resolveAllowedRepositories } from "./repositoryPolicy.js";

test("an unset allow-list defaults only to the configured target, not an arbitrary requested repository", () => {
  const allowed = resolveAllowedRepositories(undefined, "erman-ksv/TezJet");
  assert.deepEqual(allowed, ["erman-ksv/TezJet"]);
  assert.doesNotThrow(() => assertRepositoryAllowed("erman-ksv/TezJet", allowed));
  assert.throws(
    () => assertRepositoryAllowed("erman-ksv/Onay-Agents-Factory", allowed),
    /not allow-listed/,
  );
});

test("an explicit allow-list permits only listed repositories and trims duplicates", () => {
  const allowed = resolveAllowedRepositories(
    " erman-ksv/TezJet, erman-ksv/Onay-Agents-Factory,erman-ksv/TezJet ",
    "erman-ksv/TezJet",
  );
  assert.deepEqual(allowed, ["erman-ksv/TezJet", "erman-ksv/Onay-Agents-Factory"]);
  assert.doesNotThrow(() => assertRepositoryAllowed("erman-ksv/Onay-Agents-Factory", allowed));
  assert.throws(() => assertRepositoryAllowed("someone/else", allowed), /not allow-listed/);
});

test("protected branches remain blocked", () => {
  assert.throws(() => assertWritableBranch("main"), /protected branch/);
  assert.throws(() => assertWritableBranch("master"), /protected branch/);
  assert.doesNotThrow(() => assertWritableBranch("fix/allow-list"));
});
