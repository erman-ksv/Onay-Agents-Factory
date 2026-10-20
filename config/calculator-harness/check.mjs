// Trusted host task harness. Copied OUTSIDE /app and mounted read-only.
// Required core API: export calculate(left:number, operator:'+'|'-'|'*'|'/', right:number): number.
// The number must be finite/normalized; division by zero throws a nonempty Error.
// UI checks here are structural/syntax only. Final real-browser acceptance is mandatory.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const manifest = JSON.parse(readFileSync('/manifest.json', 'utf8'));
const failures = new Set();
function run(args, input = '') {
  const result = spawnSync('/usr/local/bin/node', args, {
    input, encoding: 'utf8', timeout: 4000, maxBuffer: 16384,
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', NODE_OPTIONS: '' },
  });
  return { code: result.status, stdout: result.stdout ?? '', failed: !!result.error || result.signal !== null };
}
for (const path of manifest.paths.filter(path => path.endsWith('.mjs')))
  if (run(['--check', '/app/' + path]).code !== 0) failures.add('syntax');

if (manifest.expected.includes('fixed-arithmetic')) {
  // Candidate code executes in a child process. It cannot tamper with this
  // supervisor's assertions or turn process.exit(0) into a successful test.
  const cases = [
    { id: 'addition', left: 2, op: '+', right: 3, expected: 5 },
    { id: 'negative-result', left: 7, op: '-', right: 10, expected: -3 },
    { id: 'multiplication', left: 6, op: '*', right: 4, expected: 24 },
    { id: 'division', left: 9, op: '/', right: 3, expected: 3 },
    { id: 'decimals', left: 0.5, op: '*', right: 4, expected: 2 },
    { id: 'decimal-display', left: 0.1, op: '+', right: 0.2, expected: 0.3 },
    { id: 'zero-recovery', left: 8, op: '/', right: 0, error: true },
    { id: 'zero-recovery', left: 2, op: '+', right: 3, expected: 5 },
  ];
  const child = String.raw`
    import {readFileSync} from 'node:fs';
    const cases = JSON.parse(readFileSync(0, 'utf8'));
    const {calculate} = await import('file:///app/src/calculator.mjs');
    if (typeof calculate !== 'function') process.exit(2);
    const results = [];
    for (const item of cases) {
      try { const value = calculate(item.left, item.op, item.right); results.push({ok:true,finite:typeof value === 'number' && Number.isFinite(value),value,display:String(value)}); }
      catch(error) { results.push({ok:false,errorNonEmpty:error instanceof Error && typeof error.message === 'string' && error.message.trim().length>0}); }
    }
    process.stdout.write(JSON.stringify(results));
  `;
  const result = run(['--disable-sigusr1', '--permission', '--allow-fs-read=/app', '--input-type=module', '-e', child], JSON.stringify(cases));
  let values;
  try { values = JSON.parse(result.stdout); } catch { /* Not proof of execution. */ }
  if (result.failed || result.code !== 0 || !Array.isArray(values) || values.length !== cases.length) failures.add('arithmetic-interface');
  else for (const [index, item] of cases.entries()) {
    const actual = values[index];
    if (!actual || (item.error ? actual.ok !== false || actual.errorNonEmpty !== true :
      actual.ok !== true || actual.finite !== true || actual.value !== item.expected || actual.display !== String(item.expected))) failures.add(item.id);
  }
}
if (manifest.expected.includes('project-tests'))
  for (const path of manifest.paths.filter(path => path.startsWith('test/') && path.endsWith('.mjs'))) {
    const result = run(['--disable-sigusr1', '--permission', '--allow-fs-read=/app', '/app/' + path]);
    if (result.failed || result.code !== 0) failures.add('project-tests');
  }
if (manifest.expected.includes('ui-structure')) {
  try {
    const html = readFileSync('/app/index.html', 'utf8'), css = readFileSync('/app/styles.css', 'utf8'), app = readFileSync('/app/src/app.mjs', 'utf8');
    if (!/<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/i.test(html) ||
      !/(?:<output\b|\brole\s*=\s*["']status["']|\baria-live\s*=\s*["'](?:polite|assertive)["'])/i.test(html) ||
      !/(?:<button\b|<input\b[^>]*\btype\s*=\s*["'](?:button|submit)["'])/i.test(html) || !/<script\b(?=[^>]*\btype\s*=\s*["']module["'])(?=[^>]*\bsrc\s*=\s*["'](?:\.\/)?src\/app\.mjs["'])[^>]*>/i.test(html) ||
      !/<link\b[^>]*\bhref\s*=\s*["'](?:\.\/)?styles\.css["']/i.test(html) || !css.trim() || !app.trim()) failures.add('ui-structure');
  } catch { failures.add('ui-structure'); }
}
const proof = { version: 1, status: failures.size ? 'failed' : 'passed', checks: manifest.expected, failures: [...failures] };
process.stdout.write(JSON.stringify(proof));
process.exitCode = failures.size ? 1 : 0;
