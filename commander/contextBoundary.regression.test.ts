import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Usage, setTracingDisabled, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { runAiCommander } from "./aiCommander.js";
import type { AiExecutionDependencies } from "./aiExecution.js";
import { REPOSITORY_CONTEXT_LIMITS } from "./repositoryContext.js";

setTracingDisabled(true);
const repository = "erman-ksv/Onay-Agents-Factory";
const baseSha = "a".repeat(40);
const blobSha = "c".repeat(40);
const candidateSha = "b".repeat(40);
const branch = "fix/offline-context-boundary";
const path = "agents/backend/authorization.ts";
const env = { AGENT_ALLOWED_REPOSITORIES: repository, AGENT_FACTORY_LEGAL_ENABLED: "false" };
const baseMarker = "PRIVATE_BASE_SOURCE_73K";
const proposalMarker = "PRIVATE_COMPLETE_PROPOSAL";
const summaryMarker = "PRIVATE_CODER_SUMMARY";
const messageMarker = "PRIVATE_CODER_MESSAGE";
const adviceMarker = "PRIVATE_SPECIALIST_FINDING";
const baseContent = `// ${baseMarker}\nexport const authorization = false;\n// ${"x".repeat(73_000)}`;
const proposalContent = `// ${proposalMarker}\nexport const authorization = true;\n// ${"y".repeat(73_000)}`;

/** Real SDK tool dispatch, with an in-process model and no provider requests. */
class BoundaryModel implements Model {
  readonly commanderRequests: ModelRequest[] = [];
  readonly specialistRequests: ModelRequest[] = [];
  readonly steps: string[];

  constructor(steps: string[]) { this.steps = steps; }

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const commander = JSON.stringify(request.tools).includes('"explore_onay"');
    if (!commander) {
      this.specialistRequests.push(request);
      return this.message(JSON.stringify({ ready: true,
        findings: [{ severity: "low", message: adviceMarker }], summary: adviceMarker }));
    }
    const index = this.commanderRequests.push(request) - 1;
    const name = this.steps[index];
    return name ? { usage: new Usage(), output: [{ type: "function_call", callId: "boundary-" + index,
      name, arguments: name === "backend_specialist" ? '{"input":"Review the selected authorization behavior."}' : "{}",
      status: "completed" }] } : this.message("The available host evidence is recorded; remaining checks must be reviewed.");
  }

  private message(text: string): ModelResponse {
    return { usage: new Usage(), output: [{ type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text }] }] };
  }

  async *getStreamedResponse(): AsyncGenerator<never> { throw new Error("Offline non-streaming model only."); }
}

function fixture() {
  const observed = { generated: [] as string[], reviewed: [] as string[], scanned: [] as string[], published: [] as string[] };
  const dependencies: AiExecutionDependencies = {
    getHead: async () => baseSha,
    getCandidateHead: async ref => { assert.equal(ref, branch); return candidateSha; },
    explore: async sha => ({ repository, ref: sha, files: [{ path, sha: blobSha, content: baseContent }] }),
    generate: async context => {
      observed.generated.push(context);
      return { summary: summaryMarker, files: [{ path, content: proposalContent, message: messageMarker }] };
    },
    review: files => {
      observed.reviewed.push(files[0].content);
      return { agent: "reviewer", ready: true, findings: [] };
    },
    scan: files => {
      observed.scanned.push(files[0].content);
      return { agent: "security", status: "clean", findings: [] };
    },
    inspectSecurity: async sha => ({ agent: "security", repository, ref: sha, status: "clean", findings: [] }),
    discoverTests: async () => ({ scripts: ["test: offline-fixture"] }),
    publish: async (files, sha) => {
      assert.equal(sha, baseSha);
      observed.published.push(files[0].content);
      return { head_sha: candidateSha, html_url: `https://github.com/${repository}/pull/123`, number: 123 };
    },
    verify: async (sha, ref) => ({ testsExecuted: true, repository, ref, expectedSha: sha, status: "passed",
      evidence: [{ runId: 123, name: "Offline CI fixture", headSha: sha, conclusion: "success",
        url: `https://github.com/${repository}/actions/runs/123` }],
      checks: [{ jobName: "typecheck", name: "Test", status: "completed", conclusion: "success" }], notes: [] }),
  };
  return { dependencies, observed };
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** Extract the context JSON even when the SDK wraps it in a user message. */
function contextObject(request: ModelRequest): Record<string, unknown> {
  for (const text of strings(request.input)) {
    const start = text.indexOf('{"repository":');
    if (start < 0) continue;
    let quoted = false;
    let escaped = false;
    let depth = 0;
    for (let index = start; index < text.length; index++) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === "{") depth++;
      else if (character === "}" && --depth === 0) return JSON.parse(text.slice(start, index + 1)) as Record<string, unknown>;
    }
  }
  assert.fail("SDK input did not contain repository context metadata.");
}

test("SDK Explorer returns commit and blob references without its 73k private source", async () => {
  const model = new BoundaryModel(["explore_onay"]);
  const { dependencies, observed } = fixture();
  const result = await runAiCommander("Fix Onay-Agents-Factory", { model, env, dependencies });
  assert.equal(model.commanderRequests.length, 2);
  assert.doesNotMatch(JSON.stringify(model.commanderRequests), new RegExp(baseMarker));
  const manifest = contextObject(model.commanderRequests[1]);
  assert.equal(manifest.repository, repository);
  assert.equal(manifest.baseSha, baseSha);
  const files = manifest.files as Array<Record<string, unknown>>;
  assert.equal(files[0].path, path);
  assert.equal(files[0].blobSha, blobSha);
  assert.equal(files[0].bytes, Buffer.byteLength(baseContent));
  assert.equal(files[0].url, `https://github.com/${repository}/blob/${baseSha}/${path}`);
  assert.equal("content" in files[0], false);
  assert.equal(result.evidence.baseSha, baseSha);
  assert.deepEqual(observed.published, []);
});

test("SDK Coder results omit full files and source-derived summary and message in both modes", async t => {
  for (const privateMode of [false, true]) await t.test(privateMode ? "private transform" : "generic", async () => {
    const model = new BoundaryModel(["explore_onay", "code_onay"]);
    const { dependencies, observed } = fixture();
    const result = await runAiCommander("Fix Onay-Agents-Factory", { model, env, dependencies,
      ...(privateMode ? { specialistContextTransform: (context: string) => context } : {}) });
    assert.equal(model.commanderRequests.length, 3);
    const history = JSON.stringify(model.commanderRequests);
    for (const marker of [baseMarker, proposalMarker, summaryMarker, messageMarker]) assert.equal(history.includes(marker), false, marker);
    assert.ok(history.includes(path));
    assert.equal(observed.generated[0], `FILE: ${path}\n${baseContent}`);
    assert.deepEqual(result.evidence.proposedFiles, [path]);
    assert.deepEqual(observed.published, []);
  });
});

test("SDK specialist receives bounded selected lines, provenance and explicit unknowns; advice stays private", async () => {
  const model = new BoundaryModel(["explore_onay", "code_onay", "backend_specialist"]);
  const { dependencies } = fixture();
  const result = await runAiCommander("Fix Onay-Agents-Factory backend authorization", { model, env, dependencies,
    specialistSelections: { backend: [
      { path, source: "base", startLine: 2, endLine: 2 },
      { path, source: "proposal", startLine: 2, endLine: 2 },
    ] } });
  assert.equal(model.specialistRequests.length, 1);
  const packet = contextObject(model.specialistRequests[0]);
  assert.ok(JSON.stringify(packet).length <= REPOSITORY_CONTEXT_LIMITS.packetCharacters);
  assert.equal(packet.repository, repository);
  assert.equal(packet.baseSha, baseSha);
  assert.equal(packet.role, "backend");
  const snippets = packet.snippets as Array<Record<string, unknown>>;
  assert.equal(snippets.length, 2);
  assert.deepEqual(snippets.map(snippet => snippet.source), ["base", "proposal"]);
  for (const snippet of snippets) {
    assert.equal(snippet.path, path);
    assert.equal(snippet.baseBlobSha, blobSha);
    assert.equal(snippet.startLine, 2);
    assert.equal(snippet.endLine, 2);
    assert.equal(snippet.partial, true);
  }
  assert.equal(snippets[0].text, "2 | export const authorization = false;");
  assert.equal(snippets[1].text, "2 | export const authorization = true;");
  assert.equal(snippets[1].contentSha256, createHash("sha256").update(proposalContent).digest("hex"));
  const unknowns = packet.unverifiedAreas as Record<string, unknown>;
  assert.equal(unknowns.outsideExploredSnapshot, true);
  assert.equal(unknowns.testsAndRuntimeBehavior, true);
  assert.equal((unknowns.unshownRanges as unknown[]).length, 2);
  const specialistInput = JSON.stringify(model.specialistRequests);
  assert.equal(specialistInput.includes(baseMarker), false);
  assert.equal(specialistInput.includes(proposalMarker), false);
  assert.equal(JSON.stringify(model.commanderRequests).includes(adviceMarker), false);
  assert.ok(strings(model.commanderRequests.at(-1)!.input).some(text => text.includes('"unverifiedAreas"')),
    "Commander must retain the specialist's limited coverage without receiving its source text");
  assert.equal(result.evidence.assessments.backend.findings[0].message, adviceMarker);
  assert.equal(result.evidence.testsExecuted, false);
  assert.equal(result.legalReview, "disabled");
});

test("SDK invalid host snippet selection blocks publication without calling the specialist model", async t => {
  for (const selection of [
    { path: "missing.ts", startLine: 1, endLine: 1 },
    { path, startLine: 2, endLine: 999_999 },
  ]) await t.test(selection.path === path ? "out-of-range lines" : "unknown path", async () => {
    const model = new BoundaryModel(["explore_onay", "code_onay", "backend_specialist", "security_review", "final_review", "publish_change_set"]);
    const { dependencies, observed } = fixture();
    const result = await runAiCommander("Fix Onay-Agents-Factory backend authorization", {
      model, env: { ...env, AGENT_FACTORY_ENABLE_GITHUB_WRITES: "true" }, dependencies,
      specialistSelections: { backend: [selection] }, publication: { branch, title: "Offline fixture", body: "No real publication." },
    });
    assert.equal(result.status, "blocked");
    assert.equal(model.specialistRequests.length, 0);
    assert.deepEqual(observed.published, []);
    assert.equal(result.evidence.publication, undefined);
    assert.ok(result.events.some(event => event.type === "tool_failed" && event.details?.tool === "backend_specialist"));
  });
});

test("SDK content-free handoffs preserve complete trusted gate payloads and exact candidate CI", async () => {
  const model = new BoundaryModel(["explore_onay", "code_onay", "security_review", "final_review", "publish_change_set", "test_onay"]);
  const { dependencies, observed } = fixture();
  const result = await runAiCommander("Fix Onay-Agents-Factory", {
    model, env: { ...env, AGENT_FACTORY_ENABLE_GITHUB_WRITES: "true" }, dependencies,
    allowedChangePaths: [path], expectedBaseSha: baseSha,
    publication: { branch, title: "Offline fixture", body: "In-process publication dependency only." },
  });
  assert.equal(result.status, "completed", result.reasons.join("; "));
  assert.deepEqual(observed.generated, [`FILE: ${path}\n${baseContent}`]);
  assert.deepEqual(observed.reviewed, [proposalContent]);
  assert.deepEqual(observed.scanned, [proposalContent]);
  assert.deepEqual(observed.published, [proposalContent]);
  assert.equal(result.evidence.testsExecuted, true);
  assert.equal(result.evidence.tests?.expectedSha, candidateSha);
  assert.deepEqual(result.evidence.changedFiles, [path]);
  const history = JSON.stringify(model.commanderRequests);
  for (const marker of [baseMarker, proposalMarker, summaryMarker, messageMarker]) assert.equal(history.includes(marker), false, marker);
});
