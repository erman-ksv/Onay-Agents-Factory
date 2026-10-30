import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {projectCorrectiveBudgetFixture as fixture} from '../config/fixtures/projectCorrectiveBudgetFixture.js';
import {createProjectGrantChainFixtureForTests as gitFixture} from '../config/fixtures/projectGrantChainFixture.js';
import {inspectProjectDevelopmentBudgetExtension as inspect,authorizeProjectDevelopmentBudgetExtension as authorize,consumeProjectBudgetExtensionPermit as consume,projectBudgetStateDigest,projectDevelopmentLineageReservationLimit as limit} from './projectBudgetExtensionAuthorization.js';
import {restoreAcknowledgedDevelopmentGrantLineageForTests as restore,restoreDevelopmentGrantChainForTests as restoreChain,assertProjectGrantLineageFloor as floor,extendProjectDevelopmentBudgetWithLineageForTests as extend} from './projectGrantLineage.js';
import type {ProjectModelBudgetState} from './projectModelBudget.js';
import {createProjectModelBudgetGitHubExtensionStore} from '../github/projectModelBudgetStore.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
test('separate corrective reserve is exact used+16, keeps every charge and grants no execution',async()=>{
 const f=await fixture(),v=inspect(f.previous,f.state,f.proposed);assert.deepEqual(v.used,{requests:1,requestBytes:4668,reservedTokens:3012});assert.equal(v.grant.maxRequests-v.used.requests,16);assert.equal(v.grant.maxTotalRequestBytes-v.used.requestBytes,192000);assert.equal(v.grant.maxReservedTokens-v.used.reservedTokens,96000);assert.deepEqual(v.newState.reservations,f.state.reservations);assert.equal(v.additionalRequestsAuthorized,0);assert.equal(v.taskReplayAuthorized,false);assert.equal(f.writes(),0);assert.equal(limit(f.previous),8);assert.equal(limit(f.next),16);assert.throws(()=>limit({...f.next}));
});
test('legacy +1 remains exact and cannot smuggle corrective slots under its old grant ID',async()=>{
 const f=await fixture(),g=f.previous.grant,legacy={...g,grantId:'development-extend-'+projectBudgetStateDigest(f.state),maxRequests:g.maxRequests+1,maxTotalRequestBytes:g.maxTotalRequestBytes+12000,maxReservedTokens:g.maxReservedTokens+6000};assert.equal(inspect(f.previous,f.state,legacy).grant.maxRequests,9);assert.throws(()=>inspect(f.previous,f.state,{...f.proposed,grantId:legacy.grantId}));
});
test('wrong scope, profile, task list, ceiling, history, pin or repeated corrective reserve is refused',async()=>{
 const f=await fixture();for(const change of [{maxRequests:18},{maxRequests:16},{maxTotalRequestBytes:196669},{maxReservedTokens:99013},{maxRequestBytes:24000},{historical:{requests:0,requestBytes:0,reservedTokens:1}},{grantId:'development-corrective-'+'0'.repeat(64)},{repository:'other/repo'}])assert.throws(()=>inspect(f.previous,f.state,{...f.proposed,...change}));
 for(const options of [{projectId:'other'}, {taskIds:['other-task','other-task-2']},{changedProfile:true}]){const x=await fixture(options);assert.throws(()=>inspect(x.previous,x.state,x.proposed));}
 const state=inspect(f.previous,f.state,f.proposed).newState;assert.throws(()=>inspect(f.next,state,{...f.proposed,grantId:'development-corrective-'+projectBudgetStateDigest(state)}));assert.throws(()=>inspect({...f.previous},f.state,f.proposed));
});
test('genuine distinct OWNER controllers and single-use permit are mandatory; revocation blocks final guard',async()=>{
 const f=await fixture();await assert.rejects(()=>authorize({...f.previous},f.next,'e'.repeat(64),f.state));await assert.rejects(()=>authorize(f.previous,f.previous,'e'.repeat(64),f.state));const p=await authorize(f.previous,f.next,'e'.repeat(64),f.state),command=consume(p,f.previous.projectKey);assert.deepEqual(command.after.reservations,f.state.reservations);assert.throws(()=>consume(p,f.previous.projectKey));f.revoke();await assert.rejects(command.assertAuthorized);assert.equal(f.writes(),0);
});
async function cold(count=16,kind='ok'){
 const f=await fixture(),after=inspect(f.previous,f.state,f.proposed).newState,states:ProjectModelBudgetState[]=[f.state,after];
 for(let i=1;i<=count;i++)states.push({...after,reservations:[...after.reservations,...Array.from({length:i},(_,n)=>({reservationId:'after-'+n+':r1',taskId:f.identity.taskIds[n<8?0:1]!,requestSha256:'f'.repeat(64),requestBytes:100,reservedTokens:50}))]});
 if(kind==='rewrite'){const last=states.at(-1)!;states[states.length-1]={...last,reservations:[{...f.state.reservations[0]!,requestBytes:1},...last.reservations.slice(1)]};}
 const git=gitFixture(f.previous.projectKey,states);if(kind==='drift')git.live.drift=true;if(kind==='merge')git.objects.get('/git/commits/'+git.heads.at(-1)).parents.push({sha:git.heads[0]});
 f.save(states.at(-1)!,hash(git.heads.at(-1)!));return {f,git,states,options:{previous:f.previous,next:f.next,beforeHead:git.heads[0]!,afterHead:git.heads[1]!,stateProtection:await f.protection()}};
}
test('native GET-only reader permits exactly16 charged commits only for the genuine scoped controller',async()=>{
 for(const n of [9,16]){const c=await cold(n),r=c.git.reader(c.f.next),v=await r.readAcknowledgedTransition(c.options.beforeHead,c.options.afterHead);assert.equal(v.current.data.reservations.length,n+1);assert.equal(c.f.writes(),0);}
 const c=await cold(9);await assert.rejects(()=>c.git.reader().readAcknowledgedTransition(c.options.beforeHead,c.options.afterHead));assert.throws(()=>c.git.reader({...c.f.next}));assert.throws(()=>c.git.reader(c.f.previous));
});
test('cold lineage after16 reservations preserves old floors and never turns simulated proof native',async()=>{
 const c=await cold(),cap=await restore(c.options,c.git.reader(c.f.next));await floor(cap,c.f.next,{projectKey:c.f.next.projectKey,grantSha256:c.f.previous.grantSha256,used:{requests:1,requestBytes:4668,reservedTokens:3012}},'simulated');await assert.rejects(()=>floor(cap,c.f.next,{projectKey:c.f.next.projectKey,grantSha256:c.f.previous.grantSha256,used:{requests:1,requestBytes:4668,reservedTokens:3012}},'native'));assert.equal((await c.f.next.inspect()).used.requests,17);assert.equal(c.f.writes(),0);
});
test('17th suffix commit, prefix rewrite, merge, moving head and OWNER revocation all stop restoration',async()=>{
 for(const [n,kind]of [[17,'ok'],[16,'rewrite'],[16,'merge'],[16,'drift']] as const){const c=await cold(n,kind);await assert.rejects(()=>restore(c.options,c.git.reader(c.f.next)));assert.equal(c.f.writes(),0);}
 const c=await cold();c.f.revoke();await assert.rejects(()=>c.git.reader(c.f.next).readAcknowledgedTransition(c.options.beforeHead,c.options.afterHead));assert.equal(c.git.trace.length,0);
});
test('multi-grant cold chain validates legacy transition then bounded reserve and16 append-only charges',async()=>{
 const f=await fixture(),g=f.previous.grant,legacy={...g,grantId:'development-extend-'+projectBudgetStateDigest(f.state),maxRequests:g.maxRequests+1,maxTotalRequestBytes:g.maxTotalRequestBytes+12000,maxReservedTokens:g.maxReservedTokens+6000},middle=await f.controller(legacy,103),first=inspect(f.previous,f.state,legacy).newState,before={...first,reservations:[...first.reservations,{reservationId:'middle:r1',taskId:f.identity.taskIds[0]!,requestSha256:'d'.repeat(64),requestBytes:100,reservedTokens:50}]},proposed={...g,grantId:'development-corrective-'+projectBudgetStateDigest(before),maxRequests:18,maxTotalRequestBytes:196768,maxReservedTokens:99062},next=await f.controller(proposed,104),after=inspect(middle,before,proposed).newState;
 const states=[f.state,first,before,after];for(let i=1;i<=16;i++)states.push({...after,reservations:[...after.reservations,...Array.from({length:i},(_,n)=>({reservationId:'suffix-'+n+':r1',taskId:f.identity.taskIds[n<8?0:1]!,requestSha256:'f'.repeat(64),requestBytes:100,reservedTokens:50}))]});
 const git=gitFixture(f.previous.projectKey,states),transitions=[{beforeHead:git.heads[0]!,afterHead:git.heads[1]!},{beforeHead:git.heads[2]!,afterHead:git.heads[3]!}];f.save(states.at(-1)!,hash(git.heads.at(-1)!));
 // Protection is controller-bound; prepare it for this exact final controller.
 const {prepareProjectStateProtectionForTests}=await import('../github/projectStateProtection.js');const rules=[{type:'deletion'},{type:'non_fast_forward'}],source='erman-ksv/Onay-Agents-Factory',stateProtection=await prepareProjectStateProtectionForTests({controller:next,token:'offline'},async url=>Response.json(String(url).includes('/rulesets/')?{id:1,source_type:'Repository',source,target:'branch',enforcement:'active',bypass_actors:[],rules}:rules.map(r=>({...r,ruleset_id:1,ruleset_source_type:'Repository',ruleset_source:source}))));
 const cap=await restoreChain({controllers:[f.previous,middle,next],transitions,stateProtection},git.reader(next));await floor(cap,next,{projectKey:next.projectKey,grantSha256:f.previous.grantSha256,used:{requests:1,requestBytes:4668,reservedTokens:3012}},'simulated');assert.equal(f.writes(),0);
});
test('unknown CAS acknowledgement and mismatching readback mint no lineage and preserve all reservations',async()=>{
 for(const kind of ['lost','wrong']){const f=await fixture();let writes=0;const after=inspect(f.previous,f.state,f.proposed).newState;await assert.rejects(()=>extend({previous:f.previous,next:f.next,expectedRevision:'e'.repeat(64),state:f.state},{read:f.read,extend:async permit=>{const command=consume(permit,f.previous.projectKey);await command.assertAuthorized();writes++;f.save(after,'f'.repeat(64));if(kind==='lost')throw Error('unknown ACK');return {revision:'f'.repeat(64),data:command.before};}}));assert.equal(writes,1);assert.deepEqual((await f.read())!.data.reservations,f.state.reservations);}
});
test('two simultaneous bounded extension requests produce exactly one acknowledged native-adapter CAS without charges',async()=>{
 const f=await fixture(),git=gitFixture(f.previous.projectKey,[f.state]),revision=hash(git.live.head),after=inspect(f.previous,f.state,f.proposed).newState;
 f.save(f.state,revision);let writes=0;
 const gitHash=(kind:string,b:Buffer)=>createHash('sha1').update(Buffer.concat([Buffer.from(kind+' '+b.length+'\0'),b])).digest('hex');
 const transport:typeof fetch=async(input,init)=>{
  const method=init?.method??'GET';if(method==='GET')return git.transport(input,init);
  const path=new URL(String(input)).pathname.replace('/repos/erman-ksv/Onay-Agents-Factory',''),body=JSON.parse(String(init?.body));
  if(method==='POST'&&path==='/git/blobs'){const bytes=Buffer.from(body.content),sha=gitHash('blob',bytes);git.objects.set('/git/blobs/'+sha,{sha,encoding:'base64',content:bytes.toString('base64')});return Response.json({sha},{status:201});}
  if(method==='POST'&&path==='/git/trees'){const sha=gitHash('tree',Buffer.concat([Buffer.from('100644 project-model-budget.json\0'),Buffer.from(body.tree[0].sha,'hex')]));git.objects.set('/git/trees/'+sha,{sha,truncated:false,tree:body.tree});return Response.json({sha},{status:201});}
  if(method==='POST'&&path==='/git/commits'){const sha=createHash('sha1').update(JSON.stringify(body)).digest('hex');git.objects.set('/git/commits/'+sha,{sha,message:body.message,tree:{sha:body.tree},parents:body.parents.map((sha:string)=>({sha}))});return Response.json(git.objects.get('/git/commits/'+sha),{status:201});}
  if(method==='PATCH'){assert.equal(body.force,false);assert.equal(decodeURIComponent(path),'/git/refs/heads/state/project-model-budget/'+f.previous.projectKey);const commit=git.objects.get('/git/commits/'+body.sha);if(commit.parents[0]?.sha!==git.live.head)return Response.json({message:'CAS conflict'},{status:422});git.live.head=body.sha;writes++;f.save(after,hash(body.sha));return Response.json({ref:'refs/heads/state/project-model-budget/'+f.previous.projectKey,object:{type:'commit',sha:body.sha}});}
  assert.fail('Unexpected metadata write');
 };
 const stores=[1,2].map(()=>createProjectModelBudgetGitHubExtensionStore({projectKey:f.previous.projectKey,token:'offline',transport}));
 const results=await Promise.allSettled(stores.map(store=>extend({previous:f.previous,next:f.next,expectedRevision:revision,state:f.state},store)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(writes,1);assert.equal((await f.next.inspect()).used.requests,1);assert.deepEqual((await f.read())!.data.reservations,f.state.reservations);
});
