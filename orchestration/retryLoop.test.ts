import assert from "node:assert/strict";
import test from "node:test";
import { AgentRunJournal } from "./agentRunJournal.js";
import { boundedRepairAttempts, retryFailedCi, type RetryLoopDependencies } from "./retryLoop.js";
import { getTargetRepository } from "../github/repositoryConfig.js";

const originalSha = "a".repeat(40);
const repairedSha = "b".repeat(40);
const input = { goal: "Repair seat restoration", branch: "fix/seat-restoration", repositoryContext: "FILE: src/seats.ts\nexport const seats = 1;", headSha: originalSha };
const change = { path: "src/seats.ts", content: "export const seats = 2;", message: "Repair seat restoration" };
const requiredSteps = ["Typecheck", "API integration tests"];

function dependencies(): RetryLoopDependencies {
  return {
    generate: async () => ({ summary: "Fixed", files: [change] }),
    review: () => ({ agent: "reviewer", ready: true, findings: [] }),
    scan: () => ({ agent: "security", status: "clean", findings: [] }),
    security: async (_paths, repository, ref) => ({ agent: "security", repository: repository ?? getTargetRepository(), ref: ref ?? "main", status: "clean", findings: [] }),
    failure: async (_branch, _sha, requiredNames, options) => {
      assert.deepEqual(requiredNames, ["Typecheck and API tests"]);
      assert.deepEqual(options?.requiredStepNames, requiredSteps);
      return { gate: { status: "failed", runs: [] }, failures: [] };
    },
    write: async () => repairedSha,
    wait: async ({ requiredStepNames }) => {
      assert.deepEqual(requiredStepNames, requiredSteps);
      return { status: "passed", runs: [] };
    },
  };
}

test("a second CI repair receives the latest written file contents and original goal", async () => {
  const deps = dependencies();
  let generations = 0;
  deps.generate = async (goal, context) => {
    assert.match(goal, /Repair seat restoration/);
    if (++generations === 2) {
      assert.match(context, /CURRENT CANDIDATE FILES/);
      assert.match(context, /export const seats = 2;/);
    }
    return { summary: "Fixed", files: [{ ...change, content: `export const seats = ${generations + 1};` }] };
  };
  let waits = 0;
  deps.wait = async () => ({ status: ++waits === 1 ? "failed" : "passed", runs: [] });
  const result = await retryFailedCi(input, deps);
  assert.equal(result.status, "passed");
  assert.equal(result.headSha, repairedSha);
  assert.equal(generations, 2);
});

test("rejected repair contents are distinct from the committed candidate sent to the next Coder", async t => {
  for (const gate of ["review", "security"]) await t.test(gate, async () => {
    const deps = dependencies();
    let generations = 0;
    let validations = 0;
    const written: string[] = [];
    deps.generate = async (goal, context) => {
      generations++;
      if (generations === 3) {
        const [committed, rejected] = context.split("REJECTED PROPOSAL");
        assert.match(committed, /CURRENT CANDIDATE FILES[\s\S]*export const seats = 2;/);
        assert.doesNotMatch(committed, /seats = 99/);
        assert.match(rejected, /not written[\s\S]*export const seats = 99;/);
        assert.match(goal, /Rejected repair/);
      }
      const seats = generations === 2 ? 99 : generations + 1;
      return { summary: "Fixed", files: [{ ...change, content: `export const seats = ${seats};` }] };
    };
    if (gate === "review") {
      deps.review = () => ++validations === 2
        ? { agent: "reviewer", ready: false, findings: [{ severity: "high", message: "Rejected repair" }] }
        : { agent: "reviewer", ready: true, findings: [] };
    } else {
      deps.scan = () => ++validations === 2
        ? { agent: "security", status: "findings", findings: [{ path: change.path, line: 1, pattern: "test", message: "Rejected repair" }] }
        : { agent: "security", status: "clean", findings: [] };
    }
    deps.write = async (_path, content) => { written.push(content); return repairedSha; };
    let waits = 0;
    deps.wait = async ({ requiredStepNames }) => {
      assert.deepEqual(requiredStepNames, requiredSteps);
      return { status: ++waits === 1 ? "failed" : "passed", runs: [] };
    };
    const result = await retryFailedCi({ ...input, maxAttempts: 3 }, deps);
    assert.equal(result.status, "passed");
    assert.deepEqual(written, ["export const seats = 2;", "export const seats = 4;"]);
    assert.equal(result.attempts[1].reason, `${gate}-blocked`);
  });
});

test("independent review rejection is returned to Coder before any write", async () => {
  const deps = dependencies();
  const journal = new AgentRunJournal(input.goal);
  let reviews = 0;
  let writes = 0;
  deps.review = () => ++reviews === 1
    ? { agent: "reviewer", ready: false, findings: [{ severity: "high", message: "Unsafe transition" }] }
    : { agent: "reviewer", ready: true, findings: [] };
  deps.generate = async goal => {
    if (reviews) assert.match(goal, /Unsafe transition/);
    return { summary: "Fixed", files: [change] };
  };
  deps.write = async () => { writes++; return repairedSha; };
  const result = await retryFailedCi({ ...input, journal }, deps);
  assert.equal(result.status, "passed");
  assert.equal(writes, 1);
  assert.equal(result.attempts[0].reason, "review-blocked");
  assert.ok(journal.snapshot().some(event => event.type === "handoff" && event.actor === "reviewer" && event.details?.to === "coder"));
});

test("repeated security rejection exhausts the bounded repair budget without writing", async () => {
  const deps = dependencies();
  let generations = 0;
  deps.generate = async () => { generations++; return { summary: "Fixed", files: [change] }; };
  deps.scan = () => ({ agent: "security", status: "findings", findings: [{ path: change.path, line: 1, pattern: "test", message: "Potential secret" }] });
  deps.write = async () => { assert.fail("Rejected repair must never be written"); };
  const result = await retryFailedCi({ ...input, maxAttempts: 99 }, deps);
  assert.equal(result.status, "blocked");
  assert.equal(generations, 3);
  assert.equal(result.headSha, originalSha);
});

test("retry counts remain finite and integral for malformed numeric limits", () => {
  assert.equal(boundedRepairAttempts(Number.NaN), 2);
  assert.equal(boundedRepairAttempts(Number.POSITIVE_INFINITY), 2);
  assert.equal(boundedRepairAttempts(2.8), 2);
  assert.equal(boundedRepairAttempts(-1), 1);
  assert.equal(boundedRepairAttempts(0, 0), 0);
});

test("pending CI does not launch a developer or write a repair", async () => {
  const deps = dependencies();
  deps.failure = async () => ({ gate: { status: "pending", runs: [] }, failures: [] });
  deps.generate = async () => { assert.fail("Pending CI has no failure to repair"); };
  const result = await retryFailedCi(input, deps);
  assert.equal(result.status, "waiting");
  assert.equal(result.attempts.length, 0);
});

test("repository security findings stop a repair before writing", async () => {
  const deps = dependencies();
  deps.security = async (_paths, repository, ref) => {
    assert.equal(ref, originalSha);
    return { agent: "security", repository: repository!, ref: ref!, status: "findings", findings: [{ path: "src/secret.ts", findings: ["Could not inspect file"] }] };
  };
  deps.write = async () => { assert.fail("Repository security failure must block writes"); };
  assert.equal((await retryFailedCi(input, deps)).status, "blocked");
});

test("unsuccessful CI after the last repair remains max-attempts with the final SHA", async () => {
  const deps = dependencies();
  deps.wait = async () => ({ status: "failed", runs: [] });
  const result = await retryFailedCi({ ...input, maxAttempts: 1 }, deps);
  assert.equal(result.status, "max-attempts");
  assert.equal(result.headSha, repairedSha);
  assert.equal(result.attempts.length, 1);
});
