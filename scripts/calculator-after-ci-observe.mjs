/** Fixed read-only observation of the first Calculator candidate's late CI.
 * This is neither execution authorization nor an event subscription. No source
 * blobs, artifacts, model endpoints, writes or dispatches are accessed. */
import { pathToFileURL } from 'node:url';

const FACTORY = 'erman-ksv/Onay-Agents-Factory';
const REPOSITORY = 'erman-ksv/Onay-Factory-Calculator';
const BRANCH = 'feat/calculator-agent/calculator-pilot-step7-v1';
const CANDIDATE = '5c4bc71b3119a50d2ca7ce1dbdf12bcaa000ce75';
const BOOTSTRAP = '2c1218f2b020962ad93adf68d902a847271a7e72';
// Historical host config in calculatorStep7Regeneration.ts, runtime AEC.
const WORKFLOW = Object.freeze({ id: 390241255, path: '.github/workflows/calculator-task-ci.yml',
  blobSha: '45fae4a292a04e89a631ad7ff2469a3af7265e70' });
const RUN = 39610242811, JOB = 119256919001;
const SHA = /^[a-f0-9]{40}$/;
const ERROR = 'calculator_after_ci_observation_unverified_no_execution';
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const integer = value => Number.isSafeInteger(value) && value > 0;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 240 && !/[\u0000-\u001f\u007f]/.test(value);
function refuse() { throw Error(ERROR); }
function object(value) { if (!plain(value)) refuse(); return value; }

/** Dependency injection exists only for deterministic host tests. The CLI
 * supplies the native fetch and its fixed workflow-scoped credential. */
export async function observeCalculatorAfterCi(env = process.env, transport = globalThis.fetch) {
  if (env.GITHUB_REPOSITORY !== FACTORY || !env.CALCULATOR_GITHUB_TOKEN ||
      env.GITHUB_EVENT_NAME !== 'push' || !env.GITHUB_REF?.startsWith('refs/heads/feat/') ||
      env.GITHUB_RUN_ATTEMPT !== '1' || !SHA.test(env.GITHUB_SHA ?? '') ||
      !integer(Number(env.GITHUB_RUN_ID)) || typeof transport !== 'function') refuse();
  const started = performance.now(); let requests = 0;
  async function get(endpoint) {
    const remaining = 45000 - (performance.now() - started);
    if (++requests > 24 || remaining <= 0 || !endpoint.startsWith('/')) refuse();
    const response = await transport('https://api.github.com/repos/' + REPOSITORY + endpoint, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(12000, remaining)))),
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + env.CALCULATOR_GITHUB_TOKEN,
        'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!response.ok || !response.body) { void response.body?.cancel().catch(() => undefined); refuse(); }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try { while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 1048576) { await reader.cancel(); refuse(); }
      chunks.push(part.value);
    } } finally { reader.releaseLock(); }
    if (performance.now() - started > 45000) refuse();
    return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
  }
  async function current() {
    const value = await get('/git/ref/heads/' + encodeURIComponent(BRANCH));
    if (value.ref !== 'refs/heads/' + BRANCH || object(value.object).type !== 'commit' || value.object.sha !== CANDIDATE) refuse();
  }
  function run(value) {
    object(value);
    if (value.id !== RUN || value.workflow_id !== WORKFLOW.id || value.path !== WORKFLOW.path ||
        value.head_sha !== CANDIDATE || value.head_branch !== BRANCH || value.run_attempt !== 1 || value.event !== 'push' ||
        value.status !== 'completed' || value.conclusion !== 'success' ||
        object(value.repository).full_name !== REPOSITORY || object(value.head_repository).full_name !== REPOSITORY ||
        value.html_url !== 'https://github.com/' + REPOSITORY + '/actions/runs/' + RUN) refuse();
    return { id: RUN, workflowId: WORKFLOW.id, path: WORKFLOW.path, candidateSha: CANDIDATE, branch: BRANCH,
      attempt: 1, status: 'completed', conclusion: 'success', event: 'push' };
  }
  async function list() {
    const value = await get('/actions/runs?head_sha=' + CANDIDATE + '&branch=' + encodeURIComponent(BRANCH) + '&per_page=20&page=1');
    if (!Number.isSafeInteger(value.total_count) || value.total_count < 1 || value.total_count > 20 ||
        !Array.isArray(value.workflow_runs) || value.workflow_runs.length !== value.total_count) refuse();
    const ids = new Set();
    for (const item of value.workflow_runs) {
      object(item);
      if (!integer(item.id) || ids.has(item.id) || item.head_sha !== CANDIDATE || item.head_branch !== BRANCH ||
          object(item.repository).full_name !== REPOSITORY || object(item.head_repository).full_name !== REPOSITORY ||
          (item.workflow_id === WORKFLOW.id && item.id !== RUN) ||
          (item.status === 'completed' && !['success', 'skipped', 'neutral'].includes(item.conclusion))) refuse();
      ids.add(item.id);
    }
    const observed = value.workflow_runs.find(item => item.id === RUN); if (!observed) refuse(); run(observed);
    return [...ids].sort((left, right) => left - right);
  }
  async function jobs() {
    const value = await get('/actions/runs/' + RUN + '/attempts/1/jobs?per_page=100&page=1');
    if (!Array.isArray(value.jobs) || value.total_count !== value.jobs.length || value.jobs.length !== 2) refuse();
    const ids = new Set(), names = new Set();
    const result = value.jobs.map(item => {
      object(item);
      if (!integer(item.id) || ids.has(item.id) || !text(item.name) || names.has(item.name) ||
          item.run_id !== RUN || item.run_attempt !== 1 || item.head_sha !== CANDIDATE ||
          !['https://github.com/' + REPOSITORY + '/actions/runs/' + RUN + '/job/' + item.id,
            'https://github.com/' + REPOSITORY + '/runs/' + item.id].includes(item.html_url)) refuse();
      ids.add(item.id); names.add(item.name);
      if (item.id === JOB) {
        if (item.name !== 'Calculator task CI' || item.status !== 'completed' || item.conclusion !== 'success' ||
            !Array.isArray(item.steps) || item.steps.length > 64) refuse();
        const numbers = new Set();
        for (const step of item.steps) {
          object(step); if (!integer(step.number) || numbers.has(step.number) || !text(step.name)) refuse(); numbers.add(step.number);
        }
        for (const name of ['Syntax', 'Task tests']) {
          const steps = item.steps.filter(step => step.name === name);
          if (steps.length !== 1 || steps[0].status !== 'completed' || steps[0].conclusion !== 'success') refuse();
        }
        return { id: JOB, name: 'Calculator task CI', status: 'completed', conclusion: 'success',
          steps: item.steps.map(step => ({ number: step.number, name: step.name, status: step.status, conclusion: step.conclusion })) };
      }
      if (item.name !== 'Workflow registration only' || item.status !== 'completed' || item.conclusion !== 'skipped') refuse();
      return { id: item.id, name: item.name, status: 'completed', conclusion: 'skipped' };
    });
    if (!ids.has(JOB)) refuse(); return result.sort((left, right) => left.id - right.id);
  }
  await current();
  for (const sha of [BOOTSTRAP, CANDIDATE]) {
    const commit = await get('/git/commits/' + sha);
    if (commit.sha !== sha || !SHA.test(object(commit.tree).sha) ||
        (sha === CANDIDATE && (!Array.isArray(commit.parents) || commit.parents.length !== 1 || object(commit.parents[0]).sha !== BOOTSTRAP))) refuse();
    const tree = await get('/git/trees/' + commit.tree.sha + '?recursive=1');
    if (tree.sha !== commit.tree.sha || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 512) refuse();
    const entries = new Map();
    for (const entry of tree.tree) {
      object(entry); if (!text(entry.path) || entries.has(entry.path) || !SHA.test(entry.sha)) refuse(); entries.set(entry.path, entry);
    }
    for (const directory of ['.github', '.github/workflows']) {
      if (entries.get(directory)?.type !== 'tree' || entries.get(directory)?.mode !== '040000') refuse();
    }
    const pin = entries.get(WORKFLOW.path);
    if (!pin || pin.type !== 'blob' || pin.mode !== '100644' || pin.sha !== WORKFLOW.blobSha) refuse();
  }
  const workflow = await get('/actions/workflows/' + WORKFLOW.id);
  if (workflow.id !== WORKFLOW.id || workflow.path !== WORKFLOW.path || workflow.state !== 'active') refuse();
  const initialList = await list(), before = run(await get('/actions/runs/' + RUN)), observedJobs = await jobs();
  const after = run(await get('/actions/runs/' + RUN));
  if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(observedJobs) !== JSON.stringify(await jobs()) ||
      JSON.stringify(initialList) !== JSON.stringify(await list())) refuse();
  await current();
  return Object.freeze({ version: 1, status: 'observed-exact-candidate-ci-passed', repository: REPOSITORY, branch: BRANCH,
    candidateSha: CANDIDATE, bootstrapSha: BOOTSTRAP, workflow: WORKFLOW, runId: RUN, runAttempt: 1, jobId: JOB,
    requiredSteps: ['Syntax', 'Task tests'], testsExecuted: true, requests,
    observationOnly: true, executionAuthorized: false, automaticEventSubscription: false, modelsRun: false,
    writesPerformed: false, priorReceiptsChanged: false, wholeAppCompleted: false });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await observeCalculatorAfterCi())); }
  catch { console.error(JSON.stringify({ status: 'blocked', reasonCode: ERROR, modelsRun: false, writesPerformed: false })); process.exitCode = 10; }
}
