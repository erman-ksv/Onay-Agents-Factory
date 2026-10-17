import assert from "node:assert/strict";
import test from "node:test";
import { AiExecutionSession, type AiExecutionDependencies, type AiExecutionOptions } from "./aiExecution.js";

const repository = "erman-ksv/Onay-Agents-Factory";
const baseSha = "a".repeat(40);
const blobSha = "b".repeat(40);
const path = "src/dispatch.ts";
const source = Array.from({ length: 1000 }, (_, index) => `export const order_${index} = "PRIVATE_BASE_LINE_${index}";`).join("\n");
const proposal = source + '\nexport const changed = "PRIVATE_PROPOSAL_ONLY_HOST";';

function fixture(options: Partial<AiExecutionOptions> = {}) {
  const observed: { generation?: string; scan?: string; review?: string } = {};
  const dependencies: AiExecutionDependencies = {
    getHead: async () => baseSha,
    getCandidateHead: async () => "c".repeat(40),
    explore: async sha => ({ repository, ref: sha, files: [{ path, sha: blobSha, content: source }] }),
    generate: async context => {
      observed.generation = context;
      return { summary: proposal, files: [{ path, content: proposal, message: proposal }] };
    },
    review: files => { observed.review = files[0].content; return { agent: "reviewer", ready: true, findings: [] }; },
    scan: files => { observed.scan = files[0].content; return { agent: "security", status: "clean", findings: [] }; },
    inspectSecurity: async sha => ({ agent: "security", repository, ref: sha, status: "clean", findings: [] }),
    discoverTests: async () => ({ scripts: [] }),
    publish: async () => { throw new Error("No publication is authorized in this fixture."); },
    verify: async () => { throw new Error("No CI execution is supplied in this fixture."); },
  };
  const session = new AiExecutionSession({ goal: "Review dispatch order selection", repository,
    ref: "feat/specialist-qualification-20261017", requiredActors: ["explorer", "coder", "reviewer", "security"],
    auditOnly: false, writesEnabled: false, ...options }, dependencies);
  return { session, observed };
}

test("exploration exposes bounded provenance while trusted gates retain complete originals", async () => {
  const { session, observed } = fixture();
  const manifest = await session.explore();
  assert.equal(manifest.baseSha, baseSha);
  assert.equal(manifest.ref, baseSha);
  assert.equal(manifest.files[0].blobSha, blobSha);
  assert.equal(manifest.files[0].bytes, Buffer.byteLength(source));
  assert.ok(manifest.files[0].url.includes(`/blob/${baseSha}/${path}`));
  assert.equal(JSON.stringify(manifest).includes("PRIVATE_BASE_LINE"), false);
  await session.generate();
  session.reviewChanges();
  await session.inspectSecurity();
  assert.equal(observed.generation, `FILE: ${path}\n${source}`);
  assert.equal(observed.review, proposal);
  assert.equal(observed.scan, proposal);
  const metadata = session.modelToolResult(session.proposalMetadata());
  assert.equal(metadata.includes("PRIVATE_PROPOSAL"), false);
  assert.equal(metadata.includes("PRIVATE_BASE_LINE"), false);
  assert.ok(metadata.includes(baseSha));
  assert.equal(session.finish("Proposal only.").evidence.testsExecuted, false);
});

test("host-selected specialist ranges preserve SHA and explicitly expose unknown areas", async () => {
  const { session } = fixture({ specialistSelections: { dispatch: [{ path, startLine: 10, endLine: 12 }] } });
  await session.explore();
  const encoded = session.specialistContext("dispatch", "Inspect order selection only.");
  const packet = JSON.parse(encoded);
  assert.ok(encoded.length <= 6000);
  assert.equal(packet.baseSha, baseSha);
  assert.equal(packet.snippets[0].baseBlobSha, blobSha);
  assert.equal(packet.snippets[0].startLine, 10);
  assert.equal(packet.snippets[0].endLine, 12);
  assert.equal(packet.snippets[0].partial, true);
  assert.ok(packet.snippets[0].text.includes("10 | export const order_9"));
  assert.equal(packet.unverifiedAreas.outsideExploredSnapshot, true);
  assert.equal(packet.unverifiedAreas.testsAndRuntimeBehavior, true);
  assert.deepEqual(packet.unverifiedAreas.unshownLineRanges[0].ranges, [
    { startLine: 1, endLine: 9 }, { startLine: 13, endLine: 1000 },
  ]);
  assert.equal(encoded.includes("PRIVATE_BASE_LINE_999"), false);
});

test("invalid host ranges and oversized legacy transforms fail without exposing source", async () => {
  const invalid = fixture({ specialistSelections: { backend: [{ path: "unread.ts", startLine: 1, endLine: 2 }] } });
  await invalid.session.explore();
  assert.throws(() => invalid.session.specialistContext(), /safe context budget/);
  const transformed = fixture({ specialistContextTransform: () => source });
  await transformed.session.explore();
  assert.throws(() => transformed.session.specialistContext(), /safe context budget/);
});

test("a terminal provider failure prevents queued tools and direct publication", async () => {
  const { session } = fixture();
  await session.explore();
  let laterActions = 0;
  const error = Object.assign(new Error("Unsafe provider body must not survive"), { error: {
    providerFailure: { provider: "groq", code: "rate_limited", retryable: false, retryAfter: "12" },
  } });
  const failed = session.invoke("backend", "backend_specialist", () => { throw error; });
  const queued = session.invoke("github", "publish_change_set", () => { laterActions++; });
  const [first, second] = await Promise.all([failed, queued]);
  assert.ok(first && "error" in first && first.error.includes("HTTP 429"));
  assert.ok(second && "error" in second && second.error.includes("HTTP 429"));
  assert.equal(laterActions, 0);
  assert.equal(session.providerFailure?.retryAfter, "12");
  await assert.rejects(session.publish(), /HTTP 429/);
  const result = session.finish("Stopped.");
  assert.equal(result.status, "blocked");
  assert.equal(result.evidence.publicationAttempted, false);
  assert.equal(JSON.stringify(result).includes("Unsafe provider body"), false);
});

test("source-bearing diagnostics cannot reintroduce a complete file into model history", async () => {
  const { session } = fixture();
  await session.explore();
  assert.throws(() => session.modelToolResult({ error: source }), /model context budget/);
  assert.equal(session.safeErrorMessage(new Error(source.split("\n")[10])).includes("PRIVATE_BASE_LINE"), false);
});

test("a transformed packet cannot claim the original range coverage", async () => {
  const { session } = fixture({ specialistContextTransform: () => "No source evidence was selected by the host." });
  await session.explore();
  assert.match(session.specialistContext(), /Do not assume original selected ranges remain present/);
  const coverage = session.finish("Not verified.").evidence.contextCoverage.backend as Record<string, unknown>;
  assert.equal(coverage.hostTransformApplied, true);
  assert.equal("snippets" in coverage, false);
});
