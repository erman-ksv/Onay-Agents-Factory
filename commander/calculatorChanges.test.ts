import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CALCULATOR_PROFILE, CALCULATOR_CHANGE_ERROR, calculatorBranch, validateCalculatorScope } from "../config/calculatorProfile.js";
import { calculatorSources, createCalculatorSnapshotReader, loadCalculatorSnapshot, verifyCalculatorBase,
  type CalculatorSnapshotReader } from "../github/calculatorSnapshot.js";
import type { CalculatorScope } from "../config/calculatorProfile.js";
import { prepareCalculatorChanges } from "./calculatorChanges.js";
import { applyBoundedPatches } from "./boundedPatch.js";
import { prepareTeamTask } from "../orchestration/teamTaskCard.js";

const baseSha = "a".repeat(40), treeSha = "b".repeat(40);
const path = "src/calculator.mjs";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const blobSha = (text: string) => createHash("sha1").update(Buffer.concat([
  Buffer.from("blob " + Buffer.byteLength(text) + "\0"), Buffer.from(text),
])).digest("hex");
const scope = (paths = [path]): CalculatorScope => ({ repository: CALCULATOR_PROFILE.repository,
  baseRef: "feat/calculator-pilot-bootstrap", baseSha, changePaths: paths });
function fixture(source?: string) {
  const calls: string[] = [];
  const reader: CalculatorSnapshotReader = {
    getHead: async () => { calls.push("head"); return baseSha; },
    readCommit: async () => { calls.push("commit"); return { sha: baseSha, treeSha }; },
    readTree: async () => { calls.push("tree"); return { sha: treeSha, truncated: false, tree: source === undefined ? [] : [
      { path: "src", sha: "c".repeat(40), type: "tree", mode: "040000" },
      { path, sha: blobSha(source), type: "blob", mode: "100644", size: Buffer.byteLength(source) },
    ] }; },
    readBlob: async () => { calls.push("blob"); return { sha: blobSha(source ?? ""), encoding: "base64",
      content: Buffer.from(source ?? "").toString("base64") }; },
  };
  return { calls, reader };
}
const create = (content = "export const fixtureValue = 1;\n", selectedPath = path) => ({
  operation: "create", path: selectedPath, content, message: "Create bounded fixture source",
});
const proposal = (changes: unknown[] = [create()]) => ({ summary: "Create the approved isolated calculator source.", changes });
const fixedRefusal = (error: unknown) => {
  assert.ok(error instanceof Error); assert.equal(error.message, CALCULATOR_CHANGE_ERROR); return true;
};

test("calculator target is fixed, narrowly scoped, and cannot alter Onay or protected files", () => {
  validateCalculatorScope(scope());
  assert.equal(calculatorBranch("calculator-core"), "feat/calculator-agent/calculator-core");
  assert.ok(Object.isFrozen(CALCULATOR_PROFILE.writablePaths));
  for (const invalid of [
    { ...scope(), repository: "erman-ksv/Onay" }, { ...scope(), repository: "erman-ksv/Onay-Agents-Factory" },
    { ...scope(), baseRef: "refs/heads/main" }, { ...scope(), baseSha: "short" },
    ...[".env", ".github/workflows/ci.yml", "package.json", "README.md", "acceptance/golden.test.mjs",
      "../index.html", "src/../index.html", "src\\calculator.mjs", "Index.html", "/index.html", "src/extra.mjs"]
      .map(value => scope([value])), scope([]), scope([path, path]),
    scope(["index.html", "styles.css", path, "src/app.mjs"]),
  ]) assert.throws(() => validateCalculatorScope(invalid), fixedRefusal);
  for (const id of ["main", "../../main", "", "refs/heads/main", "A", "task id", "a".repeat(49)]) {
    if (id === "main") assert.equal(calculatorBranch(id), "feat/calculator-agent/main");
    else assert.throws(() => calculatorBranch(id), fixedRefusal);
  }
});
test("complete pinned tree proves absence; create returns a bounded proposal without authorizing publication", async () => {
  const f = fixture(), snapshot = await loadCalculatorSnapshot(scope(), f.reader);
  assert.deepEqual(f.calls, ["head", "commit", "tree", "head"]);
  assert.deepEqual(snapshot.files, [{ path, exists: false }]);
  const result = prepareCalculatorChanges(proposal(), snapshot);
  assert.equal(result.files[0].content, create().content);
  assert.equal(result.baseSha, baseSha); assert.equal(result.repository, CALCULATOR_PROFILE.repository);
  assert.equal(result.gates.publicationAuthorized, false);
  assert.equal(result.gates.independentReview, "required"); assert.equal(result.gates.tests, "required");
  assert.equal(result.gates.secretScan, "passed"); assert.equal(result.gates.policyReview, "passed");
  assert.equal(JSON.parse(result.reviewEvidence).changes[0].absenceVerifiedAt, baseSha);
  assert.ok(Object.isFrozen(result.files[0])); assert.ok(Object.isFrozen(result.gates));
  assert.deepEqual(calculatorSources(snapshot), new Map());
});
test("snapshot cannot be forged, JSON-restored or widened after host verification", async () => {
  const f = fixture(), approved = scope();
  const pending = loadCalculatorSnapshot(approved, f.reader);
  (approved.changePaths as string[]).push(".github/workflows/ci.yml");
  const snapshot = await pending;
  assert.deepEqual(snapshot.changePaths, [path]);
  for (const forged of [{ ...snapshot }, JSON.parse(JSON.stringify(snapshot)), Object.freeze({ ...snapshot, files: [{ path, exists: false }] })]) {
    assert.throws(() => prepareCalculatorChanges(proposal(), forged), fixedRefusal);
    await assert.rejects(verifyCalculatorBase(forged, f.reader), fixedRefusal);
  }
  assert.throws(() => (snapshot.changePaths as string[]).push("index.html"));
});
test("incomplete, mismatched, failed or changed GitHub evidence never proves absence", async t => {
  for (const name of ["head-before", "head-after", "commit-sha", "tree-link", "truncated", "read-404", "duplicate", "too-many", "invalid-path"]) {
    await t.test(name, async () => {
      const f = fixture(); let heads = 0;
      if (name === "head-before") f.reader.getHead = async () => "d".repeat(40);
      if (name === "head-after") f.reader.getHead = async () => ++heads === 1 ? baseSha : "d".repeat(40);
      if (name === "commit-sha") f.reader.readCommit = async () => ({ sha: "d".repeat(40), treeSha });
      if (name === "tree-link") f.reader.readTree = async () => ({ sha: "d".repeat(40), truncated: false, tree: [] });
      if (name === "truncated") f.reader.readTree = async () => ({ sha: treeSha, truncated: true, tree: [] });
      if (name === "read-404") f.reader.readTree = async () => { throw new Error("404 SECRET_DIAGNOSTIC"); };
      const entry = { path: "README.md", sha: "d".repeat(40), type: "blob", mode: "100644" };
      if (name === "duplicate") f.reader.readTree = async () => ({ sha: treeSha, truncated: false, tree: [entry, entry] });
      if (name === "too-many") f.reader.readTree = async () => ({ sha: treeSha, truncated: false,
        tree: Array.from({ length: 513 }, (_, index) => ({ ...entry, path: "doc" + index })) });
      if (name === "invalid-path") f.reader.readTree = async () => ({ sha: treeSha, truncated: false, tree: [{ ...entry, path: "../README.md" }] });
      await assert.rejects(loadCalculatorSnapshot(scope(), f.reader), fixedRefusal);
    });
  }
});
test("symlinks, submodules and conflicting ancestor files cannot become a create destination", async t => {
  for (const [selected, entries] of [
    [path, [{ path: "src", type: "blob", mode: "120000" }]],
    [path, [{ path: "src", type: "blob", mode: "100644" }]],
    [path, [{ path: "src", type: "commit", mode: "160000" }]],
    ["index.html", [{ path: "index.html", type: "tree", mode: "040000" }]],
    [path, [{ path, type: "blob", mode: "100644" }]],
    ["index.html", [{ path: "index.html/child", type: "blob", mode: "100644" }]],
  ] as const) await t.test(JSON.stringify(entries), async () => {
    const f = fixture();
    f.reader.readTree = async () => ({ sha: treeSha, truncated: false, tree: entries.map(entry => ({ ...entry, sha: "d".repeat(40) })) });
    await assert.rejects(loadCalculatorSnapshot(scope([selected]), f.reader), fixedRefusal);
  });
});
test("existing source is hash verified; exact patch preserves unshown private source", async () => {
  const marker = "PRIVATE_UNSHOWN_CALCULATOR_SOURCE";
  const source = "// " + marker + "\n" + "// unchanged\n".repeat(1000) + "export const n = 1;\n";
  const f = fixture(source), snapshot = await loadCalculatorSnapshot(scope(), f.reader);
  assert.equal(snapshot.files[0].sourceSha256, digest(source)); assert.equal(snapshot.files[0].blobSha, blobSha(source));
  const input = proposal([{ operation: "patch", path, sourceSha256: digest(source),
    edits: [{ before: "export const n = 1;", after: "export const n = 2;" }], message: "Adjust one fixture value" }]);
  const result = prepareCalculatorChanges(input, snapshot);
  assert.equal(result.files[0].content, source.replace("n = 1", "n = 2"));
  assert.ok(!result.reviewEvidence.includes(marker)); assert.ok(result.reviewEvidence.includes(digest(source)));
  const copy = calculatorSources(snapshot) as Map<string, string>; copy.clear();
  assert.equal(calculatorSources(snapshot).get(path), source);
  assert.throws(() => prepareCalculatorChanges(proposal(), snapshot), fixedRefusal);
  await verifyCalculatorBase(snapshot, f.reader);
  f.reader.getHead = async () => "e".repeat(40);
  await assert.rejects(verifyCalculatorBase(snapshot, f.reader), fixedRefusal);
});
test("corrupt blob, changed SHA, wrong size, secrets and read errors fail with fixed diagnostics", async t => {
  for (const name of ["content", "sha", "size", "encoding", "base64", "error", "secret", "oversized", "binary"]) await t.test(name, async () => {
    const source = name === "secret" ? "// ghp_" + "A".repeat(24) : "export const n = 1;\n";
    const f = fixture(source), originalRead = f.reader.readBlob;
    if (name === "content") f.reader.readBlob = async sha => ({ ...await originalRead(sha), content: Buffer.from("other").toString("base64") });
    if (name === "sha") f.reader.readBlob = async sha => ({ ...await originalRead(sha), sha: "d".repeat(40) });
    if (name === "size") { const read = f.reader.readTree; f.reader.readTree = async sha => {
      const tree = await read(sha); tree.tree[1].size = 999; return tree;
    }; }
    if (name === "encoding") f.reader.readBlob = async sha => ({ ...await originalRead(sha), encoding: "utf8" });
    if (name === "base64") f.reader.readBlob = async sha => ({ ...await originalRead(sha), content: "%%%" });
    if (name === "error") f.reader.readBlob = async () => { throw new Error("SECRET_DIAGNOSTIC"); };
    if (name === "oversized") { const read = f.reader.readTree; f.reader.readTree = async sha => {
      const tree = await read(sha); tree.tree[1].size = 131_073; return tree;
    }; }
    if (name === "binary") { const data = Buffer.from([0xff]); const hash = createHash("sha1").update(Buffer.concat([Buffer.from("blob 1\0"), data])).digest("hex");
      f.reader.readTree = async () => ({ sha: treeSha, truncated: false, tree: [
        { path: "src", sha: "c".repeat(40), type: "tree", mode: "040000" }, { path, sha: hash, type: "blob", mode: "100644", size: 1 },
      ] }); f.reader.readBlob = async () => ({ sha: hash, encoding: "base64", content: data.toString("base64") });
    }
    await assert.rejects(loadCalculatorSnapshot(scope(), f.reader), fixedRefusal);
  });
});
test("model cannot change scope, grant authority, replace an existing file or exceed a shared proposal budget", async t => {
  const snapshot = await loadCalculatorSnapshot(scope([path, "index.html", "styles.css"]), fixture().reader);
  const bad: unknown[] = [
    { ...proposal(), repository: "erman-ksv/Onay" }, { ...proposal(), publicationAuthorized: true },
    proposal([{ ...create(), operation: "delete" }]), proposal([{ ...create(), path: "package.json" }]),
    proposal([{ ...create(), path: "src/app.mjs" }]), proposal([{ ...create(), bypass: true }]),
    proposal([create(), create()]), proposal([]), proposal([create(" ")]), proposal([create("x".repeat(6001))]),
    proposal([create("я".repeat(4097))]), proposal([create("x".repeat(3100)), create("y".repeat(3100), "index.html")]),
    proposal([create("// ghp_" + "A".repeat(24))]), proposal([{ ...create(), message: "ghp_" + "A".repeat(24) }]),
    proposal([{ operation: "patch", path, sourceSha256: "a".repeat(64), edits: [{ before: "a", after: "b" }], message: "Patch nonexistent source" }]),
  ];
  for (const [index, input] of bad.entries()) await t.test(String(index), () => assert.throws(() => prepareCalculatorChanges(input, snapshot), fixedRefusal));
  assert.deepEqual(calculatorSources(snapshot), new Map());
});
test("stale, ambiguous and extended patch evidence is rejected without weakening old patch rules", async () => {
  const source = "const n = 1;\nconst n = 1;\n";
  const snapshot = await loadCalculatorSnapshot(scope(), fixture(source).reader);
  for (const edits of [[{ before: "const n = 1;", after: "const n = 2;" }],
    [{ before: source, after: source, bypass: true }], [{ before: "", after: "new" }]])
    assert.throws(() => prepareCalculatorChanges(proposal([{ operation: "patch", path, sourceSha256: digest(source), edits, message: "Patch fixture source" }]), snapshot), fixedRefusal);
  assert.throws(() => prepareCalculatorChanges(proposal([{ operation: "patch", path, sourceSha256: "e".repeat(64),
    edits: [{ before: source, after: "new" }], message: "Patch fixture source" }]), snapshot), fixedRefusal);
});
test("new-file permissions never widen the existing Onay executor or its patch contract", () => {
  assert.throws(() => prepareTeamTask({ version: 1, id: "calculator-task", goal: "Create a new calculator source file.",
    acceptanceCriteria: ["The proposed calculator passes acceptance."], profile: "calculator", provider: "groq",
    baseRef: "feat/calculator-pilot-bootstrap", baseSha, changePaths: [path], contextPaths: [] }));
  assert.throws(() => applyBoundedPatches([{ path, sourceSha256: digest(""), edits: [{ before: "", after: "new" }],
    message: "Create fixture source" }], new Map(), [path]));
});
test("serialized reviewer byte budget also counts escaping and metadata", async () => {
  const snapshot = await loadCalculatorSnapshot(scope(), fixture().reader);
  assert.throws(() => prepareCalculatorChanges(proposal([create('"'.repeat(6000))]), snapshot), fixedRefusal);
});
test("live snapshot adapter requires explicit target access and issues only fixed-target GETs", async t => {
  let calls = 0;
  const fake: typeof fetch = async (input, init) => {
    calls++; const url = String(input); assert.ok(url.startsWith("https://api.github.com/repos/" + CALCULATOR_PROFILE.repository + "/"));
    assert.equal(init?.method, "GET");
    if (url.includes("/git/commits/")) return Response.json({ sha: baseSha, tree: { sha: treeSha } });
    if (url.includes("/git/trees/")) return Response.json({ sha: treeSha, truncated: false, tree: [] });
    return Response.json({ sha: baseSha });
  };
  const env = { AGENT_FACTORY_TARGET_PROFILE: "calculator", GITHUB_TOKEN: "offline-fixture-token",
    AGENT_ALLOWED_REPOSITORIES: CALCULATOR_PROFILE.repository };
  for (const invalid of [{}, { ...env, AGENT_FACTORY_TARGET_PROFILE: "onay" }, { ...env, GITHUB_TOKEN: "" },
    { ...env, AGENT_ALLOWED_REPOSITORIES: "erman-ksv/Onay" }]) assert.throws(() => createCalculatorSnapshotReader(invalid, fake), fixedRefusal);
  assert.equal(calls, 0);
  await loadCalculatorSnapshot(scope(), createCalculatorSnapshotReader(env, fake)); assert.equal(calls, 4);
  for (const status of [404, 429, 500]) await t.test(String(status), async () => {
    let tries = 0;
    const transport: typeof fetch = async () => { tries++; return new Response("SECRET_DIAGNOSTIC", { status }); };
    await assert.rejects(loadCalculatorSnapshot(scope(), createCalculatorSnapshotReader(env, transport)), fixedRefusal);
    assert.equal(tries, 1);
  });
});
