import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createProjectTargetRegistry,projectTargetProfile,assertProjectTargetScope,PROJECT_TARGET_ERROR,type ProjectTargetDefinition} from './projectTargetRegistry.js';
import {authorizeProjectBudget,authorizeGitHubProjectBudget,consumeAuthorizedProjectTaskScope,reconcileProjectBudgetHistory,projectBudgetApprovalDigest,PROJECT_AUTHORIZATION_ERROR,type ProjectBudgetIdentity,type ProjectBudgetHistory} from './projectBudgetAuthorization.js';
import {createProjectModelBudgetFileStore} from './projectModelBudgetFileStore.js';

const definition=(id='notes',repository='example/notes'):ProjectTargetDefinition=>({version:1,id,repository,writablePaths:['index.html','src/app.mjs','test/app.test.mjs'],branchPrefix:'feat/notes-agent/',requiredCiNames:['Notes task CI'],requiredCiSteps:['Syntax','Task tests'],requiredActors:['security','reviewer','tester'],maxFiles:3,maxSourceBytes:131072,maxNewFileBytes:8192,maxChangedCharacters:6000,maxReviewBytes:12000,legalEnabled:false,mergesEnabled:false});
const targetRefusal=(e:unknown)=>e instanceof Error&&e.message===PROJECT_TARGET_ERROR;
const authorizationRefusal=(e:unknown)=>e instanceof Error&&e.message===PROJECT_AUTHORIZATION_ERROR;
function fixture(d=definition(),legacy=false){
 const root=mkdtempSync(join(tmpdir(),'project-target-test-')),target=createProjectTargetRegistry([d]).select(d.id),profile=projectTargetProfile(target,d.repository);
 const identity:ProjectBudgetIdentity={projectId:legacy?'calculator-pilot-step7-v1':'offline-portability',repository:legacy?'erman-ksv/Onay-Factory-Calculator':d.repository,planFingerprint:legacy?'1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2':'a'.repeat(64),ownerFingerprint:legacy?'34ee0369da08ad7b0c83551481d9e87baa6dcd8b9d68021f0b18ac6c6533fdd8':'b'.repeat(64),taskIds:['t01']};
 const history:ProjectBudgetHistory={version:1,projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,observations:['planning','t01'].map(scopeId=>({scopeId,kind:'cumulative-scope-total',charge:{requests:0,requestBytes:0,reservedTokens:0},evidenceSha256:'c'.repeat(64)}))};
 const h=reconcileProjectBudgetHistory(history,identity),document:any={version:1,kind:'authorize-project-model-budget',mode:'development',grant:{version:1,projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,grantId:'offline-only-scope',maxRequests:3,maxRequestBytes:24000,maxTotalRequestBytes:72000,maxReservedTokens:18000,historical:h.charge,historicalEvidenceSha256:h.digest,provider:'groq',freeTierConfirmed:true,legalEnabled:false},expiresAt:'2026-10-27T12:00:00.000Z',...(!legacy?{targetProfileSha256:profile.sha256}:{})};
 const comment:any={id:321,user:{login:'erman-ksv',type:'User'},author_association:'OWNER',issue_url:'https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/75',html_url:'https://github.com/erman-ksv/Onay-Agents-Factory/pull/75#issuecomment-321',created_at:'2026-10-26T11:00:00Z',updated_at:'2026-10-26T11:00:00Z',body:JSON.stringify(document)};
 let reads=0;const transport:typeof fetch=async(url,init)=>{reads++;assert.equal(String(url),'https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/comments/321');assert.equal(init?.method,'GET');return Response.json(comment);};
 const options={identity,history,decision:{issueNumber:75,commentId:321,bodySha256:projectBudgetApprovalDigest(document)},token:'offline-owner-token',store:createProjectModelBudgetFileStore(root),transport,now:()=>Date.parse('2026-10-26T12:00:00Z'),...(!legacy?{targetProfile:target}:{})};
 return{target,profile,document,comment,options,reads:()=>reads,refresh(){comment.body=JSON.stringify(document);options.decision.bodySha256=projectBudgetApprovalDigest(document);},cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('host registry selects only registered immutable profiles; copies and JSON cannot select a target',()=>{
 const d=definition(),registry=createProjectTargetRegistry([d]),target=registry.select('notes'),p=projectTargetProfile(target,d.repository);
 assert.throws(()=>registry.select('unknown'),targetRefusal);assert.throws(()=>projectTargetProfile({...target},d.repository),targetRefusal);assert.throws(()=>projectTargetProfile(JSON.parse(JSON.stringify(target)),d.repository),targetRefusal);
 assert.throws(()=>projectTargetProfile(p,d.repository),targetRefusal);assert.throws(()=>projectTargetProfile(target,'example/other'),targetRefusal);
 (d.writablePaths as string[]).push('src/evil.mjs');assert.equal(p.writablePaths.includes('src/evil.mjs'),false);assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.writablePaths));
});
test('profile fingerprint is deterministic and binds path, branch, CI and byte limits',()=>{
 const d=definition(),digest=(v:ProjectTargetDefinition)=>createProjectTargetRegistry([v]).list()[0]!.sha256;
 assert.equal(digest(d),digest({...d,writablePaths:[...d.writablePaths].reverse(),requiredCiSteps:[...d.requiredCiSteps].reverse(),requiredActors:[...d.requiredActors].reverse()}));
 for(const v of [{...d,branchPrefix:'feat/other-agent/'},{...d,writablePaths:['index.html','src/other.mjs','test/app.test.mjs']},{...d,requiredCiNames:['Other CI']},{...d,maxReviewBytes:11999}])assert.notEqual(digest(d),digest(v));
});
test('invalid or ambiguous profiles cannot relax actors, flags, paths, bounds or repository controls',()=>{
 const d=definition();for(const v of [{...d,requiredActors:['security','reviewer']},{...d,requiredActors:['security','reviewer','reviewer']},{...d,legalEnabled:true},{...d,mergesEnabled:true},{...d,maxFiles:17},{...d,maxFiles:4},{...d,maxReviewBytes:24001},{...d,branchPrefix:'main/'},{...d,repository:'erman-ksv/Onay-Agents-Factory'},{...d,unknown:'value'}])assert.throws(()=>createProjectTargetRegistry([v]),targetRefusal);
 for(const p of ['../secret.json','.github/workflows/test.yml','src/.env.json','AGENTS.md','src/AGENTS.md','package.json','node_modules/data.json','src//app.mjs','src/%2e%2e/app.mjs','src/app.mjs?other'])assert.throws(()=>createProjectTargetRegistry([{...d,writablePaths:[p],maxFiles:1}]),targetRefusal);
 assert.throws(()=>createProjectTargetRegistry([d,d]),targetRefusal);assert.throws(()=>createProjectTargetRegistry([d,{...d,id:'other',repository:'EXAMPLE/NOTES'}]),targetRefusal);
});
test('accessors, sparse arrays and extra symbol data are rejected without reading getter values',()=>{
 let calls=0;const d=definition(),getter={...d};Object.defineProperty(getter,'repository',{get(){calls++;return d.repository;},enumerable:true});assert.throws(()=>createProjectTargetRegistry([getter]),targetRefusal);
 const paths=['index.html'];Object.defineProperty(paths,'0',{get(){calls++;return 'index.html';},enumerable:true});assert.throws(()=>createProjectTargetRegistry([{...d,writablePaths:paths,maxFiles:1}]),targetRefusal);
 const defs:any[]=[d];Object.defineProperty(defs,'0',{get(){calls++;return d;},enumerable:true});assert.throws(()=>createProjectTargetRegistry(defs),targetRefusal);
 assert.throws(()=>createProjectTargetRegistry(new Array(1)),targetRefusal);assert.throws(()=>createProjectTargetRegistry([{...d,[Symbol('extra')]:true}]),targetRefusal);assert.equal(calls,0);
});
test('scope guard refuses another repository, main, traversal, unlisted paths and too many files',()=>{
 const target=createProjectTargetRegistry([definition()]).select('notes'),good={repository:'example/notes',branch:'feat/notes-agent/t01',changePaths:['src/app.mjs']};assert.equal(assertProjectTargetScope(target,good).id,'notes');
 for(const input of [{...good,repository:'example/other'},{...good,branch:'main'},{...good,branch:'feat/notes-agent/'},{...good,branch:'feat/notes-agent/../main'},{...good,changePaths:['README.md']},{...good,changePaths:['src/app.mjs','src/app.mjs']},{...good,changePaths:[]}])assert.throws(()=>assertProjectTargetScope(target,input),targetRefusal);
});
test('new repository requires genuine target and native owner approval bound to its exact fingerprint',async()=>{
 const f=fixture();try{
  for(const targetProfile of [undefined,{},f.profile,JSON.parse(JSON.stringify(f.target))])await assert.rejects(()=>authorizeProjectBudget({...f.options,targetProfile} as any),authorizationRefusal);
  const without:any={...f.options};delete without.targetProfile;await assert.rejects(()=>authorizeProjectBudget(without),authorizationRefusal);assert.equal(f.reads(),0);
  const c=await authorizeProjectBudget(f.options);await c.initialize();const scope=consumeAuthorizedProjectTaskScope(await c.taskScope('t01','only-once'),f.options.identity);assert.equal(scope.targetProfile,f.target);assert.equal(c.targetProfileSha256,f.profile.sha256);assert.equal((await c.inspect()).used.requests,0);
 }finally{f.cleanup();}
});
test('missing or swapped approved profile fingerprint cannot create or initialize a ledger',async()=>{
 for(const mode of ['missing','mismatch','foreign-target']){const f=fixture();try{if(mode==='missing')delete f.document.targetProfileSha256;if(mode==='mismatch')f.document.targetProfileSha256='f'.repeat(64);if(mode==='foreign-target')f.options.targetProfile=createProjectTargetRegistry([definition('other','example/other')]).select('other');f.refresh();await assert.rejects(()=>authorizeProjectBudget(f.options),authorizationRefusal);assert.equal(await f.options.store.read(),undefined);}finally{f.cleanup();}}
});
test('editing native owner approval remains terminal for new profiles',async()=>{
 const f=fixture();try{const c=await authorizeProjectBudget(f.options);await c.initialize();f.comment.updated_at='2026-10-26T11:01:00Z';await assert.rejects(()=>c.assertAuthorized(),authorizationRefusal);f.comment.updated_at=f.comment.created_at;const reads=f.reads();await assert.rejects(()=>c.assertAuthorized(),authorizationRefusal);assert.equal(f.reads(),reads);}finally{f.cleanup();}
});
test('new profiles retain native author, association, issue and signed grant checks',async()=>{
 for(const mode of ['bot','author','association','issue','grant-repository']){const f=fixture();try{
  if(mode==='bot')f.comment.user.type='Bot';if(mode==='author')f.comment.user.login='other';if(mode==='association')f.comment.author_association='MEMBER';if(mode==='issue')f.comment.issue_url='https://api.github.com/repos/example/other/issues/75';if(mode==='grant-repository'){f.document.grant.repository='example/other';f.refresh();}
  await assert.rejects(()=>authorizeProjectBudget(f.options),authorizationRefusal);assert.equal(await f.options.store.read(),undefined);
 }finally{f.cleanup();}}
});
test('different project IDs on the same profile cannot share a native ledger key',async()=>{
 const a=fixture(),b=fixture();try{
  b.options.identity={...b.options.identity,projectId:'another-project'};b.options.history={...b.options.history,projectId:'another-project'};b.document.grant.projectId='another-project';b.document.grant.historicalEvidenceSha256=reconcileProjectBudgetHistory(b.options.history,b.options.identity).digest;b.refresh();
  const ca=await authorizeProjectBudget(a.options),cb=await authorizeProjectBudget(b.options);assert.notEqual(ca.projectKey,cb.projectKey);
 }finally{a.cleanup();b.cleanup();}
});
test('later host options mutation cannot replace the target carried by a controller or scope',async()=>{
 const f=fixture();try{const original=f.target,c=await authorizeProjectBudget(f.options);f.options.targetProfile=createProjectTargetRegistry([definition('other','example/other')]).select('other');const host=consumeAuthorizedProjectTaskScope(await c.taskScope('t01','stable-target'),f.options.identity);assert.equal(host.targetProfile,original);assert.equal(c.targetProfile,original);}finally{f.cleanup();}
});
test('projects have independent keys but a profile revision retains the same spent ledger',async()=>{
 const a=fixture(),b=fixture(definition('other','example/other')),revision=fixture({...definition(),maxReviewBytes:11999});try{
  const ca=await authorizeProjectBudget(a.options),cb=await authorizeProjectBudget(b.options),cc=await authorizeProjectBudget({...revision.options,store:a.options.store});assert.notEqual(ca.projectKey,cb.projectKey);assert.equal(ca.projectKey,cc.projectKey);await ca.initialize();await cb.initialize();
  const host=consumeAuthorizedProjectTaskScope(await ca.taskScope('t01','reserve-one'),a.options.identity);await host.projectBudget.ledger.reserve({reservationId:'isolated-r1',taskId:'t01',requestSha256:'d'.repeat(64),requestBytes:100,reservedTokens:100});assert.equal((await ca.inspect()).used.requests,1);assert.equal((await cb.inspect()).used.requests,0);assert.equal((await cc.inspect()).used.requests,1);await assert.rejects(()=>cc.initialize());assert.equal((await ca.inspect()).used.requests,1);
  const scope=await ca.taskScope('t01','foreign-consumer');assert.throws(()=>consumeAuthorizedProjectTaskScope(scope,b.options.identity),authorizationRefusal);
 }finally{a.cleanup();b.cleanup();revision.cleanup();}
});
test('legacy Calculator approval and stable remote namespace remain byte-compatible',async()=>{
 const f=fixture(definition(),true);try{const c=await authorizeProjectBudget(f.options);assert.equal(c.projectKey,'30aba2ef57704b41551ee67ae250315a8ec6a83963987f2e6533dbc20f7f70f0');assert.equal(Object.hasOwn(c,'targetProfile'),false);await c.initialize();assert.equal((await c.inspect()).used.requests,0);
  f.document.targetProfileSha256=f.profile.sha256;f.refresh();await assert.rejects(()=>authorizeProjectBudget(f.options),authorizationRefusal);
 }finally{f.cleanup();}
});
test('native store uses the same project key and cannot accept injected storage',async()=>{
 const f=fixture();try{const c=await authorizeProjectBudget(f.options);const {store:unused,...options}=f.options;const reads:string[]=[];const transport:typeof fetch=async(url,init)=>{const s=String(url);reads.push(s);assert.equal(init?.method,'GET');if(s.includes('/issues/comments/'))return Response.json(f.comment);assert.ok(s.endsWith('/git/ref/heads/'+encodeURIComponent('state/project-model-budget/'+c.projectKey)));return new Response('',{status:404});};
  const remote=await authorizeGitHubProjectBudget({...options,transport});assert.equal(remote.projectKey,c.projectKey);await assert.rejects(()=>remote.inspect());assert.equal(reads.length,2);await assert.rejects(()=>authorizeGitHubProjectBudget({...options,store:unused} as any),authorizationRefusal);
 }finally{f.cleanup();}
});
