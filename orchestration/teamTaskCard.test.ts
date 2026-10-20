import assert from "node:assert/strict";
import test from "node:test";
import { prepareTeamTask, taskGoal, type TeamTaskCard } from "./teamTaskCard.js";
import { ONAY_MOBILE_REQUIRED_CI } from "../commander/onayMobileScope.js";

function card(): TeamTaskCard {
  return {
    version: 1, id: "passenger-order-state", goal: "Исправить отображение состояния заказа пассажира.",
    acceptanceCriteria: ["Показывать состояние заказа без потери текущей поездки."],
    profile: "mobile", provider: "cloudflare", baseRef: "feat/mobile-base", baseSha: "a".repeat(40),
    changePaths: ["mobile/tezjet-app/lib/orders.ts"],
    contextPaths: ["mobile/tezjet-app/test/orders.test.mjs", "mobile/tezjet-app/package.json"],
  };
}

test("a Russian mobile goal assigns the complete host-owned specialist team and exact CI", () => {
  const prepared = prepareTeamTask(card());
  assert.equal(prepared.repository, "erman-ksv/Onay");
  assert.equal(prepared.branch, "feat/onay-agent/passenger-order-state");
  assert.deepEqual(prepared.advisoryActors, ["product", "ux", "frontend", "backend", "dispatch"]);
  assert.deepEqual(prepared.requiredActors, ["explorer", "coder", "product", "ux", "frontend", "backend", "dispatch", "security", "reviewer", "tester"]);
  assert.ok(!prepared.requiredActors.includes("legal"));
  assert.deepEqual(prepared.requiredCiNames, [...ONAY_MOBILE_REQUIRED_CI.names]);
  assert.deepEqual(prepared.requiredCiSteps, [...ONAY_MOBILE_REQUIRED_CI.steps]);
  assert.deepEqual(prepared.explorerPaths, ["package.json", ...prepared.contextPaths, ...prepared.changePaths]);
  assert.match(prepared.fingerprint, /^[a-f0-9]{64}$/);
  const goal = taskGoal(prepared);
  assert.ok(goal.includes(prepared.goal));
  assert.ok(prepared.acceptanceCriteria.every(item => goal.includes(item)));
  assert.match(goal, /Do not merge, deploy, install skills/);
  assert.match(goal, /invoke a legal agent/);
});

test("backend specialists and API test requirements are independent of language keywords", () => {
  const input = card();
  input.profile = "backend";
  input.goal = "Исправить обработку отмены заказа в очереди.";
  input.changePaths = ["artifacts/api-server/src/controllers/orderController.ts"];
  input.contextPaths = ["artifacts/api-server/test/orders.test.mjs"];
  const prepared = prepareTeamTask(input);
  assert.deepEqual(prepared.advisoryActors, ["product", "backend", "database", "dispatch"]);
  assert.deepEqual(prepared.requiredCiNames, ["Typecheck and API tests"]);
  assert.deepEqual(prepared.requiredCiSteps, ["Typecheck", "API integration tests"]);
  assert.ok(prepared.requiredActors.includes("security") && prepared.requiredActors.includes("tester"));
  assert.ok(!prepared.requiredActors.includes("legal"));
});

test("normalization pins the full SHA and copies mutable owner inputs", () => {
  const input = card();
  input.baseSha = "A".repeat(40);
  const prepared = prepareTeamTask(input);
  assert.equal(prepared.baseSha, "a".repeat(40));
  assert.equal(prepared.fingerprint, prepareTeamTask({ ...input, baseSha: "a".repeat(40) }).fingerprint);
  const originalPath = prepared.changePaths[0];
  input.changePaths[0] = "mobile/tezjet-app/lib/other.ts";
  input.acceptanceCriteria[0] = "Another acceptance criterion.";
  assert.equal(prepared.changePaths[0], originalPath);
  assert.notEqual(prepared.acceptanceCriteria[0], input.acceptanceCriteria[0]);
  assert.notEqual(prepared.fingerprint, prepareTeamTask(input).fingerprint);
});

test("unknown fields cannot select repositories, bypass actors or redefine CI", () => {
  for (const field of ["repository", "requiredActors", "requiredCiNames", "allowWorkflowChanges", "legalEnabled"]) {
    assert.throws(() => prepareTeamTask({ ...card(), [field]: "override" }), /Invalid bounded Onay task card/);
  }
});

test("scope rejects workflow, auth configuration, traversal, cross-profile and duplicate paths", () => {
  const forbidden = [
    ".github/workflows/ci.yml", "package.json", "mobile/tezjet-app/package.json", ".env",
    "mobile/tezjet-app/lib/../orders.ts", "mobile/tezjet-app/lib//orders.ts",
    "mobile/tezjet-app/lib/./orders.ts", "mobile\\tezjet-app\\lib\\orders.ts",
    "artifacts/api-server/src/controllers/orderController.ts", "mobile/tezjet-app/lib/.hidden.ts",
  ];
  for (const path of forbidden) assert.throws(() => prepareTeamTask({ ...card(), changePaths: [path] }), /Invalid bounded/);
  const path = card().changePaths[0];
  assert.throws(() => prepareTeamTask({ ...card(), changePaths: [path, path] }), /Invalid bounded/);
  assert.throws(() => prepareTeamTask({ ...card(), contextPaths: [path, path] }), /Invalid bounded/);
  assert.throws(() => prepareTeamTask({ ...card(), contextPaths: ["commander/aiCommander.ts"] }), /Invalid bounded/);
});

test("ref expressions, abbreviated SHA, unsupported providers and unsafe task identifiers are rejected", () => {
  for (const baseRef of ["refs/heads/main", "main~1", "feature/../main", "-unsafe", "main:other"]) {
    assert.throws(() => prepareTeamTask({ ...card(), baseRef }), /Invalid bounded/);
  }
  for (const baseSha of ["abc1234", "main", "g".repeat(40), "a".repeat(41)]) {
    assert.throws(() => prepareTeamTask({ ...card(), baseSha }), /Invalid bounded/);
  }
  for (const id of ["../task", "A-task", "task_name", "x".repeat(49)]) {
    assert.throws(() => prepareTeamTask({ ...card(), id }), /Invalid bounded/);
  }
  assert.throws(() => prepareTeamTask({ ...card(), provider: "openai" }), /Invalid bounded/);
  assert.throws(() => prepareTeamTask({ ...card(), baseRef: "feat/onay-agent/" + card().id }), /Invalid bounded/);
});

test("card rejects potential secrets and oversized expanded goals without silently dropping criteria", () => {
  const marker = "ghp_" + "x".repeat(24);
  assert.throws(() => prepareTeamTask({ ...card(), goal: "Do not expose this fixture " + marker }), error =>
    error instanceof Error && !error.message.includes(marker) && /Invalid bounded/.test(error.message));
  assert.throws(() => prepareTeamTask({ ...card(), goal: "Onay-Agents-Factory internals are out of scope" }), /Invalid bounded/);
  const criteria = Array.from({ length: 6 }, (_, index) => "Criterion " + index + ": " + "x".repeat(220));
  assert.throws(() => prepareTeamTask({ ...card(), acceptanceCriteria: criteria }), /Invalid bounded/);
  assert.throws(() => prepareTeamTask({ ...card(), goal: "x".repeat(1200) }), /Invalid bounded/);
});
