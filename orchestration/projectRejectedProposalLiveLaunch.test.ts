import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {REJECTED_LIVE_PINS as P,REJECTED_LIVE_FILES,proposeRejectedLiveLaunch,assertRejectedLiveDispatch,assertRejectedLiveDiff,inspectRejectedLiveOwner,inspectRejectedLiveBudget,verifyRejectedLiveMetadataForTests} from './projectRejectedProposalLiveLaunch.js';

const NOW=Date.parse(P.expiresAt)-3600000,SOURCE='a'.repeat(40),RECOVERY=7000000001,LAUNCH=7000000002;
const env=():NodeJS.ProcessEnv=>({GITHUB_REPOSITORY:P.repository,GITHUB_REF:'refs/heads/'+P.branch,GITHUB_SHA:SOURCE,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',GITHUB_ACTOR:'erman-ksv',GITHUB_TRIGGERING_ACTOR:'erman-ksv',GITHUB_WORKFLOW_REF:P.repository+'/'+P.workflowPath+'@refs/heads/'+P.branch,LAUNCH_SOURCE_SHA:SOURCE,LAUNCH_RECOVERY_OWNER_COMMENT_ID:String(RECOVERY),LAUNCH_OWNER_COMMENT_ID:String(LAUNCH),LAUNCH_CONFIRMATION:'ONE_REJECTED_PROPOSAL_AND_SUCCESSOR_MAX_8',FACTORY_LAUNCH_READ_TOKEN:'offline'});
const saved=()=>JSON.parse(readFileSync('config/fixtures/projectRejectedLiveState.json','utf8'));
const recoveryBody=()=>JSON.parse(readFileSync('docs/rejected-proposal-live-20261030/OWNER-recovery-DRAFT.json','utf8'));
const comment=(id:number,body:unknown,created=NOW-20000)=>({id,body:JSON.stringify(body),user:{login:'erman-ksv',type:'User'},author_association:'OWNER',created_at:new Date(created).toISOString(),updated_at:new Date(created).toISOString(),issue_url:'https://api.github.com/repos/'+P.repository+'/issues/75',html_url:'https://github.com/'+P.repository+'/pull/75#issuecomment-'+id});
const content=(data:unknown)=>{const b=Buffer.from(JSON.stringify(data));return {type:'file',encoding:'base64',content:b.toString('base64'),sha:createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex')};};
function fixture(){
 const data=saved(),host=JSON.parse(readFileSync('.factory/rejected-proposal-host.json','utf8')),calls:string[]=[],state={source:SOURCE,ciStatus:'success',ciSha:SOURCE,stepStatus:'success',lost:false,archive:host.binding.archiveHead,budgetHead:host.budgetHead,recovery:comment(RECOVERY,recoveryBody(),NOW-30000),launch:comment(LAUNCH,proposeRejectedLiveLaunch(SOURCE,RECOVERY)),budget:data.budget,checkpoint:data.checkpoint};
 const transport:typeof fetch=async(url,init)=>{
  assert.equal(init?.method,'GET');assert.equal(init?.body,undefined);assert.equal(init?.redirect,'error');const u=new URL(String(url));assert.equal(u.origin,'https://api.github.com');calls.push(u.pathname+u.search);if(state.lost)throw Error('unknown metadata response');const path=decodeURIComponent(u.pathname.slice(('/repos/'+P.repository).length));
  if(path==='/git/ref/heads/'+P.branch)return Response.json({ref:'refs/heads/'+P.branch,object:{type:'commit',sha:state.source}});
  if(path==='/actions/runs')return Response.json({total_count:1,workflow_runs:[{id:123,name:'Agent Factory CI',path:'.github/workflows/ci.yml',head_sha:state.ciSha,head_branch:P.branch,event:'push',run_attempt:1,status:'completed',conclusion:state.ciStatus,updated_at:new Date(NOW-60000).toISOString()}]});
  if(path==='/actions/runs/123/attempts/1/jobs')return Response.json({total_count:1,jobs:[{head_sha:SOURCE,status:'completed',conclusion:'success',steps:['Install','Typecheck','Test'].map(name=>({name,status:'completed',conclusion:name==='Test'?state.stepStatus:'success'}))}]});
  if(path==='/issues/comments/'+RECOVERY)return Response.json(state.recovery);
  if(path==='/issues/comments/'+LAUNCH)return Response.json(state.launch);
  if(path==='/git/ref/heads/state/project-model-budget/'+P.projectKey)return Response.json({ref:'refs/heads/state/project-model-budget/'+P.projectKey,object:{type:'commit',sha:state.budgetHead}});
  if(path==='/contents/project-model-budget.json'){assert.equal(u.searchParams.get('ref'),host.budgetHead);return Response.json(content(state.budget));}
  if(path==='/git/ref/heads/state/project-checkpoints/'+P.projectKey)return Response.json({ref:'refs/heads/state/project-checkpoints/'+P.projectKey,object:{type:'commit',sha:state.archive}});
  if(path==='/contents/encrypted-checkpoint.json'){assert.equal(u.searchParams.get('ref'),host.binding.archiveHead);return Response.json(content(state.checkpoint));}
  throw Error('Unexpected endpoint');
 };
 return {state,calls,verify:()=>verifyRejectedLiveMetadataForTests(env(),transport,()=>NOW)};
}

test('exact new launch draft binds source SHA, existing grant, recovery admission and maximum eight; never authorizes itself',()=>{
 const d=proposeRejectedLiveLaunch(SOURCE,RECOVERY);assert.equal(d.sourceSha,SOURCE);assert.equal(d.hostBaseSha,P.hostBaseSha);assert.equal(d.recoveryOwnerDecision.commentId,RECOVERY);assert.equal(d.maxNewRequests,8);assert.equal(d.maxTotalRequestBytes,96000);assert.equal(d.maxReservedTokens,48000);assert.equal(d.budgetIncreaseAuthorized,false);assert.equal(d.replayAuthorized,false);assert.equal(d.expiresAt,P.expiresAt);
 assert.throws(()=>proposeRejectedLiveLaunch(P.hostBaseSha,RECOVERY));assert.throws(()=>proposeRejectedLiveLaunch(SOURCE,0));
});
test('dispatch rejects push, wrong actor, rerun, wrong branch, stale SHA, missing IDs and absent confirmation',()=>{
 assert.doesNotThrow(()=>assertRejectedLiveDispatch(env(),NOW));
 for(const change of [{GITHUB_EVENT_NAME:'push'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_ACTOR:'someone'},{GITHUB_TRIGGERING_ACTOR:'github-actions[bot]'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_REF:'refs/heads/main'},{LAUNCH_SOURCE_SHA:'b'.repeat(40)},{LAUNCH_RECOVERY_OWNER_COMMENT_ID:''},{LAUNCH_OWNER_COMMENT_ID:String(RECOVERY)},{LAUNCH_OWNER_COMMENT_ID:'1e5'},{LAUNCH_CONFIRMATION:''}])assert.throws(()=>assertRejectedLiveDispatch({...env(),...change},NOW));
});
test('expiry stops before metadata HTTP; no implicit scope renewal',async()=>{
 assert.throws(()=>assertRejectedLiveDispatch(env(),Date.parse(P.expiresAt)));let calls=0;
 await assert.rejects(()=>verifyRejectedLiveMetadataForTests(env(),async()=>{calls++;throw Error('must not run');},()=>Date.parse(P.expiresAt)+1));assert.equal(calls,0);
});
test('metadata gate refuses credentials that could generate or write before it checks approvals',()=>{
 for(const key of ['GROQ_API_KEY','GEMINI_API_KEY','CLOUDFLARE_API_KEY','FACTORY_STATE_TOKEN','FACTORY_RECOVERY_KEY_BASE64','AGENT_FACTORY_ENABLE_GITHUB_WRITES','AGENT_FACTORY_PROJECT_LIVE_APPROVED'])assert.throws(()=>assertRejectedLiveDispatch({...env(),[key]:'present'},NOW));
});
test('launcher diff permits only seven additions, no change to Host, corrective loop, main or budget config',()=>{
 const diff=REJECTED_LIVE_FILES.map(p=>'A\t'+p).join('\n');assert.doesNotThrow(()=>assertRejectedLiveDiff(diff));
 assert.throws(()=>assertRejectedLiveDiff(diff+'\nM\torchestration/projectNextTaskWorker.ts'));assert.throws(()=>assertRejectedLiveDiff(diff.replace('A\t','M\t')));assert.throws(()=>assertRejectedLiveDiff(diff.split('\n').slice(1).join('\n')));
});
test('saved encrypted checkpoint and source-free ledger yield simulated GET-only metadata proof; no permit or budget mutation',async()=>{
 const f=fixture(),before=structuredClone(f.state),r=await f.verify();assert.equal(r.provenance,'simulated');assert.equal(r.executionAuthorized,false);assert.equal(r.providerCalls,0);assert.equal(r.budgetWrites,0);assert.equal(r.archiveWrites,0);assert.equal(r.metadataGetRequests,10);assert.equal(r.budget.remaining.requests,15);assert.equal(r.budget.maxNewRequests,8);assert.deepEqual(f.state,before);
});
test('parallel read-only proofs are not two execution permits and preserve all charges',async()=>{
 const f=fixture(),before=structuredClone(f.state.budget),out=await Promise.all([f.verify(),f.verify()]);assert.equal(out.length,2);assert.ok(out.every(v=>v.executionAuthorized===false&&v.providerCalls===0));assert.deepEqual(f.state.budget,before);
});
for(const scenario of ['branch-drift','stale-ci','failed-ci','skipped-test','changed-budget-ref','used-permit-checkpoint','corrupt-ciphertext','new-budget-charge','lost-response'])test(scenario+' refuses before provider/claim and never retries an unknown response',async()=>{
 const f=fixture();
 if(scenario==='branch-drift')f.state.source='b'.repeat(40);
 if(scenario==='stale-ci')f.state.ciSha='b'.repeat(40);
 if(scenario==='failed-ci')f.state.ciStatus='failure';
 if(scenario==='skipped-test')f.state.stepStatus='skipped';
 if(scenario==='changed-budget-ref')f.state.budgetHead='b'.repeat(40);
 if(scenario==='used-permit-checkpoint')f.state.archive='b'.repeat(40);
 if(scenario==='corrupt-ciphertext')f.state.checkpoint.ciphertextBase64=Buffer.from('corrupt').toString('base64');
 if(scenario==='new-budget-charge')f.state.budget.reservations[0].requestBytes++;
 if(scenario==='lost-response')f.state.lost=true;
 const before=structuredClone(f.state.budget);await assert.rejects(()=>f.verify());assert.deepEqual(f.state.budget,before);if(scenario==='lost-response')assert.equal(f.calls.length,1);
});
for(const scenario of ['edited','bot','not-owner','wrong-pr','old-recovery','wrong-source','widen-eight','extra-field','before-ci'])test('OWNER '+scenario+' cannot authorize launch',async()=>{
 const f=fixture();
 if(scenario==='edited')f.state.launch.updated_at=new Date(NOW-10000).toISOString();
 if(scenario==='bot')f.state.launch.user.type='Bot';
 if(scenario==='not-owner')f.state.launch.author_association='MEMBER';
 if(scenario==='wrong-pr')f.state.launch.issue_url=f.state.launch.issue_url.replace('75','74');
 if(scenario==='old-recovery')f.state.recovery.body=JSON.stringify({kind:'authorize-stopped-recovery-replacement-v4'});
 if(['wrong-source','widen-eight','extra-field'].includes(scenario)){const b=JSON.parse(f.state.launch.body);if(scenario==='wrong-source')b.sourceSha='b'.repeat(40);if(scenario==='widen-eight')b.maxNewRequests=9;if(scenario==='extra-field')b.replay=true;f.state.launch.body=JSON.stringify(b);}
 if(scenario==='before-ci'){f.state.recovery.created_at=new Date(NOW-120000).toISOString();f.state.recovery.updated_at=f.state.recovery.created_at;}
 await assert.rejects(()=>f.verify());
});
test('owner expiry verification remains independent from digest matching',()=>{
 const body={expiresAt:new Date(NOW-1).toISOString()};assert.throws(()=>inspectRejectedLiveOwner(comment(LAUNCH,body),LAUNCH,body,NOW));
});
test('budget reader rejects refunds, changed grant and fake remaining state',()=>{
 const data=saved().budget;assert.equal(inspectRejectedLiveBudget(data).used.requests,71);
 for(const mutate of [(v:any)=>v.reservations.pop(),(v:any)=>v.grantSha256='0'.repeat(64),(v:any)=>v.remaining={requests:15}]){const v=structuredClone(data);mutate(v);assert.throws(()=>inspectRejectedLiveBudget(v));}
});
test('manual workflow has no push/schedule, no retry matrix and preflight dependency before its single existing Host live command',()=>{
 const y=readFileSync(P.workflowPath,'utf8');assert.match(y,/workflow_dispatch:/);assert.doesNotMatch(y,/^\s+(push|pull_request|schedule|workflow_run|repository_dispatch):/m);assert.match(y,/needs: preflight/);assert.match(y,/cancel-in-progress: false/);assert.equal((y.match(/scripts\/project-rejected-proposal-host\.ts --live/g)??[]).length,1);assert.doesNotMatch(y,/continue-on-error|\bmatrix:/);
 const preflight=y.split('  accept:')[0];assert.doesNotMatch(preflight,/secrets\.GROQ_API_KEY|FACTORY_STATE_TOKEN:/);
 assert.match(y,/assert\.equal\(r.status,'plan-ci-recorded'/);assert.match(y,/assert\.notEqual\(r.firstCandidateSha,r.candidateSha\)/);assert.match(y,/assert\.equal\(r.used.requests,79\)/);
});
