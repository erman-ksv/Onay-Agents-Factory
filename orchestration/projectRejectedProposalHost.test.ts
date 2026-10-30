import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareProjectRejectedProposalHost,assertProjectRejectedHostEnvironment,preflightProjectRejectedProposalHost,runProjectRejectedProposalHost} from './projectRejectedProposalHost.js';
import {rejectedProposalHostMain} from '../scripts/project-rejected-proposal-host.js';

const body=()=>readFileSync('.factory/rejected-proposal-host.json','utf8');
const runtime=()=>readFileSync('.factory/runtime-project-manifest.json','utf8');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const prepare=(s=body())=>prepareProjectRejectedProposalHost(s,hash(s),runtime());
const env=():NodeJS.ProcessEnv=>({GITHUB_REPOSITORY:'erman-ksv/Onay-Agents-Factory',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',GITHUB_REF:'refs/heads/fix/stage8-corrective-verification-20261029',FACTORY_HOST_SOURCE_SHA:'a'.repeat(40),GITHUB_SHA:'a'.repeat(40),AGENT_FACTORY_LEGAL_ENABLED:'false',ONAY_TEAM_FREE_TIER_CONFIRMED:'true',FACTORY_INSPECTION_READ_TOKEN:'offline'});

test('pinned existing manifest composes host DATA, not an execution permit',()=>{assert.ok(prepare());assert.doesNotThrow(()=>assertProjectRejectedHostEnvironment(env(),'preflight'));});
test('scope digest, old base, old checkpoint, old source, widened budget and unknown fields are refused',()=>{
 assert.throws(()=>prepareProjectRejectedProposalHost(body(),'0'.repeat(64),runtime()));
 for(const mutate of [
  (v:any)=>v.baseCodeSha='e5a7137d3e4ba853123213de95e78ef6bf52134a',
  (v:any)=>v.binding.archiveSequence=10,
  (v:any)=>v.binding.baseSha='0'.repeat(40),
  (v:any)=>v.maxNewRequests=9,
  (v:any)=>v.expectedRemaining.requests=16,
  (v:any)=>v.ownerCommentId=6521552680,
  (v:any)=>v.grantTransitions.pop(),
  (v:any)=>v.grantDecisions[1]=v.grantDecisions[0],
 ]){const v=JSON.parse(body());mutate(v);assert.throws(()=>prepare(JSON.stringify(v)));}
});
test('push permits read-only mode only; PR, rerun, wrong branch and stale source refuse both',()=>{
 assert.doesNotThrow(()=>assertProjectRejectedHostEnvironment({...env(),GITHUB_EVENT_NAME:'push'},'preflight'));
 assert.throws(()=>assertProjectRejectedHostEnvironment({...env(),GITHUB_EVENT_NAME:'push'},'live'));
 for(const change of [{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_REF:'refs/heads/main'},{GITHUB_SHA:'b'.repeat(40)}])for(const mode of ['preflight','live'] as const)assert.throws(()=>assertProjectRejectedHostEnvironment({...env(),...change},mode));
});
test('read-only preflight refuses every provider/write/live credential before any HTTP',()=>{
 for(const key of ['GROQ_API_KEY','GEMINI_API_KEY','CLOUDFLARE_API_KEY','FACTORY_STATE_TOKEN','AGENT_FACTORY_PROJECT_LIVE_APPROVED','AGENT_FACTORY_ENABLE_GITHUB_WRITES','FACTORY_REJECTED_OWNER_COMMENT_ID','FACTORY_REJECTED_LIVE_CONFIRMATION'])assert.throws(()=>assertProjectRejectedHostEnvironment({...env(),[key]:'present'},'preflight'));
});
test('live needs explicit separate confirmation and OWNER comment; preflight config cannot activate it',()=>{
 assert.throws(()=>assertProjectRejectedHostEnvironment(env(),'live'));
 const live:NodeJS.ProcessEnv={...env(),FACTORY_REJECTED_LIVE_CONFIRMATION:'ONE_REJECTED_PROPOSAL_AND_SUCCESSOR_MAX_8',AGENT_FACTORY_PROJECT_LIVE_APPROVED:'ONE_FREE_BOUNDED_RUN',AGENT_FACTORY_ENABLE_GITHUB_WRITES:'true',AGENT_FACTORY_PROVIDER:'groq',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_API_KEY:'offline',FACTORY_STATE_TOKEN:'offline',GITHUB_TOKEN:'offline',FACTORY_READ_TOKEN:'offline',FACTORY_REJECTED_OWNER_COMMENT_ID:'123'};
 assert.doesNotThrow(()=>assertProjectRejectedHostEnvironment(live,'live'));
 for(const key of ['FACTORY_REJECTED_LIVE_CONFIRMATION','FACTORY_REJECTED_OWNER_COMMENT_ID','GROQ_API_KEY','FACTORY_STATE_TOKEN']){const v={...live};delete v[key];assert.throws(()=>assertProjectRejectedHostEnvironment(v,'live'));}
});
test('two parallel host preflights consume one host capability; stale remote SHA is GET-only and stops before secrets',async()=>{
 const cap=prepare(),dir=mkdtempSync(join(tmpdir(),'onay-host-test-')),native=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,init)=>{calls++;assert.equal(init?.method,'GET');assert.equal(init?.body,undefined);assert.match(String(url),/api.github.com\/repos\/erman-ksv\/Onay-Agents-Factory\/git\/ref\//);return Response.json({ref:'refs/heads/fix/stage8-corrective-verification-20261029',object:{type:'commit',sha:'b'.repeat(40)}});};
 try{const results=await Promise.allSettled([preflightProjectRejectedProposalHost(cap,env(),dir),preflightProjectRejectedProposalHost(cap,env(),dir)]);assert.equal(results.filter(v=>v.status==='rejected').length,2);assert.equal(calls,1);await assert.rejects(()=>runProjectRejectedProposalHost(cap,env(),dir));assert.equal(calls,1);}finally{globalThis.fetch=native;rmSync(dir,{recursive:true,force:true});}
});
test('lost GitHub response and failed exact-source CI do not retry, claim or contact provider',async()=>{
 const native=globalThis.fetch;
 try{for(const scenario of ['lost','ci-failed','skipped-test']){
  const dir=mkdtempSync(join(tmpdir(),'onay-host-http-'));let calls=0;
  globalThis.fetch=async(url,init)=>{calls++;assert.equal(init?.method,'GET');assert.equal(init?.body,undefined);assert.equal(new URL(String(url)).hostname,'api.github.com');if(scenario==='lost')throw Error('unknown response');if(calls===1)return Response.json({ref:'refs/heads/fix/stage8-corrective-verification-20261029',object:{type:'commit',sha:'a'.repeat(40)}});
   if(calls===2)return Response.json({total_count:1,workflow_runs:[{id:123,name:'Agent Factory CI',path:'.github/workflows/ci.yml',head_sha:'a'.repeat(40),head_branch:'fix/stage8-corrective-verification-20261029',event:'push',run_attempt:1,status:'completed',conclusion:scenario==='ci-failed'?'failure':'success'}]});
   return Response.json({total_count:1,jobs:[{head_sha:'a'.repeat(40),conclusion:'success',status:'completed',steps:['Install','Typecheck','Test'].map(name=>({name,status:'completed',conclusion:name==='Test'?'skipped':'success'}))}]});
  };
  try{await assert.rejects(()=>preflightProjectRejectedProposalHost(prepare(),env(),dir));assert.equal(calls,scenario==='lost'?1:scenario==='ci-failed'?2:3);}finally{rmSync(dir,{recursive:true,force:true});}
 }}finally{globalThis.fetch=native;}
});
test('expired host policy stops without network or claim and cannot be reused',async()=>{
 const v=JSON.parse(body());v.expiresAt='2000-01-01T00:00:00Z';const cap=prepare(JSON.stringify(v)),dir=mkdtempSync(join(tmpdir(),'onay-host-expired-')),native=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not call');};
 try{await assert.rejects(()=>preflightProjectRejectedProposalHost(cap,env(),dir));await assert.rejects(()=>preflightProjectRejectedProposalHost(cap,env(),dir));assert.equal(calls,0);}finally{globalThis.fetch=native;rmSync(dir,{recursive:true,force:true});}
});
test('CLI has no default activation mode and ignores no extra arguments',async()=>{
 for(const args of [[],['--live','--preflight'],['run'],['--preflight','extra']])await assert.rejects(()=>rejectedProposalHostMain(args,{}));
});
test('dedicated workflow invokes preflight only, has read permissions and no provider/write secrets',()=>{
 const workflow=readFileSync('.github/workflows/stage8-rejected-proposal-preflight.yml','utf8');
 assert.match(workflow,/scripts\/project-rejected-proposal-host\.ts --preflight/);
 assert.doesNotMatch(workflow,/--live|contents: write|actions: write|secrets\.(GROQ_API_KEY|GEMINI_API_KEY|CLOUDFLARE_API_KEY)|FACTORY_STATE_TOKEN:/);
 assert.match(workflow,/contents: read/);assert.match(workflow,/actions: read/);
 assert.match(workflow,new RegExp(hash(body())));
});
