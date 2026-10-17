import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildSpecialistContext, createRepositoryManifest, REPOSITORY_CONTEXT_ERROR, REPOSITORY_CONTEXT_LIMITS,
  type FrozenRepositoryFile, type SpecialistContextOptions,
} from "./repositoryContext.js";

const repository = "owner/repository";
const baseSha = "a".repeat(40);
const blobSha = "b".repeat(40);
const file = (path: string, content = "first line\nsecond line\nthird line"): FrozenRepositoryFile => ({ path, sha: blobSha, content });
const options = (extra: Partial<SpecialistContextOptions> = {}): SpecialistContextOptions => ({
  repository, baseSha, files: [file("src/api.ts")], goal: "Review API authentication", role: "backend", ...extra,
});
const safeFailure = (action: () => unknown) => assert.throws(action, { message: REPOSITORY_CONTEXT_ERROR });

test("manifest exposes exact pinned provenance and no source, without mutating the host snapshot", () => {
  const source = "PRIVATE_SOURCE_MARKER\nsecond line";
  const files = Object.freeze([Object.freeze(file("src/my file.ts", source))]);
  const manifest = createRepositoryManifest(repository, baseSha, files);
  assert.equal(manifest.repository, repository);
  assert.equal(manifest.baseSha, baseSha);
  assert.deepEqual(manifest.files, [{
    path: "src/my file.ts", blobSha, bytes: Buffer.byteLength(source), lines: 2,
    url: `https://github.com/${repository}/blob/${baseSha}/src/my%20file.ts`,
  }]);
  assert.equal(JSON.stringify(manifest).includes(source), false);
  assert.equal(JSON.stringify(manifest).includes("PRIVATE_SOURCE_MARKER"), false);
  assert.equal(files[0].content, source);
  manifest.files[0].path = "changed.ts";
  assert.equal(files[0].path, "src/my file.ts");
});

test("manifest refuses unsafe or truncated identifiers and bounds its metadata", () => {
  const invalid = ["../api.ts", "src/../api.ts", "/api.ts", "./api.ts", "src\\api.ts", "src//api.ts", "src/instruction\n.ts", "x".repeat(241)];
  for (const path of invalid) safeFailure(() => createRepositoryManifest(repository, baseSha, [file(path)]));
  safeFailure(() => createRepositoryManifest("owner/repo\nPRIVATE_SOURCE_MARKER", baseSha, [file("api.ts")]));
  safeFailure(() => createRepositoryManifest(repository, "main", [file("api.ts")]));
  safeFailure(() => createRepositoryManifest(repository, baseSha, [{ ...file("api.ts"), sha: blobSha + "PRIVATE_SOURCE_MARKER" }]));
  safeFailure(() => createRepositoryManifest(repository, baseSha, [file("api.ts"), file("api.ts")]));
  safeFailure(() => createRepositoryManifest(repository, baseSha, Array.from({ length: 65 }, (_, index) => file(`file${index}.ts`))));
  safeFailure(() => createRepositoryManifest(repository, baseSha, Array.from({ length: 30 }, (_, index) => file(`${"a".repeat(225)}${index}.ts`))));
});

test("explicit host ranges are exact, line numbered and identify unverified ranges and unread files", () => {
  const context = buildSpecialistContext(options({
    files: [file("src/api.ts"), file("src/unread.ts", "UNREAD_SOURCE_MARKER")],
    selection: { path: "src/api.ts", startLine: 2, endLine: 2 },
  }));
  const packet = JSON.parse(context);
  assert.equal(packet.snippets.length, 1);
  assert.deepEqual(packet.snippets[0], {
    path: "src/api.ts", source: "base", baseBlobSha: blobSha,
    contentSha256: createHash("sha256").update("first line\nsecond line\nthird line").digest("hex"),
    baseUrl: `https://github.com/${repository}/blob/${baseSha}/src/api.ts`, committed: true,
    startLine: 2, endLine: 2, totalLines: 3, partial: true, text: "2 | second line",
  });
  assert.equal(context.includes("first line"), false);
  assert.equal(context.includes("UNREAD_SOURCE_MARKER"), false);
  assert.deepEqual(packet.unverifiedAreas.unreadBaseFiles, { count: 1, paths: ["src/unread.ts"], omittedPathCount: 0 });
  assert.deepEqual(packet.unverifiedAreas.unshownRanges, [{ path: "src/api.ts", source: "base" }]);
  assert.equal(packet.unverifiedAreas.outsideExploredSnapshot, true);
  assert.match(packet.knowledgeBoundary, /ready is advice, not proof/);
});

test("proposals identify their own SHA256 and cannot masquerade as committed blobs", () => {
  const proposal = { path: "src/api.ts", content: "proposed API behavior" };
  const packet = JSON.parse(buildSpecialistContext(options({
    proposals: [proposal, { path: "src/new.ts", content: "new proposed source" }],
    selection: [
      { path: proposal.path, source: "proposal", startLine: 1, endLine: 1 },
      { path: "src/new.ts", source: "proposal", startLine: 1, endLine: 1 },
    ],
  })));
  const [changed, added] = packet.snippets;
  assert.equal(changed.source, "proposal");
  assert.equal(changed.committed, false);
  assert.equal(changed.baseBlobSha, blobSha);
  assert.equal(changed.contentSha256, createHash("sha256").update(proposal.content).digest("hex"));
  assert.notEqual(changed.contentSha256, blobSha);
  assert.equal(added.baseBlobSha, null);
  assert.equal(added.baseUrl, null);
  assert.equal(added.committed, false);
  assert.deepEqual(packet.proposedCoverage, { totalFiles: 2, shownFiles: ["src/api.ts", "src/new.ts"], completeFiles: ["src/api.ts", "src/new.ts"] });
  assert.equal(packet.unverifiedAreas.unreadBaseFiles.count, 1);
});

test("invalid explicit ranges, absent sources and repeated file requests fail without source diagnostics", () => {
  const selections: unknown[] = [
    { path: "src/missing.ts", startLine: 1, endLine: 1 },
    { path: "src/api.ts", startLine: 0, endLine: 1 },
    { path: "src/api.ts", startLine: 1.5, endLine: 2 },
    { path: "src/api.ts", startLine: 3, endLine: 2 },
    { path: "src/api.ts", startLine: 1, endLine: 4 },
    { path: "src/api.ts", startLine: 1, endLine: Number.POSITIVE_INFINITY },
    { path: "src/api.ts", startLine: 1, endLine: 1, source: "proposal" },
    { path: "src/api.ts", startLine: 1, endLine: 1, source: "PRIVATE_SOURCE_MARKER" },
    [{ path: "src/api.ts", startLine: 1, endLine: 1 }, { path: "src/api.ts", startLine: 2, endLine: 2 }],
    [],
  ];
  for (const selection of selections) safeFailure(() => buildSpecialistContext(options({ selection: selection as SpecialistContextOptions["selection"] })));
});

test("explicit selections refuse both per-file and aggregate budgets without truncating", () => {
  safeFailure(() => buildSpecialistContext(options({
    files: [file("src/api.ts", "PRIVATE_SOURCE_MARKER".repeat(100))],
    selection: { path: "src/api.ts", startLine: 1, endLine: 1 },
  })));
  const files = ["one.ts", "two.ts", "three.ts"].map(path => file(path, "x".repeat(1_490)));
  safeFailure(() => buildSpecialistContext(options({
    goal: "a".repeat(1_200), files,
    selection: files.map(({ path }) => ({ path, startLine: 1, endLine: 1 })),
  })));
  safeFailure(() => buildSpecialistContext(options({
    files: ["one.ts", "two.ts", "three.ts", "four.ts"].map(path => file(path)),
    selection: ["one.ts", "two.ts", "three.ts", "four.ts"].map(path => ({ path, startLine: 1, endLine: 1 })),
  })));
});

test("automatic selection uses task and role relevance and stays inside all packet budgets", () => {
  const files = Array.from({ length: 8 }, (_, index) => file(`misc/file${index}.ts`, Array.from({ length: 200 }, () => "unrelated details".repeat(4)).join("\n")));
  files.push(file("src/auth-api.ts", Array.from({ length: 150 }, (_, index) => index === 80 ? "authentication API permission contract" : "ordinary source line").join("\n")));
  const context = buildSpecialistContext(options({ files }));
  const packet = JSON.parse(context);
  assert.equal(packet.snippets[0].path, "src/auth-api.ts");
  assert.match(packet.snippets[0].text, /81 \| authentication API permission contract/);
  assert.ok(context.length <= REPOSITORY_CONTEXT_LIMITS.packetCharacters);
  assert.ok(packet.snippets.length <= REPOSITORY_CONTEXT_LIMITS.snippetFiles);
  for (const snippet of packet.snippets) {
    assert.ok(snippet.text.length <= REPOSITORY_CONTEXT_LIMITS.snippetCharacters);
    assert.equal(snippet.partial, true);
  }
  assert.equal(packet.unverifiedAreas.unreadBaseFiles.count, files.length - packet.snippets.length);
  assert.equal(packet.unverifiedAreas.unreadBaseFiles.omittedPathCount, Math.max(0, files.length - packet.snippets.length - 6));
});

test("automatic selection leaves oversized lines unread rather than cutting source silently", () => {
  const content = "PRIVATE_SOURCE_MARKER".repeat(500);
  const packetText = buildSpecialistContext(options({ files: [file("src/api.ts", content)] }));
  const packet = JSON.parse(packetText);
  assert.deepEqual(packet.snippets, []);
  assert.equal(packet.unverifiedAreas.unreadBaseFiles.count, 1);
  assert.equal(packetText.includes("PRIVATE_SOURCE_MARKER"), false);
});

test("host labels and proposal metadata are bounded and validated before rendering", () => {
  safeFailure(() => buildSpecialistContext(options({ goal: "x".repeat(1_201) })));
  safeFailure(() => buildSpecialistContext(options({ request: "x".repeat(601) })));
  safeFailure(() => buildSpecialistContext(options({ role: "backend\nPRIVATE_SOURCE_MARKER" })));
  safeFailure(() => buildSpecialistContext(options({ proposals: [{ path: "../unsafe.ts", content: "PRIVATE_SOURCE_MARKER" }] })));
  safeFailure(() => buildSpecialistContext(options({ proposals: [{ path: "api.ts", content: "one" }, { path: "api.ts", content: "two" }] })));
  // Valid custom role labels must not resolve inherited Object properties as keyword lists.
  assert.equal(JSON.parse(buildSpecialistContext(options({ role: "constructor" }))).role, "constructor");
});
