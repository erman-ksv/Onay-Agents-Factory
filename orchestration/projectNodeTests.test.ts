import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {createProjectTargetRegistry} from './projectTargetRegistry.js';
import {prepareProjectGoal,createProjectPlan,projectPlanTaskId} from './projectPlan.js';
import {loadProjectTaskSnapshot,type ProjectSnapshotReader} from '../github/projectSourceSnapshot.js';
import {prepareProjectChanges} from '../commander/projectChanges.js';
import {prepareProjectNodeTestPolicy,createProjectNodeSandbox,createProjectNodeSandboxForTests,verifyProjectNodeTestReceipt,PROJECT_NODE_TEST_ERROR,type ProjectNodeTestPolicy} from './projectNodeTests.js';
import type {CalculatorSandboxProcess} from './calculatorSandbox.js';
const image='node@sha256:'+'1'.repeat(64),hash=(s:string)=>createHash('sha256').update(s).digest('hex'),blob=(s:string)=>createHash('sha1').update(Buffer.from('blob '+Buffer.byteLength(s)+'\0'+s)).digest('hex');
const refusal=(e:unknown)=>e instanceof Error&&e.message===PROJECT_NODE_TEST_ERROR;
async function fixture(){
 const files=new Map([['src/note.mjs','export function note(value) { return value; } // PRIVATE_MARKER\n'],['src/dependency.mjs','export const helper = 1;\n']]);
 const target=createProjectTargetRegistry([{version:1,id:'note-tests',repository:'example/note-tests',writablePaths:[...files.keys()],branchPrefix:'feat/note-agent/',requiredCiNames:['Notes CI'],requiredCiSteps:['Syntax','Task tests'],requiredActors:['security','reviewer','tester'],maxFiles:2,maxSourceBytes:8192,maxNewFileBytes:4096,maxChangedCharacters:1024,maxReviewBytes:12000,legalEnabled:false,mergesEnabled:false}]).select('note-tests');
 const goal=prepareProjectGoal(target,{version:1,id:'note-host-tests',goal:'Provide a small note conversion function.',baseRef:'feat/bootstrap',baseSha:'a'.repeat(40),provider:'groq',acceptance:[{id:'note-value',scenario:'The note function returns the requested value.'}],requiredPaths:[...files.keys()]}),taskId=projectPlanTaskId(goal,1),plan=createProjectPlan(goal,{tasks:[{id:taskId,role:'coder',goal:'Return the requested note with a prefix.',acceptanceIds:['note-value'],paths:[...files.keys()],dependsOn:[]}],blockers:[],unverifiedAreas:[]});
 const state={head:plan.request.baseSha};const reader:ProjectSnapshotReader={getHead:async()=>state.head,readCommit:async sha=>({sha,treeSha:'b'.repeat(40),parents:[]}),readTree:async sha=>({sha,truncated:false,tree:[{path:'src',sha:'c'.repeat(40),type:'tree',mode:'040000'},...[...files].map(([path,s])=>({path,sha:blob(s),type:'blob',mode:'100644',size:Buffer.byteLength(s)}))]}),readBlob:async sha=>({sha,encoding:'base64',content:Buffer.from([...files].find(([,s])=>blob(s)===sha)![1]).toString('base64')})};
 const snapshot=await loadProjectTaskSnapshot(plan,taskId,reader),input={summary:'Prefix the requested note.',changes:[{operation:'patch',path:'src/note.mjs',sourceSha256:hash(files.get('src/note.mjs')!),edits:[{before:'return value;',after:'return "Note: " + value;'}],message:'Prefix notes.'}]},changes=await prepareProjectChanges(plan,taskId,snapshot,input);
 const policyInput={image,checks:[{id:'contract-note',path:'src/note.mjs',exportName:'note',args:['hello'],expected:'Note: hello',acceptanceIds:['note-value']}]},policy=prepareProjectNodeTestPolicy(plan,taskId,policyInput);
 return{files,plan,taskId,state,snapshot,changes,input,policyInput,policy};
}
function processFixture(policy:ProjectNodeTestPolicy,mode='pass',onRun?:()=>void){
 const calls:readonly string[][]=[] as unknown as string[][],directories:string[]=[],manifests:any[]=[],contents=new Map<string,string>();
 const runner:CalculatorSandboxProcess=async(args,options)=>{
  (calls as string[][]).push([...args]);assert.deepEqual(Object.keys(options.env),['PATH']);assert.equal(options.timeoutMs,30000);assert.equal(options.maxOutputBytes,32768);
  const result=(code:number,stdout:string,timedOut=false)=>({code,stdout,stderr:'PRIVATE_DIAGNOSTIC_MUST_NOT_LEAK',timedOut});
  if(args.includes('info')){if(mode==='unavailable')throw Error('PRIVATE_DOCKER_ERROR');return result(0,'28.0.0');}
  if(args.includes('inspect'))return result(0,JSON.stringify([mode==='wrong-image'?'node@sha256:'+'2'.repeat(64):image]));
  if(args.includes('rm'))return result(0,'');
  for(const flag of ['--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=32','--memory=256m','--cpus=1','--env=NODE_OPTIONS='])assert.ok(args.includes(flag));
  assert.ok(!args.some(a=>/--privileged|--no-sandbox|--network=host|--env-file/.test(a)));
  if(args.includes('--version'))return result(0,mode==='old-node'?'v20.0.0':'v24.0.0');
  const mount=(dst:string)=>args.find(a=>a.startsWith('--mount=type=bind,src=')&&a.endsWith(',dst='+dst+',readonly'))!.slice('--mount=type=bind,src='.length).split(',dst=')[0]!;
  const app=mount('/app'),manifest=mount('/manifest.json');directories.push(app);const data=JSON.parse(readFileSync(manifest,'utf8'));manifests.push(data);for(const path of data.paths)contents.set(path,readFileSync(app+'/'+path,'utf8'));
  const harness=readFileSync(mount('/harness.mjs'),'utf8');assert.ok(harness.includes('--permission'));assert.ok(harness.includes('isDeepStrictEqual(actual.value,check.expected)'));assert.ok(!harness.includes('input.expected'));onRun?.();
  if(mode==='throw')throw Error('PRIVATE_RUN_ERROR');if(mode==='timeout')return result(0,'',true);if(mode==='oversized')return result(0,'x'.repeat(32769));if(mode==='malformed')return result(0,'not JSON');
  const v:any={version:1,status:mode==='failed'?'failed':'passed',checks:policy.checkIds,failures:mode==='failed'?['contract:contract-note']:[]};if(mode==='false-pass')v.failures=['contract:contract-note'];if(mode==='extra')v.testsExecuted=true;if(mode==='fake-checks')v.checks=['syntax'];if(mode==='unknown-failure'){v.status='failed';v.failures=['RAW_PRIVATE_SOURCE'];}if(mode==='duplicate-failure'){v.status='failed';v.failures=['contract:contract-note','contract:contract-note'];}
  return result(['failed','unknown-failure','duplicate-failure'].includes(mode)?1:0,JSON.stringify(v));
 };
 return{runner,calls,directories,manifests,contents};
}
test('host policy covers exact task criteria and never exposes expected answers as default metadata',async()=>{
 const f=await fixture();assert.equal(JSON.stringify(f.policy).includes('Note: hello'),false);assert.equal(f.policy.planFingerprint,f.plan.fingerprint);assert.deepEqual(f.policy.checkIds,['syntax','contract-note']);assert.throws(()=>createProjectNodeSandbox({...f.policy}),refusal);assert.throws(()=>createProjectNodeSandboxForTests({...f.policy},async()=>({code:0,stdout:'',stderr:''})),refusal);
});
test('policy refuses getters, model commands, moving images, unknown scope and missing criterion coverage',async()=>{
 const f=await fixture();let reads=0;const getter=Object.defineProperty({},'image',{enumerable:true,get(){reads++;return image;}});assert.throws(()=>prepareProjectNodeTestPolicy(f.plan,f.taskId,getter),refusal);assert.equal(reads,0);
 for(const mode of ['image','path','scope','command','criteria','duplicate','export']){const v=structuredClone(f.policyInput) as any;if(mode==='image')v.image='node:latest';if(mode==='path')v.checks[0].path='../escape.mjs';if(mode==='scope')v.checks[0].path='src/unknown.mjs';if(mode==='command')v.command='true';if(mode==='criteria')v.checks[0].acceptanceIds=[];if(mode==='duplicate')v.checks.push(v.checks[0]);if(mode==='export')v.checks[0].exportName='evil()';assert.throws(()=>prepareProjectNodeTestPolicy(f.plan,f.taskId,v),refusal);}
});
test('immutable policy and exact overlay include unchanged required dependencies in the file digest',async()=>{
 const f=await fixture(),r=processFixture(f.policy);f.policyInput.checks[0]!.expected='MUTATED';const receipt=await createProjectNodeSandboxForTests(f.policy,r.runner).run(f.snapshot,f.changes);assert.equal(receipt.status,'passed');assert.equal(receipt.testsExecuted,true);assert.equal(receipt.provenance,'simulated');assert.equal(r.manifests[0].checks[0].expected,'Note: hello');assert.ok(r.contents.get('src/note.mjs')!.includes('return "Note: " + value;'));assert.equal(r.contents.get('src/dependency.mjs'),f.files.get('src/dependency.mjs'));assert.equal(receipt.fileSetSha256,hash(JSON.stringify([...r.contents].sort(([a],[b])=>a.localeCompare(b)).map(([path,s])=>({path,sha256:hash(s),bytes:Buffer.byteLength(s)})))));assert.equal(JSON.stringify(receipt).includes('PRIVATE_MARKER'),false);assert.equal(receipt.publicationAuthorized,false);assert.equal(receipt.wholeAppCompleted,false);assert.ok(r.directories.every(d=>!existsSync(d)));assert.ok(r.calls.some(a=>a.includes('rm')));
});
test('perfect simulated output and copied metadata can never approve real host tests',async()=>{
 const f=await fixture(),r=processFixture(f.policy),receipt=await createProjectNodeSandboxForTests(f.policy,r.runner).run(f.snapshot,f.changes);for(const value of [receipt,{...receipt,provenance:'native-docker' as const}])await assert.rejects(()=>verifyProjectNodeTestReceipt(value,f.plan,f.taskId,f.snapshot,f.changes,f.policy),refusal);
});
test('executed failed check remains failed with source-free diagnostics and no publication',async()=>{
 const f=await fixture(),r=processFixture(f.policy,'failed'),receipt=await createProjectNodeSandboxForTests(f.policy,r.runner).run(f.snapshot,f.changes);assert.equal(receipt.status,'failed');assert.equal(receipt.testsExecuted,true);assert.deepEqual(receipt.failures,['contract:contract-note']);assert.equal(JSON.stringify(receipt).includes('PRIVATE'),false);assert.equal(receipt.publicationAuthorized,false);
});
test('unavailable isolation or pinned runtime returns unverified without host execution fallback',async()=>{
 for(const mode of ['unavailable','wrong-image','old-node']){const f=await fixture(),r=processFixture(f.policy,mode),receipt=await createProjectNodeSandboxForTests(f.policy,r.runner).run(f.snapshot,f.changes);assert.equal(receipt.status,'unverified');assert.equal(receipt.testsExecuted,false);assert.equal(r.directories.length,0);assert.equal(r.calls.some(a=>a.includes('/harness.mjs')),false);assert.equal(JSON.stringify(receipt).includes('PRIVATE'),false);}
});
test('inconsistent, malformed, oversized, timed-out or thrown process output never passes',async()=>{
 for(const mode of ['false-pass','extra','fake-checks','unknown-failure','duplicate-failure','malformed','oversized','timeout','throw']){const f=await fixture(),r=processFixture(f.policy,mode),receipt=await createProjectNodeSandboxForTests(f.policy,r.runner).run(f.snapshot,f.changes);assert.equal(receipt.status,'unverified',mode);assert.equal(receipt.testsExecuted,false);assert.equal(JSON.stringify(receipt).includes('PRIVATE'),false);assert.ok(r.directories.every(d=>!existsSync(d)));assert.ok(r.calls.some(a=>a.includes('rm')));}
});
test('source movement during execution invalidates an otherwise passing result',async()=>{
 const f=await fixture(),r=processFixture(f.policy,'pass',()=>{f.state.head='d'.repeat(40);}),receipt=await createProjectNodeSandboxForTests(f.policy,r.runner).run(f.snapshot,f.changes);assert.equal(receipt.status,'unverified');assert.equal(receipt.testsExecuted,false);assert.ok(r.directories.every(d=>!existsSync(d)));
});
test('foreign or copied source/proposal cannot reach Docker or reflect source in metadata',async()=>{
 const f=await fixture(),r=processFixture(f.policy);await assert.rejects(()=>createProjectNodeSandboxForTests(f.policy,r.runner).run({...f.snapshot},f.changes),refusal);await assert.rejects(()=>createProjectNodeSandboxForTests(f.policy,r.runner).run(f.snapshot,{...f.changes,digest:'PRIVATE_SOURCE'}),refusal);assert.equal(r.calls.length,0);
});
test('one-shot sandbox cannot replay even after unavailable isolation',async()=>{
 const f=await fixture(),r=processFixture(f.policy,'unavailable'),sandbox=createProjectNodeSandboxForTests(f.policy,r.runner);await sandbox.run(f.snapshot,f.changes);const count=r.calls.length;await assert.rejects(()=>sandbox.run(f.snapshot,f.changes),refusal);assert.equal(r.calls.length,count);
});
