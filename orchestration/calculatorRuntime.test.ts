import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareCalculatorRuntimeConfig, runCalculatorRuntime, loadCalculatorRuntimeSources, CALCULATOR_RUNTIME_ERROR } from "./calculatorRuntime.js";
import { parseCalculatorCli, runCalculatorCli } from "./calculatorCli.js";
const config = { version: 1, sandboxImage: "node@sha256:" + "a".repeat(64), trustedWorkflows: [
  { id: 1, path: ".github/workflows/calculator-task-ci.yml", blobSha: "b".repeat(40) },
] };
const owner = { version: 1, id: "runtime-pilot", goal: "Create the complete agreed static calculator with independent tests and phone layout.",
  baseRef: "feat/calculator-pilot-bootstrap", baseSha: "a".repeat(40), provider: "groq" };
const refused = (error: unknown) => error instanceof Error && error.message === CALCULATOR_RUNTIME_ERROR;
test("live config freezes exact image/workflow identities and refuses fallback/unknown pins", () => {
  const result = prepareCalculatorRuntimeConfig(config); assert.ok(Object.isFrozen(result.trustedWorkflows));
  for (const raw of [{ ...config, sandboxImage: "node:22" }, { ...config, trustedWorkflows: [] },
    { ...config, trustedWorkflows: [{ ...config.trustedWorkflows[0], id: 0 }] },
    { ...config, trustedWorkflows: [{ ...config.trustedWorkflows[0], path: ".github/workflows/arbitrary.yml" }] },
    { ...config, trustedWorkflows: [config.trustedWorkflows[0], config.trustedWorkflows[0]] },
    { ...config, paidFallback: true }]) assert.throws(() => prepareCalculatorRuntimeConfig(raw), refused);
});
test("inspect needs no config, credentials, Docker or model and cannot claim completion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "calculator-runtime-"));
  try { const result = await runCalculatorRuntime(owner, undefined, directory, "inspect", {});
    assert.equal(result.status, "unplanned"); assert.equal(result.wholeAppCompleted, false); assert.equal(result.legalEnabled, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("missing host/provider consent refuses before planning/model or Git writes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "calculator-runtime-"));
  try { await assert.rejects(() => runCalculatorRuntime(owner, config, directory, "run", {}), refused);
    const result = await runCalculatorRuntime(owner, undefined, directory, "inspect", {}); assert.equal(result.status, "unplanned");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("current source assembly checks both complete snapshots and refuses a moving base", async () => {
  const A = "a".repeat(40), B = "b".repeat(40); let heads = 0;
  const reader = { getHead: async () => { heads++; return A; }, readCommit: async () => ({ sha: A, treeSha: B }),
    readTree: async () => ({ sha: B, truncated: false, tree: [] }), readBlob: async () => { throw Error("unused"); } };
  assert.equal((await loadCalculatorRuntimeSources(reader, owner.baseRef, A)).size, 0); assert.equal(heads, 5);
  reader.getHead = async () => B;
  await assert.rejects(() => loadCalculatorRuntimeSources(reader, owner.baseRef, A));
});
test("CLI accepts explicit bounded modes and rejects duplicate/relative/arbitrary commands", () => {
  const args = ["--goal", "/tmp/goal.json", "--config", "/tmp/config.json", "--state-dir", "/tmp/state", "--output-dir", "/tmp/output", "--mode", "inspect"];
  assert.equal(parseCalculatorCli(args).mode, "inspect");
  for (const value of [[...args, "--mode", "run"], args.map(part => part === "/tmp/goal.json" ? "goal.json" : part),
    args.map(part => part === "inspect" ? "shell" : part), [...args, "--command", "curl"]]) assert.throws(() => parseCalculatorCli(value), refused);
});
test("CLI saves a private source-free inspection report and refuses state symlink ancestors", async () => {
  const directory = mkdtempSync(join(tmpdir(), "calculator-cli-"));
  try {
    const goal = join(directory, "goal.json"); writeFileSync(goal, JSON.stringify(owner));
    const args = ["--goal", goal, "--config", join(directory, "absent.json"), "--state-dir", join(directory, "state"), "--output-dir", join(directory, "output"), "--mode", "inspect"];
    assert.equal((await runCalculatorCli(args, {})).code, 0);
    const report = JSON.parse(readFileSync(join(directory, "output", "calculator-report.json"), "utf8")); assert.equal(report.status, "unplanned");
    mkdirSync(join(directory, "real"), { mode: 0o700 }); symlinkSync(join(directory, "real"), join(directory, "link"));
    await assert.rejects(() => runCalculatorCli(args.map(part => part === join(directory, "state") ? join(directory, "link", "child") : part), {}), refused);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("fresh committed inspection uses proven sources at current SHA without inventing another generation", async () => {
  const { createCalculatorModelTeam } = await import('./calculatorModelTeam.js');
  const { createCalculatorPlan, calculatorPlanTaskId, CALCULATOR_ACCEPTANCE } = await import('./calculatorPlan.js');
  const { loadCalculatorSnapshot } = await import('../github/calculatorSnapshot.js');
  const { createHash } = await import('node:crypto');
  const A = owner.baseSha, B = 'b'.repeat(40), T = 'c'.repeat(40);
  const id = (n: number) => calculatorPlanTaskId(owner, n);
  const plan = createCalculatorPlan(owner, { tasks: [
    { id: id(1), role: 'coder', goal: 'Implement arithmetic and meaningful tests.', acceptanceIds: CALCULATOR_ACCEPTANCE.slice(0,7).map(item=>item.id), paths: ['src/calculator.mjs','test/calculator.test.mjs'], dependsOn: [] },
    { id: id(2), role: 'frontend', goal: 'Implement all responsive UI sources.', acceptanceIds: CALCULATOR_ACCEPTANCE.slice(7).map(item=>item.id), paths: ['index.html','styles.css','src/app.mjs'], dependsOn: [id(1)] },
    { id: id(3), role: 'frontend', goal: 'Test keyboard and button interaction.', acceptanceIds: ['keyboard'], paths: ['test/ui.test.mjs'], dependsOn: [id(2)] },
  ], blockers: [], unverifiedAreas: [] });
  const sources = new Map([['src/calculator.mjs', 'export const calculate = (a, op, b) => a + b;'], ['test/calculator.test.mjs', 'export const checks = true;']]);
  const blobs = [...sources].map(([path,content])=>({path,content,sha:createHash('sha1').update('blob '+Buffer.byteLength(content)+'\0'+content).digest('hex')}));
  const original = await loadCalculatorSnapshot({repository:plan.owner.repository,baseRef:A,baseSha:A,changePaths:plan.tasks[0].paths},{getHead:async()=>A,readCommit:async()=>({sha:A,treeSha:T}),readTree:async()=>({sha:T,truncated:false,tree:[]}),readBlob:async()=>{throw Error('unused');}});
  const current = await loadCalculatorSnapshot({repository:plan.owner.repository,baseRef:plan.branch,baseSha:B,changePaths:plan.tasks[0].paths},{getHead:async()=>B,readCommit:async()=>({sha:B,treeSha:T}),readTree:async()=>({sha:T,truncated:false,tree:[{path:'src',sha:T,type:'tree',mode:'040000'},{path:'test',sha:T,type:'tree',mode:'040000'},...blobs.map(file=>({path:file.path,sha:file.sha,type:'blob',mode:'100644'}))]}),readBlob:async sha=>({sha,encoding:'base64',content:Buffer.from(blobs.find(file=>file.sha===sha)!.content).toString('base64')})});
  let calls = 0;
  const team = createCalculatorModelTeam(owner,{AGENT_FACTORY_PROVIDER:'groq',GROQ_API_KEY:'fixture-key',AGENT_FACTORY_TARGET_PROFILE:'calculator',CALCULATOR_MODEL_LIVE_APPROVED:'ONE_FREE_BOUNDED_RUN',ONAY_TEAM_FREE_TIER_CONFIRMED:'true',AGENT_FACTORY_LEGAL_ENABLED:'false'},async(_url,init)=>{
    calls++;const packet=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    assert.equal(packet.inspectedCommitSha,B);assert.equal(packet.evidenceId,'changes@'+B);
    return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({ready:true,summary:'Review of shown committed task changes.',findings:[],unverifiedAreas:['Unshown source and browser acceptance remain unverified.']})}}]});
  });
  const observed = team.observeCommitted(plan,id(1),original,current);
  assert.equal(calls,0);assert.equal((await team.assess('reviewer',plan,id(1),observed)).ready,true);
  assert.equal(team.snapshot().generatedTasks,0);assert.equal(calls,1);
  assert.throws(()=>team.observeCommitted(plan,id(1),JSON.parse(JSON.stringify(original)),current));
});
test("host workflow renderer pins Factory, isolates candidate execution and cannot inject YAML", async () => {
  const {renderCalculatorTaskWorkflow}=await import('../config/calculatorTaskWorkflow.js');
  const text=renderCalculatorTaskWorkflow('a'.repeat(40),'node@sha256:'+'b'.repeat(64));
  assert.ok(text.includes('ref: '+'a'.repeat(40)));assert.ok(text.includes('persist-credentials: false'));
  assert.ok(text.includes('name: Syntax'));assert.ok(text.includes('name: Task tests'));assert.ok(!text.includes('pull_request_target'));
  assert.throws(()=>renderCalculatorTaskWorkflow('main','node:latest'));
  assert.throws(()=>renderCalculatorTaskWorkflow('a'.repeat(40),'node@sha256:'+'b'.repeat(64)+'\nrun: bad'));
});
test("trusted CI entry refuses incomplete/symlink sources without running candidate code", async () => {
  const {runCalculatorTaskCi}=await import('./calculatorTaskCi.js');
  const directory=mkdtempSync(join(tmpdir(),'calculator-task-ci-'));
  try { assert.equal((await runCalculatorTaskCi(directory,owner.baseSha,config.sandboxImage)).status,'unverified');
    const source=join(directory,'real');mkdirSync(source);symlinkSync(source,join(directory,'link'));
    await assert.rejects(()=>runCalculatorTaskCi(join(directory,'link'),owner.baseSha,config.sandboxImage));
  } finally {rmSync(directory,{recursive:true,force:true});}
});
test("bootstrap workflow registration is separated from required candidate test jobs", async () => {
  const {renderCalculatorTaskWorkflow}=await import('../config/calculatorTaskWorkflow.js');
  const workflow=renderCalculatorTaskWorkflow('a'.repeat(40),'node@sha256:'+'b'.repeat(64));
  const registration=workflow.split('  registration:\n')[1]?.split('  task:\n')[0];
  assert.ok(registration?.includes("if: github.ref == 'refs/heads/feat/calculator-pilot-bootstrap'"));
  assert.ok(registration?.includes('testsExecuted:false'));
  for(const forbidden of ['secrets.', 'actions/checkout', 'pnpm', 'docker', 'name: Syntax', 'name: Task tests'])
    assert.ok(!registration?.includes(forbidden));
  const task=workflow.split('  task:\n')[1];
  assert.ok(task.includes("if: startsWith(github.ref, 'refs/heads/feat/calculator-agent/')"));
  assert.ok(task.includes('name: Syntax'));assert.ok(task.includes('name: Task tests'));
  const {evaluateTestExecutionEvidence}=await import('../agents/tester/agent.js');
  const run={id:1,name:'Calculator task CI',status:'completed',conclusion:'success',html_url:'https://github.com/erman-ksv/Onay-Factory-Calculator/actions/runs/1',head_sha:'a'.repeat(40),run_attempt:1};
  const evidence=evaluateTestExecutionEvidence([run],[{name:'Workflow registration only',status:'completed',conclusion:'success',run_id:1,run_attempt:1,head_sha:'a'.repeat(40)},
    {name:'Calculator task CI',status:'completed',conclusion:'skipped',run_id:1,run_attempt:1,head_sha:'a'.repeat(40),steps:[]}],
    'a'.repeat(40),['Calculator task CI'],['Syntax','Task tests']);
  assert.equal(evidence.testsExecuted,false);assert.notEqual(evidence.status,'passed');
});
test("dependency review sends a bounded diff and omits an unchanged private companion", async () => {
  const {createCalculatorModelTeam}=await import('./calculatorModelTeam.js');
  const {createCalculatorPlan,calculatorPlanTaskId,CALCULATOR_ACCEPTANCE}=await import('./calculatorPlan.js');
  const {loadCalculatorSnapshot}=await import('../github/calculatorSnapshot.js');
  const {createHash}=await import('node:crypto');
  const id=(n:number)=>calculatorPlanTaskId(owner,n), A=owner.baseSha,B='b'.repeat(40),T='c'.repeat(40);
  const proposal={tasks:[
    {id:id(1),role:'coder',goal:'Implement arithmetic and meaningful tests.',acceptanceIds:CALCULATOR_ACCEPTANCE.slice(0,7).map(x=>x.id),paths:['src/calculator.mjs','test/calculator.test.mjs'],dependsOn:[]},
    {id:id(2),role:'frontend',goal:'Implement all responsive UI sources.',acceptanceIds:CALCULATOR_ACCEPTANCE.slice(7).map(x=>x.id),paths:['index.html','styles.css','src/app.mjs'],dependsOn:[id(1)]},
    {id:id(3),role:'frontend',goal:'Test keyboard and button interaction.',acceptanceIds:['keyboard'],paths:['test/ui.test.mjs'],dependsOn:[id(2)]},
  ],blockers:[],unverifiedAreas:[]};
  const plan=createCalculatorPlan(owner,proposal), old='export const value = 41; // ORIGINAL_PRIVATE_TAIL', companion='export const privateCompanion = true;';
  async function snapshot(sha:string,source:string){
    const blobs=[{path:'src/calculator.mjs',content:source},{path:'test/calculator.test.mjs',content:companion}].map(f=>({...f,sha:createHash('sha1').update('blob '+Buffer.byteLength(f.content)+'\0'+f.content).digest('hex')}));
    return loadCalculatorSnapshot({repository:plan.owner.repository,baseRef:sha,baseSha:sha,changePaths:plan.tasks[0].paths},{getHead:async()=>sha,readCommit:async()=>({sha,treeSha:T}),readTree:async()=>({sha:T,truncated:false,tree:[{path:'src',sha:T,type:'tree',mode:'040000'},{path:'test',sha:T,type:'tree',mode:'040000'},...blobs.map(f=>({path:f.path,sha:f.sha,type:'blob',mode:'100644'}))]}),readBlob:async h=>({sha:h,encoding:'base64',content:Buffer.from(blobs.find(f=>f.sha===h)!.content).toString('base64')})});
  }
  const original=await snapshot(A,old),current=await snapshot(B,old.replace('41','42'));let sent='';
  const team=createCalculatorModelTeam(owner,{AGENT_FACTORY_PROVIDER:'groq',GROQ_API_KEY:'fixture-key',AGENT_FACTORY_TARGET_PROFILE:'calculator',CALCULATOR_MODEL_LIVE_APPROVED:'ONE_FREE_BOUNDED_RUN',ONAY_TEAM_FREE_TIER_CONFIRMED:'true',AGENT_FACTORY_LEGAL_ENABLED:'false'},async(_u,init)=>{
    sent=String(init?.body);return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({ready:true,summary:'The bounded changed expression is reviewed.',findings:[],unverifiedAreas:['Unchanged companion source is not inspected.']})}}]});
  });
  const changes=team.observeCommitted(plan,id(1),original,current);assert.equal(changes.files.length,1);
  await team.assess('reviewer',plan,id(1),changes);assert.ok(!sent.includes('ORIGINAL_PRIVATE_TAIL'));assert.ok(!sent.includes(companion));assert.ok(sent.includes('Unshown unchanged source'));
  const split=structuredClone(proposal);split.tasks[1].paths=['index.html','styles.css'];split.tasks[2].paths=['src/app.mjs','test/ui.test.mjs'];
  assert.equal(createCalculatorPlan(owner,split).status,'blocked');
});
