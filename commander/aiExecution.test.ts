import assert from "node:assert/strict";
import test from "node:test";
import { AiExecutionSession, type AiExecutionDependencies, type AiExecutionOptions } from "./aiExecution.js";
import type { TestExecutionEvidence } from "../agents/tester/agent.js";

const repository = "erman-ksv/TezJet-Agent-Factory";
const baseSha = "a".repeat(40);
const candidateSha = "b".repeat(40);
const branch = "agent-factory/verified-task";
const files = [{ path: "commander/summary.ts", content: "export const verified = true;\n", message: "Verify task evidence" }];
const generated = { summary: "Verify task evidence", files };
const publication = { head_sha: candidateSha, html_url: "https://github.com/erman-ksv/TezJet-Agent-Factory/pull/123", number: 123 };
const review = { agent: "reviewer" as const, ready: true, findings: [] };
const proposedSecurity = { agent: "security" as const, status: "clean" as const, findings: [] };
const mutationActors = ["explorer", "coder", "tester", "security", "reviewer"];
const readyAdvice = { ready: true, findings: [], summary: "The proposed change preserves the backend contracts." };

function passingEvidence(sha = candidateSha, ref = branch): TestExecutionEvidence {
  return {
    testsExecuted: true, repository, ref, expectedSha: sha, status: "passed",
    evidence: [{ runId: 123, name: "CI", headSha: sha, conclusion: "success", url: "https://github.com/erman-ksv/TezJet-Agent-Factory/actions/runs/123" }],
    checks: [{ jobName: "Typecheck and API tests", name: "Run tests", status: "completed", conclusion: "success" }],
    notes: [],
  };
}

function setup(overrides: Partial<AiExecutionDependencies> = {}, options: Partial<AiExecutionOptions> = {}) {
  const calls: Array<{ tool: string; args: unknown[] }> = [];
  const record = (tool: string, ...args: unknown[]) => calls.push({ tool, args: structuredClone(args) });
  const dependencies: AiExecutionDependencies = {
    getHead: async () => { record("getHead"); return baseSha; },
    explore: async sha => {
      record("explore", sha);
      return { repository, ref: sha, files: [{ path: "commander/summary.ts", sha: "c".repeat(40), content: "export const verified = false;\n" }] };
    },
    generate: async context => { record("generate", context); return structuredClone(generated); },
    review: proposed => { record("review", proposed); return structuredClone(review); },
    scan: proposed => { record("scan", proposed); return structuredClone(proposedSecurity); },
    inspectSecurity: async sha => { record("inspectSecurity", sha); return { agent: "security", repository, ref: sha, status: "clean", findings: [] }; },
    discoverTests: async () => { record("discoverTests"); return { scripts: ["test: tsx --test"], validJson: true }; },
    publish: async (proposed, sha) => { record("publish", proposed, sha); return publication; },
    verify: async (sha, ref) => { record("verify", sha, ref); return passingEvidence(sha, ref); },
    getCandidateHead: async ref => { record("getCandidateHead", ref); return ref === branch ? candidateSha : baseSha; },
    ...overrides,
  };
  const session = new AiExecutionSession({
    goal: "Fix task execution verification", repository, ref: "dev/agent-factory-core",
    requiredActors: [...mutationActors], auditOnly: false,
    publication: { branch, title: "Verify task execution", body: "A proposed fix with verified CI evidence." },
    writesEnabled: true, ...options,
  }, dependencies);
  return { session, calls };
}

async function prepare(session: AiExecutionSession) {
  await session.invoke("explorer", "explore_tezjet", () => session.explore());
  await session.invoke("coder", "code_tezjet", () => session.generate());
  await session.invoke("reviewer", "final_review", () => session.reviewChanges());
  await session.invoke("security", "security_review", () => session.inspectSecurity());
}

async function execute(session: AiExecutionSession) {
  await prepare(session);
  await session.invoke("github", "publish_changes", () => session.publish());
  await session.invoke("tester", "test_tezjet", () => session.test());
  return session.finish("The candidate was written and its CI evidence verified.");
}

test("AI mutation completes only after actual tools publish and verify the exact candidate", async () => {
  const { session, calls } = setup();
  const result = await execute(session);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.missingActors, []);
  assert.deepEqual(calls.map(call => call.tool), ["getHead", "explore", "generate", "review", "inspectSecurity", "scan", "publish", "discoverTests", "verify", "getCandidateHead"]);
  assert.deepEqual(calls.find(call => call.tool === "publish")?.args, [files, baseSha]);
  assert.deepEqual(calls.find(call => call.tool === "verify")?.args, [candidateSha, branch]);
  assert.deepEqual(calls.find(call => call.tool === "getCandidateHead")?.args, [branch]);
  assert.match(String(calls.find(call => call.tool === "generate")?.args[0]), /FILE: commander\/summary\.ts\nexport const verified = false/);
  assert.deepEqual(result.evidence.changedFiles, [files[0].path]);
  assert.equal(result.evidence.baseSha, baseSha);
  assert.equal(result.evidence.publication?.head_sha, candidateSha);
  assert.equal(result.evidence.testsExecuted, true);
  assert.deepEqual(result.events.filter(event => event.type === "tool_started").map(event => [event.actor, event.details?.tool]), [
    ["explorer", "explore_tezjet"], ["coder", "code_tezjet"], ["reviewer", "final_review"],
    ["security", "security_review"], ["github", "publish_changes"], ["github", "write_candidate"], ["tester", "test_tezjet"],
  ]);
  const written = result.events.find(event => event.type === "artifact_created" && event.actor === "github");
  assert.deepEqual(written?.details?.files, [files[0].path]);
  assert.equal(written?.details?.headSha, candidateSha);
  assert.equal(result.events.find(event => event.type === "verification_passed" && event.actor === "tester")?.details?.expectedSha, candidateSha);
});

test("a model saying done without executing tools is blocked", () => {
  const { session, calls } = setup();
  const result = session.finish("Done. I changed the code and all tests passed.");
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.missingActors, ["explorer", "coder", "tester", "security", "reviewer"]);
  assert.deepEqual(result.evidence.changedFiles, []);
  assert.equal(result.evidence.testsExecuted, false);
  assert.deepEqual(calls, []);
});

test("successful test claims for stale commits or other repositories/refs cannot complete", async t => {
  const variants: Array<[string, (evidence: TestExecutionEvidence) => void]> = [
    ["base-commit expected SHA", evidence => { evidence.expectedSha = baseSha; evidence.evidence[0].headSha = baseSha; }],
    ["another repository", evidence => { evidence.repository = "someone/other-repository"; }],
    ["another branch", evidence => { evidence.ref = "main"; }],
    ["wrong run head SHA", evidence => { evidence.evidence[0].headSha = baseSha; }],
    ["no workflow runs", evidence => { evidence.evidence = []; }],
    ["unsuccessful workflow", evidence => { evidence.evidence[0].conclusion = "failure"; }],
  ];
  for (const [name, change] of variants) await t.test(name, async () => {
    const evidence = passingEvidence();
    change(evidence);
    const { session } = setup({ verify: async () => evidence });
    const result = await execute(session);
    assert.equal(result.status, "needs-review");
    assert.equal(result.evidence.testsExecuted, false);
    assert.match(result.reasons.join("\n"), /tests have not passed for the exact task commit/);
    assert.equal(result.events.some(event => event.type === "verification_passed" && event.actor === "tester"), false);
  });
});

test("test discovery before publication never proves proposed code passed", async () => {
  const { session, calls } = setup();
  await prepare(session);
  const tested = await session.invoke("tester", "test_tezjet", () => session.test());
  assert.equal("testsExecuted" in tested && tested.testsExecuted, false);
  assert.equal(calls.some(call => call.tool === "verify"), false);
  const result = session.finish("Tests were discovered.");
  assert.equal(result.status, "needs-review");
  assert.equal(result.evidence.testsExecuted, false);
  assert.deepEqual(result.evidence.changedFiles, []);
});

test("successful CI for the candidate does not complete when its branch has advanced", async () => {
  const verificationOrder: string[] = [];
  const { session } = setup({
    verify: async (sha, ref) => { verificationOrder.push("verify"); return passingEvidence(sha, ref); },
    getCandidateHead: async ref => {
      verificationOrder.push("getCandidateHead");
      assert.equal(ref, branch);
      return "d".repeat(40);
    },
  });
  const result = await execute(session);
  assert.deepEqual(verificationOrder, ["verify", "getCandidateHead"]);
  assert.equal(result.status, "needs-review");
  assert.equal(result.evidence.testsExecuted, false);
  assert.equal(result.evidence.tests?.status, "sha-mismatch");
  assert.equal(result.evidence.tests?.expectedSha, candidateSha);
  assert.equal(result.events.some(event => event.type === "verification_passed" && event.actor === "tester"), false);
});

test("regenerating changes invalidates review and security until both run again", async () => {
  const { session, calls } = setup();
  await prepare(session);
  await session.invoke("coder", "code_tezjet", () => session.generate());
  const gated = await session.invoke("github", "publish_changes", () => session.publish());
  assert.equal("error" in gated, true);
  assert.equal(calls.some(call => call.tool === "publish"), false);
  assert.equal(session.finish("A new proposal exists.").evidence.review, undefined);
  assert.equal(session.finish("A new proposal exists.").evidence.security, undefined);
  await session.invoke("reviewer", "final_review", () => session.reviewChanges());
  await session.invoke("security", "security_review", () => session.inspectSecurity());
  await session.invoke("github", "publish_changes", () => session.publish());
  await session.invoke("tester", "test_tezjet", () => session.test());
  assert.equal(session.finish("Updated proposal verified.").status, "completed");
  assert.deepEqual(calls.filter(call => ["generate", "review", "inspectSecurity", "publish"].includes(call.tool)).map(call => call.tool),
    ["generate", "review", "inspectSecurity", "generate", "review", "inspectSecurity", "publish"]);
});

test("failed regeneration also invalidates the previous publishable change set", async () => {
  let generation = 0;
  const { session, calls } = setup({ generate: async () => {
    if (++generation > 1) throw new Error("Coder provider unavailable");
    return structuredClone(generated);
  } });
  await prepare(session);
  assert.deepEqual(await session.invoke("coder", "code_tezjet", () => session.generate()), { error: "Coder provider unavailable" });
  const result = session.finish("The earlier proposal was reviewed.");
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.evidence.proposedFiles, []);
  assert.equal(result.evidence.review, undefined);
  assert.equal(result.evidence.security, undefined);
  await session.invoke("github", "publish_changes", () => session.publish());
  assert.equal(calls.some(call => call.tool === "publish"), false);
});

test("required advisory specialists execute against the current proposal before publication", async () => {
  const { session, calls } = setup({}, { requiredActors: [...mutationActors, "backend"] });
  await prepare(session);
  await session.invoke("backend", "backend_specialist", () => session.recordAdvice("backend", readyAdvice));
  await session.invoke("github", "publish_changes", () => session.publish());
  await session.invoke("tester", "test_tezjet", () => session.test());
  const result = session.finish("Backend assessment and candidate CI verified.");
  assert.equal(result.status, "completed");
  assert.equal(calls.filter(call => call.tool === "publish").length, 1);
  const tools = result.events.filter(event => event.type === "tool_started").map(event => event.details?.tool);
  assert.ok(tools.indexOf("backend_specialist") < tools.indexOf("publish_changes"));
});

test("regeneration invalidates specialist advice and requires reassessment before publication", async () => {
  const { session, calls } = setup({}, { requiredActors: [...mutationActors, "backend"] });
  await prepare(session);
  await session.invoke("backend", "backend_specialist", () => session.recordAdvice("backend", readyAdvice));
  await session.invoke("coder", "code_tezjet", () => session.generate());
  await session.invoke("reviewer", "final_review", () => session.reviewChanges());
  await session.invoke("security", "security_review", () => session.inspectSecurity());
  assert.ok(session.finish("Regenerated proposal.").missingActors.includes("backend"));
  assert.equal("error" in await session.invoke("github", "publish_changes", () => session.publish()), true);
  assert.equal(calls.some(call => call.tool === "publish"), false);
  await session.invoke("backend", "backend_specialist", () => session.recordAdvice("backend", readyAdvice));
  await session.invoke("github", "publish_changes", () => session.publish());
  await session.invoke("tester", "test_tezjet", () => session.test());
  assert.equal(session.finish("Regenerated proposal reassessed and verified.").status, "completed");
});

test("new exploration invalidates prior specialist advice", async () => {
  const { session, calls } = setup({}, { requiredActors: [...mutationActors, "backend"] });
  await prepare(session);
  await session.invoke("backend", "backend_specialist", () => session.recordAdvice("backend", readyAdvice));
  await prepare(session);
  assert.ok(session.finish("Context reloaded.").missingActors.includes("backend"));
  assert.equal("error" in await session.invoke("github", "publish_changes", () => session.publish()), true);
  assert.equal(calls.some(call => call.tool === "publish"), false);
});

test("blocking specialist assessments prevent publication even if the tool returned", async t => {
  const assessments = [
    { ready: false, findings: [], summary: "Cannot establish readiness." },
    { ready: true, findings: [{ severity: "blocker" as const, message: "The fix breaks a backend contract." }] },
    { ready: true, findings: [{ severity: "high" as const, message: "A required validation is absent." }] },
  ];
  for (const assessment of assessments) await t.test(assessment.summary ?? assessment.findings[0].severity, async () => {
    const { session, calls } = setup({}, { requiredActors: [...mutationActors, "backend"] });
    await prepare(session);
    await session.invoke("backend", "backend_specialist", () => session.recordAdvice("backend", assessment));
    assert.equal("error" in await session.invoke("github", "publish_changes", () => session.publish()), true);
    assert.equal(calls.some(call => call.tool === "publish"), false);
    assert.notEqual(session.finish("Backend assessment returned.").status, "completed");
  });
});

test("a specialist succeeding once then failing cannot authorize publication", async () => {
  const { session, calls } = setup({}, { requiredActors: [...mutationActors, "backend"] });
  await prepare(session);
  await session.invoke("backend", "backend_specialist", () => session.recordAdvice("backend", readyAdvice));
  assert.deepEqual(await session.invoke("backend", "backend_specialist", () => { throw new Error("Backend reassessment failed"); }), { error: "Backend reassessment failed" });
  assert.equal("error" in await session.invoke("github", "publish_changes", () => session.publish()), true);
  assert.equal(calls.some(call => call.tool === "publish"), false);
  const result = session.finish("Earlier assessment was ready.");
  assert.equal(result.status, "blocked");
  assert.ok(result.reasons.includes("Backend reassessment failed"));
});

test("a partial publication failure reports its branch and never automatically retries writes", async () => {
  let writes = 0;
  const { session, calls } = setup({ publish: async () => {
    writes++;
    throw new Error("Draft PR creation failed after writing a candidate file");
  } });
  await prepare(session);
  assert.equal("error" in await session.invoke("github", "publish_changes", () => session.publish()), true);
  const result = session.finish("Publication needs inspection.");
  assert.equal(result.status, "blocked");
  assert.equal(result.evidence.publicationAttempted, true);
  assert.equal(result.evidence.publicationBranch, branch);
  assert.equal(result.evidence.publication, undefined);
  assert.match(result.reasons.join("\n"), /inspect the requested branch for partial writes/);
  const attempt = result.events.find(event => event.type === "tool_started" && event.details?.tool === "write_candidate");
  assert.equal(attempt?.details?.branch, branch);
  assert.deepEqual(attempt?.details?.files, [files[0].path]);
  assert.equal("error" in await session.invoke("github", "publish_changes", () => session.publish()), true);
  assert.equal("error" in await session.invoke("coder", "code_tezjet", () => session.generate()), true);
  await session.invoke("tester", "test_tezjet", () => session.test());
  assert.equal(writes, 1);
  assert.equal(calls.some(call => call.tool === "verify"), false);
});

test("failed tools record actor, tool and error and block completion", async () => {
  const { session } = setup({ explore: async () => { throw new Error("GitHub unavailable"); } });
  assert.deepEqual(await session.invoke("explorer", "explore_tezjet", () => session.explore()), { error: "GitHub unavailable" });
  const result = session.finish("Exploration did not succeed.");
  assert.equal(result.status, "blocked");
  assert.ok(result.missingActors.includes("explorer"));
  assert.ok(result.reasons.includes("GitHub unavailable"));
  const failure = result.events.find(event => event.type === "tool_failed");
  assert.equal(failure?.actor, "explorer");
  assert.equal(failure?.details?.tool, "explore_tezjet");
  assert.equal(failure?.message, "GitHub unavailable");
  assert.equal(result.events.some(event => event.type === "tool_completed" && event.actor === "explorer"), false);
});

test("parallel model tool calls serialize generation after exploration and review after generation", async () => {
  const order: string[] = [];
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const explorationStarted = new Promise<void>(resolve => { entered = resolve; });
  const { session } = setup({
    explore: async sha => {
      order.push("explore:start"); entered(); await barrier; order.push("explore:end");
      return { repository, ref: sha, files: [{ path: files[0].path, sha: baseSha, content: "old code" }] };
    },
    generate: async () => { order.push("generate"); return structuredClone(generated); },
    review: () => { order.push("review"); return review; },
  });
  const exploring = session.invoke("explorer", "explore_tezjet", () => session.explore());
  const coding = session.invoke("coder", "code_tezjet", () => session.generate());
  const reviewing = session.invoke("reviewer", "final_review", () => session.reviewChanges());
  await explorationStarted;
  assert.deepEqual(order, ["explore:start"]);
  release();
  const results = await Promise.all([exploring, coding, reviewing]);
  assert.equal(results.some(result => "error" in result), false);
  assert.deepEqual(order, ["explore:start", "explore:end", "generate", "review"]);
  assert.deepEqual(session.journal.snapshot().filter(event => event.type === "tool_started" || event.type === "tool_completed").map(event => [event.type, event.actor]), [
    ["tool_started", "explorer"], ["tool_completed", "explorer"],
    ["tool_started", "coder"], ["tool_completed", "coder"],
    ["tool_started", "reviewer"], ["tool_completed", "reviewer"],
  ]);
});

test("publishing is blocked when writes or publication configuration are missing", async t => {
  for (const options of [{ writesEnabled: false }, { publication: undefined }]) await t.test(JSON.stringify(options), async () => {
    const { session, calls } = setup({}, options);
    await prepare(session);
    const result = await session.invoke("github", "publish_changes", () => session.publish());
    assert.equal("error" in result, true);
    assert.equal(calls.some(call => call.tool === "publish"), false);
    assert.equal(session.finish("A reviewed proposal exists.").status, "blocked");
  });
});

test("independent review and exact-base security must pass before files are published", async t => {
  const variants: Array<[string, Partial<AiExecutionDependencies>]> = [
    ["review rejected", { review: () => ({ ...review, ready: false }) }],
    ["proposed secret found", { scan: () => ({ ...proposedSecurity, status: "findings" }) }],
    ["security scanned another repository", { inspectSecurity: async () => ({ agent: "security", repository: "other/repo", ref: baseSha, status: "clean", findings: [] }) }],
    ["security scanned a different base commit", { inspectSecurity: async () => ({ agent: "security", repository, ref: candidateSha, status: "clean", findings: [] }) }],
  ];
  for (const [name, override] of variants) await t.test(name, async () => {
    const { session, calls } = setup(override);
    await prepare(session);
    assert.equal("error" in await session.invoke("github", "publish_changes", () => session.publish()), true);
    assert.equal(calls.some(call => call.tool === "publish"), false);
    const result = session.finish("The proposal requires review.");
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.evidence.changedFiles, []);
  });
});

test("incomplete or mismatched exploration cannot seed generation", async t => {
  const valid = { path: files[0].path, sha: baseSha, content: "existing code" };
  const variants = [
    { name: "missing file", result: { repository, ref: baseSha, files: [valid, { path: "package.json", error: "not found" }] } },
    { name: "no files", result: { repository, ref: baseSha, files: [] } },
    { name: "other repository", result: { repository: "other/repo", ref: baseSha, files: [valid] } },
    { name: "moving branch ref", result: { repository, ref: "main", files: [valid] } },
  ];
  for (const variant of variants) await t.test(variant.name, async () => {
    const { session, calls } = setup({ explore: async () => variant.result });
    assert.equal("error" in await session.invoke("explorer", "explore_tezjet", () => session.explore()), true);
    assert.equal("error" in await session.invoke("coder", "code_tezjet", () => session.generate()), true);
    assert.equal(calls.some(call => call.tool === "generate"), false);
    const result = session.finish("Claimed completion.");
    assert.equal(result.status, "blocked");
    assert.equal(result.evidence.baseSha, undefined);
  });
});

test("empty final model output or a runner failure cannot complete an otherwise verified run", async t => {
  for (const output of [undefined, "", " \n"]) await t.test(String(output), async () => {
    const { session } = setup();
    await execute(session);
    const result = session.finish(output);
    assert.equal(result.status, "needs-review");
    assert.ok(result.reasons.includes("Commander returned no final explanation."));
  });
  const { session } = setup();
  await execute(session);
  const result = session.finish("Candidate verified.", "Model runner timed out");
  assert.equal(result.status, "blocked");
  assert.ok(result.reasons.includes("Model runner timed out"));
});

test("read-only audits verify the explored base commit without generating or publishing", async () => {
  const { session, calls } = setup({}, { auditOnly: true, requiredActors: ["explorer", "security", "tester"] });
  await session.invoke("explorer", "explore_tezjet", () => session.explore());
  await session.invoke("security", "security_review", () => session.inspectSecurity());
  await session.invoke("tester", "test_tezjet", () => session.test());
  const result = session.finish("Audit evidence verified.");
  assert.equal(result.status, "completed");
  assert.deepEqual(calls.map(call => call.tool), ["getHead", "explore", "inspectSecurity", "discoverTests", "verify"]);
  assert.deepEqual(calls.find(call => call.tool === "verify")?.args, [baseSha, "dev/agent-factory-core"]);
  assert.deepEqual(result.evidence.changedFiles, []);
  assert.equal(result.evidence.publication, undefined);
  assert.equal(result.evidence.testsExecuted, true);
  assert.equal("error" in await session.invoke("coder", "code_tezjet", () => session.generate()), true);
  assert.equal("error" in await session.invoke("github", "publish_changes", () => session.publish()), true);
  assert.equal(calls.some(call => call.tool === "generate" || call.tool === "publish"), false);
});
