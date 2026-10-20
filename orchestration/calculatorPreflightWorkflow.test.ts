import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';

const workflow = fs.readFileSync(new URL('../.github/workflows/calculator-preflight.yml', import.meta.url), 'utf8');
const embedded = workflow.split("          node --input-type=module <<'NODE'\n")[1]?.split('\n          NODE')[0];
assert.ok(embedded, 'Readiness implementation must remain inspectable');
const script = embedded.split('\n').map(line => line.slice(10)).filter(line => !line.startsWith('import ')).join('\n');
const fixture = {
  version: 1, factorySha: '18f6408007f95720e0e534636e8f2a322db82294', freeTierConfirmed: true,
  goal: { version: 1, id: 'preflight-regression', goal: 'Create the agreed calculator with independent tests and phone controls.',
    baseRef: 'feat/calculator-pilot-bootstrap', baseSha: 'a'.repeat(40), provider: 'groq' },
  config: { version: 1, sandboxImage: 'node@sha256:' + 'c'.repeat(64), trustedWorkflows: [
    { id: 73, path: '.github/workflows/calculator-task-ci.yml', blobSha: 'b'.repeat(40) },
  ] },
};
type Report = { status: string; reasonCode: string; modelsRun: boolean; calculatorWrites: boolean;
  wholeAppCompleted: boolean; legalEnabled: boolean; freeTierConfirmationSource?: string;
  access: { readAccessVerified: boolean; writeAccessVerified: boolean; headMatches: boolean } };

test('read-only preflight rejects credential, provenance and input failures without disclosure', async t => {
  for (const kind of ['valid', 'missing-key', 'missing-token', 'free-unconfirmed', 'extra-mode', 'wrong-runtime',
    'main-base', 'duplicate-pin', 'request-symlink', 'ancestor-symlink', 'hardlink', 'oversize',
    'token-401', 'token-403', 'token-404', 'access-head-race', 'access-wrong-blob', 'access-disabled',
    'free-not-boolean', 'owner-free-confirmation']) await t.test(kind, async () => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'calculator-preflight-'));
    try {
      const workspace = join(directory, 'workspace'), temporary = join(directory, 'temporary');
      const path = join(workspace, 'request/.factory/calculator-preflight-request.json'), output = join(directory, 'output');
      fs.mkdirSync(join(workspace, 'request/.factory'), { recursive: true, mode: 0o700 });
      fs.mkdirSync(temporary, { mode: 0o700 }); fs.writeFileSync(output, '');
      const request: Record<string, any> = structuredClone(fixture);
      if (kind === 'extra-mode') request.mode = 'run';
      if (kind === 'wrong-runtime') request.factorySha = 'd'.repeat(40);
      if (kind === 'main-base') request.goal.baseRef = 'main';
      if (kind === 'duplicate-pin') request.config.trustedWorkflows.push(request.config.trustedWorkflows[0]);
      if (kind === 'free-unconfirmed') request.freeTierConfirmed = false;
      if (kind === 'free-not-boolean') request.freeTierConfirmed = 'true';
      fs.writeFileSync(path, kind === 'oversize' ? ' '.repeat(24577) : JSON.stringify(request));
      if (kind === 'request-symlink') { fs.renameSync(path, join(directory, 'real.json')); fs.symlinkSync(join(directory, 'real.json'), path); }
      if (kind === 'ancestor-symlink') { fs.renameSync(join(workspace, 'request/.factory'), join(directory, 'real-dir')); fs.symlinkSync(join(directory, 'real-dir'), join(workspace, 'request/.factory')); }
      if (kind === 'hardlink') fs.linkSync(path, join(directory, 'linked.json'));
      const env: Record<string, string> = { RUNNER_TEMP: temporary, GITHUB_WORKSPACE: workspace, GITHUB_OUTPUT: output,
        GITHUB_TOKEN: 'test-only-never-disclose', HAS_GROQ: 'true', HAS_GEMINI: 'false', HAS_CLOUDFLARE: 'false',
        HAS_CALCULATOR_TOKEN: 'true', HAS_CONFIRMED_FREE_TIER: 'true' };
      if (kind === 'missing-key') env.HAS_GROQ = 'false';
      if (kind === 'missing-token') env.HAS_CALCULATOR_TOKEN = 'false';
      if (kind === 'free-unconfirmed' || kind === 'owner-free-confirmation') env.HAS_CONFIRMED_FREE_TIER = 'false';
      const process = { env, umask: () => 0o077, exitCode: 0 };
      let heads = 0, calls = 0; const logged: string[] = [];
      const fetch = async (url: string, options: RequestInit) => {
        calls++; assert.ok(url.startsWith('https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/'));
        assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
        if (kind.startsWith('token-')) return new Response('DO_NOT_DISCLOSE_UPSTREAM_BODY', { status: Number(kind.slice(6)) });
        if (url.includes('/git/ref/')) return Response.json({ ref: 'refs/heads/feat/calculator-pilot-bootstrap',
          object: { type: 'commit', sha: kind === 'access-head-race' && ++heads > 1 ? 'd'.repeat(40) : request.goal.baseSha } });
        if (url.includes('/contents/')) return Response.json({ type: 'file', path: request.config.trustedWorkflows[0].path,
          sha: kind === 'access-wrong-blob' ? 'd'.repeat(40) : request.config.trustedWorkflows[0].blobSha });
        return Response.json({ id: request.config.trustedWorkflows[0].id, path: request.config.trustedWorkflows[0].path,
          state: kind === 'access-disabled' ? 'disabled_manually' : 'active' });
      };
      await runInNewContext('(async()=>{' + script + '})()', { ...fs, join, process, fetch, Response, AbortSignal, Buffer,
        console: { log: (line: string) => logged.push(line) } }, { timeout: 2000 });
      const root = join(temporary, 'calculator-preflight');
      const raw = fs.readFileSync(join(root, 'report/calculator-report.json'), 'utf8'), report = JSON.parse(raw) as Report;
      for (const value of [raw, ...logged]) {
        assert.ok(!value.includes('test-only-never-disclose'));
        assert.ok(!value.includes('DO_NOT_DISCLOSE_UPSTREAM_BODY'));
      }
      assert.equal(report.modelsRun, false); assert.equal(report.calculatorWrites, false);
      assert.equal(report.wholeAppCompleted, false); assert.equal(report.legalEnabled, false);
      assert.equal(report.status, 'blocked'); assert.equal(report.access.writeAccessVerified, false);
      if (kind === 'valid' || kind === 'owner-free-confirmation') {
        assert.equal(process.exitCode, 0); assert.equal(report.reasonCode, 'runtime_preflight_not_executed');
        assert.equal(report.access.readAccessVerified, true); assert.equal(calls, 4);
        assert.ok(fs.readFileSync(output, 'utf8').startsWith('ready=true\nprovider=groq\n'));
        assert.equal(fs.statSync(join(root, 'goal.json')).mode & 0o777, 0o600);
        if (kind === 'owner-free-confirmation') assert.equal(report.freeTierConfirmationSource, 'owner-request');
      } else {
        assert.equal(process.exitCode, 10); assert.equal(fs.readFileSync(output, 'utf8'), '');
        assert.equal(fs.existsSync(join(root, 'goal.json')), false);
      }
      if (kind === 'free-unconfirmed') { assert.equal(report.reasonCode, 'free_tier_unconfirmed'); assert.equal(report.access.readAccessVerified, true); }
      if (kind === 'access-head-race') assert.equal(report.access.headMatches, false);
      if (['missing-key', 'missing-token', 'extra-mode', 'wrong-runtime', 'main-base'].includes(kind)) assert.equal(calls, 0);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
});

test('preflight workflow keeps live execution and GitHub writes disabled', () => {
  const commands = workflow.split('\n').filter(line => line.includes('run: pnpm exec tsx orchestration/calculatorCli.ts'));
  assert.equal(commands.length, 1); assert.ok(commands[0].endsWith('--mode preflight'));
  assert.ok(workflow.includes("AGENT_FACTORY_ENABLE_GITHUB_WRITES: 'false'"));
  assert.ok(workflow.includes("CALCULATOR_EXECUTION_LIVE_APPROVED: ''"));
  assert.ok(workflow.includes("AGENT_FACTORY_LEGAL_ENABLED: 'false'"));
  assert.ok(!workflow.includes('pull_request_target'));
  const artifact = workflow.split('name: Preserve only the source-free preflight report')[1];
  const paths = artifact.split('path: |\n')[1].split('if-no-files-found:')[0].split('\n').map(line => line.trim()).filter(Boolean);
  assert.deepEqual(paths, ['${{ runner.temp }}/calculator-preflight/report/calculator-report.json',
    '${{ runner.temp }}/calculator-preflight/report/calculator-access.json']);
});
