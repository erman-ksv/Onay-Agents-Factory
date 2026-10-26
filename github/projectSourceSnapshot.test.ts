import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createProjectTargetRegistry,type ProjectTargetDefinition} from '../orchestration/projectTargetRegistry.js';
import {prepareProjectGoal,createProjectPlan,projectPlanTaskId} from '../orchestration/projectPlan.js';
import {loadProjectTaskSnapshot,loadGitHubProjectTaskSnapshot,projectSnapshotSources,verifyProjectSnapshot,createProjectSnapshotSourceGuard,PROJECT_SOURCE_ERROR,type ProjectSnapshotReader} from './projectSourceSnapshot.js';
import {prepareProjectChanges,projectChangesFiles,verifyProjectChanges,PROJECT_CHANGES_ERROR} from '../commander/projectChanges.js';

const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const blob=(s:string)=>createHash('sha1').update(Buffer.from('blob '+Buffer.byteLength(s)+'\0'+s)).digest('hex');
const sourceRefusal=(e:unknown)=>e instanceof Error&&e.message===PROJECT_SOURCE_ERROR;
const changesRefusal=(e:unknown)=>e instanceof Error&&e.message===PROJECT_CHANGES_ERROR;
function fixture(config=false){
 const ui=config?'vitest.config.ts':'index.html',files=new Map([[ui,'<main>Notes</main>\n'],['src/app.mjs','export const value = 1; // PRIVATE_MARKER\n'],['test/app.test.mjs','export const test = true;\n']]);
 const d:ProjectTargetDefinition={version:1,id:'notes',repository:'example/notes',writablePaths:[...files.keys()],branchPrefix:'feat/notes-agent/',requiredCiNames:['Notes CI'],requiredCiSteps:['Syntax','Task tests'],requiredActors:['security','reviewer','tester'],maxFiles:3,maxSourceBytes:131072,maxNewFileBytes:8192,maxChangedCharacters:6000,maxReviewBytes:12000,legalEnabled:false,mergesEnabled:false};
 const target=createProjectTargetRegistry([d]).select('notes'),goal=prepareProjectGoal(target,{version:1,id:'notes-pilot',goal:'Show and update a small notes application.',baseRef:'feat/bootstrap',baseSha:'1'.repeat(40),provider:'groq',acceptance:[{id:'show-value',scenario:'The note value is shown correctly.'}],requiredPaths:[...files.keys()]});
 const taskId=projectPlanTaskId(goal,1),plan=createProjectPlan(goal,{tasks:[{id:taskId,role:'coder',goal:'Implement the required note display and tests.',acceptanceIds:['show-value'],paths:[...files.keys()],dependsOn:[]}],blockers:[],unverifiedAreas:['Real source inspection is still required.']});
 const state={root:plan.request.baseSha,head:'5'.repeat(40),truncated:false,reads:0,blobReads:0};
 const reader:ProjectSnapshotReader={getHead:async ref=>{state.reads++;return ref===plan.request.baseRef?state.root:state.head;},readCommit:async sha=>({sha,treeSha:'2'.repeat(40),parents:sha==='5'.repeat(40)?[plan.request.baseSha]:[]}),readTree:async sha=>({sha,truncated:state.truncated,tree:[{path:'src',sha:'3'.repeat(40),type:'tree',mode:'040000'},{path:'test',sha:'4'.repeat(40),type:'tree',mode:'040000'},...[...files].map(([path,content])=>({path,sha:blob(content),type:'blob',mode:'100644',size:Buffer.byteLength(content)}))]}),readBlob:async sha=>{state.blobReads++;const entry=[...files].find(([,content])=>blob(content)===sha);if(!entry)throw Error('PRIVATE_BLOB_ERROR');return {sha,encoding:'base64',content:Buffer.from(entry[1]).toString('base64')};}};
 const load=()=>loadProjectTaskSnapshot(plan,taskId,reader),patch=()=>({summary:'PRIVATE_MARKER: update the note value.',changes:[{operation:'patch',path:'src/app.mjs',sourceSha256:hash(files.get('src/app.mjs')!),edits:[{before:'value = 1',after:'value = 2'}],message:'PRIVATE_MARKER: update value.'}]});
 return{files,d,target,plan,taskId,state,reader,load,patch};
}

test('source snapshot binds commit and verified blobs while JSON contains metadata only',async()=>{
 const f=fixture(),s=await f.load();assert.equal(s.baseSha,f.plan.request.baseSha);assert.equal(s.files.length,3);assert.equal(s.executionAuthorized,false);assert.equal(JSON.stringify(s).includes('PRIVATE_MARKER'),false);assert.equal(s.files.find(x=>x.path==='src/app.mjs')!.sourceSha256,hash(f.files.get('src/app.mjs')!));
 const sources=projectSnapshotSources(s);sources.set('src/app.mjs','tampered');assert.equal(projectSnapshotSources(s).get('src/app.mjs'),f.files.get('src/app.mjs'));await verifyProjectSnapshot(s);assert.throws(()=>projectSnapshotSources({...s}),sourceRefusal);
});
test('absence requires complete commit-linked tree, not 404 or a truncated listing',async()=>{
 const f=fixture();f.files.delete('test/app.test.mjs');const s=await f.load();assert.equal(s.files.find(x=>x.path==='test/app.test.mjs')!.exists,false);assert.equal(f.state.blobReads,2);
 const g=fixture();g.state.truncated=true;await assert.rejects(()=>g.load(),sourceRefusal);const h=fixture();(h.reader as any).readBlob=async()=>{throw Error('404 PRIVATE');};await assert.rejects(()=>h.load(),sourceRefusal);
});
test('copied plan, unknown task and foreign snapshot identity cannot authorize source changes',async()=>{
 const f=fixture();await assert.rejects(()=>loadProjectTaskSnapshot({...f.plan},f.taskId,f.reader),sourceRefusal);await assert.rejects(()=>loadProjectTaskSnapshot(f.plan,'unknown',f.reader),sourceRefusal);const s=await f.load();await assert.rejects(()=>prepareProjectChanges({...f.plan},f.taskId,s,f.patch()),changesRefusal);await assert.rejects(()=>prepareProjectChanges(f.plan,'unknown',s,f.patch()),changesRefusal);await assert.rejects(()=>prepareProjectChanges(f.plan,f.taskId,{...s},f.patch()),changesRefusal);
});
test('descendant branch anchor is verified and unrelated commit or foreign branch is refused',async()=>{
 const f=fixture(),s=await loadProjectTaskSnapshot(f.plan,f.taskId,f.reader,{ref:f.plan.branch,sha:f.state.head});assert.equal(s.baseSha,f.state.head);await verifyProjectSnapshot(s);
 f.state.head='6'.repeat(40);await assert.rejects(()=>loadProjectTaskSnapshot(f.plan,f.taskId,f.reader,{ref:f.plan.branch,sha:f.state.head}),sourceRefusal);await assert.rejects(()=>loadProjectTaskSnapshot(f.plan,f.taskId,f.reader,{ref:'main',sha:f.plan.request.baseSha}),sourceRefusal);
});
test('head movement during loading refuses; a later source verification failure stays latched',async()=>{
 const f=fixture(),read=f.reader.readBlob;(f.reader as any).readBlob=async(id:string)=>{const b=await read(id);f.state.root='f'.repeat(40);return b;};await assert.rejects(()=>f.load(),sourceRefusal);
 const g=fixture(),s=await g.load();g.state.root='f'.repeat(40);await assert.rejects(()=>verifyProjectSnapshot(s),sourceRefusal);g.state.root=g.plan.request.baseSha;await assert.rejects(()=>verifyProjectSnapshot(s),sourceRefusal);assert.throws(()=>projectSnapshotSources(s),sourceRefusal);
});
test('actual source callback pins the genuine plan/task and rechecks native head on each call',async()=>{
 const f=fixture(),s=await f.load(),guard=createProjectSnapshotSourceGuard(s);await guard(f.plan,f.plan.tasks[0]!);await assert.rejects(()=>guard({...f.plan},f.plan.tasks[0]!),sourceRefusal);await assert.rejects(()=>guard(f.plan,{...f.plan.tasks[0]!}),sourceRefusal);f.state.root='f'.repeat(40);await assert.rejects(()=>guard(f.plan,f.plan.tasks[0]!),sourceRefusal);f.state.root=f.plan.request.baseSha;await assert.rejects(()=>guard(f.plan,f.plan.tasks[0]!),sourceRefusal);
});
test('blob digest, canonical base64, UTF8, size and secrets are checked independently',async()=>{
 for(const mode of ['digest','encoding','base64','utf8','size','secret']){const f=fixture();if(mode==='secret')f.files.set('src/app.mjs',"const token = 'gsk_"+'a'.repeat(32)+"';");else if(mode==='size'){const tree=f.reader.readTree;(f.reader as any).readTree=async(s:string)=>{const t=await tree(s);const e=t.tree.find(x=>x.path==='src/app.mjs')!;(e as any).size++;return t;};}else{const read=f.reader.readBlob;(f.reader as any).readBlob=async(s:string)=>{const b=await read(s);if(mode==='digest')b.content=Buffer.from('different content').toString('base64');if(mode==='encoding')b.encoding='utf8';if(mode==='base64')b.content+=' ';if(mode==='utf8')b.content=Buffer.from([255]).toString('base64');return b;};}await assert.rejects(()=>f.load(),sourceRefusal);}
});
test('symlinks, gitlinks, duplicate paths and missing directory evidence cannot masquerade as regular files',async()=>{
 for(const mode of ['symlink','gitlink','duplicate','missing-parent']){const f=fixture(),read=f.reader.readTree;(f.reader as any).readTree=async(id:string)=>{const t=await read(id),entries=t.tree as any[];if(mode==='symlink')entries.find(x=>x.path==='src/app.mjs').mode='120000';if(mode==='gitlink'){const e=entries.find(x=>x.path==='src');e.type='commit';e.mode='160000';}if(mode==='duplicate')entries.push({...entries[0]});if(mode==='missing-parent')entries.splice(entries.findIndex(x=>x.path==='src'),1);return t;};await assert.rejects(()=>f.load(),sourceRefusal);}
});
test('native source adapter stays on fixed repo GET endpoints and preserves exact commit/blob links',async()=>{
 const f=fixture(),calls:string[]=[];const transport:typeof fetch=async(url,init)=>{const u=new URL(String(url));assert.equal(u.origin,'https://api.github.com');assert.ok(u.pathname.startsWith('/repos/example/notes/'));assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer offline-read-token');const p=u.pathname.replace('/repos/example/notes','');calls.push(p);let r:unknown;
 if(p.startsWith('/git/ref/heads/')){const ref=decodeURIComponent(p.slice('/git/ref/heads/'.length));r={ref:'refs/heads/'+ref,object:{type:'commit',sha:await f.reader.getHead(ref)}};}else if(p.startsWith('/git/commits/')){const c=await f.reader.readCommit(p.split('/').at(-1)!);r={sha:c.sha,tree:{sha:c.treeSha},parents:c.parents.map(sha=>({sha}))};}else if(p.startsWith('/git/trees/'))r=await f.reader.readTree(p.split('/').at(-1)!);else if(p.startsWith('/git/blobs/'))r=await f.reader.readBlob(p.split('/').at(-1)!);else assert.fail('Unexpected endpoint');return Response.json(r);};
 const s=await loadGitHubProjectTaskSnapshot({plan:f.plan,taskId:f.taskId,token:'offline-read-token',transport});assert.equal(s.files.length,3);await verifyProjectSnapshot(s);assert.ok(calls.length>=9);await assert.rejects(()=>loadGitHubProjectTaskSnapshot({plan:f.plan,taskId:f.taskId,token:'offline-read-token',transport,reader:f.reader} as any),sourceRefusal);
});
test('native 404, transport failure and oversized response are source-free terminal read failures',async()=>{
 for(const mode of ['404','network','large']){const f=fixture();let calls=0;const transport:typeof fetch=async()=>{calls++;if(mode==='network')throw Error('PRIVATE_TOKEN_FAILURE');return new Response(mode==='large'?'x'.repeat(1048577):'PRIVATE_BODY',{status:mode==='404'?404:200});};await assert.rejects(()=>loadGitHubProjectTaskSnapshot({plan:f.plan,taskId:f.taskId,token:'offline-read-token',transport}),sourceRefusal);assert.equal(calls,1);}
});
test('prepared patch keeps code, summary and messages private and requires all independent gates',async()=>{
 const f=fixture(),s=await f.load(),c=await prepareProjectChanges(f.plan,f.taskId,s,f.patch());assert.equal(JSON.stringify(c).includes('PRIVATE_MARKER'),false);assert.ok(projectChangesFiles(c)[0]!.content.includes('value = 2'));assert.ok(projectSnapshotSources(s).get('src/app.mjs')!.includes('value = 1'));assert.equal(c.gates.independentReview,'required');assert.equal(c.gates.tests,'required');assert.equal(c.gates.ci,'required');assert.equal(c.gates.publicationAuthorized,false);await verifyProjectChanges(c);assert.throws(()=>projectChangesFiles({...c}),changesRefusal);await assert.rejects(()=>verifyProjectChanges({...c}),changesRefusal);
});
test('create requires genuine absence while existing-file overwrite and duplicate changes refuse',async()=>{
 const f=fixture();f.files.delete('test/app.test.mjs');const s=await f.load(),input={summary:'Add a missing independent test file.',changes:[{operation:'create',path:'test/app.test.mjs',content:'export const test = true;\n',message:'Add test fixture.'}]},c=await prepareProjectChanges(f.plan,f.taskId,s,input);assert.equal(c.files[0]!.operation,'create');
 await assert.rejects(()=>prepareProjectChanges(f.plan,f.taskId,s,{...input,changes:[{...input.changes[0],path:'src/app.mjs'}]}),changesRefusal);await assert.rejects(()=>prepareProjectChanges(f.plan,f.taskId,s,{...input,changes:[input.changes[0],input.changes[0]]}),changesRefusal);
});
test('patch digest, unique old anchors, overlap, no-op and introduced anchors remain mandatory',async()=>{
 for(const mode of ['hash','missing','ambiguous','overlap','noop','introduced']){const f=fixture();if(mode==='ambiguous')f.files.set('src/app.mjs','value = 1; value = 1;');const s=await f.load(),p=f.patch(),c=p.changes[0]!;if(mode==='hash')c.sourceSha256='f'.repeat(64);if(mode==='missing')c.edits[0]!.before='not present';if(mode==='overlap')c.edits.push({before:'= 1;',after:'= 3;'});if(mode==='noop')c.edits[0]!.after=c.edits[0]!.before;if(mode==='introduced')c.edits.push({before:'value = 2',after:'value = 3'});await assert.rejects(()=>prepareProjectChanges(f.plan,f.taskId,s,p),changesRefusal);assert.equal(projectSnapshotSources(s).get('src/app.mjs'),f.files.get('src/app.mjs'));}
});
test('foreign paths, protected test configuration, secret output and changed-character limits refuse',async()=>{
 for(const mode of ['foreign','config','secret','budget','utf8']){const f=fixture(mode==='config'),s=await f.load(),p:any=f.patch();if(mode==='foreign')p.changes[0].path='.github/workflows/change.yml';if(mode==='config')p.changes=[{operation:'patch',path:'vitest.config.ts',sourceSha256:hash(f.files.get('vitest.config.ts')!),edits:[{before:'Notes',after:'Changed'}],message:'Change test configuration.'}];if(mode==='secret')p.changes[0].edits[0].after="value = 'gsk_"+'a'.repeat(32)+"'";if(mode==='budget')p.changes[0].edits[0].after='x'.repeat(6001);if(mode==='utf8')p.changes[0].edits[0].after='value = "'+String.fromCharCode(0xd800)+'"';await assert.rejects(()=>prepareProjectChanges(f.plan,f.taskId,s,p),changesRefusal);}
});
test('proposal getters refuse without evaluation and caller mutation cannot change prepared bytes',async()=>{
 const f=fixture(),s=await f.load();let reads=0;const bad:any=f.patch();Object.defineProperty(bad,'summary',{enumerable:true,get(){reads++;return 'PRIVATE_SUMMARY';}});await assert.rejects(()=>prepareProjectChanges(f.plan,f.taskId,s,bad),changesRefusal);assert.equal(reads,0);
 const input=f.patch(),pending=prepareProjectChanges(f.plan,f.taskId,s,input);input.changes[0]!.edits[0]!.after='value = 99';const c=await pending;assert.ok(projectChangesFiles(c)[0]!.content.includes('value = 2'));assert.equal(projectChangesFiles(c)[0]!.content.includes('value = 99'),false);
});
test('stale source invalidates proposal validation and previously prepared private output',async()=>{
 const f=fixture(),s=await f.load(),c=await prepareProjectChanges(f.plan,f.taskId,s,f.patch());f.state.root='f'.repeat(40);await assert.rejects(()=>verifyProjectChanges(c),changesRefusal);assert.throws(()=>projectChangesFiles(c),changesRefusal);await assert.rejects(()=>prepareProjectChanges(f.plan,f.taskId,s,f.patch()),changesRefusal);
});
