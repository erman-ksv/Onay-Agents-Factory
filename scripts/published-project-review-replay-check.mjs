// New worker + genuine native owner/controller against the already consumed
// ledger. No source capability, provider credential or HTTP is available.
import assert from 'node:assert/strict';import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
import {createCalculatorPlan} from '../orchestration/calculatorPlan.js';import {stageCalculatorProjectHistory} from '../orchestration/projectBudgetMigration.js';
import {authorizeGitHubProjectBudget} from '../orchestration/projectBudgetAuthorization.js';import {runPublishedCalculatorProjectReview} from '../orchestration/calculatorPublishedProjectReview.js';
const env=process.env,repo='erman-ksv/Onay-Agents-Factory',root=join(env.RUNNER_TEMP??'/tmp','published-project-review-replay');mkdirSync(root,{mode:0o700});let reads=0,sourceCalls=0,modelCalls=0;
const report={version:1,status:'unverified',modelCalls:0,githubApiMutationRequests:0,executionAuthorized:false,legalEnabled:false};
try{
 assert.equal(env.GITHUB_REPOSITORY,repo);assert.equal(env.GITHUB_RUN_ATTEMPT,'1');assert.equal(env.GITHUB_REF,'refs/heads/feat/calculator-t02-charge-reconcile-20261022');assert.equal(env.AGENT_FACTORY_LEGAL_ENABLED,'false');assert.ok(env.FACTORY_READ_TOKEN);
 for(const key of ['GROQ_API_KEY','GEMINI_API_KEY','CLOUDFLARE_API_KEY','OPENAI_API_KEY','FACTORY_STATE_TOKEN','FACTORY_BUDGET_TOKEN','CALCULATOR_GITHUB_TOKEN'])assert.equal(env[key],undefined);
 const transport=async(input,init)=>{assert.equal(init?.method,'GET');const u=new URL(String(input));assert.equal(u.origin,'https://api.github.com');assert.ok(u.pathname.startsWith('/repos/'+repo+'/'));assert.ok(++reads<=64);return fetch(input,init);};
 const saved=JSON.parse(readFileSync('orchestration/fixtures/calculatorStep7SavedPlan.json','utf8')),history=JSON.parse(readFileSync('.factory/project-budget-history.json','utf8')),plan=createCalculatorPlan(saved.request,saved.proposal),staged=stageCalculatorProjectHistory(saved.request,saved.proposal,history,'6fdb95f2178edb18b60364ea659874f75f7bb434a0bf0e45dc87749b941a09f1');
 const controller=await authorizeGitHubProjectBudget({identity:staged.identity,history,decision:{issueNumber:75,commentId:6412067757,bodySha256:'afaf23c899abbd5349787e912e6249092a5e6690d66abc1f3eb5d1adbc8318b6'},token:env.FACTORY_READ_TOKEN,transport});
 const before=await controller.inspect();assert.equal(before.used.requests,62);assert.equal(before.remaining.requests,0);assert.equal(before.used.requestBytes,590219);assert.equal(before.used.reservedTokens,246886);
 const forbidden=async()=>{sourceCalls++;throw Error('Source must never be reached');};let refused=false;
 try{await runPublishedCalculatorProjectReview({plan,taskId:plan.tasks.at(-1).id,candidateSha:'558993981c9bbb7c6100c8335860ac5668768314',original:{},dependencies:{},changes:{},controller,env:{},assertPublished:forbidden,runners:{checkProposal:forbidden,checkBrowser:forbidden},checkpoint:forbidden,transport:async()=>{modelCalls++;throw Error('Model transport must never be reached');}});}catch{refused=true;}
 assert.equal(refused,true);assert.equal(sourceCalls,0);assert.equal(modelCalls,0);const after=await controller.inspect();assert.deepEqual(after,before);
 Object.assign(report,{status:'fresh-native-controller-replay-refused-before-source-and-model',ownerApprovalVerified:true,used:after.used,remaining:after.remaining,ledgerUnchanged:true,sourceCalls:0});
}catch{process.exitCode=10;report.reasonCode='replay-proof-unverified-no-retry';}
finally{report.githubReads=reads;writeFileSync(join(root,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));}
