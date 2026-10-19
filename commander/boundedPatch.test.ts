import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { applyBoundedPatches, BOUNDED_PATCH_ERROR, BOUNDED_PATCH_LIMITS, type BoundedPatch } from "./boundedPatch.js";

const path = "src/example.ts";
const sha = (source: string) => createHash("sha256").update(source, "utf8").digest("hex");
const patch = (source: string, edits: BoundedPatch["edits"], targetPath = path): BoundedPatch => ({
  path: targetPath, sourceSha256: sha(source), edits, message: "Apply the requested scoped change",
});
const apply = (source: string, edits: BoundedPatch["edits"]) => applyBoundedPatches([patch(source, edits)], new Map([[path, source]]), [path]);
const blocked = (run: () => unknown) => assert.throws(run, error => error instanceof Error && error.message === BOUNDED_PATCH_ERROR);

test("bounded patches preserve every untouched byte and resolve reversed edits against original offsets", () => {
  const source = "// untouched 😀\r\nconst first = 1;\r\nconst last = 2;\r\n// trailing\r\n";
  const sources = new Map([[path, source]]);
  const changes = applyBoundedPatches([patch(source, [
    { before: "const last = 2;", after: "const last = 20;" },
    { before: "const first = 1;", after: "const first = 1000;" },
  ])], sources, [path]);
  assert.deepEqual(changes, [{ path, content: "// untouched 😀\r\nconst first = 1000;\r\nconst last = 20;\r\n// trailing\r\n", message: "Apply the requested scoped change" }]);
  assert.equal(sources.get(path), source);
});

test("bounded patches reject stale full-file SHA256 even when the anchor still matches", () => {
  const source = "const value = 1;\n// unseen changed";
  const stale = patch("const value = 1;\n// previous", [{ before: "value = 1", after: "value = 2" }]);
  blocked(() => applyBoundedPatches([stale], new Map([[path, source]]), [path]));
});

test("bounded patches require unique anchors including overlapping repeated matches", () => {
  blocked(() => apply("same and same", [{ before: "same", after: "different" }]));
  blocked(() => apply("aaa", [{ before: "aa", after: "x" }]));
});

test("bounded patches reject overlapping or duplicate original ranges", () => {
  blocked(() => apply("abcdef", [{ before: "abc", after: "x" }, { before: "cde", after: "y" }]));
  blocked(() => apply("abcdef", [{ before: "abc", after: "x" }, { before: "abc", after: "y" }]));
});

test("bounded patches cannot reference newly inserted text in a later edit", () => {
  blocked(() => apply("original anchor", [
    { before: "original", after: "newly inserted" }, { before: "inserted", after: "rewritten" },
  ]));
});

test("bounded patches apply adjacent original ranges simultaneously", () => {
  assert.equal(apply("ABCD", [{ before: "AB", after: "CD" }, { before: "CD", after: "EF" }])[0].content, "CDEF");
});

test("bounded patches reject traversal, absolute, normalized, and noncanonical paths", () => {
  for (const targetPath of ["../src/x.ts", "/src/x.ts", "src/../x.ts", "src/./x.ts", "src//x.ts", "src\\x.ts", "src/x.ts\n", " src/x.ts", "src/ x.ts", "src/x.ts ", "C:/x.ts", "src/\u0000x.ts"]) {
    const source = "old";
    blocked(() => applyBoundedPatches([patch(source, [{ before: "old", after: "new" }], targetPath)], new Map([[targetPath, source]]), [targetPath]));
  }
});

test("bounded patches require exact host authorization rather than a path prefix or another source", () => {
  const source = "old";
  const proposal = patch(source, [{ before: "old", after: "new" }]);
  blocked(() => applyBoundedPatches([proposal], new Map([[path, source]]), ["src/"]));
  blocked(() => applyBoundedPatches([proposal], new Map([[path, source]]), ["src/example.ts.backup"]));
  blocked(() => applyBoundedPatches([proposal], new Map([["src/other.ts", source]]), [path]));
});

test("bounded patches reject duplicate paths, missing sources, no-op changes, and empty anchors", () => {
  const source = "original";
  const proposal = patch(source, [{ before: "original", after: "changed" }]);
  blocked(() => applyBoundedPatches([proposal, proposal], new Map([[path, source]]), [path]));
  blocked(() => applyBoundedPatches([proposal], new Map(), [path]));
  blocked(() => apply(source, [{ before: "original", after: "original" }]));
  blocked(() => apply(source, [{ before: "", after: "extra" }]));
  blocked(() => apply(source, []));
  blocked(() => applyBoundedPatches([], new Map([[path, source]]), [path]));
});

test("bounded patches support exact deletions without interpreting replacement syntax", () => {
  assert.equal(apply("keep REMOVE end", [{ before: "REMOVE ", after: "" }])[0].content, "keep end");
  assert.equal(apply("old", [{ before: "old", after: "$& $$ $` $'" }])[0].content, "$& $$ $` $'");
});

test("bounded patches enforce file and per-file edit counts", () => {
  const many = Array.from({ length: BOUNDED_PATCH_LIMITS.files + 1 }, (_, index) => patch("old", [{ before: "old", after: "new" }], `src/${index}.ts`));
  blocked(() => applyBoundedPatches(many, new Map(many.map(item => [item.path, "old"])), many.map(item => item.path)));
  blocked(() => apply("012345678", Array.from({ length: 9 }, (_, index) => ({ before: String(index), after: "x" }))));
});

test("bounded patches enforce aggregate changed-text budget across separate edits and files", () => {
  blocked(() => apply("ab", [{ before: "a", after: "X".repeat(6_000) }, { before: "b", after: "Y".repeat(6_000) }]));
  const sources = new Map([[path, "first"], ["src/other.ts", "second"]]);
  blocked(() => applyBoundedPatches([
    patch("first", [{ before: "first", after: "X".repeat(6_000) }]),
    patch("second", [{ before: "second", after: "Y".repeat(6_000) }], "src/other.ts"),
  ], sources, [...sources.keys()]));
});

test("bounded patches cap original and reconstructed UTF8 bytes", () => {
  blocked(() => apply("old" + "😀".repeat(BOUNDED_PATCH_LIMITS.fileBytes / 4), [{ before: "old", after: "new" }]));
  const source = "old" + "x".repeat(BOUNDED_PATCH_LIMITS.fileBytes - 3);
  blocked(() => apply(source, [{ before: "old", after: "longer" }]));
});

test("bounded patches reject potential secrets in new content and messages without echoing them", () => {
  const secret = "ghp_" + "A".repeat(24);
  blocked(() => apply("old", [{ before: "old", after: secret }]));
  const proposal = { ...patch("old", [{ before: "old", after: "new" }]), message: secret };
  blocked(() => applyBoundedPatches([proposal], new Map([[path, "old"]]), [path]));
  blocked(() => apply(`old\n${secret}`, [{ before: "old", after: "new" }]));
});

test("bounded patch failure is source-free and leaves all host inputs unchanged", () => {
  const source = "PRIVATE ORIGINAL SOURCE";
  const first = patch(source, [{ before: source, after: "safe change" }]);
  const second = patch("second source", [{ before: "missing private anchor", after: "new" }], "src/second.ts");
  const sources = new Map([[path, source], [second.path, "second source"]]);
  const before = JSON.stringify([first, second]);
  blocked(() => applyBoundedPatches([first, second], sources, [...sources.keys()]));
  assert.equal(JSON.stringify([first, second]), before);
  assert.deepEqual([...sources], [[path, source], [second.path, "second source"]]);
});

test("bounded patches reject malformed runtime input with one fixed error", () => {
  for (const invalid of [null, { ...patch("old", [{ before: "old", after: "new" }]), sourceSha256: "not-a-hash" },
    { ...patch("old", [{ before: "old", after: "new" }]), message: "" },
    { ...patch("old", [{ before: "old", after: "new" }]), edits: [{ before: 3, after: "new" }] }]) {
    blocked(() => applyBoundedPatches([invalid as BoundedPatch], new Map([[path, "old"]]), [path]));
  }
});
