import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createProjectTargetRegistry,assertProjectTargetScope,registeredProjectTargetProfile} from './projectTargetRegistry.js';
import {prepareProjectGoal,createProjectPlan,projectPlanTaskId} from './projectPlan.js';
import {loadProjectTaskSnapshot,projectSnapshotSources,type ProjectSnapshotReader} from '../github/projectSourceSnapshot.js';
import {prepareProjectChanges} from '../commander/projectChanges.js';
import {prepareProjectModelContext,projectContextRequestBody} from './projectModelContext.js';
import {prepareProjectNodeTestPolicy} from './projectNodeTests.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),blob=(s:string)=>createHash('sha1').update(Buffer.from('blob '+Buffer.byteLength(s)+'\0'+s)).digest('hex');
async function fixture(missing=false){
 const files=new Map([['src/app.mjs','export const value = 0; // selected writable source\n'],['src/core.mjs','export const helper = 2; // PRIVATE_READ_ONLY_SOURCE\n']]);
 const definition={version:1 as const,id:'readonly-fixture',repository:'example/readonly-fixture',writablePaths:['src/app.mjs'],readOnlyPaths:['src/core.mjs'],branchPrefix:'feat/readonly-fixture/',requiredCiNames:['Fixture CI'],requiredCiSteps:['Syntax','Task tests'],requiredActors:['security','reviewer','tester'],maxFiles:1,maxSourceBytes:8192,maxNewFileBytes:4096,maxChangedCharacters:1024,maxReviewBytes:12000,legalEnabled:false as const,mergesEnabled:false as const},target=createProjectTargetRegistry([definition]).select(definition.id);
 const input={version:1 as const,id:'readonly-scope',goal:'Read the helper without granting authority to change it.',baseRef:'feat/bootstrap',baseSha:'a'.repeat(40),provider:'groq',acceptance:[{id:'value-result',scenario:'The selected source uses the verified read-only helper.'}],requiredPaths:['src/app.mjs'],readOnlyPaths:['src/core.mjs']},goal=prepareProjectGoal(target,input),taskId=projectPlanTaskId(goal,1),proposal={tasks:[{id:taskId,role:'coder',goal:'Update only the selected writable application file.',paths:['src/app.mjs'],acceptanceIds:['value-result'],dependsOn:[]}],blockers:[],unverifiedAreas:[]},plan=createProjectPlan(goal,proposal);
 const reader:ProjectSnapshotReader={getHead:async()=>input.baseSha,readCommit:async sha=>({sha,treeSha:'b'.repeat(40),parents:[]}),readTree:async sha=>({sha,truncated:false,tree:[{path:'src',type:'tree',mode:'040000',sha:'c'.repeat(40)},...[...files].filter(([p])=>!missing||p!=='src/core.mjs').map(([path,s])=>({path,type:'blob',mode:'100644',sha:blob(s),size:Buffer.byteLength(s)}))]}),readBlob:async sha=>({sha,encoding:'base64',content:Buffer.from([...files].find(([,s])=>blob(s)===sha)![1]).toString('base64')})};
 return {files,target,definition,input,goal,proposal,plan,taskId,load:()=>loadProjectTaskSnapshot(plan,taskId,reader)};
}
test('explicit read dependencies are loaded and SHA verified without entering writable paths',async()=>{
 const f=await fixture(),snapshot=await f.load();assert.deepEqual(snapshot.changePaths,['src/app.mjs']);assert.equal(projectSnapshotSources(snapshot).get('src/core.mjs'),f.files.get('src/core.mjs'));assert.equal(snapshot.files.find(v=>v.path==='src/core.mjs')?.readOnly,true);assert.equal(f.plan.status,'planned');assert.throws(()=>assertProjectTargetScope(f.target,{repository:f.plan.repository,branch:f.plan.branch,changePaths:['src/core.mjs']}));const policy=prepareProjectNodeTestPolicy(f.plan,f.taskId,{image:'node@sha256:'+'1'.repeat(64),checks:[{id:'contract-helper',path:'src/core.mjs',exportName:'helper',args:[],expected:2,acceptanceIds:['value-result']}]});assert.equal(policy.taskId,f.taskId);
});
test('a model cannot patch a loaded read-only dependency',async()=>{
 const f=await fixture(),snapshot=await f.load();await assert.rejects(()=>prepareProjectChanges(f.plan,f.taskId,snapshot,{summary:'Unauthorized dependency write attempt.',changes:[{operation:'patch',path:'src/core.mjs',sourceSha256:hash(f.files.get('src/core.mjs')!),edits:[{before:'helper = 2',after:'helper = 3'}],message:'Must be refused.'}]}));
});
test('source excerpts identify read-only scope and keep full dependency content out of model context',async()=>{
 const f=await fixture(),snapshot=await f.load(),packet=await prepareProjectModelContext(f.plan,f.taskId,snapshot,{role:'author',model:'qwen/qwen3-32b',selections:[{path:'src/app.mjs',version:'base',start:20,end:21},{path:'src/core.mjs',version:'base',start:20,end:21}]}),body=projectContextRequestBody(packet);assert.ok(body.includes('readOnlyPaths'));assert.ok(body.includes('sourceSha256'));assert.equal(body.includes('PRIVATE_READ_ONLY_SOURCE'),false);
});
test('missing dependency or adding read scope outside the host profile fails closed',async()=>{
 const missing=await fixture(true);await assert.rejects(()=>missing.load());const f=await fixture();assert.throws(()=>prepareProjectGoal(f.target,{...f.input,readOnlyPaths:['src/unknown.mjs']}));assert.throws(()=>createProjectTargetRegistry([{...f.definition,readOnlyPaths:['src/app.mjs']}]));assert.throws(()=>createProjectTargetRegistry([{...f.definition,readOnlyPaths:['.env']}]));
});
test('read scope is part of owner/profile fingerprints and cannot be assigned as a writable task',async()=>{
 const f=await fixture();assert.throws(()=>createProjectPlan(f.goal,{...f.proposal,tasks:[{...f.proposal.tasks[0],paths:['src/core.mjs']}]}));const {sha256,...d}=registeredProjectTargetProfile(f.target),{readOnlyPaths,...without}=d,other=createProjectTargetRegistry([without]).select(d.id);assert.notEqual(registeredProjectTargetProfile(other).sha256,sha256);const {readOnlyPaths:omitted,...goalInput}=f.input;assert.notEqual(prepareProjectGoal(f.target,goalInput).ownerFingerprint,f.goal.ownerFingerprint);
});
