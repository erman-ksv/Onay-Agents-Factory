import assert from "node:assert/strict";
import test from "node:test";
import { assertOnayMobileExplorerFiles, ONAY_MOBILE_ORDER_CONTEXT, ONAY_MOBILE_ORDER_CHANGES,
  ONAY_MOBILE_REQUIRED_CI } from "./onayMobileScope.js";
import { createAiCommander } from "./aiCommander.js";
import { GitHubClient } from "../github/githubClient.js";

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

test("actual mobile Commander Explorer reads only pinned approved files and fails closed on skipped APK", async t => {
  const sha = "a".repeat(40);
  const seen: string[] = [];
  const env = { AGENT_ALLOWED_REPOSITORIES: "erman-ksv/Onay",
    AGENT_FACTORY_LEGAL_ENABLED: "false", AGENT_FACTORY_ENABLE_GITHUB_WRITES: "false" };
  t.mock.method(GitHubClient.prototype, "getCommitSha", async () => sha);
  t.mock.method(GitHubClient.prototype, "getFile", async (path: string, ref: string) => {
    assert.equal(ref, sha);
    seen.push(path);
    return { path, sha: "b".repeat(40), content: path.endsWith("package.json")
      ? '{"scripts":{"test":"node --test"}}' : "export const unchanged = true;" };
  });
  const ciSteps = ONAY_MOBILE_REQUIRED_CI.steps.map(name => ({
    name, status: "completed", conclusion: name === "Assemble Android debug APK" ? "skipped" : "success",
  }));
  t.mock.method(GitHubClient.prototype, "getWorkflowRuns", async () => [{
    id: 11, run_attempt: 1, name: "TezJet Mobile CI",
    status: "completed", conclusion: "success", head_sha: sha,
    html_url: "https://github.com/erman-ksv/Onay/actions/runs/11",
  }]);
  t.mock.method(GitHubClient.prototype, "getWorkflowJobs", async () => ({ jobs: [{
    id: 12, run_id: 11, run_attempt: 1, head_sha: sha,
    name: "verify-mobile", status: "completed", conclusion: "success", steps: ciSteps,
  }] }));
  const { session } = createAiCommander("Audit Onay mobile order status labels", {
    env, baseRef: "feat/onay-configured-passenger-order-20261019",
    expectedBaseSha: sha, explorerPaths: ONAY_MOBILE_ORDER_CONTEXT,
    allowedChangePaths: ONAY_MOBILE_ORDER_CHANGES,
  });
  await session.explore();
  assert.deepEqual(seen, [...ONAY_MOBILE_ORDER_CONTEXT]);
  const result = await session.test();
  assert.equal(result.testsExecuted, false, "A skipped APK must never count as mobile CI success.");
  assert.equal(result.executionEvidence?.status, "failed");
});
