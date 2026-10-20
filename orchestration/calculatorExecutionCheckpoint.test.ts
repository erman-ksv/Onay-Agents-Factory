import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PreparedCalculatorChanges } from "../commander/calculatorChanges.js";
import type { CalculatorAssessment } from "../commander/calculatorTeam.js";
import { calculatorProposalDigest } from "./calculatorExecutionEvidence.js";
import { CALCULATOR_EXECUTION_CHECKPOINT_ERROR, createCalculatorExecutionCheckpointStore,
  type CalculatorExecutionCheckpointIdentity, type CalculatorExecutionCheckpointPayload } from "./calculatorExecutionCheckpoint.js";

const identity: CalculatorExecutionCheckpointIdentity = Object.freeze({
  repository: "erman-ksv/Onay-Calculator", goalId: "goal-20261020", taskId: "calc-core",
  ownerFingerprint: "a".repeat(64), planFingerprint: "b".repeat(64), branch: "main",
  baseSha: "c".repeat(40), bootstrapSha: "d".repeat(40), runtimeConfigDigest: "e".repeat(64),
});
const error = { message: CALCULATOR_EXECUTION_CHECKPOINT_ERROR };
function fixture(t: { after(callback: () => void): void }) {
  const parent = mkdtempSync(join(tmpdir(), "calculator-private-")), directory = join(parent, "execution-private");
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, directory, path: join(directory, identity.taskId + ".execution.json") };
}
function proposal(content = "export function add(a, b) { return a + b; }\n"): PreparedCalculatorChanges {
  return { repository: identity.repository, baseRef: identity.branch, baseSha: identity.baseSha,
    summary: "Private Coder proposal summary", files: [{ path: "src/calculator.js", content, message: "Create calculator core" }],
    reviewEvidence: JSON.stringify({ repository: identity.repository, baseSha: identity.baseSha,
      changes: [{ operation: "create", path: "src/calculator.js", absenceVerifiedAt: identity.baseSha,
        content, contentSha256: createHash("sha256").update(content).digest("hex") }],
      unverified: ["Independent review", "Exact-candidate runtime CI"] }),
    gates: { secretScan: "passed", policyReview: "passed", independentReview: "required", tests: "required", publicationAuthorized: false } };
}
function assessment(role: "security" | "reviewer" | "tester" = "security"): CalculatorAssessment {
  return { role, ready: true, summary: "Private assessment summary",
    findings: [{ severity: "low", message: "Private finding text", evidenceRefs: ["src/calculator.js"], evidenceStatus: "supplied" }],
    unverifiedAreas: ["Exact candidate runtime CI"], testsExecuted: false,
    overallTaskCompletionVerified: false, publicationAuthorized: false };
}
function payload(overrides: Partial<CalculatorExecutionCheckpointPayload> = {}): CalculatorExecutionCheckpointPayload {
  return { attempt: 1, stage: "generate_1", status: "passed", proposal: proposal(), assessments: [],
    modelState: { attemptedRequests: 1, totalRequestBytes: 400, reservedRunTokens: 1200, elapsedMs: 100 },
    httpInFlight: false, publicationStarted: false, ...overrides };
}

test("private proposal roundtrip has exact digest, sequence, clone isolation and source-free metadata", t => {
  const { directory, path } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  t.after(() => store.close());
  assert.equal(store.read(), undefined); assert.equal(store.inspect(), undefined);
  const input = payload({ assessments: [assessment()] }), saved = store.save(input);
  assert.equal(saved.sequence, 1);
  assert.equal(saved.bytes, Buffer.byteLength(readFileSync(path)));
  assert.equal(saved.sha256, createHash("sha256").update(readFileSync(path)).digest("hex"));
  assert.deepEqual(store.read(saved.sha256), input);
  const copy = store.read(saved.sha256)!;
  (copy.proposal!.files[0] as { content: string }).content = "mutated caller copy";
  assert.deepEqual(store.read(saved.sha256), input);
  const metadata = store.inspect()!;
  assert.equal(metadata.proposalDigest, calculatorProposalDigest(input.proposal!));
  assert.deepEqual(metadata.completedRoles, ["security"]);
  assert.equal(metadata.chargeAccounting, "conservative-high-water");
  const publicText = JSON.stringify(metadata);
  for (const privateText of [input.proposal!.files[0]!.content, input.proposal!.summary,
    input.proposal!.reviewEvidence, "Private assessment summary", "Private finding text"])
    assert.equal(publicText.includes(privateText), false);
});

test("private files have restrictive permissions and exclusive lock survives duplicate open", t => {
  const { directory, path } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  store.save(payload());
  assert.equal(lstatSync(directory).mode & 0o777, 0o700);
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
  assert.equal(lstatSync(path + ".lock").mode & 0o777, 0o600);
  assert.throws(() => createCalculatorExecutionCheckpointStore(directory, identity), error);
  assert.equal(existsSync(path + ".lock"), true);
  store.close(); store.close();
  assert.equal(existsSync(path + ".lock"), false);
  const reopened = createCalculatorExecutionCheckpointStore(directory, identity);
  t.after(() => reopened.close()); assert.equal(reopened.inspect()!.sequence, 1);
});

test("valid provider settlement retains conservative high-water charge across reopen", t => {
  const { directory } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  store.save(payload({ stage: "security_1", status: "running", httpInFlight: true,
    modelState: { attemptedRequests: 2, totalRequestBytes: 900, reservedRunTokens: 2400, elapsedMs: 200 } }));
  const ref = store.save(payload({ stage: "security_1", assessments: [assessment()],
    modelState: { attemptedRequests: 2, totalRequestBytes: 900, reservedRunTokens: 1300, elapsedMs: 230 } }));
  assert.equal(ref.sequence, 2); assert.equal(store.read(ref.sha256)!.modelState.reservedRunTokens, 2400);
  store.close();
  const reopened = createCalculatorExecutionCheckpointStore(directory, identity);
  t.after(() => reopened.close());
  assert.equal(reopened.read(ref.sha256)!.modelState.reservedRunTokens, 2400);
  assert.equal(reopened.inspect()!.chargeAccounting, "conservative-high-water");
});

test("counter rollback is refused before durable evidence is replaced", t => {
  const { directory, path } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  t.after(() => store.close()); const first = store.save(payload()), original = readFileSync(path, "utf8");
  for (const key of ["attemptedRequests", "totalRequestBytes", "elapsedMs"] as const)
    assert.throws(() => store.save(payload({ modelState: { ...payload().modelState, [key]: 0 } })), error);
  assert.equal(readFileSync(path, "utf8"), original);
  assert.deepEqual(store.read(first.sha256), payload());
});

test("external digest and monotonic live identity reject stale rollback or changed bytes", t => {
  const { directory, path } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  t.after(() => store.close()); const first = store.save(payload()), oldBytes = readFileSync(path);
  const second = store.save(payload({ stage: "security_1", assessments: [assessment()] }));
  assert.throws(() => store.read(first.sha256), error);
  assert.throws(() => store.read("not-a-digest"), error);
  assert.deepEqual(store.read(second.sha256)!.assessments, [assessment()]);
  writeFileSync(path, oldBytes, { mode: 0o600 });
  assert.throws(() => store.inspect(), error); assert.throws(() => store.save(payload()), error);
});

test("saved identity binds goal, task, owner, plan, base, bootstrap and runtime configuration", t => {
  const { directory } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  store.save(payload()); store.close();
  const changes = { repository: "other/repo", goalId: "different-goal", ownerFingerprint: "1".repeat(64),
    planFingerprint: "2".repeat(64), branch: "different", baseSha: "3".repeat(40),
    bootstrapSha: "4".repeat(40), runtimeConfigDigest: "5".repeat(64) };
  for (const [key, value] of Object.entries(changes))
    assert.throws(() => createCalculatorExecutionCheckpointStore(directory, { ...identity, [key]: value }), error);
  assert.throws(() => createCalculatorExecutionCheckpointStore(directory, { ...identity, unknown: true } as CalculatorExecutionCheckpointIdentity), error);
  assert.throws(() => createCalculatorExecutionCheckpointStore(directory, { ...identity, taskId: "../escape" }), error);
  const recovered = createCalculatorExecutionCheckpointStore(directory, identity);
  t.after(() => recovered.close()); assert.equal(recovered.read()!.attempt, 1);
});

test("reopened capsule integrity detects modified content and unknown fields", t => {
  const { directory, path } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  store.save(payload()); store.close(); const original = readFileSync(path, "utf8");
  for (const mutate of [(data: any) => { data.payload.proposal.files[0].content = "tampered"; },
    (data: any) => { data.unrecognized = true; }, (data: any) => { data.sequence = 0; },
    (data: any) => { data.payload.modelState.reservedRunTokens = -1; }]) {
    const data = JSON.parse(original); mutate(data); writeFileSync(path, JSON.stringify(data), { mode: 0o600 });
    assert.throws(() => createCalculatorExecutionCheckpointStore(directory, identity), error);
  }
  writeFileSync(path, original, { mode: 0o600 });
  const recovered = createCalculatorExecutionCheckpointStore(directory, identity);
  t.after(() => recovered.close()); assert.equal(recovered.inspect()!.sequence, 1);
});

test("only unfinished role suffix can be appended and recorded roles cannot be rewritten", t => {
  const { directory } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  t.after(() => store.close()); store.save(payload({ assessments: [assessment()] }));
  assert.throws(() => store.save(payload()), error);
  assert.throws(() => store.save(payload({ assessments: [{ ...assessment(), ready: false }] })), error);
  assert.throws(() => store.save(payload({ assessments: [assessment(), assessment("tester")] })), error);
  store.save(payload({ stage: "reviewer_1", assessments: [assessment(), assessment("reviewer")] }));
  store.save(payload({ stage: "tester_1", assessments: [assessment(), assessment("reviewer"), assessment("tester")] }));
  assert.deepEqual(store.inspect()!.completedRoles, ["security", "reviewer", "tester"]);
});

test("bounded repair advances attempt without dropping prior accounting", t => {
  const { directory, path } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  t.after(() => store.close()); store.save(payload({ assessments: [assessment()] }));
  const repaired = proposal("export function add(a, b) { return Number(a) + Number(b); }\n");
  assert.throws(() => store.save(payload({ proposal: repaired })), error);
  store.save(payload({ attempt: 2, stage: "repair_2", status: "running", assessments: [assessment()] }));
  store.save(payload({ attempt: 2, stage: "repair_2", proposal: repaired }));
  assert.throws(() => store.save(payload()), error);
  assert.throws(() => store.save(payload({ attempt: 3 } as unknown as Partial<CalculatorExecutionCheckpointPayload>)), error);
  assert.equal(store.read()!.attempt, 2); assert.deepEqual(store.read()!.proposal, repaired);
  const archived = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(archived.history.length, 2);
  assert.deepEqual(archived.history[0].payload.proposal, proposal());
  assert.deepEqual(archived.history[0].payload.assessments, [assessment()]);
  store.save(payload({ attempt: 2, stage: "repair_2", status: "running", proposal: repaired }));
  assert.throws(() => store.save(payload({ attempt: 2, stage: "repair_2", proposal: proposal("different source") })), error);
});

test("publication and ambiguous HTTP flags survive checkpoints without granting replay", t => {
  const { directory } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  t.after(() => store.close());
  const ref = store.save(payload({ stage: "reviewer_1", status: "running", httpInFlight: true }));
  assert.equal(store.read(ref.sha256)!.httpInFlight, true);
  store.save(payload({ stage: "reviewer_1", status: "blocked", httpInFlight: true }));
  assert.equal(store.read()!.httpInFlight, true);
  assert.equal(store.read()!.status, "blocked");
  assert.throws(() => store.save(payload({ httpInFlight: true })), error);
  store.save(payload({ stage: "publish_candidate", status: "running", publicationStarted: true }));
  assert.throws(() => store.save(payload()), error);
  assert.equal(store.inspect()!.publicationStarted, true);
  assert.equal("resumeAuthorized" in store.inspect()!, false);
});

test("invalid, non-finite, unknown or secret-bearing inputs fail without replacing valid evidence", t => {
  const { directory, path } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  t.after(() => store.close()); store.save(payload()); const original = readFileSync(path, "utf8");
  const invalid = [
    { ...payload(), unknown: "unrecognized source" },
    payload({ modelState: { ...payload().modelState, attemptedRequests: Infinity } }),
    payload({ modelState: { ...payload().modelState, elapsedMs: NaN } }),
    payload({ modelState: { ...payload().modelState, reservedRunTokens: -1 } }),
    payload({ proposal: { ...proposal(), unexpectedSource: "hidden source" } as PreparedCalculatorChanges }),
    payload({ proposal: { ...proposal(), baseSha: "f".repeat(40) } }),
    payload({ assessments: [{ ...assessment(), summary: "ghp_" + "A".repeat(30) }] }),
    payload({ proposal: undefined, assessments: [assessment()] }),
  ];
  for (const input of invalid) assert.throws(() => store.save(input as CalculatorExecutionCheckpointPayload), error);
  assert.equal(readFileSync(path, "utf8"), original);
});

test("symlink ancestors, private directory and capsule plus hardlinks are refused", t => {
  const { parent, directory, path } = fixture(t), real = join(parent, "real"), linked = join(parent, "linked");
  mkdirSync(real); symlinkSync(real, linked, "dir");
  assert.throws(() => createCalculatorExecutionCheckpointStore(join(linked, "execution-private"), identity), error);
  symlinkSync(real, directory, "dir");
  assert.throws(() => createCalculatorExecutionCheckpointStore(directory, identity), error);
  rmSync(directory); const store = createCalculatorExecutionCheckpointStore(directory, identity);
  store.save(payload()); store.close(); const original = readFileSync(path);
  rmSync(path); writeFileSync(join(parent, "linked-file"), original, { mode: 0o600 });
  symlinkSync(join(parent, "linked-file"), path);
  assert.throws(() => createCalculatorExecutionCheckpointStore(directory, identity), error);
  rmSync(path); linkSync(join(parent, "linked-file"), path);
  assert.throws(() => createCalculatorExecutionCheckpointStore(directory, identity), error);
});

test("unsafe file permissions are refused and missing evidence is never manufactured", t => {
  const { directory, path } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  t.after(() => store.close());
  assert.throws(() => store.read("a".repeat(64)), error);
  store.save(payload()); chmodSync(path, 0o644);
  assert.throws(() => store.inspect(), error); chmodSync(path, 0o600);
  rmSync(path); assert.throws(() => store.read(), error); assert.throws(() => store.save(payload()), error);
});

test("directory replacement fault prevents the next operation and preserves original capsule", t => {
  const { parent, directory, path } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  t.after(() => store.close()); store.save(payload()); const original = readFileSync(path, "utf8");
  const moved = join(parent, "moved-private"); renameSync(directory, moved); mkdirSync(directory, { mode: 0o700 });
  let nextOperation = 0;
  assert.throws(() => { store.save(payload({ stage: "reviewer_1" })); nextOperation++; }, error);
  assert.equal(nextOperation, 0);
  assert.equal(readFileSync(join(moved, identity.taskId + ".execution.json"), "utf8"), original);
  assert.equal(existsSync(path), false);
});

test("atomic rename failure preserves previous checkpoint and prevents further requests", t => {
  const { directory, path } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  t.after(() => store.close()); store.save(payload()); const original = readFileSync(path, "utf8");
  const realRename = fs.renameSync; let nextOperation = 0;
  try {
    // Synchronous, bounded fault injection: no model/tool work is performed.
    fs.renameSync = () => { throw new Error("simulated atomic persistence failure"); };
    syncBuiltinESMExports();
    assert.throws(() => { store.save(payload({ stage: "security_1" })); nextOperation++; }, error);
  } finally { fs.renameSync = realRename; syncBuiltinESMExports(); }
  assert.equal(nextOperation, 0); assert.equal(readFileSync(path, "utf8"), original);
  // A writer with an uncertain persistence result cannot continue after repair.
  assert.throws(() => store.save(payload({ stage: "security_1" })), error);
  assert.deepEqual(store.read(), payload());
});

test("constructor read fault never removes a replacement worker lock", t => {
  const { parent, directory, path } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  store.save(payload()); store.close(); const original = readFileSync(path, "utf8"), realRead = fs.readFileSync;
  const moved = join(parent, "original-private"), replacementLock = path + ".lock";
  let injected = false;
  try {
    fs.readFileSync = ((...args: unknown[]) => {
      if (!injected && typeof args[0] === "number") {
        injected = true; renameSync(directory, moved); mkdirSync(directory, { mode: 0o700 });
        writeFileSync(replacementLock, "replacement-worker", { mode: 0o600 });
        throw new Error("simulated constructor read failure");
      }
      return Reflect.apply(realRead, fs, args);
    }) as typeof fs.readFileSync;
    syncBuiltinESMExports();
    assert.throws(() => createCalculatorExecutionCheckpointStore(directory, identity), error);
  } finally { fs.readFileSync = realRead; syncBuiltinESMExports(); }
  assert.equal(injected, true);
  assert.equal(readFileSync(replacementLock, "utf8"), "replacement-worker");
  assert.equal(readFileSync(join(moved, identity.taskId + ".execution.json"), "utf8"), original);
});

test("capsule byte bound rejects oversized private source without truncation", t => {
  const { directory, path } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  t.after(() => store.close()); store.save(payload());
  store.save(payload({ attempt: 2, stage: "repair_2", status: "running" }));
  const original = readFileSync(path, "utf8");
  assert.throws(() => store.save(payload({ attempt: 2, stage: "repair_2", proposal: proposal("x".repeat(300_000)) })), error);
  assert.equal(readFileSync(path, "utf8"), original);
});

test("exact proposal metadata cannot be changed while retaining successful prior assessments", t => {
  const { directory } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  t.after(() => store.close()); store.save(payload({ assessments: [assessment()] }));
  const alteredSummary = { ...proposal(), summary: "Different unverified Coder summary" };
  const evidence = JSON.parse(proposal().reviewEvidence); evidence.unverified = ["Different evidence"];
  const alteredEvidence = { ...proposal(), reviewEvidence: JSON.stringify(evidence) };
  for (const changed of [alteredSummary, alteredEvidence]) {
    assert.equal(calculatorProposalDigest(changed), calculatorProposalDigest(proposal()));
    assert.throws(() => store.save(payload({ proposal: changed, assessments: [assessment()] })), error);
  }
});

test("immutable private history is integrity-checked and bounded to 64 total snapshots", t => {
  const { directory, path } = fixture(t), store = createCalculatorExecutionCheckpointStore(directory, identity);
  for (let index = 0; index < 64; index++) assert.equal(store.save(payload()).sequence, index + 1);
  const latest = store.inspect()!; assert.equal(latest.sequence, 64);
  assert.throws(() => store.save(payload()), error); store.close();
  const data = JSON.parse(readFileSync(path, "utf8")); assert.equal(data.history.length, 63);
  data.history[0].payload.proposal.summary = "Modified initial Coder proposal";
  writeFileSync(path, JSON.stringify(data), { mode: 0o600 });
  assert.throws(() => createCalculatorExecutionCheckpointStore(directory, identity), error);
});
