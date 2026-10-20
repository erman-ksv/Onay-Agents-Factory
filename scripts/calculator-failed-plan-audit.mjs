/** Read only the fixed stopped execution capsule; no model or state changes. */
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const root = process.argv[2];
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const read = path => { const s = lstatSync(path); if (!s.isFile() || s.isSymbolicLink() || s.size > 32768) throw Error('audit_file_invalid'); return JSON.parse(readFileSync(path, 'utf8')); };
try {
  const context = read(join(root, 'context.json')), barrier = read(join(root, 'barrier/recovery.json'));
  if (context.runtimeSha !== '4b8f56ee80c1aecb9f25536ccf2b0c96ef2fa203' || context.eventSha !== '666ae4a559396e57bcb8e713d29087967b5fb821' ||
      context.runId !== '39448498604' || context.correction !== true || barrier.recoveryRunId !== context.runId || barrier.runtimeSha !== context.runtimeSha || barrier.eventSha !== context.eventSha) throw Error('audit_binding_invalid');
  const goal = 'calculator-pilot-step7-v1', taskId = goal + '-34ee03-t01';
  const plan = read(join(root, 'state', goal + '.calculator-plan.json'));
  if (plan.fingerprint !== '1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2') throw Error('audit_plan_invalid');
  const task = read(join(root, 'state', 'calc-' + taskId + '.json'));
  if (task.id !== 'calc-' + taskId || task.fingerprint !== digest({ planFingerprint: plan.fingerprint, taskId }) ||
      !['blocked','needs-review','completed','running'].includes(task.status) || !Array.isArray(task.stages) || task.stages.length > 32 ||
      task.stages.some(s => !/^[a-z][a-z0-9_-]{0,63}$/.test(s.stage) || !['passed','blocked','running'].includes(s.status)) ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(task.reasonCode)) throw Error('audit_receipt_invalid');
  const report = read(join(root, 'calculator-report.json'));
  if (report.taskId !== taskId || report.wholeAppCompleted !== false || report.legalEnabled !== false || !['blocked','needs-review','candidate-verified'].includes(report.status)) throw Error('audit_report_invalid');
  console.log(JSON.stringify({ event: 'calculator_stopped_task_audit', runId: 39448498604, planFingerprint: plan.fingerprint,
    taskId, receiptStatus: task.status, reasonCode: task.reasonCode, stages: task.stages, publicationPresent: !!task.publication,
    proposalTestsExecuted: report.proposalTestsExecuted === true, candidateTestsExecuted: report.candidateTestsExecuted === true,
    generatedProposalPersisted: readdirSync(root).some(name => name === 'execution-proposal.json'),
    modelsRunByAudit: false, writesPerformedByAudit: false, legalEnabled: false }));
} catch { console.error('Stopped task evidence unverified; no replay.'); process.exitCode = 10; }
