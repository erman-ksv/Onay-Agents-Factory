import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALCULATOR_ASSESSMENT_REJECTION_ERROR, writeCalculatorAssessmentRejection,
  type CalculatorAssessmentRejectionIdentity } from "./calculatorAssessmentRejection.js";

const identity: CalculatorAssessmentRejectionIdentity = Object.freeze({
  repository: "erman-ksv/Onay-Factory-Calculator", goalId: "rejection-pilot", taskId: "calc-first",
  ownerFingerprint: "a".repeat(64), planFingerprint: "b".repeat(64), branch: "feat/calculator-agent/test",
  baseSha: "c".repeat(40), bootstrapSha: "d".repeat(40), runtimeConfigDigest: "e".repeat(64),
  proposalDigest: "f".repeat(64), role: "reviewer",
});
const rejected = { ready: true, summary: "PRIVATE_REJECTED_ASSESSMENT", findings: "not an array", unverifiedAreas: [] };
const refusal = (error: unknown) => error instanceof Error && error.message === CALCULATOR_ASSESSMENT_REJECTION_ERROR;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}
function fixture(t: { after(callback: () => void): void }) {
  const parent = mkdtempSync(join(tmpdir(), "calculator-rejected-")), directory = join(parent, "execution-private");
  mkdirSync(directory, { mode: 0o700 });
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, directory, fileName: identity.taskId + "-reviewer-rejected.execution.json" };
}
const input = (result: unknown = rejected) => ({ result, validationCode: "findings_invalid" as const });

test("rejected result is captured exactly with bound identity, digests and no acceptance authority", t => {
  const f = fixture(t), reference = writeCalculatorAssessmentRejection(f.directory, identity, input());
  assert.equal(reference.fileName, f.fileName);
  const raw = readFileSync(join(f.directory, reference.fileName)), record = JSON.parse(raw.toString("utf8"));
  assert.equal(record.version, 1); assert.equal(record.kind, "calculator-assessment-rejection");
  assert.equal(record.evidenceValidation, "unvalidated"); assert.deepEqual(record.identity, identity);
  assert.equal(record.validationCode, "findings_invalid"); assert.deepEqual(record.result, rejected);
  assert.equal(record.resultSha256, digest(canonical(rejected))); assert.equal(reference.resultSha256, record.resultSha256);
  assert.equal(reference.sha256, digest(raw)); assert.equal(reference.bytes, raw.length);
  assert.equal(record.assessmentAccepted, false); assert.equal(record.resumeAuthorized, false); assert.equal(record.publicationAuthorized, false);
  const { integritySha256, ...unsigned } = record;
  assert.equal(integritySha256, digest(canonical(unsigned)));
  assert.equal(lstatSync(f.directory).mode & 0o777, 0o700); assert.equal(lstatSync(join(f.directory, f.fileName)).mode & 0o777, 0o600);
});

test("public reference contains no private result, identity or directory contents", t => {
  const f = fixture(t), reference = writeCalculatorAssessmentRejection(f.directory, identity, input());
  assert.deepEqual(Object.keys(reference).sort(), ["bytes", "fileName", "resultSha256", "sha256"]);
  assert.ok(Object.isFrozen(reference));
  assert.ok(!JSON.stringify(reference).includes(rejected.summary)); assert.ok(!JSON.stringify(reference).includes(f.directory));
  assert.ok(!reference.fileName.includes("/")); assert.ok(!reference.fileName.includes(".."));
});

test("result JSON keys are canonicalized recursively and caller mutations cannot alter stored bytes", t => {
  const f = fixture(t), result = { z: [3, { z: false, a: "first" }], a: { y: 2, b: 1 } };
  const reference = writeCalculatorAssessmentRejection(f.directory, identity, input(result));
  const raw = readFileSync(join(f.directory, f.fileName)), record = JSON.parse(raw.toString("utf8"));
  assert.equal(JSON.stringify(record.result), '{"a":{"b":1,"y":2},"z":[3,{"a":"first","z":false}]}');
  assert.equal(reference.resultSha256, digest(canonical(result)));
  result.a.b = 42;
  assert.ok(readFileSync(join(f.directory, f.fileName)).equals(raw));
});

test("numeric JSON property names are ordered lexically in evidence and both digests", t => {
  const f = fixture(t), result = { "2": "second", "10": { "3": false, "11": true } };
  const reference = writeCalculatorAssessmentRejection(f.directory, identity, input(result));
  const raw = readFileSync(join(f.directory, reference.fileName), "utf8"), record = JSON.parse(raw);
  assert.ok(raw.indexOf('"10":') < raw.indexOf('"2":'));
  assert.ok(raw.indexOf('"11":') < raw.indexOf('"3":'));
  assert.equal(record.resultSha256, digest('{"10":{"11":true,"3":false},"2":"second"}'));
  const { integritySha256, ...unsigned } = record;
  assert.equal(integritySha256, digest(canonical(unsigned)));
});

test("each specialist has a separate rejected-output file and no lock or temporary residue remains", t => {
  const f = fixture(t);
  for (const role of ["security", "reviewer", "tester"] as const) {
    const reference = writeCalculatorAssessmentRejection(f.directory, { ...identity, role }, input());
    assert.equal(reference.fileName, identity.taskId + "-" + role + "-rejected.execution.json");
  }
  assert.equal(readdirSync(f.directory).length, 3);
  assert.ok(readdirSync(f.directory).every(name => name.endsWith(".execution.json")));
});

test("an existing rejection cannot be overwritten or refunded by another result", t => {
  const f = fixture(t), first = writeCalculatorAssessmentRejection(f.directory, identity, input());
  const before = readFileSync(join(f.directory, f.fileName));
  assert.throws(() => writeCalculatorAssessmentRejection(f.directory, identity, input({ ready: true })), refusal);
  assert.ok(readFileSync(join(f.directory, f.fileName)).equals(before)); assert.equal(digest(before), first.sha256);
});

test("pre-existing foreign files and locks are never replaced or deleted", t => {
  const f = fixture(t), foreign = Buffer.from("private earlier evidence");
  const path = join(f.directory, f.fileName); writeFileSync(path, foreign, { mode: 0o600 });
  assert.throws(() => writeCalculatorAssessmentRejection(f.directory, identity, input()), refusal);
  assert.ok(readFileSync(path).equals(foreign));
  const other = { ...identity, role: "security" as const }, lockPath = join(f.directory, identity.taskId + "-security-rejected.execution.json.lock");
  writeFileSync(lockPath, foreign, { mode: 0o600 });
  assert.throws(() => writeCalculatorAssessmentRejection(f.directory, other, input()), refusal);
  assert.ok(readFileSync(lockPath).equals(foreign));
});

test("symlink destination and hardlinked earlier evidence are refused without changing their target", t => {
  const f = fixture(t), target = join(f.parent, "target.json"), before = Buffer.from("separate private evidence");
  writeFileSync(target, before, { mode: 0o600 }); symlinkSync(target, join(f.directory, f.fileName));
  assert.throws(() => writeCalculatorAssessmentRejection(f.directory, identity, input()), refusal);
  assert.ok(readFileSync(target).equals(before));
  const hardPath = join(f.directory, identity.taskId + "-security-rejected.execution.json"); linkSync(target, hardPath);
  assert.throws(() => writeCalculatorAssessmentRejection(f.directory, { ...identity, role: "security" }, input()), refusal);
  assert.ok(readFileSync(target).equals(before)); assert.equal(lstatSync(target).nlink, 2);
});

test("symlink directory or ancestor cannot redirect a private write", t => {
  const f = fixture(t), actual = join(f.parent, "actual"); mkdirSync(actual, { mode: 0o700 });
  const alias = join(f.parent, "alias"); symlinkSync(actual, alias);
  assert.throws(() => writeCalculatorAssessmentRejection(alias, identity, input()), refusal);
  const nested = join(actual, "nested"); mkdirSync(nested, { mode: 0o700 });
  assert.throws(() => writeCalculatorAssessmentRejection(join(alias, "nested"), identity, input()), refusal);
  assert.deepEqual(readdirSync(actual), ["nested"]); assert.deepEqual(readdirSync(nested), []);
});

test("loose private directory permissions and noncanonical paths fail before writing", t => {
  const f = fixture(t); chmodSync(f.directory, 0o755);
  assert.throws(() => writeCalculatorAssessmentRejection(f.directory, identity, input()), refusal);
  assert.deepEqual(readdirSync(f.directory), []);
  for (const path of ["relative", "/", f.directory + "/../execution-private"])
    assert.throws(() => writeCalculatorAssessmentRejection(path, identity, input()), refusal);
});

test("a missing final directory is created privately without creating arbitrary ancestor paths", t => {
  const f = fixture(t), created = join(f.parent, "new-private");
  const reference = writeCalculatorAssessmentRejection(created, identity, input());
  assert.equal(lstatSync(created).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(created, reference.fileName)).mode & 0o777, 0o600);
  const unavailableParent = join(f.parent, "absent", "private");
  assert.throws(() => writeCalculatorAssessmentRejection(unavailableParent, identity, input()), refusal);
  assert.ok(!existsSync(join(f.parent, "absent")));
});

test("repository internals and dependency directories cannot receive rejected model evidence", t => {
  const f = fixture(t);
  for (const name of [".git", ".github", "node_modules"]) {
    const internal = join(f.parent, name); mkdirSync(internal, { mode: 0o700 });
    assert.throws(() => writeCalculatorAssessmentRejection(internal, identity, input()), refusal);
    assert.deepEqual(readdirSync(internal), []);
  }
});

test("unknown code, role, identity and path-bearing IDs never produce evidence", t => {
  const f = fixture(t);
  const values: unknown[] = ["unknown_code", "ghp_" + "A".repeat(36), undefined, 3];
  for (const validationCode of values) assert.throws(() => writeCalculatorAssessmentRejection(f.directory, identity,
    { result: rejected, validationCode } as Parameters<typeof writeCalculatorAssessmentRejection>[2]), refusal);
  for (const update of [{ role: "coder" }, { taskId: "../escape" }, { goalId: "" }, { proposalDigest: "0".repeat(40) },
    { baseSha: "main" }, { ownerFingerprint: "changed" }, { repository: "foreign" }, { extra: true }, { taskId: "x".repeat(120) }]) {
    assert.throws(() => writeCalculatorAssessmentRejection(f.directory, { ...identity, ...update } as CalculatorAssessmentRejectionIdentity, input()), refusal);
  }
  assert.deepEqual(readdirSync(f.directory), []);
});

test("non-JSON values, cycles and executable accessors are refused without invoking them", t => {
  const f = fixture(t); let getters = 0, conversions = 0;
  const accessor = Object.defineProperty({}, "private", { enumerable: true, get() { getters++; return "secret source"; } });
  const conversion = { toJSON() { conversions++; return "converted"; } };
  const cycle: { self?: unknown } = {}; cycle.self = cycle;
  for (const value of [undefined, NaN, Infinity, -Infinity, BigInt(1), Symbol("private"), () => "private", new Date(), new Map(), cycle, accessor, conversion])
    assert.throws(() => writeCalculatorAssessmentRejection(f.directory, identity, { result: value, validationCode: "findings_invalid" }), refusal);
  assert.equal(getters, 0); assert.equal(conversions, 0); assert.deepEqual(readdirSync(f.directory), []);
});

test("a rejected result may retain JSON primitives without inventing an accepted assessment", t => {
  const f = fixture(t);
  for (const [index, result] of [null, false, 3, "not an assessment", []].entries()) {
    const reference = writeCalculatorAssessmentRejection(f.directory, { ...identity, taskId: "primitive-" + index }, input(result));
    const record = JSON.parse(readFileSync(join(f.directory, reference.fileName), "utf8"));
    assert.deepEqual(record.result, result); assert.equal(record.assessmentAccepted, false);
  }
});

test("UTF-8 byte bound is enforced on canonical result without truncation", t => {
  const f = fixture(t), emptyBytes = Buffer.byteLength(canonical({ note: "" }));
  const remaining = 96000 - emptyBytes, text = "я".repeat(Math.floor(remaining / 2)) + "A".repeat(remaining % 2);
  assert.equal(Buffer.byteLength(canonical({ note: text })), 96000);
  const reference = writeCalculatorAssessmentRejection(f.directory, identity, input({ note: text }));
  assert.ok(reference.bytes <= 100000); assert.equal(JSON.parse(readFileSync(join(f.directory, reference.fileName), "utf8")).result.note, text);
  const other = { ...identity, role: "tester" as const };
  assert.throws(() => writeCalculatorAssessmentRejection(f.directory, other, input({ note: text + "я" })), refusal);
  assert.ok(!existsSync(join(f.directory, identity.taskId + "-tester-rejected.execution.json")));
});

test("raw and Unicode-escaped credential families never reach private evidence", t => {
  const f = fixture(t), tokens = ["gsk_" + "A".repeat(40), "ghp_" + "B".repeat(36), "gho_" + "C".repeat(36),
    "ghu_" + "D".repeat(36), "ghs_" + "E".repeat(36), "ghr_" + "F".repeat(36), "sk-" + "G".repeat(48),
    "AIza" + "H".repeat(35), "-----BEGIN PRIVATE KEY-----\nprivate fixture\n-----END PRIVATE KEY-----"];
  for (const token of tokens) {
    const escaped = [...token].map(character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0")).join("");
    for (const text of [token, escaped]) assert.throws(() => writeCalculatorAssessmentRejection(f.directory, identity, input({ text })), refusal);
  }
  assert.deepEqual(readdirSync(f.directory), []);
});

test("refusal diagnostics do not retain private results or upstream error causes", t => {
  const f = fixture(t), text = "PRIVATE_RESULT_MUST_NOT_ENTER_ERROR", value = { text, token: "gsk_" + "Z".repeat(40) };
  try { writeCalculatorAssessmentRejection(f.directory, identity, input(value)); assert.fail("write should be refused"); }
  catch (error) {
    assert.ok(refusal(error)); assert.ok(!String(error).includes(text));
    assert.ok(!JSON.stringify(error).includes(text)); assert.equal((error as Error).cause, undefined);
  }
});

test("atomic publication failure leaves no partial result and does not expose filesystem error text", t => {
  const f = fixture(t), original = fs.linkSync; let attempts = 0;
  fs.linkSync = () => { attempts++; throw Error("PRIVATE_FILESYSTEM_FAILURE"); }; syncBuiltinESMExports();
  try {
    assert.throws(() => writeCalculatorAssessmentRejection(f.directory, identity, input()), refusal);
    assert.equal(attempts, 1); assert.ok(!existsSync(join(f.directory, f.fileName))); assert.deepEqual(readdirSync(f.directory), []);
  } finally { fs.linkSync = original; syncBuiltinESMExports(); }
});

test("one failed staging unlink leaves a private forensic record with one link and preserves earlier evidence", t => {
  const f = fixture(t), checkpointPath = join(f.directory, identity.taskId + ".execution.json");
  const checkpointBytes = Buffer.from('{"stage":"security_1","status":"passed"}\n');
  writeFileSync(checkpointPath, checkpointBytes, { mode: 0o600 });
  const path = join(f.directory, f.fileName), original = fs.unlinkSync; let failures = 0;
  fs.unlinkSync = target => {
    if (failures === 0 && String(target).includes(".assessment-rejected-") && existsSync(path)) {
      failures++; throw Error("PRIVATE_UNLINK_FAILURE");
    }
    return original(target);
  };
  syncBuiltinESMExports();
  try {
    assert.throws(() => writeCalculatorAssessmentRejection(f.directory, identity, input()), refusal);
    assert.equal(failures, 1); assert.ok(readFileSync(checkpointPath).equals(checkpointBytes));
    assert.deepEqual(readdirSync(f.directory).sort(), [identity.taskId + ".execution.json", f.fileName].sort());
    assert.equal(lstatSync(path).nlink, 1); assert.equal(lstatSync(path).mode & 0o777, 0o600);
    const record = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(record.result, rejected); assert.equal(record.assessmentAccepted, false);
    assert.equal(record.resumeAuthorized, false); assert.equal(record.publicationAuthorized, false);
    const { integritySha256, ...unsigned } = record;
    assert.equal(integritySha256, digest(canonical(unsigned)));
    assert.throws(() => writeCalculatorAssessmentRejection(f.directory, identity, input()), refusal);
  } finally { fs.unlinkSync = original; syncBuiltinESMExports(); }
});
