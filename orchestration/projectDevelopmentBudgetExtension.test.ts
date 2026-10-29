import {extendProjectDevelopmentBudgetWithLineageForTests as extendLineage,assertProjectGrantLineageFloor as assertFloor} from './projectGrantLineage.js';
import {restoreProjectDevelopmentGrantLineageForTests as restoreLineage,restoreGitHubProjectDevelopmentGrantLineage} from './projectGrantLineage.js';
import {restoreAcknowledgedDevelopmentGrantLineageForTests as restoreAcknowledged,restoreGitHubAcknowledgedDevelopmentGrantLineage} from './projectGrantLineage.js';
import {prepareProjectStateProtectionForTests} from '../github/projectStateProtection.js';
import {createHash} from 'node:crypto';
import test from 'node:test';import assert from 'node:assert/strict';
import {authorizeProjectBudget,reconcileProjectBudgetHistory,projectBudgetApprovalDigest} from './projectBudgetAuthorization.js';
import {inspectProjectDevelopmentBudgetExtension as inspect,authorizeProjectDevelopmentBudgetExtension as authorize,consumeProjectBudgetExtensionPermit,projectBudgetStateDigest} from './projectBudgetExtensionAuthorization.js';
const now=Date.parse('2026-10-27T12:00:00Z');
async function fixture(){
 const identity={projectId:'extension-offline',repository:'erman-ksv/Onay-Factory-Calculator',planFingerprint:'a'.repeat(64),ownerFingerprint:'b'.repeat(64),taskIds:['t01','t02']};
 const history={version:1 as const,projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,observations:['planning','t01','t02'].map(scopeId=>({scopeId,kind:'cumulative-scope-total' as const,charge:{requests:0,requestBytes:0,reservedTokens:0},evidenceSha256:'c'.repeat(64)}))},h=reconcileProjectBudgetHistory(history,identity);
 const grant={version:1,projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,grantId:'original',maxRequests:8,maxRequestBytes:12000,maxTotalRequestBytes:96000,maxReservedTokens:48000,historical:h.charge,historicalEvidenceSha256:h.digest,provider:'groq',freeTierConfirmed:true,legalEnabled:false};let writes=0,revoked=false,saved:any=undefined;
 async function controller(g:unknown,id:number){const document={version:1,kind:'authorize-project-model-budget',mode:'development',grant:g,expiresAt:'2026-10-28T12:00:00Z'};return authorizeProjectBudget({identity,history,decision:{issueNumber:75,commentId:id,bodySha256:projectBudgetApprovalDigest(document)},token:'offline-only',store:{read:async()=>saved,compareAndSwap:async()=>{writes++;throw Error('No writes allowed');}},now:()=>now,transport:async()=>Response.json({id,user:{login:revoked?'other':'erman-ksv',type:'User'},author_association:'OWNER',issue_url:'https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/75',html_url:'https://github.com/erman-ksv/Onay-Agents-Factory/pull/75#issuecomment-'+id,created_at:'2026-10-27T11:00:00Z',updated_at:'2026-10-27T11:00:00Z',body:JSON.stringify(document)})});}
 const previous=await controller(grant,101),state={version:1 as const,grantSha256:previous.grantSha256,reservations:[{reservationId:'attempt:r1',taskId:'t01',requestSha256:'d'.repeat(64),requestBytes:4668,reservedTokens:3012}]};
 const proposed={...grant,grantId:'development-extend-'+projectBudgetStateDigest(state),maxRequests:9,maxTotalRequestBytes:108000,maxReservedTokens:54000};
 saved={revision:'e'.repeat(64),data:state};return {previous,state,proposed,controller,read:async()=>saved,save:(data:unknown,revision:string)=>{saved={data,revision};},writes:()=>writes,revoke:()=>{revoked=true;}};
}
test('inspection retains the complete charged reservation and grants no execution',async()=>{const f=await fixture(),v=inspect(f.previous,f.state,f.proposed);assert.equal(v.used.requests,1);assert.deepEqual(v.newState.reservations,f.state.reservations);assert.equal(v.additionalRequestsAuthorized,0);assert.equal(v.taskReplayAuthorized,false);assert.equal(f.writes(),0);});
test('extra slots, understated history, changed identity and stale reservation pin refuse',async()=>{const f=await fixture();for(const change of [{maxRequests:10},{maxTotalRequestBytes:108001},{maxReservedTokens:54001},{historical:{requests:0,requestBytes:0,reservedTokens:1}},{projectId:'other'},{grantId:'development-extend-'+'0'.repeat(64)}])assert.throws(()=>inspect(f.previous,f.state,{...f.proposed,...change}));assert.throws(()=>inspect(f.previous,{...f.state,reservations:[]},f.proposed));});
test('only two genuine native OWNER controllers can mint a one-use CAS permit',async()=>{const f=await fixture(),next=await f.controller(f.proposed,102);await assert.rejects(()=>authorize({...f.previous},next,'e'.repeat(64),f.state));const permit=await authorize(f.previous,next,'e'.repeat(64),f.state),command=consumeProjectBudgetExtensionPermit(permit,f.previous.projectKey);assert.deepEqual(command.after.reservations,f.state.reservations);assert.throws(()=>consumeProjectBudgetExtensionPermit(permit,f.previous.projectKey));assert.equal(f.writes(),0);});
test('owner revocation blocks authorization and the final pre-CAS guard',async()=>{const f=await fixture(),next=await f.controller(f.proposed,102),permit=await authorize(f.previous,next,'e'.repeat(64),f.state),command=consumeProjectBudgetExtensionPermit(permit,f.previous.projectKey);f.revoke();await assert.rejects(command.assertAuthorized);await assert.rejects(()=>authorize(f.previous,next,'e'.repeat(64),f.state));assert.equal(f.writes(),0);});

function adapter(f:Awaited<ReturnType<typeof fixture>>,kind='ok'){
 return {read:f.read,extend:async(permit:Parameters<typeof consumeProjectBudgetExtensionPermit>[0])=>{const c=consumeProjectBudgetExtensionPermit(permit,f.previous.projectKey);await c.assertAuthorized();if(kind==='lost')throw Error('ack lost');f.save(c.after,'f'.repeat(64));return {revision:'f'.repeat(64),data:kind==='wrong'?c.before:c.after};}};
}
test('acknowledged lineage accepts the exact prior floor but never native simulated or copied proof',async()=>{
 const f=await fixture(),next=await f.controller(f.proposed,102),cap=await extendLineage({previous:f.previous,next,expectedRevision:'e'.repeat(64),state:f.state},adapter(f)),floor={projectKey:next.projectKey,grantSha256:f.previous.grantSha256,used:{requests:1,requestBytes:4668,reservedTokens:3012}};
 await assertFloor(cap,next,floor,'simulated');await assert.rejects(()=>assertFloor(cap,next,floor,'native'));await assert.rejects(()=>assertFloor({...cap},next,floor,'simulated'));await assert.rejects(()=>assertFloor(cap,next,{...floor,grantSha256:'0'.repeat(64)},'simulated'));await assert.rejects(()=>assertFloor(cap,next,{...floor,used:{...floor.used,requests:2}},'simulated'));
});
test('unknown acknowledgement or wrong readback cannot mint any lineage',async()=>{
 for(const kind of ['lost','wrong']){const f=await fixture(),next=await f.controller(f.proposed,102);await assert.rejects(()=>extendLineage({previous:f.previous,next,expectedRevision:'e'.repeat(64),state:f.state},adapter(f,kind)));}
});
test('stale expected state refuses before extension and later revocation invalidates lineage',async()=>{
 const f=await fixture(),next=await f.controller(f.proposed,102);await assert.rejects(()=>extendLineage({previous:f.previous,next,expectedRevision:'0'.repeat(64),state:f.state},adapter(f)));
 const cap=await extendLineage({previous:f.previous,next,expectedRevision:'e'.repeat(64),state:f.state},adapter(f));f.revoke();await assert.rejects(()=>assertFloor(cap,next,{projectKey:next.projectKey,grantSha256:f.previous.grantSha256,used:{requests:1,requestBytes:4668,reservedTokens:3012}},'simulated'));
});
async function coldFixture(){
 const f=await fixture(),next=await f.controller(f.proposed,102),beforeHead='1'.repeat(40),afterHead='2'.repeat(40),hash=(s:string)=>createHash('sha256').update(s).digest('hex'),inspection=inspect(f.previous,f.state,next.grant);
 f.save(inspection.newState,hash(afterHead));let bypass=false,reads=0;
 const transport:typeof fetch=async(url,init)=>{assert.equal(init?.method,'GET');const rules=[{type:'deletion'},{type:'non_fast_forward'}],source='erman-ksv/Onay-Agents-Factory';return Response.json(String(url).includes('/rulesets/')?{id:1,source_type:'Repository',source,target:'branch',enforcement:'active',bypass_actors:bypass?[{actor_id:1}]:[],rules}:rules.map(r=>({...r,ruleset_id:1,ruleset_source_type:'Repository',ruleset_source:source})));};
 const stateProtection=await prepareProjectStateProtectionForTests({controller:next,token:'offline'},transport),transition={before:{revision:hash(beforeHead),data:f.state},after:{revision:hash(afterHead),data:inspection.newState}},options={previous:f.previous,next,beforeHead,afterHead,stateProtection};
 const reader={readTransition:async(before:string,after:string)=>{assert.equal(before,beforeHead);assert.equal(after,afterHead);reads++;return structuredClone(transition);}};
 return {f,next,options,reader,transition,reads:()=>reads,changeRules:()=>{bypass=true;},floor:{projectKey:next.projectKey,grantSha256:f.previous.grantSha256,used:inspection.used}};
}
test('cold lineage is recreated from the verified transition without extension, reset or task execution',async()=>{
 const c=await coldFixture(),cap=await restoreLineage(c.options,c.reader);assert.equal(c.reads(),2);assert.equal(c.f.writes(),0);await assertFloor(cap,c.next,c.floor,'simulated');await assert.rejects(()=>assertFloor(cap,c.next,c.floor,'native'));await assert.rejects(()=>assertFloor({...cap},c.next,c.floor,'simulated'));
 await assert.rejects(()=>restoreGitHubProjectDevelopmentGrantLineage({...c.options,token:'offline',reader:c.reader} as any));assert.equal(c.reads(),2);
});
test('cold lineage refuses wrong revisions, replaced reservations and mismatching live state',async()=>{
 for(const kind of ['revision','reservation','live']){const c=await coldFixture();if(kind==='revision')c.transition.before.revision='0'.repeat(64);else if(kind==='reservation')c.transition.after.data={...c.transition.after.data,reservations:[]};else c.f.save({...c.transition.after.data,reservations:[]},'f'.repeat(64));await assert.rejects(()=>restoreLineage(c.options,c.reader));assert.equal(c.f.writes(),0);}
});
test('cold lineage refuses copied protection, changed rules and revoked OWNER decisions',async()=>{
 const a=await coldFixture();await assert.rejects(()=>restoreLineage({...a.options,stateProtection:{...a.options.stateProtection}},a.reader));assert.equal(a.reads(),0);
 const b=await coldFixture();b.changeRules();await assert.rejects(()=>restoreLineage(b.options,b.reader));assert.equal(b.reads(),0);
 const c=await coldFixture();c.f.revoke();await assert.rejects(()=>restoreLineage(c.options,c.reader));assert.equal(c.reads(),0);
});
test('cold lineage refuses a transition changed during verification and checks later revocation',async()=>{
 const c=await coldFixture();let count=0;await assert.rejects(()=>restoreLineage(c.options,{readTransition:async(a,b)=>{const v=await c.reader.readTransition(a,b);if(++count===2)v.after.revision='0'.repeat(64);return v;}}));
 const d=await coldFixture(),cap=await restoreLineage(d.options,d.reader);d.f.revoke();await assert.rejects(()=>assertFloor(cap,d.next,d.floor,'simulated'));assert.equal(d.f.writes(),0);
});
async function spentFixture(){
 const c=await coldFixture(),hash=(s:string)=>createHash('sha256').update(s).digest('hex'),state={...c.transition.after.data,reservations:[...c.transition.after.data.reservations,{reservationId:'later:r1',taskId:'t01',requestSha256:'d'.repeat(64),requestBytes:100,reservedTokens:50}]},current={revision:hash('3'.repeat(40)),data:state};c.f.save(state,current.revision);
 const reader={readAcknowledgedTransition:async()=>structuredClone({...c.transition,current})};return {...c,current,reader};
}
test('cold acknowledged lineage restores old floors after an additional spent reservation without writes',async()=>{
 const c=await spentFixture(),cap=await restoreAcknowledged(c.options,c.reader);await assertFloor(cap,c.next,c.floor,'simulated');assert.equal((await c.next.inspect()).used.requests,2);assert.equal(c.f.writes(),0);await assert.rejects(()=>assertFloor(cap,c.next,c.floor,'native'));await assert.rejects(()=>restoreGitHubAcknowledgedDevelopmentGrantLineage({...c.options,token:'offline',reader:c.reader} as any));
});
test('cold acknowledged restore refuses missing proof, replaced reservation prefix and mismatching live totals',async()=>{
 for(const kind of ['missing','prefix','live']){const c=await spentFixture();if(kind==='prefix')c.current.data.reservations[0]={...c.current.data.reservations[0]!,requestSha256:'0'.repeat(64)};if(kind==='live')c.f.save({...c.current.data,reservations:[]},c.current.revision);const reader=kind==='missing'?{readAcknowledgedTransition:async()=>structuredClone(c.transition) as any}:c.reader;await assert.rejects(()=>restoreAcknowledged(c.options,reader));assert.equal(c.f.writes(),0);}
});
test('another acknowledged extension inherits both old grant floors only through a genuine parent capability',async()=>{
 const c=await spentFixture(),parent=await restoreAcknowledged(c.options,c.reader),before=c.current.data,grant={...c.next.grant,grantId:'development-extend-'+projectBudgetStateDigest(before),maxRequests:c.next.grant.maxRequests+1,maxTotalRequestBytes:c.next.grant.maxTotalRequestBytes+12000,maxReservedTokens:c.next.grant.maxReservedTokens+6000},next=await c.f.controller(grant,103),options={previous:c.next,next,expectedRevision:c.current.revision,state:before};
 let writes=0;const store={read:c.f.read,extend:async(permit:Parameters<typeof consumeProjectBudgetExtensionPermit>[0])=>{writes++;const command=consumeProjectBudgetExtensionPermit(permit,next.projectKey);await command.assertAuthorized();c.f.save(command.after,'f'.repeat(64));return {revision:'f'.repeat(64),data:command.after};}};
 await assert.rejects(()=>extendLineage({...options,parentLineage:{...parent}},store));assert.equal(writes,0);const cap=await extendLineage({...options,parentLineage:parent},store);assert.equal(writes,1);await assertFloor(cap,next,c.floor,'simulated');await assertFloor(cap,next,{projectKey:next.projectKey,grantSha256:c.next.grantSha256,used:{requests:2,requestBytes:4768,reservedTokens:3062}},'simulated');await assert.rejects(()=>assertFloor(cap,next,{...c.floor,grantSha256:'0'.repeat(64)},'simulated'));c.f.revoke();await assert.rejects(()=>assertFloor(cap,next,c.floor,'simulated'));
});
