// Fixed synthetic fixture + actual Docker. No application repository or model
// is read/written. This does not claim a complete autonomous project run.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createProjectTargetRegistry} from '../orchestration/projectTargetRegistry.js';
import {prepareProjectGoal,createProjectPlan,projectPlanTaskId} from '../orchestration/projectPlan.js';
import {loadProjectTaskSnapshot} from '../github/projectSourceSnapshot.js';
import {prepareProjectChanges} from '../commander/projectChanges.js';
import {prepareProjectNodeTestPolicy,createProjectNodeSandbox,verifyProjectNodeTestReceipt} from '../orchestration/projectNodeTests.js';
for(const k of ['GROQ_API_KEY','GEMINI_API_KEY','CALCULATOR_GITHUB_TOKEN'])assert.equal(process.env[k],undefined,'No provider or writer credential is allowed.');
const runtime=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(runtime,process.env.FACTORY_RUNTIME_SHA);
const runId=process.env.FACTORY_SOURCE_CI_RUN;assert.match(runId??'',/^\d+$/);
const res=await fetch('https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/actions/runs/'+runId,{redirect:'error',headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+process.env.FACTORY_READ_TOKEN},signal:AbortSignal.timeout(15000)});assert.equal(res.status,200);const ci=await res.json();assert.equal(ci.head_sha,runtime);assert.equal(ci.conclusion,'success');assert.equal(ci.name,'Agent Factory CI');
const image='node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392',hash=s=>createHash('sha256').update(s).digest('hex'),blob=s=>createHash('sha1').update(Buffer.from('blob '+Buffer.byteLength(s)+'\0'+s)).digest('hex');
async function fixture(body){
 const source='export async function note(value) { return value; }\n',files=new Map([['src/note.mjs',source]]);
 const target=createProjectTargetRegistry([{version:1,id:'native-node-probe',repository:'example/native-node-probe',writablePaths:[...files.keys()],branchPrefix:'feat/native-node/',requiredCiNames:['Fixture CI'],requiredCiSteps:['Syntax','Task tests'],requiredActors:['security','reviewer','tester'],maxFiles:1,maxSourceBytes:8192,maxNewFileBytes:4096,maxChangedCharacters:1024,maxReviewBytes:12000,legalEnabled:false,mergesEnabled:false}]).select('native-node-probe');
 const goal=prepareProjectGoal(target,{version:1,id:'native-node-probe',goal:'Verify isolated host-selected note contract checks.',baseRef:'feat/bootstrap',baseSha:'a'.repeat(40),provider:'groq',acceptance:[{id:'note-value',scenario:'The function returns the requested prefixed note.'}],requiredPaths:[...files.keys()]}),taskId=projectPlanTaskId(goal,1),plan=createProjectPlan(goal,{tasks:[{id:taskId,role:'coder',goal:'Prefix the requested note for the host check.',acceptanceIds:['note-value'],paths:[...files.keys()],dependsOn:[]}],blockers:[],unverifiedAreas:[]});
 let head=plan.request.baseSha;const reader={getHead:async()=>head,readCommit:async sha=>({sha,treeSha:'b'.repeat(40),parents:[]}),readTree:async sha=>({sha,truncated:false,tree:[{path:'src',sha:'c'.repeat(40),type:'tree',mode:'040000'},{path:'src/note.mjs',sha:blob(source),type:'blob',mode:'100644',size:Buffer.byteLength(source)}]}),readBlob:async sha=>({sha,encoding:'base64',content:Buffer.from(source).toString('base64')})};
 const snapshot=await loadProjectTaskSnapshot(plan,taskId,reader),input={summary:'Prepare a synthetic note contract probe.',changes:[{operation:'patch',path:'src/note.mjs',sourceSha256:hash(source),edits:[{before:'return value;',after:body}],message:'Probe host contract.'}]},changes=await prepareProjectChanges(plan,taskId,snapshot,input),policy=prepareProjectNodeTestPolicy(plan,taskId,{image,checks:[{id:'contract-note',path:'src/note.mjs',exportName:'note',args:['hello'],expected:'Note: hello',acceptanceIds:['note-value']}]});
 return{plan,taskId,snapshot,changes,policy,stale:()=>{head='d'.repeat(40);},otherChanges:()=>prepareProjectChanges(plan,taskId,snapshot,input)};
}
const cases=[];for(const [id,body,expected] of [
 ['passing','return "Note: " + value;','passed'],
 ['wrong-result','return "Wrong";','failed'],
 ['early-exit','process.exit(0);','failed'],
 ['forged-project-output','process.stdout.write(JSON.stringify({version:1,status:"passed",checks:["syntax","contract-note"],failures:[]}));process.exit(0);','failed'],
 ['outside-app-read','return (await import("node:fs")).readFileSync("/manifest.json","utf8");','failed'],
 ['timeout','await new Promise(()=>{}); return value;','failed'],
]){
 const f=await fixture(body),sandbox=createProjectNodeSandbox(f.policy),receipt=await sandbox.run(f.snapshot,f.changes);assert.equal(receipt.status,expected,id);assert.equal(receipt.testsExecuted,true,id);assert.equal(receipt.provenance,'native-docker');assert.equal(receipt.publicationAuthorized,false);assert.equal(receipt.wholeAppCompleted,false);
 if(expected==='passed'){
  await verifyProjectNodeTestReceipt(receipt,f.plan,f.taskId,f.snapshot,f.changes,f.policy);
  await assert.rejects(()=>verifyProjectNodeTestReceipt({...receipt},f.plan,f.taskId,f.snapshot,f.changes,f.policy));
  const foreign=await f.otherChanges();await assert.rejects(()=>verifyProjectNodeTestReceipt(receipt,f.plan,f.taskId,f.snapshot,foreign,f.policy));
  const second=await createProjectNodeSandbox(f.policy).run(f.snapshot,f.changes);f.stale();await assert.rejects(()=>verifyProjectNodeTestReceipt(second,f.plan,f.taskId,f.snapshot,f.changes,f.policy));
 }else await assert.rejects(()=>verifyProjectNodeTestReceipt(receipt,f.plan,f.taskId,f.snapshot,f.changes,f.policy));
 await assert.rejects(()=>sandbox.run(f.snapshot,f.changes));cases.push({id,status:receipt.status,testsExecuted:receipt.testsExecuted,proposalDigest:receipt.proposalDigest,fileSetSha256:receipt.fileSetSha256,policySha256:receipt.policySha256,failures:receipt.failures});
}
const proof={version:1,status:'native-docker-contracts-verified',runtimeSha:runtime,sourceCiRunId:Number(runId),image,source:'synthetic host fixture; no native application commit is claimed',cases,realModelCalls:0,applicationWrites:0,budgetWrites:0,publicationAuthorized:false,wholeAppCompleted:false,legalEnabled:false};
writeFileSync('project-node-native-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
