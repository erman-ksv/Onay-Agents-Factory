/** Fixed read-only evidence audit. No source, model output text or replay authority. */
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, parse, resolve } from 'node:path';

const RUN = 39538233432, ARTIFACT = 12318598151;
const ARTIFACT_DIGEST = 'sha256:3cbd44d394b4813f83a47d997657fa78b5db3f5ea122c7dd7fcdf67ee594e363';
const MANIFEST_SHA = 'db94628325eccbc50267adaca3300195f0bd9b8c33a5f33a9a9c2312bedbcb10';
const EVENT_SHA = '5bb6090801bfab5d617a16045a5c064a2445c56c';
const RUNTIME = '67eb5d31050dd6fe20691283998e05c13836e711';
const GOAL = 'calculator-pilot-step7-v1', TASK = GOAL + '-34ee03-t01';
const PLAN = '1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2';
const BOOTSTRAP = '2c1218f2b020962ad93adf68d902a847271a7e72';
const TARGET = 'erman-ksv/Onay-Factory-Calculator', BRANCH = 'feat/calculator-agent/' + GOAL;
const SHA = /^[a-f0-9]{40}$/, DIGEST = /^[a-f0-9]{64}$/;
const CODE = /^[a-z][a-z0-9_-]{0,79}$/;
const MAX_FILE = 512 * 1024, MAX_BYTES = 8 * 1024 * 1024 + 128 * 1024, MAX_FILES = 257;
function refuse() { throw Error('fixed_current_regeneration_evidence_unverified'); }
const sha256 = value => createHash('sha256').update(value).digest('hex');
const digest = value => sha256(JSON.stringify(value));
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function exact(value, keys) { if (!plain(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) refuse(); return value; }
function safeInteger(value) { return Number.isSafeInteger(value) && value >= 0; }
function safeText(value, limit) { return typeof value === 'string' && value.length > 0 && value.length <= limit; }
function secrets(value) {
  const decoded = value.replace(/\\u([a-f0-9]{4})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  return [value, decoded].some(text => /(?:gh[pousr]_[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|gsk_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text));
}
function owned(stat) { return !process.getuid || stat.uid === process.getuid(); }
function directory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !owned(stat) || ![0o700, 0o755].includes(stat.mode & 0o777)) refuse(); return stat;
}
function unchanged(path, before, file) {
  const after = lstatSync(path);
  if (after.ino !== before.ino || after.dev !== before.dev || after.mode !== before.mode || after.uid !== before.uid || after.isSymbolicLink() ||
      (file && (!after.isFile() || after.nlink !== 1 || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)) ||
      (!file && !after.isDirectory())) refuse();
}
function read(path, maximum = MAX_FILE) {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || !owned(before) || before.size > maximum ||
      ![0o600, 0o644].includes(before.mode & 0o777)) refuse();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); let bytes;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.nlink !== 1 || stat.size !== before.size || stat.mode !== before.mode || stat.uid !== before.uid) refuse();
    bytes = readFileSync(fd); const after = fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || after.nlink !== 1) refuse();
  } finally { closeSync(fd); }
  if (bytes.length !== before.size || bytes.length > maximum) refuse(); unchanged(path, before, true);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (secrets(text)) refuse();
  let value;
  if (path.endsWith('.lock')) { if (bytes.length) refuse(); }
  else { value = JSON.parse(text); if (secrets(JSON.stringify(value))) refuse(); }
  return { bytes, value, stat: before, path };
}
function modelState(value) {
  exact(value, ['attemptedRequests', 'totalRequestBytes', 'reservedRunTokens', 'elapsedMs']);
  if (!Object.values(value).every(safeInteger)) refuse(); return { ...value };
}
function proposalMetadata(value, identity) {
  exact(value, ['repository', 'baseRef', 'baseSha', 'summary', 'files', 'reviewEvidence', 'gates']);
  if (value.repository !== TARGET || value.baseRef !== identity.branch || value.baseSha !== identity.baseSha || !safeText(value.summary, 800) ||
      !safeText(value.reviewEvidence, MAX_FILE) || !Array.isArray(value.files) || !value.files.length || value.files.length > 3) refuse();
  exact(value.gates, ['secretScan', 'policyReview', 'independentReview', 'tests', 'publicationAuthorized']);
  if (value.gates.secretScan !== 'passed' || value.gates.policyReview !== 'passed' || value.gates.independentReview !== 'required' ||
      value.gates.tests !== 'required' || value.gates.publicationAuthorized !== false) refuse();
  const paths = new Set();
  const files = value.files.map(file => {
    exact(file, ['path', 'content', 'message']);
    if (!['src/calculator.mjs', 'test/calculator.test.mjs'].includes(file.path) || paths.has(file.path) || !safeText(file.content, MAX_FILE) || !safeText(file.message, 200)) refuse();
    paths.add(file.path); return { path: file.path, bytes: Buffer.byteLength(file.content), sha256: sha256(file.content) };
  });
  const proposalDigest = digest({ repository: value.repository, baseRef: value.baseRef, baseSha: value.baseSha,
    files: [...value.files].sort((left, right) => left.path.localeCompare(right.path)).map(file => ({ path: file.path, content: file.content })) });
  return { proposalDigest, files };
}
function payloadMetadata(payload, identity, expectedDigest) {
  exact(payload, ['attempt', 'stage', 'status', 'assessments', 'modelState', 'httpInFlight', 'publicationStarted', ...(Object.hasOwn(payload, 'proposal') ? ['proposal'] : [])]);
  if (![1, 2].includes(payload.attempt) || typeof payload.stage !== 'string' || !CODE.test(payload.stage) || !['running', 'passed', 'blocked'].includes(payload.status) ||
      typeof payload.httpInFlight !== 'boolean' || typeof payload.publicationStarted !== 'boolean' || (payload.status === 'passed' && payload.httpInFlight) ||
      !Array.isArray(payload.assessments) || payload.assessments.length > 3) refuse();
  const roles = ['security', 'reviewer', 'tester'];
  const assessments = payload.assessments.map((assessment, index) => {
    exact(assessment, ['role', 'ready', 'summary', 'findings', 'unverifiedAreas', 'testsExecuted', 'overallTaskCompletionVerified', 'publicationAuthorized']);
    if (assessment.role !== roles[index] || typeof assessment.ready !== 'boolean' || !safeText(assessment.summary, 600) ||
        assessment.testsExecuted !== false || assessment.overallTaskCompletionVerified !== false || assessment.publicationAuthorized !== false ||
        !Array.isArray(assessment.findings) || assessment.findings.length > 12 || !Array.isArray(assessment.unverifiedAreas) || assessment.unverifiedAreas.length > 24 ||
        assessment.unverifiedAreas.some(area => !safeText(area, 400))) refuse();
    const findingsBySeverity = { blocker: 0, high: 0, medium: 0, low: 0 };
    for (const finding of assessment.findings) {
      exact(finding, ['severity', 'message', 'evidenceRefs', 'evidenceStatus']);
      if (!Object.hasOwn(findingsBySeverity, finding.severity) || !safeText(finding.message, 400) || !Array.isArray(finding.evidenceRefs) ||
          finding.evidenceRefs.length > 16 || finding.evidenceRefs.some(ref => !safeText(ref, 200)) || !['supplied', 'missing'].includes(finding.evidenceStatus)) refuse();
      findingsBySeverity[finding.severity]++;
    }
    return { role: assessment.role, ready: assessment.ready, findingsBySeverity, unverifiedAreaCount: assessment.unverifiedAreas.length };
  });
  const proposal = Object.hasOwn(payload, 'proposal') ? proposalMetadata(payload.proposal, identity) : undefined;
  if ((!proposal && assessments.length) || proposal?.proposalDigest !== expectedDigest) refuse();
  return { attempt: payload.attempt, stage: payload.stage, status: payload.status, rawProposalExists: !!proposal,
    ...(proposal ? { proposalDigest: proposal.proposalDigest, proposalFiles: proposal.files } : {}),
    completedRoles: assessments.map(assessment => assessment.role), assessmentMetadata: assessments, modelState: modelState(payload.modelState),
    httpInFlight: payload.httpInFlight, publicationStarted: payload.publicationStarted };
}
function capsuleMetadata(value, path, ownerFingerprint) {
  exact(value, ['version', 'identity', 'sequence', 'payload', 'history', 'integritySha256', ...(Object.hasOwn(value, 'proposalDigest') ? ['proposalDigest'] : [])]);
  exact(value.identity, ['repository', 'goalId', 'ownerFingerprint', 'planFingerprint', 'taskId', 'branch', 'baseSha', 'bootstrapSha', 'runtimeConfigDigest']);
  const identity = value.identity;
  if (value.version !== 1 || identity.repository !== TARGET || identity.goalId !== GOAL || identity.ownerFingerprint !== ownerFingerprint || identity.planFingerprint !== PLAN ||
      identity.branch !== BRANCH || identity.bootstrapSha !== BOOTSTRAP || !SHA.test(identity.baseSha) || !DIGEST.test(identity.runtimeConfigDigest) ||
      (identity.taskId !== TASK && identity.taskId !== 'runtime-' + digest({ goalId: GOAL, currentSha: identity.baseSha }).slice(0, 48)) ||
      !path.endsWith('/' + identity.taskId + '.execution.json') || !Array.isArray(value.history) || value.history.length > 63 || value.sequence !== value.history.length + 1) refuse();
  const history = []; const metadata = []; let prior;
  for (const item of [...value.history, value]) {
    if (item !== value) exact(item, ['sequence', 'payload', 'integritySha256', ...(Object.hasOwn(item, 'proposalDigest') ? ['proposalDigest'] : [])]);
    if (item.sequence !== history.length + 1 || !DIGEST.test(item.integritySha256)) refuse();
    const meta = payloadMetadata(item.payload, identity, item.proposalDigest);
    const unsigned = { version: 1, identity, sequence: item.sequence, payload: item.payload,
      ...(Object.hasOwn(item, 'proposalDigest') ? { proposalDigest: item.proposalDigest } : {}), history: [...history] };
    if (digest(unsigned) !== item.integritySha256 || (prior && Object.keys(meta.modelState).some(key => meta.modelState[key] < prior.modelState[key]))) refuse();
    metadata.push({ sequence: item.sequence, ...meta });
    if (item !== value) history.push(item); prior = meta;
  }
  return { path, identity: { ...identity }, sequence: value.sequence, latest: metadata.at(-1), history: metadata.slice(0, -1),
    chargeAccounting: 'conservative-high-water', rawProposalExists: metadata.some(item => item.rawProposalExists) };
}
function receiptMetadata(value) {
  exact(value, ['schemaVersion', 'id', 'fingerprint', 'status', 'stages', ...(Object.hasOwn(value, 'reasonCode') ? ['reasonCode'] : []), ...(Object.hasOwn(value, 'publication') ? ['publication'] : [])]);
  if (value.schemaVersion !== 1 || value.id !== 'calc-' + TASK || value.fingerprint !== digest({ planFingerprint: PLAN, taskId: TASK }) ||
      !['running', 'completed', 'blocked', 'needs-review'].includes(value.status) || !Array.isArray(value.stages) || value.stages.length > 32 ||
      (Object.hasOwn(value, 'reasonCode') && (typeof value.reasonCode !== 'string' || !CODE.test(value.reasonCode)))) refuse();
  const stages = value.stages.map(stage => { exact(stage, ['stage', 'status']); if (!CODE.test(stage.stage) || !['running', 'passed', 'blocked'].includes(stage.status)) refuse(); return { ...stage }; });
  if (new Set(stages.map(stage => stage.stage)).size !== stages.length) refuse();
  return { id: value.id, status: value.status, ...(value.reasonCode ? { reasonCode: value.reasonCode } : {}), stages, publicationPresent: Object.hasOwn(value, 'publication') };
}
function reportMetadata(value) {
  const allowed = ['mode', 'status', 'reasonCode', 'planFingerprint', 'taskId', 'attempts', 'repairs', 'publication', 'proposalTestsExecuted', 'candidateTestsExecuted', 'wholeAppCompleted', 'finalCalculatorCiVerified', 'legalEnabled'];
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)) || value.taskId !== TASK || !['blocked', 'needs-review', 'candidate-verified'].includes(value.status) ||
      value.wholeAppCompleted !== false || value.legalEnabled !== false || (value.reasonCode !== undefined && !CODE.test(value.reasonCode)) ||
      (value.planFingerprint !== undefined && value.planFingerprint !== PLAN)) refuse();
  for (const key of ['attempts', 'repairs']) if (value[key] !== undefined && !safeInteger(value[key])) refuse();
  for (const key of ['proposalTestsExecuted', 'candidateTestsExecuted', 'finalCalculatorCiVerified']) if (value[key] !== undefined && typeof value[key] !== 'boolean') refuse();
  return { status: value.status, ...(value.reasonCode ? { reasonCode: value.reasonCode } : {}), taskId: TASK,
    ...(value.attempts !== undefined ? { attempts: value.attempts } : {}), ...(value.repairs !== undefined ? { repairs: value.repairs } : {}),
    proposalTestsExecuted: value.proposalTestsExecuted === true, candidateTestsExecuted: value.candidateTestsExecuted === true,
    finalCalculatorCiVerified: value.finalCalculatorCiVerified === true, publicationPresent: Object.hasOwn(value, 'publication'), wholeAppCompleted: false, legalEnabled: false };
}

try {
  if (process.argv.length !== 3 || !SHA.test(EVENT_SHA)) refuse();
  const root = process.argv[2]; if (!isAbsolute(root) || resolve(root) !== root || root === parse(root).root) refuse();
  let ancestor = parse(root).root;
  for (const part of root.slice(ancestor.length).split('/').filter(Boolean)) { ancestor = join(ancestor, part); const stat = lstatSync(ancestor); if (!stat.isDirectory() || stat.isSymbolicLink()) refuse(); }
  const manifestFile = read(join(root, 'manifest.json'), 128 * 1024); if (sha256(manifestFile.bytes) !== MANIFEST_SHA) refuse();
  const manifest = manifestFile.value;
  exact(manifest, ['version', 'kind', 'evidenceValidation', 'identity', 'fileCount', 'totalBytes', 'files', 'treeSha256', 'resumeAuthorized', 'budgetResetAuthorized']);
  exact(manifest.identity, ['goalId', 'taskId', 'planFingerprint', 'runtimeSha', 'runId', 'eventSha', 'barrierDigest']);
  const binding = manifest.identity;
  if (manifest.version !== 1 || manifest.kind !== 'calculator-regeneration-forensic' || manifest.evidenceValidation !== 'unvalidated' || manifest.resumeAuthorized !== false || manifest.budgetResetAuthorized !== false ||
      binding.goalId !== GOAL || binding.taskId !== TASK || binding.planFingerprint !== PLAN || binding.runtimeSha !== RUNTIME || binding.runId !== RUN || binding.eventSha !== EVENT_SHA ||
      !DIGEST.test(binding.barrierDigest) || manifest.fileCount !== 34 || manifest.totalBytes !== 54797 || !Array.isArray(manifest.files) || manifest.files.length !== manifest.fileCount ||
      manifest.treeSha256 !== digest(manifest.files)) refuse();
  const expected = new Map(); let countBytes = 0;
  for (const entry of manifest.files) {
    exact(entry, ['path', 'kind', 'bytes', 'sha256']);
    if (typeof entry.path !== 'string' || entry.path.split('/').length > 8 || entry.path.split('/').some(part => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(part) || part.includes('..')) ||
        !['json', 'stale-lock'].includes(entry.kind) || !safeInteger(entry.bytes) || entry.bytes > MAX_FILE || !DIGEST.test(entry.sha256) ||
        (entry.kind === 'stale-lock' ? !entry.path.endsWith('.lock') || entry.bytes !== 0 : !entry.path.endsWith('.json')) || expected.has('evidence/' + entry.path)) refuse();
    expected.set('evidence/' + entry.path, entry); countBytes += entry.bytes;
  }
  if (countBytes !== manifest.totalBytes) refuse();
  const files = new Map(), directories = []; let total = 0;
  function walk(path, relative = '', depth = 0) {
    if (depth > 10 || directories.length > 256) refuse();
    const stat = directory(path), names = readdirSync(path).sort(); if (names.length > MAX_FILES) refuse(); directories.push({ path, stat, names });
    for (const name of names) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name) || name.includes('..')) refuse();
      const child = join(path, name), rel = relative ? relative + '/' + name : name, childStat = lstatSync(child);
      if (childStat.isDirectory() && !childStat.isSymbolicLink()) { walk(child, rel, depth + 1); continue; }
      if (files.size >= MAX_FILES || (rel !== 'manifest.json' && !expected.has(rel))) refuse();
      const file = rel === 'manifest.json' ? manifestFile : read(child); total += file.bytes.length; if (total > MAX_BYTES) refuse(); files.set(rel, file);
    }
  }
  walk(root);
  if (files.size !== expected.size + 1) refuse();
  for (const [path, entry] of expected) { const file = files.get(path); if (!file || file.bytes.length !== entry.bytes || sha256(file.bytes) !== entry.sha256) refuse(); }
  const context = files.get('evidence/context.json')?.value, barrier = files.get('evidence/barrier/regeneration.json')?.value;
  exact(context, ['version', 'request', 'barrier']);
  if (context.version !== 1 || digest(context.barrier) !== binding.barrierDigest || digest(barrier) !== binding.barrierDigest ||
      barrier.version !== 1 || barrier.authorization !== 'ONE_REGENERATION_AFTER_LOST_PROPOSAL' || barrier.automaticReplay !== false || barrier.budgetResetAuthorized !== false ||
      ['goalId', 'taskId', 'planFingerprint', 'runtimeSha', 'runId', 'eventSha'].some(key => barrier[key] !== binding[key])) refuse();
  const goal = context.request?.request?.goal;
  exact(goal, ['version', 'id', 'goal', 'baseRef', 'baseSha', 'provider']);
  if (goal.id !== GOAL || goal.baseSha !== BOOTSTRAP || goal.baseRef !== 'feat/calculator-pilot-bootstrap' || goal.provider !== 'groq' || !safeText(goal.goal, 4000)) refuse();
  const ownerFingerprint = digest({ version: goal.version, id: goal.id, goal: goal.goal, baseRef: goal.baseRef, baseSha: goal.baseSha, provider: goal.provider,
    repository: TARGET, requirementsSha256: '8e83351512d4a2aa58688590865cd6710a22bb4a97f268e521586abd2d0c5a27' });
  const currentReceipt = receiptMetadata(files.get('evidence/state/calc-' + TASK + '.json')?.value);
  const executionCapsules = [];
  for (const [path, file] of files) if (/^evidence\/execution-private\/[a-f0-9]{64}\/[a-z0-9][a-z0-9_-]{0,119}\.execution\.json$/.test(path))
    executionCapsules.push({ ...capsuleMetadata(file.value, path.slice('evidence/'.length), ownerFingerprint), bytes: file.bytes.length, sha256: sha256(file.bytes) });
  if (!executionCapsules.length || !executionCapsules.some(capsule => capsule.identity.taskId === TASK)) refuse();
  const report = reportMetadata(files.get('evidence/calculator-report.json')?.value);
  for (const item of directories) { unchanged(item.path, item.stat, false); if (readdirSync(item.path).sort().join(',') !== item.names.join(',')) refuse(); }
  for (const file of files.values()) unchanged(file.path, file.stat, true);
  const result = { event: 'calculator_regeneration_current_read_only_audit', runId: RUN, artifactId: ARTIFACT, artifactDigest: ARTIFACT_DIGEST,
    manifestSha256: MANIFEST_SHA, manifest, currentReceipt, executionCapsules, report, rawProposalExists: executionCapsules.some(capsule => capsule.rawProposalExists),
    modelsRunByAudit: false, writesPerformedByAudit: false, resumeAuthorized: false, budgetResetAuthorized: false };
  const output = JSON.stringify(result); if (Buffer.byteLength(output) > 128 * 1024 || secrets(output)) refuse(); console.log(output);
} catch { console.error('Fixed current regeneration evidence unverified; no source printed and no replay.'); process.exitCode = 10; }
