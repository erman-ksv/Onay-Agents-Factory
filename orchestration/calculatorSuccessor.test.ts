import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, linkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCalculatorSuccessorRequest, validateCalculatorSuccessorRequest, calculatorSuccessorRequestText,
  verifyCalculatorSuccessorHistory, verifyCalculatorSuccessorRemoteBarrier, createCalculatorSuccessorAdmission,
  collectCalculatorSuccessorEvidence, CALCULATOR_SUCCESSOR_ERROR, CALCULATOR_SUCCESSOR_PATH, CALCULATOR_SUCCESSOR_REQUEST,
  CALCULATOR_SUCCESSOR_BRANCH, CALCULATOR_SUCCESSOR_CHARGES } from "./calculatorSuccessor.js";
import { renderCalculatorSuccessorWorkflow } from "../config/calculatorSuccessorWorkflow.js";
import { CALCULATOR_PUBLISHED_STATE_PIN } from "./calculatorPublishedTaskState.js";
import { prepareCalculatorAfterCiRequest, calculatorAfterCiEventIdentity } from "./calculatorAfterCi.js";
import { prepareCalculatorEventOrigin, exportCalculatorAfterCiEventState } from "./calculatorAfterCiEventState.js";
import { TeamTaskStore } from "./teamTaskStore.js";
const SHA = "a".repeat(40), EVENT = "b".repeat(40), RUN = 22001;
const blob = (text: string) => createHash("sha1").update("blob " + Buffer.byteLength(text) + "\0").update(text).digest("hex");
const refusal = { message: CALCULATOR_SUCCESSOR_ERROR };
const env = { GITHUB_REPOSITORY: "erman-ksv/Onay-Agents-Factory", GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/" + CALCULATOR_SUCCESSOR_BRANCH,
  GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ID: String(RUN), GITHUB_SHA: EVENT, FACTORY_HISTORY_TOKEN: "fixture-history" };
function history() {
  const repository = { full_name: env.GITHUB_REPOSITORY };
  const current = { id: RUN, head_sha: EVENT, path: CALCULATOR_SUCCESSOR_PATH, run_attempt: 1, run_number: 1, head_branch: CALCULATOR_SUCCESSOR_BRANCH,
    event: "push", status: "in_progress", conclusion: null, repository, head_repository: repository, workflow_id: 98 };
  const map = new Map<string, unknown>([
    ["/actions/runs/" + RUN, current], ["/actions/workflows/98/runs?per_page=100", { total_count: 1, workflow_runs: [{ id: RUN }] }],
    ["/contents/" + CALCULATOR_SUCCESSOR_PATH + "?ref=" + EVENT, { type: "file", sha: blob(renderCalculatorSuccessorWorkflow(SHA)) }],
    ["/contents/" + CALCULATOR_SUCCESSOR_REQUEST + "?ref=" + EVENT, { type: "file", sha: blob(calculatorSuccessorRequestText(SHA)) }],
    ["/actions/runs/" + CALCULATOR_PUBLISHED_STATE_PIN.runId, { id: CALCULATOR_PUBLISHED_STATE_PIN.runId, head_sha: CALCULATOR_PUBLISHED_STATE_PIN.eventSha,
      path: ".github/workflows/calculator-step7-final-tester.yml", head_branch: CALCULATOR_SUCCESSOR_BRANCH, event: "push", run_attempt: 1,
      status: "completed", conclusion: "success", repository, head_repository: repository }],
    ["/actions/artifacts/" + CALCULATOR_PUBLISHED_STATE_PIN.artifactId, { id: CALCULATOR_PUBLISHED_STATE_PIN.artifactId,
      name: "calculator-step7-final-tester-evidence-" + CALCULATOR_PUBLISHED_STATE_PIN.runId, digest: CALCULATOR_PUBLISHED_STATE_PIN.artifactDigest,
      expired: false, size_in_bytes: 53286, workflow_run: { id: CALCULATOR_PUBLISHED_STATE_PIN.runId, head_sha: CALCULATOR_PUBLISHED_STATE_PIN.eventSha } }],
  ]);
  let calls = 0;
  const transport: typeof fetch = async (input, init) => {
    calls++; assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
    const url = String(input), prefix = "https://api.github.com/repos/" + env.GITHUB_REPOSITORY;
    assert.ok(url.startsWith(prefix)); const path = url.slice(prefix.length); assert.ok(map.has(path), path); return Response.json(map.get(path));
  };
  return { map, current, transport, calls: () => calls };
}
test("successor request fixes source, next task, historical costs and bounded allowance", () => {
  const request = createCalculatorSuccessorRequest(SHA);
  assert.equal(request.taskId, "calculator-pilot-step7-v1-34ee03-t02"); assert.equal(request.additionalAllowance.maxRequests, 4);
  assert.equal(request.additionalAllowance.maxRepairs, 0); assert.equal(request.previousCharges.completedTask.reservedRunTokens, 4210);
  assert.deepEqual(validateCalculatorSuccessorRequest(JSON.parse(calculatorSuccessorRequestText(SHA)), SHA), request);
  for (const value of [{ ...request, runtimeSha: EVENT }, { ...request, automaticReplay: true }, { ...request, ignored: true },
    { ...request, source: { ...request.source, artifactId: 12398981222 } },
    { ...request, additionalAllowance: { ...request.additionalAllowance, maxRequests: 5 } }, { ...request, previousCharges: {} }])
    assert.throws(() => validateCalculatorSuccessorRequest(value, SHA), refusal);
  assert.throws(() => createCalculatorSuccessorRequest("main"));
});
test("only one first-attempt run with exact request/workflow and real source artifact passes history", async () => {
  const f = history(); await verifyCalculatorSuccessorHistory(env, SHA, f.transport); assert.equal(f.calls(), 6);
});
test("reruns, forks, modified workflow/request and missing/expired/test source artifacts stop before execution", async t => {
  const cases: Array<[string, (f: ReturnType<typeof history>) => void]> = [
    ["attempt", f => { f.current.run_attempt = 2; }], ["run number", f => { f.current.run_number = 2; }],
    ["fork", f => { f.current.head_repository = { full_name: "other/repository" }; }],
    ["branch", f => { f.current.head_branch = "main"; }], ["event", f => { f.current.event = "workflow_dispatch"; }],
    ["prior run exists", f => { f.map.set("/actions/workflows/98/runs?per_page=100", { total_count: 2, workflow_runs: [{ id: RUN }, { id: 17 }] }); }],
    ["wrong workflow", f => { f.map.set("/contents/" + CALCULATOR_SUCCESSOR_PATH + "?ref=" + EVENT, { type: "file", sha: EVENT }); }],
    ["wrong request", f => { f.map.set("/contents/" + CALCULATOR_SUCCESSOR_REQUEST + "?ref=" + EVENT, { type: "file", sha: EVENT }); }],
    ["expired", f => { const key = "/actions/artifacts/" + CALCULATOR_PUBLISHED_STATE_PIN.artifactId; f.map.set(key, { ...(f.map.get(key) as object), expired: true }); }],
    ["test artifact", f => { const key = "/actions/artifacts/" + CALCULATOR_PUBLISHED_STATE_PIN.artifactId; f.map.set(key, { ...(f.map.get(key) as object), name: "calculator-event-state-audit-39715712558" }); }],
    ["source failed", f => { const key = "/actions/runs/" + CALCULATOR_PUBLISHED_STATE_PIN.runId; f.map.set(key, { ...(f.map.get(key) as object), conclusion: "failure" }); }],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => { const f = history(); mutate(f); await assert.rejects(() => verifyCalculatorSuccessorHistory(env, SHA, f.transport), refusal); });
  const f = history(); await assert.rejects(() => verifyCalculatorSuccessorHistory({ ...env, GITHUB_RUN_ATTEMPT: "2" }, SHA, f.transport)); assert.equal(f.calls(), 0);
});
test("remote barrier acknowledgement binds artifact bytes, source run and exact event", async t => {
  const barrierEnv = { ...env, CALCULATOR_SUCCESSOR_BARRIER_ID: "77", CALCULATOR_SUCCESSOR_BARRIER_DIGEST: "sha256:" + "d".repeat(64) };
  const good = { id: 77, name: "calculator-successor-admission-" + RUN, digest: barrierEnv.CALCULATOR_SUCCESSOR_BARRIER_DIGEST,
    expired: false, size_in_bytes: 1500, workflow_run: { id: RUN, head_sha: EVENT } };
  for (const [name, value] of [["valid", good], ["wrong digest", { ...good, digest: "sha256:" + "e".repeat(64) }],
    ["expired", { ...good, expired: true }], ["wrong run", { ...good, workflow_run: { id: RUN + 1, head_sha: EVENT } }],
    ["wrong event", { ...good, workflow_run: { id: RUN, head_sha: SHA } }], ["audit name", { ...good, name: "calculator-event-state-audit-39715712558" }]] as const)
    await t.test(name, async () => { const transport: typeof fetch = async (_url, init) => { assert.equal(init?.method, "GET"); return Response.json(value); };
      if (name === "valid") await verifyCalculatorSuccessorRemoteBarrier(barrierEnv, transport);
      else await assert.rejects(() => verifyCalculatorSuccessorRemoteBarrier(barrierEnv, transport), refusal);
    });
});
test("uploaded admission intent is byte-identical to the later real claimed event including its crash lock", () => {
  const root = mkdtempSync(join(tmpdir(), "successor-admission-"));
  const transition = prepareCalculatorAfterCiRequest({ version: 1, planFingerprint: CALCULATOR_PUBLISHED_STATE_PIN.planFingerprint,
    previousTaskId: CALCULATOR_PUBLISHED_STATE_PIN.taskId, candidateSha: CALCULATOR_PUBLISHED_STATE_PIN.candidateSha, expectedNextTaskId: createCalculatorSuccessorRequest(SHA).taskId });
  const origin = prepareCalculatorEventOrigin({ repository: env.GITHUB_REPOSITORY, workflowPath: CALCULATOR_SUCCESSOR_PATH, runId: RUN,
    runAttempt: 1, eventSha: EVENT, runtimeSha: SHA });
  try {
    const intent = createCalculatorSuccessorAdmission(root, transition, origin), live = join(root, "live-event"); mkdirSync(live, { mode: 0o700 });
    const store = new TeamTaskStore(live, calculatorAfterCiEventIdentity(transition));
    try { store.claim(); store.recordStage("execute_next_task", "running");
      const actual = exportCalculatorAfterCiEventState(live, join(root, "confirmed-event"), transition, origin);
      assert.equal(actual.manifestSha256, intent.manifestSha256); assert.equal(actual.lockPresent, true); assert.equal(actual.receiptStatus, "running");
    } finally { store.close(); }
    assert.throws(() => createCalculatorSuccessorAdmission(root, transition, origin));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("private successor export preserves old charges, new events and failure checkpoints without replacing source", () => {
  const root = mkdtempSync(join(tmpdir(), "successor-collect-"));
  try {
    mkdirSync(join(root, "prior-evidence"), { mode: 0o700 }); mkdirSync(join(root, "execution-private"), { mode: 0o700 });
    writeFileSync(join(root, "prior-evidence", "history.json"), JSON.stringify(CALCULATOR_SUCCESSOR_CHARGES), { mode: 0o600 });
    writeFileSync(join(root, "execution-private", "new.execution.json"), JSON.stringify({ status: "blocked", modelState: { attemptedRequests: 1 } }), { mode: 0o600 });
    const result = collectCalculatorSuccessorEvidence(root); assert.equal(result.fileCount, 2);
    const manifest = JSON.parse(readFileSync(join(root, "successor-artifact", "manifest.json"), "utf8"));
    assert.deepEqual(manifest.previousCharges, CALCULATOR_SUCCESSOR_CHARGES); assert.equal(manifest.resumeAuthorized, false);
    assert.deepEqual(readFileSync(join(root, "prior-evidence/history.json")), readFileSync(join(root, "successor-artifact/evidence/prior-evidence/history.json")));
    assert.throws(() => collectCalculatorSuccessorEvidence(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("collector rejects unlisted source, linked files and leaked secrets before creating a reusable archive", async t => {
  for (const name of ["source", "link", "secret"] as const) await t.test(name, () => {
    const root = mkdtempSync(join(tmpdir(), "successor-collect-refuse-"));
    try {
      if (name === "source") writeFileSync(join(root, "unexpected.mjs"), "export const code = true;");
      else { const path = join(root, "context.json"); writeFileSync(path, JSON.stringify({ value: name === "secret" ? "gsk_" + "A".repeat(40) : "safe" }), { mode: 0o600 });
        if (name === "link") linkSync(path, join(root, "linked.json")); }
      assert.throws(() => collectCalculatorSuccessorEvidence(root), refusal); assert.ok(!readdirSync(root).includes("successor-artifact"));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
test("production workflow persists admission before exposing model credentials and always collects evidence", () => {
  const workflow = renderCalculatorSuccessorWorkflow(SHA);
  assert.ok(workflow.indexOf("actions/upload-artifact@v4") < workflow.indexOf("GROQ_API_KEY"));
  assert.ok(workflow.includes("CALCULATOR_SUCCESSOR_BARRIER_ID: ${{ steps.barrier.outputs.artifact-id }}"));
  assert.ok(workflow.includes("ref: " + SHA)); assert.ok(workflow.includes("${{ always() }}"));
  assert.ok(workflow.includes("artifact-ids: '12350008132'")); assert.ok(!workflow.includes("12398981222"));
  assert.ok(!workflow.includes("contents: write")); assert.ok(!workflow.includes("pull_request_target"));
  assert.throws(() => renderCalculatorSuccessorWorkflow("main"));
});
