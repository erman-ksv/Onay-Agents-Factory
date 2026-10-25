import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {join} from 'node:path';
import {prepareProjectBudgetActivationRequest,runGitHubProjectBudgetActivation} from '../orchestration/projectBudgetActivation.js';
const REPO='erman-ksv/Onay-Agents-Factory',BASE='https://api.github.com/repos/'+REPO;
const HISTORY='6fdb95f2178edb18b60364ea659874f75f7bb434a0bf0e45dc87749b941a09f1';
let githubReads=0,githubWriteRequests=0;
const directory=join(process.env.RUNNER_TEMP??'/tmp','project-budget-activation');mkdirSync(directory,{recursive:true});
function save(value){writeFileSync(join(directory,'result.json'),JSON.stringify(value,null,2)+'\n');}
try{
 assert.equal(process.env.GITHUB_REPOSITORY,REPO);assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');assert.equal(process.env.AGENT_FACTORY_LEGAL_ENABLED,'false');
 for(const name of ['GROQ_API_KEY','GEMINI_API_KEY','CLOUDFLARE_API_KEY','CALCULATOR_GITHUB_TOKEN'])assert.equal(process.env[name],undefined);
 const token=process.env.FACTORY_BUDGET_TOKEN,runtime=process.env.FACTORY_RUNTIME_SHA,ciRun=process.env.FACTORY_SOURCE_CI_RUN;
 assert.ok(token);assert.match(runtime,/^[a-f0-9]{40}$/);assert.match(ciRun,/^[0-9]+$/);
 const bytes=readFileSync('../request/.factory/project-budget-activation-request.json');assert.ok(bytes.length<=4096);
 const request=prepareProjectBudgetActivationRequest(JSON.parse(bytes.toString('utf8')));
 assert.equal(request.operation,process.env.FACTORY_BUDGET_OPERATION);assert.equal(request.historyDigest,HISTORY);
 const transport=async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,'https://api.github.com');assert.ok(url.pathname.startsWith('/repos/'+REPO+'/'));
  const method=init?.method??'GET';if(request.operation==='inspect')assert.equal(method,'GET');
  assert.ok(['GET','POST','PATCH'].includes(method));if(method==='GET')githubReads++;else githubWriteRequests++;
  assert.ok(githubReads+githubWriteRequests<=32);return fetch(input,init);
 };
 const ci=await transport(BASE+'/actions/runs/'+ciRun,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'}});
 assert.equal(ci.status,200);const checked=await ci.json();assert.equal(checked.head_sha,runtime);assert.equal(checked.status,'completed');assert.equal(checked.conclusion,'success');assert.equal(checked.name,'Agent Factory CI');assert.equal(checked.repository.full_name,REPO);
 const saved=JSON.parse(readFileSync('orchestration/fixtures/calculatorStep7SavedPlan.json','utf8'));
 const history=JSON.parse(readFileSync('.factory/project-budget-history.json','utf8'));
 const result=await runGitHubProjectBudgetActivation({request,ownerRequest:saved.request,proposal:saved.proposal,history,expectedHistoryDigest:HISTORY,token,transport});
 const proof={...result,runtimeSha:runtime,sourceCiRunId:Number(ciRun),githubReads,githubWriteRequests,providerKeysAvailable:false,previousPilotReplayed:false};save(proof);
 console.log(JSON.stringify({status:proof.status,operation:proof.operation,stateWrites:proof.stateWrites,modelCalls:0,githubReads,githubWriteRequests}));
}catch{
 save({status:'blocked',reasonCode:'project-budget-activation-unverified',modelCalls:0,stateWrites:'unknown-no-retry',githubReads,githubWriteRequests});
 console.error(JSON.stringify({status:'blocked',reasonCode:'project-budget-activation-unverified',modelCalls:0,githubReads,githubWriteRequests}));process.exitCode=10;
}
