import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TeamTaskStore } from "./teamTaskStore.js";
import { prepareTeamTask, type TeamTaskCard } from "./teamTaskCard.js";
import { verifyRecordedTeamTask } from "./teamTaskVerification.js";
import { evaluateTestExecutionEvidence } from "../agents/tester/agent.js";

const headSha = "b".repeat(40);
function fixture(t: { after: (callback: () => void) => void }, createReceipt = true) {
  const directory = mkdtempSync(join(tmpdir(), "team-task-verification-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const card: TeamTaskCard = {
    version: 1, id: "verify-one-task", goal: "Проверить состояние заказа после обновления экрана.",
    acceptanceCriteria: ["Текущая поездка сохраняется после обновления."],
    profile: "mobile", provider: "cloudflare", baseRef: "feat/owner-base", baseSha: "a".repeat(40),
    changePaths: ["mobile/tezjet-app/lib/orders.ts"], contextPaths: [],
  };
  const task = prepareTeamTask(card);
  const receiptPath = join(directory, card.id + ".json");
  const publication = { branch: task.branch, headSha, number: 77,
    url: "https://github.com/erman-ksv/Onay/pull/77" };
  const save = (url = publication.url) => {
    const store = new TeamTaskStore(directory, { id: task.id, fingerprint: task.fingerprint });
    assert.equal(store.claim(), "claimed");
    store.recordPublication({ ...publication, url });
    // A locally recorded verdict must not turn into trusted execution evidence.
    store.finish("completed", "host_receipt_only");
    store.close();
  };
  if (createReceipt) save();
  const pr = { state: "open", draft: true, html_url: publication.url,
    head: { ref: task.branch, sha: headSha, repo: { full_name: task.repository } }, base: { ref: task.baseRef } };
  const calls: string[] = [];
  const evidence = (mode: "passed" | "pending" | "failed" | "missing-step" = "passed", sha = headSha) => {
    const result = evaluateTestExecutionEvidence([{
      id: 77, run_attempt: 1, name: "Trusted required CI", head_sha: sha,
      status: mode === "pending" ? "in_progress" : "completed",
      conclusion: mode === "pending" ? null : mode === "failed" ? "failure" : "success",
      html_url: "https://github.com/erman-ksv/Onay/actions/runs/77",
    }], task.requiredCiNames.map(name => ({
      name, run_id: 77, run_attempt: 1, head_sha: sha, status: "completed", conclusion: "success",
      steps: task.requiredCiSteps.filter((_, index) => mode !== "missing-step" || index !== 0)
        .map(name => ({ name, status: "completed", conclusion: "success" })),
    })), sha, task.requiredCiNames, task.requiredCiSteps);
    return { ...result, repository: task.repository, ref: task.branch };
  };
  const dependencies: Parameters<typeof verifyRecordedTeamTask>[2] = {
    getPullRequest: async number => { calls.push("getPullRequest"); assert.equal(number, publication.number); return structuredClone(pr); },
    getCandidateHead: async branch => { calls.push("getCandidateHead"); assert.equal(branch, task.branch); return headSha; },
    verify: async (sha, branch) => { calls.push("verify"); assert.equal(sha, headSha); assert.equal(branch, task.branch); return evidence(); },
  };
  return { directory, card, task, pr, calls, dependencies, evidence, save, receiptPath,
    execute: () => verifyRecordedTeamTask(card, directory, dependencies) };
}

test("verification before the first run leaves no receipt or lock and does not consume its task id", async t => {
  const setup = fixture(t, false);
  const result = await setup.execute();
  assert.equal(result.status, "blocked");
  assert.equal(result.testsExecuted, false);
  assert.deepEqual(setup.calls, []);
  assert.deepEqual(readdirSync(setup.directory), []);
  const firstRun = new TeamTaskStore(setup.directory, { id: setup.task.id, fingerprint: setup.task.fingerprint });
  assert.equal(firstRun.claim(), "claimed");
  firstRun.close();
});

test("fresh exact CI verifies only CI and never treats a completed receipt as overall completion", async t => {
  const setup = fixture(t);
  const before = readFileSync(setup.receiptPath, "utf8");
  const result = await setup.execute();
  assert.equal(result.status, "ci-verified");
  assert.equal(result.testsExecuted, true);
  assert.equal(result.candidateSha, headSha);
  assert.equal(result.overallTaskCompletionVerified, false);
  assert.equal(result.modelRequests, 0);
  assert.equal(result.githubWrites, false);
  assert.deepEqual(setup.calls, ["getPullRequest", "getCandidateHead", "verify", "getCandidateHead"]);
  assert.equal(readFileSync(setup.receiptPath, "utf8"), before);
  assert.deepEqual(readdirSync(setup.directory), [setup.card.id + ".json"]);
});

test("a receipt without independently verified CI proves no completed task", async t => {
  const setup = fixture(t);
  setup.dependencies.verify = async () => { throw new Error("Synthetic unreadable CI"); };
  const result = await setup.execute();
  assert.equal(result.status, "blocked");
  assert.equal(result.testsExecuted, false);
  assert.equal(result.overallTaskCompletionVerified, false);
  assert.equal(result.modelRequests, 0);
  assert.equal(result.githubWrites, false);
});

test("PR repository, head, base, draft and open state must match the exact task receipt", async t => {
  const variants: Array<[string, (pr: ReturnType<typeof fixture>["pr"]) => void]> = [
    ["different head SHA", pr => { pr.head.sha = "c".repeat(40); }],
    ["different head ref", pr => { pr.head.ref = "feat/unrelated"; }],
    ["fork repository", pr => { pr.head.repo.full_name = "someone/Onay"; }],
    ["different base", pr => { pr.base.ref = "main"; }],
    ["not draft", pr => { pr.draft = false; }],
    ["closed PR", pr => { pr.state = "closed"; }],
    ["different PR URL", pr => { pr.html_url = "https://github.com/erman-ksv/Onay/pull/78"; }],
  ];
  for (const [name, change] of variants) await t.test(name, async t => {
    const setup = fixture(t);
    change(setup.pr);
    const result = await setup.execute();
    assert.equal(result.status, "blocked");
    assert.equal(result.testsExecuted, false);
    assert.equal(setup.calls.includes("verify"), false);
    assert.equal(result.overallTaskCompletionVerified, false);
  });
});

test("candidate head movement before or after CI keeps the verification gate closed", async t => {
  for (const when of ["before", "after"] as const) await t.test(when, async t => {
    const setup = fixture(t);
    let reads = 0;
    setup.dependencies.getCandidateHead = async () => ++reads >= (when === "before" ? 1 : 2) ? "c".repeat(40) : headSha;
    const result = await setup.execute();
    assert.equal(result.status, when === "before" ? "blocked" : "needs-review");
    assert.equal(result.testsExecuted, false);
    assert.equal(result.overallTaskCompletionVerified, false);
    assert.equal(setup.calls.includes("verify"), when === "after");
  });
});

test("pending, failed, missing required steps and stale successful CI never verify the candidate", async t => {
  for (const mode of ["pending", "failed", "missing-step", "stale"] as const) await t.test(mode, async t => {
    const setup = fixture(t);
    setup.dependencies.verify = async () => setup.evidence(mode === "stale" ? "passed" : mode,
      mode === "stale" ? "c".repeat(40) : headSha);
    const result = await setup.execute();
    assert.equal(result.status, "needs-review");
    assert.equal(result.testsExecuted, false);
    assert.equal(result.overallTaskCompletionVerified, false);
    assert.equal(result.modelRequests, 0);
    assert.equal(result.githubWrites, false);
  });
});

test("publication URL from another repository is rejected before any GitHub read", async t => {
  const setup = fixture(t, false);
  setup.save("https://github.com/someone/other/pull/77");
  const before = readFileSync(setup.receiptPath, "utf8");
  const result = await setup.execute();
  assert.equal(result.status, "blocked");
  assert.equal(result.testsExecuted, false);
  assert.deepEqual(setup.calls, []);
  assert.equal(readFileSync(setup.receiptPath, "utf8"), before);
});
