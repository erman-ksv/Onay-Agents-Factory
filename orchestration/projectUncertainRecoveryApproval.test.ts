import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createProjectTargetRegistry,registeredProjectTargetProfile} from './projectTargetRegistry.js';
import {authorizeProjectBudget,reconcileProjectBudgetHistory,projectBudgetApprovalDigest} from './projectBudgetAuthorization.js';
import {proposeProjectUncertainRecoveryApproval as propose,authorizeProjectUncertainRecoveryForTests as approve,consumeProjectUncertainRecoveryApproval as consume,authorizeProjectUncertainRecovery} from './projectUncertainRecoveryApproval.js';
async function fixture(){
 const manifest=JSON.parse(readFileSync(new URL('../.factory/runtime-project-manifest.json',import.meta.url),'utf8'));
 const target=createProjectTargetRegistry([manifest.profile]).select(manifest.profile.id),profile=registeredProjectTargetProfile(target),now=Date.now();
 const identity={projectId:'uncertain-offline',repository:manifest.profile.repository as string,planFingerprint:'a'.repeat(64),ownerFingerprint:'b'.repeat(64),taskIds:['t01','t02']},history={version:1 as const,projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,observations:['planning','t01','t02'].map(scopeId=>({scopeId,kind:'cumulative-scope-total' as const,charge:{requests:0,requestBytes:0,reservedTokens:0},evidenceSha256:'c'.repeat(64)}))};
 const grant={version:1,projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,grantId:'offline',maxRequests:9,maxRequestBytes:12000,maxTotalRequestBytes:108000,maxReservedTokens:54000,historical:{requests:0,requestBytes:0,reservedTokens:0},historicalEvidenceSha256:reconcileProjectBudgetHistory(history,identity).digest,provider:'groq',freeTierConfirmed:true,legalEnabled:false};
 const budgetDocument={version:1,kind:'authorize-project-model-budget',mode:'development',targetProfileSha256:profile.sha256,grant,expiresAt:new Date(now+86400000).toISOString()};let revoked=false,writes=0;
 const comment=(id:number,document:unknown)=>({id,user:{login:revoked?'other':'erman-ksv',type:'User'},author_association:'OWNER',issue_url:'https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/75',html_url:'https://github.com/erman-ksv/Onay-Agents-Factory/pull/75#issuecomment-'+id,created_at:new Date(now-1000).toISOString(),updated_at:new Date(now-1000).toISOString(),body:JSON.stringify(document)});
 const controller=await authorizeProjectBudget({identity,history,decision:{issueNumber:75,commentId:101,bodySha256:projectBudgetApprovalDigest(budgetDocument)},token:'offline-token',targetProfile:target,store:{read:async()=>undefined,compareAndSwap:async()=>{writes++;throw Error('No budget writes permitted');}},transport:async()=>Response.json(comment(101,budgetDocument))});
 const binding={taskId:'t01',archiveHead:'d'.repeat(40),archiveSequence:2,budgetStateSha256:'e'.repeat(64),originalRequestSha256:'f'.repeat(64)};
 const options={controller,binding,decision:{issueNumber:75,commentId:202,bodySha256:'0'.repeat(64)},token:'offline-token'},document=propose(options,new Date(now+86400000).toISOString()),owner=comment(202,document);
 options.decision.bodySha256=projectBudgetApprovalDigest(document);
 const transport:typeof fetch=async(url,init)=>{assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(String(url),'https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/comments/202');return Response.json(owner);};
 return {options,document,owner,transport,writes:()=>writes,revoke:()=>{revoked=true;},comment};
}
test('budget approval alone cannot approve recovery; exact separate OWNER decision gives no execution',async()=>{
 const f=await fixture(),cap=await approve(f.options,f.transport);await assert.rejects(()=>consume({...cap},f.options.controller,f.options.binding,'simulated'));await assert.rejects(()=>consume(cap,f.options.controller,f.options.binding,'native'));
 const handoff=await consume(cap,f.options.controller,f.options.binding,'simulated');assert.equal(handoff.executionAuthorized,false);assert.equal(handoff.budgetChangeAuthorized,false);assert.equal(handoff.replayOriginal,false);await assert.rejects(()=>consume(cap,f.options.controller,f.options.binding,'simulated'));assert.equal(f.writes(),0);
});
test('recovery attempt ID stays stable across different decisions or pinned revisions',async()=>{
 const f=await fixture(),a=propose(f.options,f.document.expiresAt),b=propose({...f.options,binding:{...f.options.binding,archiveHead:'1'.repeat(40),budgetStateSha256:'2'.repeat(64)}},f.document.expiresAt);assert.equal(a.recoveryExecutionId,b.recoveryExecutionId);assert.notEqual(a.originalExecutionId,a.recoveryExecutionId);
});
test('even a newly signed altered policy cannot increase calls, replay original or change task scope',async()=>{
 for(const change of [{maxNewRequests:5},{replayOriginal:true},{taskId:'t02'},{planFingerprint:'0'.repeat(64)},{originalOutcome:'not-sent'},{extra:'field'}]){const f=await fixture();f.owner.body=JSON.stringify({...f.document,...change});f.options.decision.bodySha256=projectBudgetApprovalDigest(JSON.parse(f.owner.body));await assert.rejects(()=>approve(f.options,f.transport));assert.equal(f.writes(),0);}
});
test('other author, edited comment, expiry and invalid body stop without writes',async()=>{
 for(const kind of ['author','edited','expired','invalid']){const f=await fixture();if(kind==='author')f.owner.user.login='other';if(kind==='edited')f.owner.updated_at=new Date().toISOString();if(kind==='expired')f.owner.body=JSON.stringify({...f.document,expiresAt:'2026-01-01T00:00:00Z'});if(kind==='invalid')f.owner.body='not json';await assert.rejects(()=>approve(f.options,f.transport));assert.equal(f.writes(),0);}
});
test('binding drift, native adapter injection and later owner revocation are refused',async()=>{
 const f=await fixture(),cap=await approve(f.options,f.transport);await assert.rejects(()=>consume(cap,f.options.controller,{...f.options.binding,archiveHead:'0'.repeat(40)},'simulated'));await assert.rejects(()=>authorizeProjectUncertainRecovery({...f.options,transport:f.transport} as any));f.revoke();await assert.rejects(()=>consume(cap,f.options.controller,f.options.binding,'simulated'));assert.equal(f.writes(),0);
});
