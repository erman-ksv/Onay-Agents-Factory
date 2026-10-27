import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createProjectNextWorkerFixtureForTests} from '../config/fixtures/projectNextWorkerFixture.js';
import {registeredProjectTargetProfile} from './projectTargetRegistry.js';
import {prepareProjectRuntimeManifest,projectRuntimeManifestMetadata,bootstrapProjectRuntime,PROJECT_RUNTIME_MANIFEST_ERROR} from './projectRuntimeManifest.js';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex'),stopped=(e:unknown)=>e instanceof Error&&e.message===PROJECT_RUNTIME_MANIFEST_ERROR;
async function fixture(){const f=await createProjectNextWorkerFixtureForTests();const {sha256,...profile}=registeredProjectTargetProfile(f.target),identity=f.controller.identity;
 const v={version:1,profile,goal:f.plan.request,proposal:{tasks:f.plan.tasks,blockers:[],unverifiedAreas:[]},history:{version:1,projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,observations:['planning',...identity.taskIds].map(scopeId=>({scopeId,kind:'cumulative-scope-total',charge:{requests:0,requestBytes:0,reservedTokens:0},evidenceSha256:'c'.repeat(64)}))},decision:{issueNumber:75,commentId:321,bodySha256:f.controller.approvalBodySha256},workflowPins:f.ciPolicy.workflowPins,taskPolicies:f.plan.tasks.map(t=>({taskId:t.id,node:{image:f.nodePolicy.image,checks:[{id:'contract-note',path:'src/note.mjs',exportName:'note',args:[],expected:2,acceptanceIds:['note-value']}]},authorSelections:[{path:'src/note.mjs',version:'base',start:25,end:34}],reviewSelections:[{path:'src/note.mjs',version:'proposed',start:25,end:36}]})),archivePin:{head:'a'.repeat(40),sequence:1},candidateSha:f.candidate.candidateSha};
 return {...f,v,prepare:(input:unknown=v)=>{const body=JSON.stringify(input);return prepareProjectRuntimeManifest(body,digest(body));}};
}
test('pinned host manifest recreates the exact plan identity and policies without executing models',async()=>{
 const f=await fixture();try{const before=f.calls(),metadata=projectRuntimeManifestMetadata(f.prepare());assert.equal(metadata.planFingerprint,f.plan.fingerprint);assert.equal(metadata.repository,f.repo);assert.equal(metadata.targetProfileSha256,f.plan.targetProfileSha256);assert.deepEqual(metadata.taskIds,f.plan.tasks.map(t=>t.id));assert.equal(metadata.executionAuthorized,false);assert.equal(f.calls(),before);assert.equal(JSON.stringify(metadata).includes('PRIVATE_SOURCE_MARKER'),false);}finally{f.cleanup();}
});
test('digest from trusted host rejects changed/oversized/invalid manifest and copied capability',async()=>{
 const f=await fixture();try{const body=JSON.stringify(f.v);for(const input of [body+' ',body.replace('publish-notes','changed-notes'),'x'.repeat(65537),'null'])assert.throws(()=>prepareProjectRuntimeManifest(input,digest(body)),stopped);assert.throws(()=>projectRuntimeManifestMetadata({...f.prepare()}),stopped);await assert.rejects(()=>bootstrapProjectRuntime({...f.prepare()},{},f.root),stopped);assert.equal(f.calls(),0);}finally{f.cleanup();}
});
test('missing complete history, pin or mandatory Security role cannot prepare a runtime',async()=>{
 const f=await fixture();try{
  for(const change of [{history:{...f.v.history,observations:f.v.history.observations.slice(1)}},{archivePin:null},{profile:{...f.v.profile,requiredActors:['reviewer','tester']}},{profile:{...f.v.profile,legalEnabled:true}},{source:'PRIVATE_SOURCE_MARKER'}])assert.throws(()=>f.prepare({...f.v,...change}),stopped);
  assert.equal(f.calls(),0);
 }finally{f.cleanup();}
});
test('every task needs host policy and bounded task-owned source selections',async()=>{
 const f=await fixture();try{const p=f.v.taskPolicies[0]!;
  for(const taskPolicies of [[],[p,p],[{...p,authorSelections:[{path:'outside/private.ts',version:'base',start:0,end:1}]},f.v.taskPolicies[1]],[{...p,reviewSelections:[{path:'src/note.mjs',version:'proposed',start:0,end:4096}]},f.v.taskPolicies[1]],[{...p,node:{...p.node,image:'node:latest'}},f.v.taskPolicies[1]]])assert.throws(()=>f.prepare({...f.v,taskPolicies}),stopped);
  assert.equal(f.calls(),0);
 }finally{f.cleanup();}
});
test('native bootstrap refuses missing explicit free/legal configuration and cannot reuse a consumed manifest',async()=>{
 const f=await fixture();try{const cap=f.prepare();await assert.rejects(()=>bootstrapProjectRuntime(cap,{},f.root),stopped);await assert.rejects(()=>bootstrapProjectRuntime(cap,{AGENT_FACTORY_LEGAL_ENABLED:'false',ONAY_TEAM_FREE_TIER_CONFIRMED:'true'},f.root),stopped);assert.equal(f.calls(),0);assert.equal((await f.controller.inspect()).used.requests,4);}finally{f.cleanup();}
});
