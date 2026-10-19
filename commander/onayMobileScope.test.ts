import assert from "node:assert/strict";
import test from "node:test";
import { assertOnayMobileExplorerFiles, ONAY_MOBILE_ORDER_CONTEXT, ONAY_MOBILE_ORDER_CHANGES,
  ONAY_MOBILE_REQUIRED_CI } from "./onayMobileScope.js";
import { createAiCommander } from "./aiCommander.js";

test("mobile source selection is fixed, duplicate-free and cannot read unrelated source", () => {
  assert.deepEqual(assertOnayMobileExplorerFiles(ONAY_MOBILE_ORDER_CONTEXT), [...ONAY_MOBILE_ORDER_CONTEXT]);
  for (const paths of [[], [...ONAY_MOBILE_ORDER_CONTEXT, ".env"],
    ["package.json", "package.json", ...ONAY_MOBILE_ORDER_CONTEXT.slice(2)],
    [...ONAY_MOBILE_ORDER_CONTEXT.slice(0, 3)], [...ONAY_MOBILE_ORDER_CONTEXT.slice(0, 3), "artifacts/api-server/src/app.ts"]]) {
    assert.throws(() => assertOnayMobileExplorerFiles(paths));
  }
});
test("mobile-task host requires exact write scope and never accepts main or backend source", () => {
  const goal = "Fix Onay mobile order status labels";
  const env = { AGENT_FACTORY_LEGAL_ENABLED: "false", AGENT_FACTORY_ENABLE_GITHUB_WRITES: "false" };
  for (const paths of [undefined, [], ["mobile/tezjet-app/lib/orders.ts"],
    [...ONAY_MOBILE_ORDER_CHANGES, "artifacts/api-server/src/app.ts"]]) {
    assert.throws(() => createAiCommander(goal, { env, explorerPaths: ONAY_MOBILE_ORDER_CONTEXT,
      ...(paths === undefined ? {} : { allowedChangePaths: paths }) }));
  }
});
test("mobile gate requires the actual APK job, not only Typecheck", () => {
  assert.deepEqual(ONAY_MOBILE_REQUIRED_CI.names, ["verify-mobile"]);
  assert.ok(ONAY_MOBILE_REQUIRED_CI.steps.includes("Assemble Android debug APK"));
  assert.ok(ONAY_MOBILE_REQUIRED_CI.steps.includes("Upload Android debug APK"));
});
