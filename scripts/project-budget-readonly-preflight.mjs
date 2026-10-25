import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {stageCalculatorProjectHistory} from '../orchestration/projectBudgetMigration.js';
import {createProjectModelBudgetGitHubStore} from '../github/projectModelBudgetStore.js';

// Pinned host metadata; no model credentials, owner-comment fabrication,
// grant initialization, task claim, publication or provider call exists here.
const FACTORY='erman-ksv/Onay-Agents-Factory',CALCULATOR='erman-ksv/Onay-Factory-Calculator';
const HISTORY='6fdb95f2178edb18b60364ea659874f75f7bb434a0bf0e45dc87749b941a09f1';
const CANDIDATE='558993981c9bbb7c6100c8335860ac5668768314',CALCULATOR_CI=40178095158;
const MAIN='0752de6cf757c833417754bfe7f9a10fd654dbd9';
const base='https://api.github.com/repos/';let githubReads=0;
try{
 assert.equal(process.env.GITHUB_REPOSITORY,FACTORY);assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
 assert.equal(process.env.AGENT_FACTORY_LEGAL_ENABLED,'false');assert.ok(process.env.FACTORY_READ_TOKEN);
 for(const name of ['GROQ_API_KEY','GEMINI_API_KEY','CLOUDFLARE_API_KEY','CALCULATOR_GITHUB_TOKEN'])assert.equal(process.env[name],undefined);
 const runtime=process.env.FACTORY_RUNTIME_SHA,ciRun=process.env.FACTORY_SOURCE_CI_RUN;
 assert.match(runtime,/^[a-f0-9]{40}$/);assert.match(ciRun,/^[0-9]+$/);
 const saved=JSON.parse(readFileSync('orchestration/fixtures/calculatorStep7SavedPlan.json','utf8'));
 const history=JSON.parse(readFileSync('.factory/project-budget-history.json','utf8'));
 const staged=stageCalculatorProjectHistory(saved.request,saved.proposal,history,HISTORY);
 const destinations=new Set([
  base+FACTORY+'/actions/runs/'+ciRun,
  base+FACTORY+'/git/ref/heads/main',
  base+CALCULATOR+'/git/ref/heads/feat/calculator-agent/calculator-pilot-step7-v1',
  base+CALCULATOR+'/actions/runs/'+CALCULATOR_CI,
  base+FACTORY+'/git/ref/heads/'+encodeURIComponent(staged.targetRef.replace('refs/heads/','')),
 ]);
 const readTransport=async(input,init)=>{
  assert.ok(destinations.has(String(input)));assert.equal(init?.method,'GET');assert.equal(init?.body,undefined);
  githubReads++;assert.ok(githubReads<=5);return fetch(input,init);
 };
 async function get(url){
  const r=await readTransport(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+process.env.FACTORY_READ_TOKEN,Accept:'application/vnd.github+json'}});
  assert.equal(r.status,200);const bytes=await r.arrayBuffer();assert.ok(bytes.byteLength<=1048576);return JSON.parse(Buffer.from(bytes).toString('utf8'));
 }
 const sourceCi=await get(base+FACTORY+'/actions/runs/'+ciRun);
 assert.equal(sourceCi.head_sha,runtime);assert.equal(sourceCi.status,'completed');assert.equal(sourceCi.conclusion,'success');assert.equal(sourceCi.name,'Agent Factory CI');assert.equal(sourceCi.repository.full_name,FACTORY);
 assert.equal((await get(base+FACTORY+'/git/ref/heads/main')).object.sha,MAIN);
 assert.equal((await get(base+CALCULATOR+'/git/ref/heads/feat/calculator-agent/calculator-pilot-step7-v1')).object.sha,CANDIDATE);
 const previousCi=await get(base+CALCULATOR+'/actions/runs/'+CALCULATOR_CI);
 assert.equal(previousCi.head_sha,CANDIDATE);assert.equal(previousCi.status,'completed');assert.equal(previousCi.conclusion,'success');assert.equal(previousCi.repository.full_name,CALCULATOR);
 const store=createProjectModelBudgetGitHubStore({projectKey:staged.projectKey,token:process.env.FACTORY_READ_TOKEN,transport:readTransport});
 // An already existing ledger is never overwritten/re-initialized by staging.
 assert.equal(await store.read(),undefined);
 const proof={...staged,runtimeSha:runtime,sourceCiRunId:Number(ciRun),calculatorCandidateSha:CANDIDATE,
  calculatorExistingCiRunId:CALCULATOR_CI,previousPilotReplayed:false,mainSha:MAIN,remoteLedgerPresent:false,githubReads,
  unverifiedAreas:['No owner grant has been approved or initialized','No new model execution or publication is authorized','Historical CI is retained, not rerun']};
 const directory=join(process.env.RUNNER_TEMP,'project-budget-preflight');mkdirSync(directory,{recursive:true});
 writeFileSync(join(directory,'project-budget-migration-plan.json'),JSON.stringify(proof,null,2)+'\n');
 console.log(JSON.stringify({status:proof.status,historyRequests:proof.historicalCharge.requests,modelCalls:0,repositoryWrites:0,additionalRequestsAuthorized:0,githubReads}));
}catch{
 console.error(JSON.stringify({status:'blocked',reasonCode:'project-budget-readonly-preflight-unverified',modelCalls:0,repositoryWrites:0}));process.exitCode=10;
}
