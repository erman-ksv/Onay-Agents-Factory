import assert from "node:assert/strict";
import test from "node:test";
import {
  applyUiEdits, assertPrivateSourceConsent, PRIVATE_SOURCE_CONSENT,
  validateScopedPlan, ONAY_HELPER_PATH, ONAY_TEST_PATH,
} from "./onayRegistrationPatch.js";

test("private source requires explicit opt-in and rejects accidental flags", () => {
  for (const consent of [undefined, "", "yes", "true", "approved", "I_APPROVE"]) {
    assert.throws(() => assertPrivateSourceConsent(consent), /explicit consent/i);
  }
  assert.doesNotThrow(() => assertPrivateSourceConsent(PRIVATE_SOURCE_CONSENT));
});

test("UI edits must have a unique literal anchor and limited change size", () => {
  const input = 'const name = "";\nconst otp = "";';
  assert.equal(applyUiEdits(input, [{find: 'const name = "";', replace: 'const name = "new";'}]),
    'const name = "new";\nconst otp = "";');
  assert.throws(() => applyUiEdits("name name", [{find:"name",replace:"surname"}]), /ambiguous/i);
  assert.throws(() => applyUiEdits(input, [{find:"missing",replace:"ok"}]), /missing/i);
  assert.throws(() => applyUiEdits(input, [{find:"",replace:"yes"}]), /invalid/i);
  assert.throws(() => applyUiEdits(input, [{find:"otp",replace:"otp"}]), /invalid/i);
  assert.throws(() => applyUiEdits(input, [{find:"otp",replace:"x".repeat(2601)}]), /invalid/i);
  assert.throws(() => applyUiEdits(input, []), /1-12/);
});

test("only the registration helper and its test file can be added", () => {
  const good = { edits: [{find:"x",replace:"y"}], newFiles: [
    {path:ONAY_HELPER_PATH,content:"export function registrationFullName() { return 120; }",message:"helper"},
    {path:ONAY_TEST_PATH,content:"test('registrationFullName')",message:"tests"},
  ]};
  assert.doesNotThrow(() => validateScopedPlan(good));
  assert.throws(() => validateScopedPlan({...good,newFiles: [...good.newFiles,{path:".env",content:"x",message:"x"}]}), /exactly/);
  assert.throws(() => validateScopedPlan({...good,newFiles:[good.newFiles[0],{...good.newFiles[1],path:"package.json"}]}), /unauthorized/);
});
