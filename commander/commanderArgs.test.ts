import assert from "node:assert/strict";
import test from "node:test";
import { parseCommanderArgs } from "./commanderArgs.js";

function publicationArgs(branch = "feat/queue-fix"): string[] {
  return [
    "Fix queue bug",
    "--publish",
    "--branch", branch,
    "--title", "Fix queue",
    "--body", "Correct the queue handling and verify the result.",
  ];
}

test("Commander preserves legacy quoted and freeform goals", () => {
  assert.deepEqual(parseCommanderArgs(["Fix issue"]), { goal: "Fix issue" });
  assert.deepEqual(parseCommanderArgs(["Fix", "queue", "bug"]), { goal: "Fix queue bug" });
  assert.deepEqual(parseCommanderArgs(["--", "Fix issue"]), { goal: "Fix issue" });
  assert.deepEqual(parseCommanderArgs(["  Fix issue  "]), { goal: "Fix issue" });
});

test("Commander parses explicit publication options in any order alongside the goal", () => {
  assert.deepEqual(parseCommanderArgs(publicationArgs()), {
    goal: "Fix queue bug",
    publication: {
      branch: "feat/queue-fix",
      title: "Fix queue",
      body: "Correct the queue handling and verify the result.",
    },
  });
  assert.deepEqual(parseCommanderArgs([
    "--", "--title", "  Fix queue  ", "Fix", "--body", "  Summary  ",
    "queue", "--branch", " feat/queue-fix ", "--publish", "bug",
  ]), {
    goal: "Fix queue bug",
    publication: { branch: "feat/queue-fix", title: "Fix queue", body: "Summary" },
  });
});

test("a later separator allows literal option names in the goal", () => {
  assert.deepEqual(parseCommanderArgs(["Explain", "--", "--publish", "-h"]), {
    goal: "Explain --publish -h",
  });
  assert.deepEqual(parseCommanderArgs(["--", "--", "--branch"]), { goal: "--branch" });
});

test("Commander requires a nonempty goal and includes usage guidance", () => {
  for (const args of [[], ["--"], [" "], ["--", " "]]) {
    assert.throws(() => parseCommanderArgs(args), /task goal is required.*Usage:/);
  }
  assert.throws(() => parseCommanderArgs(publicationArgs().slice(1)), /task goal is required/);
});

test("Commander rejects unknown flags and duplicate publication arguments", () => {
  for (const flag of ["--publsih", "--goal", "-p"]) {
    assert.throws(() => parseCommanderArgs(["Fix bug", flag]), /Unknown argument/);
  }
  assert.throws(() => parseCommanderArgs([...publicationArgs(), "--publish"]), /Duplicate argument: --publish/);
  for (const flag of ["--branch", "--title", "--body"]) {
    assert.throws(() => parseCommanderArgs([...publicationArgs(), flag, "duplicate"]), /Duplicate argument/);
  }
});

test("publication metadata requires the explicit publish flag", () => {
  for (const flag of ["--branch", "--title", "--body"]) {
    assert.throws(() => parseCommanderArgs(["Fix bug", flag, "value"]), /require --publish/);
  }
});

test("publication requires every metadata field to have a nonempty value", () => {
  for (const flag of ["--branch", "--title", "--body"]) {
    const args = publicationArgs();
    const index = args.indexOf(flag);
    assert.throws(() => parseCommanderArgs(["Fix bug", "--publish", flag]), /Missing value/);
    assert.throws(() => parseCommanderArgs(["Fix bug", "--publish", flag, "--publish"]), /Missing value/);
    args.splice(index, 2);
    assert.throws(() => parseCommanderArgs(args), new RegExp(`${flag} is required with --publish`));
    args.splice(index, 0, flag, "   ");
    assert.throws(() => parseCommanderArgs(args), new RegExp(`${flag} is required with --publish`));
  }
});

test("publication rejects protected branches and their full refs", () => {
  for (const branch of ["main", "master", "refs/heads/main", "refs/heads/master"]) {
    assert.throws(() => parseCommanderArgs(publicationArgs(branch)), /main\/master is blocked/);
  }
});

test("publication rejects invalid Git branch names", () => {
  const invalidBranches = [
    "-branch", "@", "feat/../fix", "feat/.hidden", "feat/fix.lock", "feat/fix.",
    "feat//fix", "/feat/fix", "feat/fix/", "feat/fix@{previous}", "feat/fix bug",
    "feat/fix\nline", "feat/fix\u007f", "feat/fix~1", "feat/fix^", "feat/fix:part",
    "feat/fix?", "feat/fix*", "feat/fix[1]", "feat\\fix",
  ];
  for (const branch of invalidBranches) {
    assert.throws(() => parseCommanderArgs(publicationArgs(branch)), /Invalid publication branch/, branch);
  }
  for (const branch of ["fix", "feat/queue-fix", "fix/issue_123", "feat/очередь"]) {
    assert.equal(parseCommanderArgs(publicationArgs(branch)).publication?.branch, branch);
  }
});
