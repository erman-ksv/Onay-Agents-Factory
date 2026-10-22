/** Read-only fixed plan metadata, never a model call or execution authorization. */
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
try {
  const path = join(process.argv[2], 'state/calculator-pilot-step7-v1.calculator-plan.json');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 32768) throw Error();
  const raw = readFileSync(path, 'utf8');
  if (/(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|gsk_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})/.test(raw)) throw Error();
  const plan = JSON.parse(raw);
  if (Object.keys(plan).sort().join(',') !== 'fingerprint,proposal,request,version' || plan.version !== 1 ||
      plan.fingerprint !== '1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2' ||
      plan.request?.id !== 'calculator-pilot-step7-v1' || !Array.isArray(plan.proposal?.tasks) || plan.proposal.tasks.length !== 5) throw Error();
  const files = []; let total = 0;
  function walk(directory, relative = '', depth = 0) {
    if (depth > 8) throw Error();
    const dir = lstatSync(directory);
    if (!dir.isDirectory() || dir.isSymbolicLink()) throw Error();
    for (const name of readdirSync(directory).sort()) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(name) || name.includes('..')) throw Error();
      const path = join(directory, name), rel = relative ? relative + '/' + name : name, stat = lstatSync(path);
      if (stat.isDirectory() && !stat.isSymbolicLink()) { walk(path, rel, depth + 1); continue; }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 32768 || !/\.(?:json|lock)$/.test(name)) throw Error();
      const content = readFileSync(path, 'utf8');
      if (name.endsWith('.lock') && content.length) throw Error();
      const decoded = name.endsWith('.json') ? JSON.stringify(JSON.parse(content)) : content;
      if (/(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|gsk_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})/.test(content + decoded)) throw Error();
      total += Buffer.byteLength(content); files.push({ path: rel, content });
      if (total > 1048576 || files.length > 128) throw Error();
    }
  }
  walk(process.argv[2]);
  console.log(JSON.stringify({ event: 'calculator_regeneration_plan_fixture', liveModels: false, writes: false, plan }));
  console.log(JSON.stringify({ event: 'calculator_regeneration_stopped_state_fixture', liveModels: false, writes: false, files }));
} catch { console.error('Fixed plan metadata unverified; no replay.'); process.exitCode = 10; }
