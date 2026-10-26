// Fixed host audit: four distinct processes, mocked model/owner, actual Docker.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {createProjectTargetRegistry} from '../orchestration/projectTargetRegistry.js';
import {prepareProjectGoal,createProjectPlan,projectPlanTaskId,projectPlanBudgetIdentity} from '../orchestration/projectPlan.js';
import {loadProjectTaskSnapshot,createProjectSnapshotSourceGuard} from '../github/projectSourceSnapshot.js';
import {createProjectModelBudgetFileStore} from '../orchestration/projectModelBudgetFileStore.js';
import {authorizeProjectBudget,reconcileProjectBudgetHistory,projectBudgetApprovalDigest} from '../orchestration/projectBudgetAuthorization.js';
import {createProjectExecutionAdmission} from '../orchestration/projectExecutionAdmission.js';
import {prepareProjectModelContext,prepareProjectReplyChanges,prepareProjectReplyAssessment,prepareProjectCorrectionContext,createContextBoundProjectTransport} from '../orchestration/projectModelContext.js';
import {prepareProjectNodeTestPolicy,createProjectNodeSandbox} from '../orchestration/projectNodeTests.js';
import {createProjectCorrectionRecoveryKey,saveProjectCorrectionCheckpoint,restoreProjectCorrectionCheckpoint} from '../orchestration/projectCorrectionCheckpoint.js';
for(const k of ['GROQ_API_KEY','GEMINI_API_KEY','CALCULATOR_GITHUB_TOKEN'])assert.equal(process.env[k],undefined,'No actual provider/writer secret.');
const mode=process.argv[2];
if(!mode){
 const runtime=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(runtime,process.env.FACTORY_RUNTIME_SHA);assert.match(process.env.FACTORY_SOURCE_CI_RUN??'',/^\d+$/);
 const response=await fetch('https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/actions/runs/'+process.env.FACTORY_SOURCE_CI_RUN,{redirect:'error',headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+process.env.FACTORY_READ_TOKEN},signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);const ci=await response.json();assert.equal(ci.head_sha,runtime);assert.equal(ci.conclusion,'success');assert.equal(ci.name,'Agent Factory CI');
 const directory=mkdtempSync(join(tmpdir(),'encrypted-correction-audit-'));
 try{
  mkdirSync(join(directory,'ledger'),{mode:0o700});writeFileSync(join(directory,'host-key.fixture'),randomBytes(32),{mode:0o600,flag:'wx'});
  const workers=[];for(const stage of ['save','tamper','resume','blocked']){
   const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),stage,directory],{encoding:'utf8',timeout:120000,maxBuffer:32768,env:{PATH:process.env.PATH??'/usr/bin:/bin'}});
   if(result.status!==0||result.error)throw Error('Fixed recovery audit worker failed: '+stage);workers.push(JSON.parse(result.stdout));
  }
  assert.deepEqual(workers.map(w=>w.usedRequests),[4,4,8,8]);assert.equal(workers[0].savedRequestSha256,workers[2].restoredRequestSha256);assert.equal(new Set(workers.map(w=>w.policySha256)).size,1);assert.equal(workers[1].tamperRejected,true);assert.equal(workers[1].wrongKeyRejected,true);assert.equal(workers[3].replayStoppedBeforeModel,true);assert.equal(workers.reduce((n,w)=>n+w.mockedModelCalls,0),8);const encrypted=readFileSync(join(directory,'correction.checkpoint'));
  for(const marker of ['HOST_FIXTURE_PRIVATE','return 1;','proposalInput'])assert.equal(encrypted.toString('utf8').includes(marker),false);
  const proof={version:1,status:'encrypted-correction-cross-process-recovery-verified',runtimeSha:runtime,sourceCiRunId:Number(process.env.FACTORY_SOURCE_CI_RUN),workers,distinctHostProcesses:4,modelAndOwner:'synthetic/mocked, no real owner allowance',actualDockerChecks:2,encryption:'AES-256-GCM; ephemeral fixture key kept outside checkpoint and app',checkpointBytes:encrypted.length,scope:'before-correction-admission; same runner filesystem, not a native cross-machine deployment',actualModelCalls:0,realBudgetWrites:0,applicationWrites:0,productionRecoveryKeyProvisioned:false,publicationAuthorized:false,wholeAppCompleted:false,legalEnabled:false};writeFileSync('project-node-native-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
 }finally{rmSync(directory,{recursive:true,force:true});}
}else{
 const directory=process.argv[3];
const hash=s=>createHash('sha256').update(s).digest('hex'),blob=s=>createHash('sha1').update(Buffer.from('blob '+Buffer.byteLength(s)+'\0'+s)).digest('hex'),image='node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392';
const source='export function note() { return 0; } // HOST_FIXTURE_PRIVATE_FULL_SOURCE_NOT_FOR_MODEL\n',path='src/note.mjs';
const target=createProjectTargetRegistry([{version:1,id:'correction-probe',repository:'example/correction-probe',writablePaths:[path],branchPrefix:'feat/correction-probe/',requiredCiNames:['Fixture CI'],requiredCiSteps:['Syntax','Task tests'],requiredActors:['security','reviewer','tester'],maxFiles:1,maxSourceBytes:8192,maxNewFileBytes:4096,maxChangedCharacters:1024,maxReviewBytes:12000,legalEnabled:false,mergesEnabled:false}]).select('correction-probe');
const goal=prepareProjectGoal(target,{version:1,id:'bounded-correction',goal:'Return the required note value of two.',baseRef:'feat/bootstrap',baseSha:'a'.repeat(40),provider:'groq',acceptance:[{id:'note-value',scenario:'The note function returns exactly the value two.'}],requiredPaths:[path]}),taskId=projectPlanTaskId(goal,1),plan=createProjectPlan(goal,{tasks:[{id:taskId,role:'coder',goal:'Return the requested note value of two.',acceptanceIds:['note-value'],paths:[path],dependsOn:[]}],blockers:[],unverifiedAreas:[]});
const snapshot=await loadProjectTaskSnapshot(plan,taskId,{getHead:async()=>plan.request.baseSha,readCommit:async sha=>({sha,treeSha:'b'.repeat(40),parents:[]}),readTree:async sha=>({sha,truncated:false,tree:[{path:'src',sha:'c'.repeat(40),type:'tree',mode:'040000'},{path,sha:blob(source),type:'blob',mode:'100644',size:Buffer.byteLength(source)}]}),readBlob:async sha=>({sha,encoding:'base64',content:Buffer.from(source).toString('base64')})});
const policy=prepareProjectNodeTestPolicy(plan,taskId,{image,checks:[{id:'contract-note',path,exportName:'note',args:[],expected:2,acceptanceIds:['note-value']}]});
const identity=projectPlanBudgetIdentity(plan),history={version:1,projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,observations:['planning',taskId].map(scopeId=>({scopeId,kind:'cumulative-scope-total',charge:{requests:0,requestBytes:0,reservedTokens:0},evidenceSha256:'c'.repeat(64)}))},h=reconcileProjectBudgetHistory(history,identity);
const document={version:1,kind:'authorize-project-model-budget',mode:'development',expiresAt:'2026-10-27T12:00:00Z',targetProfileSha256:plan.targetProfileSha256,grant:{version:1,projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,grantId:'synthetic-correction-only',maxRequests:8,maxRequestBytes:24000,maxTotalRequestBytes:192000,maxReservedTokens:48000,historical:h.charge,historicalEvidenceSha256:h.digest,provider:'groq',freeTierConfirmed:true,legalEnabled:false}};
 const controller=await authorizeProjectBudget({identity,history,decision:{issueNumber:75,commentId:321,bodySha256:projectBudgetApprovalDigest(document)},targetProfile:target,token:'offline-owner-fixture',store:createProjectModelBudgetFileStore(join(directory,'ledger')),now:()=>Date.parse('2026-10-26T12:00:00Z'),transport:async()=>Response.json({id:321,user:{login:'erman-ksv',type:'User'},author_association:'OWNER',issue_url:'https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/75',html_url:'https://github.com/erman-ksv/Onay-Agents-Factory/pull/75#issuecomment-321',created_at:'2026-10-26T11:00:00Z',updated_at:'2026-10-26T11:00:00Z',body:JSON.stringify(document)})});if(mode==='save')await controller.initialize();else await controller.inspect();
 const admission=()=>createProjectExecutionAdmission(plan,controller,{assertSource:createProjectSnapshotSourceGuard(snapshot),assertDependencies:async()=>{}});let clock=0,mockedCalls=0;const checkpoints=[],waits=[];
 const model='qwen/qwen3-32b',options={plan,taskId,snapshot,env:{AGENT_FACTORY_PROVIDER:'groq',GROQ_API_KEY:'offline-native-correction-fixture',ONAY_TEAM_FREE_TIER_CONFIRMED:'true',AGENT_FACTORY_PROJECT_LIVE_APPROVED:'ONE_FREE_BOUNDED_RUN',AGENT_FACTORY_LEGAL_ENABLED:'false',GROQ_MODEL:model},checkpoint:async c=>{checkpoints.push(c);},timing:{now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;}},transport:async(_url,init)=>{
  mockedCalls++;const request=JSON.parse(init.body),payload=JSON.parse(request.messages[1].content);let content;
  if(request.messages[0].content.startsWith('Propose only'))content=JSON.stringify({summary:'Return the requested note value.',changes:[{operation:'patch',path,sourceSha256:hash(source),edits:[{before:'return 0;',after:payload.correction?'return 2;':'return 1;'}],message:'Update note value.'}]});
  else content=JSON.stringify({version:1,taskId,proposalDigest:payload.proposal.digest,decision:'ready',findings:[],unverifiedAreas:['The mocked opinion does not execute host tests.']});
  return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content}}]});
 }};
 const selections=(value,version)=>{const text='return '+value+';',start=source.indexOf('return 0;');return {path,version,start,end:start+text.length};};
 async function review(wire,changes,value){for(const role of ['security','reviewer','tester'])await prepareProjectReplyAssessment(await wire.request(await prepareProjectModelContext(plan,taskId,snapshot,{role,model,changes,selections:[selections(value,'proposed')]})));}

 const key=createProjectCorrectionRecoveryKey('host-fixture-v1',readFileSync(join(directory,'host-key.fixture'))),checkpointPath=join(directory,'correction.checkpoint'),referencePath=join(directory,'reference.json');
 const before=await controller.inspect();let result;
 if(mode==='save'){
  const first=createContextBoundProjectTransport({...options,admission:await admission().prepare(taskId)}),original=await prepareProjectReplyChanges(await first.request(await prepareProjectModelContext(plan,taskId,snapshot,{role:'author',model,selections:[selections(0,'base')]})));await review(first,original,1);const failed=await createProjectNodeSandbox(policy).run(snapshot,original);assert.equal(failed.status,'failed');
  const ticket=await first.prepareCorrection({receipt:failed,policy}),packet=await prepareProjectCorrectionContext(ticket,{model,selections:[selections(0,'base'),selections(1,'proposed')]}),reference=await saveProjectCorrectionCheckpoint(ticket,plan,taskId,controller,key,checkpointPath);writeFileSync(referencePath,JSON.stringify(reference),{mode:0o600,flag:'wx'});result={stage:mode,savedRequestSha256:packet.requestSha256,checkpointSha256:reference.sha256,nativeTest:'failed'};
 }else{
  const reference=JSON.parse(readFileSync(referencePath,'utf8'));
  if(mode==='tamper'){
   const v=JSON.parse(readFileSync(checkpointPath,'utf8')),cipher=Buffer.from(v.ciphertext,'base64');cipher[0]^=1;v.ciphertext=cipher.toString('base64');const text=JSON.stringify(v),tampered=join(directory,'tampered.checkpoint');writeFileSync(tampered,text,{mode:0o600,flag:'wx'});
   await assert.rejects(()=>restoreProjectCorrectionCheckpoint(plan,taskId,snapshot,controller,key,tampered,hash(text)));const wrong=createProjectCorrectionRecoveryKey('host-fixture-v1',randomBytes(32));await assert.rejects(()=>restoreProjectCorrectionCheckpoint(plan,taskId,snapshot,controller,wrong,checkpointPath,reference.sha256));result={stage:mode,tamperRejected:true,wrongKeyRejected:true};
  }else if(mode==='resume'){
   const restored=await restoreProjectCorrectionCheckpoint(plan,taskId,snapshot,controller,key,checkpointPath,reference.sha256),second=createContextBoundProjectTransport({...options,admission:await admission().prepareCorrection(restored.ticket)}),corrected=await prepareProjectReplyChanges(await second.request(restored.packet));await review(second,corrected,2);const passed=await createProjectNodeSandbox(policy).run(snapshot,corrected);assert.equal(passed.status,'passed');await second.verifyRuntimeTests(passed,policy);assert.equal(second.snapshot().runtimeTestsVerified,true);assert.equal(second.snapshot().publicationAuthorized,false);result={stage:mode,restoredRequestSha256:restored.packet.requestSha256,nativeTest:'passed',beforeUsed:before.used.requests,independentAssessmentsVerified:second.snapshot().independentAssessmentsVerified,runtimeTestsVerified:true};
  }else if(mode==='blocked'){
   await assert.rejects(()=>restoreProjectCorrectionCheckpoint(plan,taskId,snapshot,controller,key,checkpointPath,reference.sha256));result={stage:mode,replayStoppedBeforeModel:true};
  }else throw Error('Unknown fixed fixture worker mode');
 }
 const after=await controller.inspect();console.log(JSON.stringify({...result,policySha256:policy.sha256,usedRequests:after.used.requests,mockedModelCalls:mockedCalls,publicationAuthorized:false}));
}
