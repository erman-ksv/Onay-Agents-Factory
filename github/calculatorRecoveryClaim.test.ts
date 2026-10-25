import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createCalculatorRecoveryGitHubClaim,CALCULATOR_RECOVERY_CLAIM_ERROR} from './calculatorRecoveryClaim.js';
const config={planFingerprint:'a'.repeat(64),runtimeSha:'b'.repeat(40),sourceCiRunId:123,binding:{checkpointSha256:'c'.repeat(64),receiptSha256:'d'.repeat(64),taskId:'offline-recovery',baseSha:'e'.repeat(40),executionId:'rejected-'+'f'.repeat(64)}};
const env={GITHUB_REPOSITORY:'erman-ksv/Onay-Agents-Factory',GITHUB_RUN_ATTEMPT:'1',AGENT_FACTORY_LEGAL_ENABLED:'false',FACTORY_STATE_TOKEN:'fixture-token'},error={message:CALCULATOR_RECOVERY_CLAIM_ERROR};
const git=(kind:string,b:Buffer)=>createHash('sha1').update(Buffer.concat([Buffer.from(kind+' '+b.length+'\0'),b])).digest('hex');
function fixture(mode='ready'){
 const objects=new Map<string,any>();let ref:any,posts=0,refPosts=0,revoked=false,tampered=false;
 const transport:typeof fetch=async(url,init)=>{
  const path=new URL(String(url)).pathname;assert.ok(String(url).startsWith('https://api.github.com/repos/'+env.GITHUB_REPOSITORY+'/'));assert.equal(init?.redirect,'error');
  if(init?.method==='POST'){
   posts++;const b=JSON.parse(String(init.body));
   if(path.endsWith('/git/blobs')){const sha=git('blob',Buffer.from(b.content));objects.set(sha,{sha,encoding:'base64',content:Buffer.from(b.content).toString('base64')});return Response.json({sha},{status:201});}
   if(path.endsWith('/git/trees')){assert.equal(b.base_tree,undefined);assert.equal(b.tree.length,1);const f=b.tree[0],sha=git('tree',Buffer.concat([Buffer.from(f.mode+' '+f.path+'\0'),Buffer.from(f.sha,'hex')]));objects.set(sha,{sha,truncated:false,tree:b.tree});return Response.json({sha},{status:201});}
   if(path.endsWith('/git/commits')){assert.deepEqual(b.parents,[]);const sha=git('commit',Buffer.from(JSON.stringify(b)));const c={sha,tree:{sha:b.tree},parents:[],message:b.message};objects.set(sha,c);return Response.json(c,{status:201});}
   assert.ok(path.endsWith('/git/refs'));refPosts++;if(mode==='forbidden')return new Response('PRIVATE_API_ERROR',{status:403});if(ref)return Response.json({message:'Exists'},{status:422});
   assert.ok(b.ref.startsWith('refs/heads/state/calculator-recovery/'));ref={ref:b.ref,object:{type:'commit',sha:b.sha}};if(mode==='lost-ack')throw Error('PRIVATE_LOST_ACK');return Response.json(ref,{status:201});
  }
  if(path.includes('/actions/runs/')){
   if(new URL(String(url)).search||path.endsWith('/jobs'))return Response.json({total_count:1,jobs:[{id:456,run_id:123,head_sha:config.runtimeSha,status:'completed',conclusion:'success',steps:mode==='details'?[]:['Typecheck','Test'].map(name=>({name,status:'completed',conclusion:mode==='skipped'&&name==='Test'?'skipped':'success'}))}]});
   return Response.json({id:mode==='wrong-run'?124:123,name:'Agent Factory CI',head_sha:config.runtimeSha,path:'.github/workflows/ci.yml',run_attempt:mode==='rerun'?2:1,status:'completed',conclusion:revoked?'failure':'success',repository:{full_name:env.GITHUB_REPOSITORY}});
  }
  if(path.endsWith('/actions/jobs/456'))return Response.json({id:456,run_id:123,run_attempt:1,head_sha:config.runtimeSha,status:'completed',conclusion:'success',steps:['Typecheck','Test'].map(name=>({name,status:'completed',conclusion:'success'}))});
  if(path.includes('/git/ref/heads/'))return ref?Response.json(tampered?{...ref,object:{type:'commit',sha:'9'.repeat(40)}}:ref):new Response('{}',{status:404});
  const object=objects.get(path.split('/').at(-1)!);if(!object)throw Error('Unexpected fixture endpoint');return Response.json(object);
 };
 return {transport,objects,posts:()=>posts,refPosts:()=>refPosts,revoke:()=>{revoked=true;},tamper:()=>{tampered=true;}};
}
test('native claim API writes source-free orphan metadata and blocks a fresh worker',async()=>{
 const f=fixture(),a=createCalculatorRecoveryGitHubClaim(config,env,f.transport);assert.equal(await a.inspectAbsent(),true);await a.claimRecovery(config.binding);await a.assertRecovery(config.binding);await assert.rejects(()=>a.claimRecovery(config.binding),error);
 const b=createCalculatorRecoveryGitHubClaim(config,env,f.transport);assert.equal(await b.inspectAbsent(),false);await assert.rejects(()=>b.claimRecovery(config.binding),error);assert.equal(f.refPosts(),1);
 const blobs=[...f.objects.values()].filter(o=>o.encoding==='base64');assert.equal(blobs.length,1);const data=JSON.parse(Buffer.from(blobs[0].content,'base64').toString());assert.deepEqual(Object.keys(data).sort(),['version','repository','planFingerprint','runtimeSha','sourceCiRunId',...Object.keys(config.binding)].sort());assert.equal(JSON.stringify(data).includes(env.FACTORY_STATE_TOKEN),false);
});
test('independent simultaneous native claims accept only one worker',async()=>{const f=fixture(),a=createCalculatorRecoveryGitHubClaim(config,env,f.transport),b=createCalculatorRecoveryGitHubClaim(config,env,f.transport);const results=await Promise.allSettled([a.claimRecovery(config.binding),b.claimRecovery(config.binding)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.refPosts(),2);});
test('new runtime CI or changed archive bytes cannot purchase another correction namespace',()=>{
 const a=createCalculatorRecoveryGitHubClaim(config,env,fixture().transport),b=createCalculatorRecoveryGitHubClaim({...config,runtimeSha:'9'.repeat(40),sourceCiRunId:124,binding:{...config.binding,checkpointSha256:'1'.repeat(64)}},env,fixture().transport);assert.equal(a.ref,b.ref);
});
test('lost acknowledgement preserves the remote marker and never retries',async()=>{const f=fixture('lost-ack'),a=createCalculatorRecoveryGitHubClaim(config,env,f.transport);await assert.rejects(()=>a.claimRecovery(config.binding),error);await assert.rejects(()=>a.claimRecovery(config.binding),error);const b=createCalculatorRecoveryGitHubClaim(config,env,f.transport);assert.equal(await b.inspectAbsent(),false);await assert.rejects(()=>b.claimRecovery(config.binding),error);assert.equal(f.refPosts(),1);});
test('wrong run, rerun, skipped Test and mismatched binding stop before a write',async()=>{
 for(const mode of ['wrong-run','rerun','skipped','binding']){const f=fixture(mode),a=createCalculatorRecoveryGitHubClaim(config,env,f.transport);await assert.rejects(()=>a.claimRecovery(mode==='binding'?{...config.binding,receiptSha256:'9'.repeat(64)}:config.binding),error);assert.equal(f.posts(),0);}
});
test('missing job steps use the exact native job once and still require Typecheck and Test',async()=>{const f=fixture('details'),a=createCalculatorRecoveryGitHubClaim(config,env,f.transport);await a.claimRecovery(config.binding);await a.assertRecovery(config.binding);});
test('revoked CI or moved remote ref latches refusal and never reveals response bodies',async()=>{
 for(const mode of ['ci','ref']){const f=fixture(),a=createCalculatorRecoveryGitHubClaim(config,env,f.transport);await a.claimRecovery(config.binding);if(mode==='ci')f.revoke();else f.tamper();await assert.rejects(()=>a.assertRecovery(config.binding),error);await assert.rejects(()=>a.assertRecovery(config.binding),error);}
 const f=fixture('forbidden'),a=createCalculatorRecoveryGitHubClaim(config,env,f.transport);await assert.rejects(()=>a.claimRecovery(config.binding),e=>e instanceof Error&&e.message===CALCULATOR_RECOVERY_CLAIM_ERROR&&!e.message.includes('PRIVATE_API_ERROR'));assert.equal(f.refPosts(),1);
});
test('invalid action context, secrets and lazy binding fields refuse without evaluating accessors',()=>{
 for(const patch of [{GITHUB_RUN_ATTEMPT:'2'},{AGENT_FACTORY_LEGAL_ENABLED:'true'},{GITHUB_REPOSITORY:'another/repo'},{FACTORY_STATE_TOKEN:''}])assert.throws(()=>createCalculatorRecoveryGitHubClaim(config,{...env,...patch}),error);
 let reads=0;const b=Object.defineProperty({...config.binding},'taskId',{enumerable:true,get(){reads++;return 'private';}});assert.throws(()=>createCalculatorRecoveryGitHubClaim({...config,binding:b},env),error);assert.equal(reads,0);
 assert.throws(()=>createCalculatorRecoveryGitHubClaim({...config,binding:{...config.binding,taskId:'gsk_'+'x'.repeat(48)}},env),error);
});
