import assert from "node:assert/strict";
import test from "node:test";
import { generateAndPrepareOnayChange, runChangePipeline, type PipelineDependencies, type PipelineGenerationDependencies } from "./pipeline.js";
import { getTargetRepository } from "../github/repositoryConfig.js";
import type { TestExecutionEvidence } from "../agents/tester/agent.js";

const originalSha = "a".repeat(40);
const repairedSha = "b".repeat(40);
const baseSha = "c".repeat(40);
const requiredSteps = ["Typecheck", "API integration tests"];
const input = {
  goal: "Repair seat restoration", branch: "fix/seat-restoration", title: "Repair seats", body: "Restore seats once.",
  files: [{ path: "src/seats.ts", content: "export const seats = 1;", message: "Repair seats" }],
};

function passingEvidence(sha: string, repository = getTargetRepository(), ref = input.branch): TestExecutionEvidence {
  const job = {
    run_id: 1, run_attempt: 1, head_sha: sha, name: "Typecheck and API tests", status: "completed", conclusion: "success",
    steps: requiredSteps.map(name => ({ name, status: "completed", conclusion: "success" })),
  };
  return {
    testsExecuted: true, status: "passed", expectedSha: sha, repository, ref,
    evidence: [{ runId: 1, runAttempt: 1, name: "CI", headSha: sha, conclusion: "success", url: "https://example.test/run/1" }],
    jobs: [job], checks: job.steps.map(step => ({ runId: job.run_id, runAttempt: job.run_attempt, jobName: job.name, ...step })), notes: [],
  };
}

function dependencies(): PipelineDependencies {
  return {
    generate: async () => ({ summary: "Fixed", files: [{ ...input.files[0], content: "export const seats = 2;" }] }),
    review: () => ({ agent: "reviewer", ready: true, findings: [] }),
    scan: () => ({ agent: "security", status: "clean", findings: [] }),
    security: async (_paths, repository, ref) => ({ agent: "security", repository: repository!, ref: ref!, status: "clean", findings: [] }),
    prepare: async () => ({ html_url: "https://example.test/pull/1", number: 1, head_sha: originalSha, head: { sha: originalSha } }),
    wait: async ({ requiredStepNames }) => {
      assert.deepEqual(requiredStepNames, requiredSteps);
      return { status: "passed", runs: [] };
    },
    repair: async () => ({ status: "passed", attempts: [], headSha: repairedSha, ci: { status: "passed", runs: [] } }),
    verify: async (sha, repository, ref, _requiredNames, requiredStepNames) => {
      assert.deepEqual(requiredStepNames, requiredSteps);
      return passingEvidence(sha, repository, ref);
    },
    getHead: async ref => ref === "main" ? baseSha : originalSha,
  };
}

test("a rejected proposal returns to Coder and revalidates the actual repaired files", async () => {
  const deps = dependencies();
  let reviews = 0;
  deps.review = ({ files }) => {
    reviews++;
    return { agent: "reviewer", ready: files[0].content.includes("seats = 2"), findings: [{ severity: "high", message: "Use the corrected seat value" }] };
  };
  deps.prepare = async ({ files }) => {
    assert.match(files[0].content, /seats = 2/);
    return { html_url: "https://example.test/pull/1", number: 1, head_sha: originalSha, head: { sha: originalSha } };
  };
  const result = await runChangePipeline(input, deps);
  assert.equal(result.status, "ci-passed");
  assert.equal(reviews, 2);
  assert.ok(result.events.some(event => event.type === "handoff" && event.actor === "reviewer" && event.details?.to === "coder"));
});

test("repeated review failures stay blocked and never prepare a branch", async () => {
  const deps = dependencies();
  let generations = 0;
  deps.review = () => ({ agent: "reviewer", ready: false, findings: [{ severity: "high", message: "Unsafe change" }] });
  deps.generate = async () => { generations++; return { summary: "Fixed", files: input.files }; };
  deps.prepare = async () => { assert.fail("Rejected proposals must never be published"); };
  const result = await runChangePipeline({ ...input, maxRepairAttempts: 1 }, deps);
  assert.equal(result.status, "blocked");
  assert.equal(generations, 1);
});

test("repository security failure cannot be hidden by a clean proposed-change scan", async () => {
  const deps = dependencies();
  deps.security = async () => ({ agent: "security", repository: getTargetRepository(), ref: "main", status: "findings", findings: [{ path: "src/secret.ts", findings: ["Could not inspect file"] }] });
  deps.prepare = async () => { assert.fail("Security failure must block publication"); };
  assert.equal((await runChangePipeline(input, deps)).status, "blocked");
});

test("testsExecuted cannot hide failed or different-commit test evidence", async () => {
  for (const override of [{ status: "failed" as const }, { expectedSha: repairedSha }, { repository: "someone/other" }, { evidence: [] }]) {
    const deps = dependencies();
    const verify = deps.verify;
    deps.verify = async (...args) => ({ ...await verify(...args), ...override });
    assert.equal((await runChangePipeline(input, deps)).status, "test-evidence-blocked");
  }
});

test("moving the candidate branch during verification blocks completion", async () => {
  const deps = dependencies();
  deps.getHead = async ref => ref === "main" ? baseSha : repairedSha;
  const result = await runChangePipeline(input, deps);
  assert.equal(result.status, "test-evidence-blocked");
  assert.equal("actualHeadSha" in result && result.actualHeadSha, repairedSha);
});

test("a successful CI repair returns the final candidate SHA and final CI rather than stale failure", async () => {
  const deps = dependencies();
  deps.wait = async () => ({ status: "failed", runs: [] });
  deps.getHead = async ref => ref === "main" ? baseSha : repairedSha;
  deps.verify = async (sha, repository, ref, _requiredNames, requiredStepNames) => {
    assert.equal(sha, repairedSha);
    assert.deepEqual(requiredStepNames, requiredSteps);
    return passingEvidence(sha, repository, ref);
  };
  const result = await runChangePipeline(input, deps);
  assert.equal(result.status, "ci-passed");
  assert.equal("headSha" in result && result.headSha, repairedSha);
  assert.equal("pullRequest" in result && result.pullRequest.head_sha, repairedSha);
  assert.equal("ci" in result && result.ci?.status, "passed");
  assert.deepEqual("initialCi" in result && result.initialCi, { status: "failed", runs: [] });
});

test("raw jobs must prove both required steps for the exact run, attempt and commit", async t => {
  const cases: Array<[string, (evidence: TestExecutionEvidence) => void]> = [
    ["missing raw jobs", evidence => { evidence.jobs = undefined; }],
    ["wrong run", evidence => { evidence.jobs![0].run_id = 2; }],
    ["wrong attempt", evidence => { evidence.jobs![0].run_attempt = 2; }],
    ["missing workflow attempt", evidence => { evidence.evidence[0].runAttempt = undefined; }],
    ["wrong job commit", evidence => { evidence.jobs![0].head_sha = baseSha; }],
    ["missing job commit", evidence => { evidence.jobs![0].head_sha = undefined; }],
    ["missing Typecheck", evidence => { evidence.jobs![0].steps!.shift(); }],
    ["skipped API tests", evidence => { evidence.jobs![0].steps![1].conclusion = "skipped"; }],
    ["API tests belong to an unrelated job", evidence => {
      const job = evidence.jobs![0];
      const apiStep = job.steps!.pop()!;
      evidence.jobs!.push({ ...job, name: "Build assets", steps: [apiStep] });
    }],
    ["another matrix entry cannot supply missing API tests", evidence => {
      const job = evidence.jobs![0];
      evidence.jobs!.push({ ...structuredClone(job), name: "Typecheck and API tests (22)" });
      job.name = "Typecheck and API tests (20)";
      job.steps!.pop();
    }],
  ];
  for (const repaired of [false, true]) {
    for (const [name, mutate] of cases) await t.test(`${repaired ? "repaired" : "initial"} candidate: ${name}`, async () => {
      const deps = dependencies();
      if (repaired) {
        deps.wait = async () => ({ status: "failed", runs: [] });
        deps.getHead = async ref => ref === "main" ? baseSha : repairedSha;
      }
      deps.verify = async (sha, repository, ref) => {
        const evidence = passingEvidence(sha, repository, ref);
        mutate(evidence);
        // The high-level claim and flattened checks remain successful; raw jobs must control the gate.
        return evidence;
      };
      assert.equal((await runChangePipeline(input, deps)).status, "test-evidence-blocked");
    });
  }
});

test("generation, repository security and branch creation share one immutable base despite main advancing", async () => {
  const deps: PipelineGenerationDependencies = { ...dependencies(), explore: async () => assert.fail("Expected pinned exploration") };
  const calls: string[] = [];
  let mainLookups = 0;
  deps.getHead = async ref => {
    if (ref === "main") {
      calls.push("resolve-base");
      return ++mainLookups === 1 ? baseSha : repairedSha;
    }
    return originalSha;
  };
  deps.explore = async (_paths, ref, repository) => {
    calls.push("explore");
    assert.equal(ref, baseSha);
    assert.equal(repository, getTargetRepository());
    return { repository: repository!, ref: ref!, files: [{ path: input.files[0].path, sha: baseSha, content: input.files[0].content }] };
  };
  deps.generate = async (_goal, context) => {
    calls.push("generate");
    assert.match(context, /export const seats = 1/);
    return { summary: "Fixed", files: input.files };
  };
  deps.security = async (_paths, repository, ref) => {
    calls.push("security");
    assert.equal(ref, baseSha);
    return { agent: "security", repository: repository!, ref: ref!, status: "clean", findings: [] };
  };
  deps.prepare = async proposal => {
    calls.push("prepare");
    assert.equal(proposal.baseRef, "main");
    assert.equal(proposal.baseSha, baseSha);
    return { html_url: "https://example.test/pull/1", number: 1, head_sha: originalSha, head: { sha: originalSha } };
  };
  const result = await generateAndPrepareOnayChange(input, deps);
  assert.equal(result.status, "ci-passed");
  assert.equal(mainLookups, 1);
  assert.deepEqual(calls, ["resolve-base", "explore", "generate", "security", "prepare"]);
});

test("exploration from another commit blocks generation and branch preparation", async () => {
  const deps: PipelineGenerationDependencies = {
    ...dependencies(),
    explore: async () => ({ repository: getTargetRepository(), ref: repairedSha, files: [{ path: input.files[0].path, sha: repairedSha, content: input.files[0].content }] }),
  };
  deps.generate = async () => assert.fail("Mismatched exploration must not generate changes");
  deps.prepare = async () => assert.fail("Mismatched exploration must not create a branch");
  assert.equal((await generateAndPrepareOnayChange(input, deps)).status, "blocked");
});

test("an exhausted CI repair cannot complete the task", async () => {
  const deps = dependencies();
  deps.wait = async () => ({ status: "failed", runs: [] });
  deps.repair = async () => ({ status: "max-attempts", attempts: [], headSha: repairedSha, gate: { status: "failed", runs: [] } });
  deps.verify = async () => { assert.fail("Failed repair has no successful candidate to verify"); };
  assert.equal((await runChangePipeline(input, deps)).status, "ci-repair");
});
