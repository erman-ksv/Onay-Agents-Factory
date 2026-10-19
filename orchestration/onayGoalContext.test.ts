import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createGoalPlanningPacket, GOAL_PLANNING_CONTEXT_LIMITS, type GoalPlanningSourceFile } from "./onayGoalContext.js";
import { prepareGoalRequest, type GoalInventoryFile } from "./onayGoalPlan.js";

const PATH = "mobile/tezjet-app/lib/orders.ts";
function request(goal = "Fix passenger order state after reconnect without losing the current trip.") {
  return prepareGoalRequest({ version: 1, id: "passenger-lifecycle-goal", goal,
    baseRef: "feat/current-app", baseSha: "a".repeat(40), provider: "cloudflare" });
}
function source(content: string, path = PATH): GoalPlanningSourceFile {
  const data = Buffer.from(content);
  const sha = createHash("sha1").update(Buffer.concat([Buffer.from("blob " + data.length + "\0"), data])).digest("hex");
  return { path, sha, content };
}
function inventory(files: GoalPlanningSourceFile[]): GoalInventoryFile[] {
  return [{ path: "package.json", sha: "b".repeat(40), bytes: 100 },
    ...files.map(file => ({ path: file.path, sha: file.sha, bytes: Buffer.byteLength(file.content) }))];
}
function privateSource() {
  return "PRIVATE_PREFIX_NEVER_SEND\n" + "// unrelated padding\n".repeat(80) +
    "export function passengerOrderState(order: unknown) { return reconnectCurrentTrip(order); }\n" +
    "// unrelated padding\n".repeat(80) + "PRIVATE_SUFFIX_NEVER_SEND";
}

test("large private source becomes a relevant partial excerpt with immutable provenance", () => {
  const file = source(privateSource());
  const goal = request();
  const result = createGoalPlanningPacket(goal, inventory([file]), [file]);
  const packet = JSON.parse(result.prompt);
  const shown = packet.sources[0];
  assert.deepEqual(result.evidencePaths, [PATH]);
  assert.equal(result.prompt.includes(file.content), false);
  assert.equal(result.prompt.includes("PRIVATE_PREFIX_NEVER_SEND"), false);
  assert.equal(result.prompt.includes("PRIVATE_SUFFIX_NEVER_SEND"), false);
  assert.match(shown.text, /passengerOrderState/);
  assert.ok(shown.text.length <= GOAL_PLANNING_CONTEXT_LIMITS.maxExcerptCharacters);
  assert.equal(shown.wholeFileShown, false);
  assert.equal(shown.gitBlobSha, file.sha);
  assert.equal(shown.contentSha256, createHash("sha256").update(file.content).digest("hex"));
  assert.equal(shown.baseCommitSha, goal.baseSha);
  assert.equal(shown.url, "https://github.com/erman-ksv/Onay/blob/" + goal.baseSha + "/" + PATH);
  assert.equal(shown.text, file.content.slice(shown.startCharacter, shown.endCharacterExclusive));
  assert.equal(shown.unshownCharacterRanges.length, 2);
});

test("bounded tiny files can be shown whole with explicit coverage", () => {
  const file = source("export const orderState = 'searching';\n");
  const result = createGoalPlanningPacket(request(), inventory([file]), [file]);
  const shown = JSON.parse(result.prompt).sources[0];
  assert.equal(shown.kind, "complete-small-file");
  assert.equal(shown.text, file.content);
  assert.equal(shown.wholeFileShown, true);
  assert.deepEqual(shown.unshownCharacterRanges, []);
});

test("500-character files and UTF-8-large shorter strings are never sent whole", () => {
  for (const content of ["a".repeat(500), "界".repeat(250), "😀".repeat(180)]) {
    const file = source(content);
    const shown = JSON.parse(createGoalPlanningPacket(request(), inventory([file]), [file]).prompt).sources[0];
    assert.equal(shown.wholeFileShown, false);
    assert.notEqual(shown.text, content);
    assert.equal(shown.kind, "excerpt");
    assert.ok(shown.unshownCharacterRanges.length > 0);
    assert.equal(shown.text, content.slice(shown.startCharacter, shown.endCharacterExclusive));
  }
});

test("forged source, plain-content SHA and metadata size mismatch fail closed", () => {
  const file = source(privateSource());
  for (const changed of [{ ...file, content: file.content + "private edit" },
    { ...file, sha: createHash("sha1").update(file.content).digest("hex") }]) {
    assert.throws(() => createGoalPlanningPacket(request(), inventory([file]), [changed]), /invalid provenance/);
  }
  const wrong = inventory([file]); wrong[1].bytes!++;
  assert.throws(() => createGoalPlanningPacket(request(), wrong, [file]), /invalid provenance/);
});

test("different repository, altered owner fingerprint and unknown source fields are rejected", () => {
  const file = source(privateSource());
  assert.throws(() => createGoalPlanningPacket({ ...request(), repository: "other/repo" } as never, inventory([file]), [file]), /invalid provenance/);
  assert.throws(() => createGoalPlanningPacket({ ...request(), fingerprint: "c".repeat(64) }, inventory([file]), [file]), /invalid provenance/);
  assert.throws(() => createGoalPlanningPacket(request(), inventory([file]), [{ ...file, privateExtra: file.content } as never]), /invalid provenance/);
});

test("unknown files, workflow scope and repeated source claims cannot become evidence", () => {
  const file = source(privateSource());
  const other = source(file.content, "mobile/tezjet-app/lib/unknown.ts");
  assert.throws(() => createGoalPlanningPacket(request(), inventory([file]), [other]), /invalid provenance/);
  assert.throws(() => createGoalPlanningPacket(request(), inventory([file]), [file, file]), /invalid provenance/);
  const forbidden = source(file.content, ".github/workflows/ci.yml");
  assert.throws(() => createGoalPlanningPacket(request(), inventory([forbidden]), [forbidden]), /Invalid bounded host Onay inventory/);
});

test("a secret in an unshown region blocks the whole packet without echo", () => {
  for (const secret of ["ghp_" + "x".repeat(24), "Bearer " + "private-token-value".repeat(2)]) {
    const file = source(privateSource() + "\n" + secret);
    assert.throws(() => createGoalPlanningPacket(request(), inventory([file]), [file]), error => {
      assert.match(String(error), /possible secret/);
      assert.equal(String(error).includes(secret), false);
      assert.equal(String(error).includes("PRIVATE_PREFIX"), false);
      return true;
    });
  }
});

test("host file count and byte limits are enforced before returning any model packet", () => {
  const files = Array.from({ length: 9 }, (_, index) => source("export const x = " + index + ";", "mobile/tezjet-app/lib/a" + index + ".ts"));
  assert.throws(() => createGoalPlanningPacket(request(), inventory(files), files), /invalid provenance/);
  const huge = source("x".repeat(GOAL_PLANNING_CONTEXT_LIMITS.maxHostFileBytes + 1));
  assert.throws(() => createGoalPlanningPacket(request(), inventory([huge]), [huge]), /invalid provenance/);
});

test("inventory truncation is bounded and explicitly marked as filename-only metadata", () => {
  const file = source(privateSource());
  const tree = inventory([file]);
  for (let index = 0; index < 100; index++) tree.push({ path: "mobile/tezjet-app/lib/item" + index + ".ts", sha: "c".repeat(40) });
  const packet = JSON.parse(createGoalPlanningPacket(request(), tree, [file]).prompt);
  assert.ok(packet.inventory.files.length <= GOAL_PLANNING_CONTEXT_LIMITS.maxInventoryEntries);
  assert.ok(Buffer.byteLength(JSON.stringify(packet.inventory.files)) <= GOAL_PLANNING_CONTEXT_LIMITS.maxInventoryBytes);
  assert.equal(packet.inventory.omittedFiles, tree.length - packet.inventory.files.length);
  assert.ok(packet.inventory.omittedFiles > 0);
  assert.equal(packet.coverage.unreadSourceCount, tree.length - 1);
  assert.match(packet.inventory.sourceEvidence, /Metadata only/);
  assert.match(packet.coverage.unshownInventory, /must not be invented/);
});

test("empty/whitespace files and inventory-only planning never fabricate excerpt evidence", () => {
  for (const content of ["", "  \n  \n"]) {
    const file = source(content);
    const result = createGoalPlanningPacket(request(), inventory([file]), [file]);
    const packet = JSON.parse(result.prompt);
    assert.deepEqual(result.evidencePaths, []);
    assert.deepEqual(packet.sources, []);
    assert.deepEqual(packet.coverage.filesWithoutFragments, [PATH]);
    assert.deepEqual(packet.coverage.hostReadPaths, [PATH]);
  }
  const result = createGoalPlanningPacket(request(), inventory([]), []);
  assert.deepEqual(result.evidencePaths, []);
  assert.match(result.prompt, /unverified/);
});

test("owner goal is preserved verbatim and has no additional artifact-facing code fields", () => {
  const file = source(privateSource());
  const goal = request("Make the passenger journey reliable. ".repeat(50).trim());
  const result = createGoalPlanningPacket(goal, inventory([file]), [file]);
  assert.equal(JSON.parse(result.prompt).ownerGoal, goal.goal);
  assert.deepEqual(Object.keys(result).sort(), ["evidencePaths", "prompt"]);
  assert.ok(Buffer.byteLength(result.prompt) <= GOAL_PLANNING_CONTEXT_LIMITS.maxPromptBytes);
});

test("UTF-8 total byte overflow fails safely instead of truncating the owner goal", () => {
  const file = source(privateSource());
  const goal = request("界".repeat(6000));
  assert.throws(() => createGoalPlanningPacket(goal, inventory([file]), [file]), error => {
    assert.match(String(error), /exceeds its fixed byte budget/);
    assert.equal(String(error).includes(goal.goal), false);
    assert.equal(String(error).includes(file.content), false);
    return true;
  });
});
