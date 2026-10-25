import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadCalculatorSnapshot } from "../github/calculatorSnapshot.js";
import { prepareCalculatorRoleChanges } from "../commander/calculatorTeam.js";
import { createCalculatorPlan } from "./calculatorPlan.js";
import { calculatorProposalDigest } from "./calculatorExecutionEvidence.js";
import { createCalculatorModelTeam } from "./calculatorModelTeam.js";
import { collectCalculatorAssessmentEvidence, calculatorAssessmentEvidencePacket, CALCULATOR_UI_BROWSER_SCENARIOS,
  CALCULATOR_NARROW_BROWSER_SCENARIOS, CALCULATOR_NARROW_DOM_SELECTORS, type CalculatorBrowserChecks, type CalculatorAssessmentEvidence } from "./calculatorAssessmentEvidence.js";

const saved = JSON.parse(readFileSync(new URL("./fixtures/calculatorStep7SavedPlan.json", import.meta.url), "utf8"));
const plan = createCalculatorPlan(saved.request, saved.proposal), task = plan.tasks[1]!;
const A = "a".repeat(40), B = "b".repeat(40);
const core = "export function calculate(left, operator, right) { return left + right; }\n// PRIVATE_SOURCE_MUST_STAY_IN_HOST_MEMORY";
const sha = (data: string) => createHash("sha256").update(data).digest("hex");
const env = { AGENT_FACTORY_TARGET_PROFILE: "calculator", AGENT_FACTORY_PROVIDER: "groq", GROQ_API_KEY: "fixture-key",
  CALCULATOR_MODEL_LIVE_APPROVED: "ONE_FREE_BOUNDED_RUN", ONAY_TEAM_FREE_TIER_CONFIRMED: "true", AGENT_FACTORY_LEGAL_ENABLED: "false" };
async function snapshot(paths: readonly string[], source = core, baseSha = A) {
  const blob = createHash("sha1").update("blob " + Buffer.byteLength(source) + "\0" + source).digest("hex");
  return loadCalculatorSnapshot({ repository: plan.owner.repository, baseRef: plan.branch, baseSha, changePaths: paths }, {
    getHead: async () => baseSha, readCommit: async () => ({ sha: baseSha, treeSha: B }),
    readTree: async () => ({ sha: B, truncated: false, tree: [
      { path: "src", sha: B, type: "tree", mode: "040000" },
      { path: "src/calculator.mjs", sha: blob, type: "blob", mode: "100644" },
    ] }), readBlob: async () => ({ sha: blob, encoding: "base64", content: Buffer.from(source).toString("base64") }),
  });
}
async function setup(savedUiSized = false) {
  const snap = await snapshot(task.paths), dependency = await snapshot(["src/calculator.mjs"]);
  const changes = prepareCalculatorRoleChanges("frontend", { summary: "Restore scoped UI", changes: task.paths.map(path => ({
    operation: "create", path, content: (path === "index.html" ? "<output>0</output>" : path === "styles.css" ? "output{display:block}" : "export const initial=0;").padEnd(savedUiSized ? (path === "styles.css" ? 600 : 1400) : 0),
    message: "Restore reviewed task scope",
  })) }, snap);
  const digest = calculatorProposalDigest(changes);
  const proposal = { repository: changes.repository, taskId: task.id, baseSha: A, proposalDigest: digest,
    status: "passed" as const, testsExecuted: true, failures: [] };
  const browser: CalculatorBrowserChecks = { repository: changes.repository, taskId: task.id, baseSha: A, proposalDigest: digest,
    dependencySha256: sha(core), status: "passed", testsExecuted: true, browser: "Chrome/155.0.8059.39", sandboxDisabled: false,
    pageErrors: 0, blockedRequests: 0, scenarios: [...CALCULATOR_UI_BROWSER_SCENARIOS] };
  let calls = 0;
  const runners = { checkProposal: async () => { calls++; return proposal; }, checkBrowser: async () => { calls++; return browser; } };
  return { snap, dependency, changes, proposal, browser, runners, calls: () => calls };
}
test("real host callbacks produce bounded, exact-proposal evidence without unchanged private source", async () => {
  const f = await setup(), token = await collectCalculatorAssessmentEvidence(task, f.changes, f.dependency, f.runners);
  const p = calculatorAssessmentEvidencePacket(token, task, f.changes), serialized = JSON.stringify(p);
  assert.equal(f.calls(), 2); assert.equal(p.baseSha, A); assert.equal(p.proposalDigest, calculatorProposalDigest(f.changes));
  assert.equal(p.dependencyContract.sourceSha256, sha(core)); assert.equal(p.dependencyContract.signature, "calculate(left, operator, right)");
  assert.ok(Buffer.byteLength(serialized) <= 3000); assert.ok(!serialized.includes(core)); assert.ok(!serialized.includes("PRIVATE_SOURCE"));
  assert.ok(p.unverifiedAreas.some(area => area.includes("Keyboard"))); assert.equal(p.publicationAuthorized, false);
  assert.ok(Object.isFrozen(p)); assert.ok(Object.isFrozen(p.browserChecks.scenarios));
  assert.deepEqual(Object.keys(p.proposalChecks).sort(), ["failures", "status", "testsExecuted"]);
  for (const key of ["repository", "taskId", "baseSha", "proposalDigest", "dependencySha256"])
    assert.equal(Object.hasOwn(p.browserChecks, key), false);
});
test("serialized claims, a cloned proposal and another task cannot reuse a capability", async () => {
  const f = await setup(), token = await collectCalculatorAssessmentEvidence(task, f.changes, f.dependency, f.runners);
  for (const fake of [{}, JSON.parse(JSON.stringify(token)), { publicationAuthorized: true }])
    assert.throws(() => calculatorAssessmentEvidencePacket(fake as CalculatorAssessmentEvidence, task, f.changes));
  assert.throws(() => calculatorAssessmentEvidencePacket(token, { ...task, id: task.id + "-other" }, f.changes));
  assert.throws(() => calculatorAssessmentEvidencePacket(token, task, { ...f.changes }));
});
test("a forged, stale, unrecognized or comment-only core snapshot stops before host runners", async t => {
  const f = await setup();
  for (const [name, dep] of [
    ["unbranded", { ...f.dependency }], ["stale", await snapshot(["src/calculator.mjs"], core, B)],
    ["wrong API", await snapshot(["src/calculator.mjs"], "export function calculate(expression) { return 0; }")],
    ["comment spoof", await snapshot(["src/calculator.mjs"], "/*\n" + core + "\n*/")],
  ] as const) await t.test(name, async () => assert.rejects(() => collectCalculatorAssessmentEvidence(task, f.changes, dep, f.runners)));
  assert.equal(f.calls(), 0);
});
test("incomplete, stale, failed or unsafe browser proof never becomes assessment evidence", async t => {
  for (const [key, value] of [
    ["proposalDigest", "0".repeat(64)], ["baseSha", B], ["taskId", "another-task"], ["dependencySha256", "0".repeat(64)],
    ["status", "failed"], ["testsExecuted", false], ["sandboxDisabled", true], ["pageErrors", 1], ["blockedRequests", 1],
    ["scenarios", CALCULATOR_UI_BROWSER_SCENARIOS.slice(0, 2)], ["browser", "Unverified browser"], ["extra", true],
  ]) await t.test(String(key), async () => {
    const f = await setup();
    await assert.rejects(() => collectCalculatorAssessmentEvidence(task, f.changes, f.dependency, {
      ...f.runners, checkBrowser: async () => ({ ...f.browser, [String(key)]: value }) as CalculatorBrowserChecks,
    }));
  });
});
test("failed host proposal checks stop before browser checks", async () => {
  const f = await setup(); let browser = 0;
  await assert.rejects(() => collectCalculatorAssessmentEvidence(task, f.changes, f.dependency, {
    checkProposal: async () => ({ ...f.proposal, status: "unverified", testsExecuted: false }),
    checkBrowser: async () => { browser++; return f.browser; },
  })); assert.equal(browser, 0);
});
test("host evidence reaches each fresh role before accounting; model verdicts remain unprivileged", async () => {
  const f = await setup(); let roleCalls = 0; let sentBytes = 0; let clock = 0; let currentToken: CalculatorAssessmentEvidence;
  const team = createCalculatorModelTeam(saved.request, env, async (_url, init) => {
    roleCalls++;
    const body = JSON.parse(String(init?.body)), p = JSON.parse(body.messages[1].content);
    assert.equal(body.max_completion_tokens, 1200); assert.equal(p.verifiedHostEvidence.proposalDigest, calculatorProposalDigest(f.changes));
    assert.equal(p.verifiedHostEvidence.dependencyContract.sourceSha256, sha(core));
    assert.ok(!p.unverifiedAreas.includes("No runtime tests or browser checks have executed"));
    assert.ok(!String(init?.body).includes("PRIVATE_SOURCE"));
    assert.equal(team.checkpointCharge()!.totalRequestBytes, sentBytes += Buffer.byteLength(String(init?.body)));
    return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ ready: true,
      summary: "Scoped evidence reviewed", findings: [], unverifiedAreas: ["Other browsers remain unverified"] }) } }] });
  }, { now: () => clock, wait: async ms => { clock += ms; } }, undefined, undefined,
  "calculator-successor-four-roles", () => currentToken);
  const restored = team.restoreProposal(plan, task.id, f.snap, f.changes, calculatorProposalDigest(f.changes));
  currentToken = await collectCalculatorAssessmentEvidence(task, restored, f.dependency, f.runners);
  for (const role of ["security", "reviewer", "tester"] as const) {
    const verdict = await team.assess(role, plan, task.id, restored);
    assert.equal(verdict.ready, true); assert.equal(verdict.testsExecuted, false); assert.equal(verdict.publicationAuthorized, false);
  }
  assert.equal(roleCalls, 3); assert.equal(team.snapshot().generatedTasks, 0); assert.equal(team.snapshot().restoredTasks, 1);
});
test("a JSON evidence provider fails before HTTP and before any byte or token charge", async () => {
  const f = await setup(); let calls = 0;
  const team = createCalculatorModelTeam(saved.request, env, async () => { calls++; throw Error("must not send"); }, {}, undefined, undefined,
    undefined, () => ({}) as CalculatorAssessmentEvidence);
  const restored = team.restoreProposal(plan, task.id, f.snap, f.changes, calculatorProposalDigest(f.changes));
  await assert.rejects(() => team.assess("security", plan, task.id, restored));
  assert.equal(calls, 0); assert.equal(team.checkpointCharge()!.attemptedRequests, 0); assert.equal(team.checkpointCharge()!.reservedRunTokens, 0);
  assert.throws(() => createCalculatorModelTeam(saved.request, env, undefined, {}, undefined, undefined, undefined,
    {} as never));
});
test("three saved-UI-sized review packets fit unchanged Groq per-request and run token limits", async () => {
  const f = await setup(true); let cap: CalculatorAssessmentEvidence; let clock = 0; let calls = 0;
  const team = createCalculatorModelTeam(saved.request, env, async () => {
    calls++; return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
      ready: true, summary: "Budget fixture only", findings: [], unverifiedAreas: ["No real model review"] }) } }] });
  }, { now: () => clock, wait: async ms => { clock += ms; } }, undefined, undefined, "calculator-successor-four-roles", () => cap);
  const changes = team.restoreProposal(plan, task.id, f.snap, f.changes, calculatorProposalDigest(f.changes));
  cap = await collectCalculatorAssessmentEvidence(task, changes, f.dependency, f.runners);
  for (const role of ["security", "reviewer", "tester"] as const) await team.assess(role, plan, task.id, changes);
  assert.equal(calls, 3); assert.ok(team.checkpointCharge()!.reservedRunTokens <= 16000);
  assert.ok(team.checkpointCharge()!.totalRequestBytes <= 72000); assert.equal(team.diagnostic().contextBudgetCode, undefined);
});

test("narrow-screen host evidence requires the added 360px scenario and retains unknown device areas",async()=>{
 const task=plan.tasks[3]!,snap=await snapshot(task.paths),dependency=await snapshot(["src/calculator.mjs"]);
 const changes=prepareCalculatorRoleChanges("frontend",{summary:"Responsive fixture",changes:task.paths.map(path=>({operation:"create",path,content:path==="styles.css"?"body{margin:0}":"<output>0</output>",message:"fixture"}))},snap),proposalDigest=calculatorProposalDigest(changes);
 const proposal={repository:changes.repository,taskId:task.id,baseSha:A,proposalDigest,status:"passed" as const,testsExecuted:true,failures:[]};
 const browser={repository:changes.repository,taskId:task.id,baseSha:A,proposalDigest,dependencySha256:sha(core),status:"passed" as const,testsExecuted:true as const,browser:"Chrome/155.0",sandboxDisabled:false as const,pageErrors:0 as const,blockedRequests:0 as const,scenarios:CALCULATOR_NARROW_BROWSER_SCENARIOS,domSelectors:CALCULATOR_NARROW_DOM_SELECTORS.map(selector=>({selector,matches:1}))};
 const token=await collectCalculatorAssessmentEvidence(task,changes,dependency,{checkProposal:async()=>proposal,checkBrowser:async()=>browser});const packet=calculatorAssessmentEvidencePacket(token,task,changes);assert.ok(packet.unverifiedAreas.some(a=>a.includes("Other viewport widths")));assert.ok(!JSON.stringify(packet).includes(core));assert.deepEqual(packet.browserChecks.domSelectors,browser.domSelectors);
 await assert.rejects(()=>collectCalculatorAssessmentEvidence(task,changes,dependency,{checkProposal:async()=>proposal,checkBrowser:async()=>({...browser,scenarios:CALCULATOR_UI_BROWSER_SCENARIOS})}));
 await assert.rejects(()=>collectCalculatorAssessmentEvidence(task,changes,dependency,{checkProposal:async()=>proposal,checkBrowser:async()=>({...browser,domSelectors:[{selector:".not-proven",matches:1}]})}));
 await assert.rejects(()=>collectCalculatorAssessmentEvidence(task,changes,dependency,{checkProposal:async()=>proposal,checkBrowser:async()=>({...browser,domSelectors:CALCULATOR_NARROW_DOM_SELECTORS.map(selector=>({selector,matches:-1}))})}));
});
