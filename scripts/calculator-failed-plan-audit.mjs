/** One fixed read-only investigation. Never calls a model or modifies pilot state. */
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const root = process.argv[2];
const digest = x => createHash('sha256').update(x).digest('hex');
const read = path => { const s = lstatSync(path); if (!s.isFile() || s.isSymbolicLink() || s.size > 32768) throw Error('audit_file_invalid'); return readFileSync(path); };
try {
  const launchBytes = read(join(root, 'capsule/launch.json'));
  const launch = JSON.parse(launchBytes), barrier = JSON.parse(read(join(root, 'barrier/launch.json')));
  const completion = JSON.parse(read(join(root, 'capsule/completion.json')));
  const report = JSON.parse(read(join(root, 'capsule/report/calculator-report.json')));
  if (JSON.stringify(launch) !== JSON.stringify(barrier) || launch.runId !== 39437299742 ||
      launch.goalId !== 'calculator-pilot-step7-v1' || launch.mode !== 'plan' ||
      launch.factorySha !== 'd733e078800505534cd7c39f15406822416e7f24' ||
      launch.binding !== '3e960ac2f9771c75719df71a75cdcf6c63f1905ca10f32e4510c3f283a891aed' ||
      completion.manifestDigest !== digest(JSON.stringify(launch)) || completion.reportDigest !== digest(JSON.stringify(report))) throw Error('audit_binding_invalid');
  const names = readdirSync(join(root, 'capsule/state')).sort();
  if (names.some(name => !['calc-planning-calculator-pilot-step7-v1.json','calc-plan-calculator-pilot-step7-v1.json','calculator-pilot-step7-v1.calculator-plan.json'].includes(name)) ||
      JSON.stringify(Object.keys(completion.stateDigests).sort()) !== JSON.stringify(names)) throw Error('audit_state_invalid');
  const receipts = [];
  for (const name of names) {
    const bytes = read(join(root, 'capsule/state', name));
    if (digest(bytes) !== completion.stateDigests[name]) throw Error('audit_digest_invalid');
    const data = JSON.parse(bytes);
    if (name.endsWith('.calculator-plan.json')) { receipts.push({ kind: 'plan', present: true }); continue; }
    if (!['blocked','needs-review','completed','running'].includes(data.status) || !Array.isArray(data.stages) || data.stages.length > 32 ||
        data.stages.some(s => !/^[a-z][a-z0-9_-]{0,63}$/.test(s.stage) || !['passed','blocked','running'].includes(s.status)) ||
        (data.reasonCode !== undefined && !/^[a-z][a-z0-9_-]{0,63}$/.test(data.reasonCode))) throw Error('audit_receipt_invalid');
    receipts.push({ kind: name.startsWith('calc-planning-') ? 'planning-receipt' : 'plan-receipt', status: data.status, reasonCode: data.reasonCode, stages: data.stages, publicationPresent: !!data.publication });
  }
  console.log(JSON.stringify({ event: 'calculator_failed_plan_audit', verified: true, runId: launch.runId, exitCode: completion.exitCode,
    stateFileCount: names.length, receipts, modelsRun: false, writesPerformed: false, legalEnabled: false }));
  const auth = await fetch('https://api.groq.com/openai/v1/models', { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY } });
  await auth.body?.cancel();
  console.log(JSON.stringify({ event: 'groq_read_only_auth', httpStatus: auth.status, modelInferencePerformed: false }));
} catch { console.error('Calculator read-only audit failed; no state modification or replay.'); process.exitCode = 10; }
