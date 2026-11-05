import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const hash=value=>createHash('sha256').update(value).digest('hex');
const production=path=>import(pathToFileURL(resolve(path)));
export const PINS=Object.freeze({
 repository:'erman-ksv/Onay-Agents-Factory',branch:'diag/stage8-reply16-readonly-20261105',
 projectKey:'abb7eb35a69bf638cb5b57278226170e2f6b02fd039344c29044014531ca5a0b',
 code:'07ce17e5f91b4539eb54289c9e881311e6b817e3',run:41865281507,
 budget:'688367e3168826e5d6e49876f70307d2f67c3718',
 archive:'74214dfbbdbf0abe7f809cb107b4388f556e26b9',
 envelope:'2fc037a48980c3e5072505b4c49a4932ba6450ca62bdac6c2257d1fd68ca1ede',
 manifest:'fb694376153214a09b4893e698b46729b12309af9fefa9687a0accc5a91f1341',
 grant:'4f8b196f3a36af4b05c3417d8659d8e3209eb43efef127df14c9dea89756b293',
 base:'558993981c9bbb7c6100c8335860ac5668768314',
 execution:'project-run-2d43cb3c8c822b8f45adc66c17874408',
 task:'calculator-input-repair-202610-29e2a8-t01',
 request:'041a0c3d6149b1d3ee64b7e9d3f152c3ccd1a2c767faa3d4a835d3613906660b',
});
const CONTROL=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
// Metadata only: never return supplied paths, messages, edits, summary or keys.
// These predicates mirror the change-path guard; only the pinned production
// validator can confirm rejection. This helper is not execution authority.
export function inspectChangePaths(input,changePaths,containsSecrets){
 assert.ok(input&&Array.isArray(input.changes)&&input.changes.length<=64);
 const seen=new Set();
 const changes=input.changes.map((change,index)=>{
  const object=change!==null&&typeof change==='object'&&!Array.isArray(change);
  const path=object?change.path:undefined,message=object?change.message:undefined;
  const pathIsString=typeof path==='string',messageIsString=typeof message==='string';
  const failures=[];
  if(!object)failures.push('change-not-object');
  if(!pathIsString)failures.push('path-not-string');
  else if(!changePaths.includes(path))failures.push('path-outside-task');
  if(pathIsString&&seen.has(path))failures.push('duplicate-path');
  const messageMetadata={isString:messageIsString,
   utf16Characters:messageIsString?message.length:null,
   utf8Bytes:messageIsString?Buffer.byteLength(message):null,
   blank:messageIsString?!message.trim():null,
   exceeds200:messageIsString?message.length>200:null,
   controlCharacters:messageIsString?CONTROL.test(message):null,
   secretPattern:messageIsString?containsSecrets(message):null};
  if(!messageIsString)failures.push('message-not-string');
  else for(const [key,code] of [['blank','message-blank'],['exceeds200','message-too-long'],['controlCharacters','message-control-character'],['secretPattern','message-secret-pattern']])if(messageMetadata[key])failures.push(code);
  if(pathIsString)seen.add(path);
  const operation=object&&['patch','create'].includes(change.operation)?change.operation:'unsupported';
  if(operation==='unsupported')failures.push('unsupported-operation');
  return {index,pathIsString,pathMatchesTask:pathIsString&&changePaths.includes(path),
   message:messageMetadata,operation,failures};
 });
 return {changeCount:changes.length,changes,firstObservedGuardFailure:changes.find(c=>c.failures.length)?.failures[0]??null};
}
const api='https://api.github.com/repos/';
const factory=api+PINS.repository;
const refs=[['state/project-model-budget/'+PINS.projectKey,PINS.budget],
 ['state/project-checkpoints/'+PINS.projectKey,PINS.archive],
 ['fix/stage8-corrective-verification-20261029',PINS.code]];
const archiveUrl=factory+'/contents/encrypted-checkpoint.json?ref='+PINS.archive;
const runUrl=factory+'/actions/runs/'+PINS.run;
const calculator=api+'erman-ksv/Onay-Factory-Calculator';
const calculatorRef=calculator+'/git/ref/heads/'+encodeURIComponent('feat/calculator-agent/calculator-pilot-step7-v1');
const blobs=Object.freeze({
 'index.html':'18150ee8ab02586759ec1ef341d83a5d4df0bd14',
 'src/app.mjs':'a218250d94cebaaa036cf8e97af238ae57396841',
 'src/calculator.mjs':'e80e4cf99b5f2f892a60af61e0b82293c33445b1',
 'styles.css':'2b91427a8d85dfa565bb47fe5c480c63b2ff044b',
 'test/ui.test.mjs':'1ac172efed6e41524565de7288492b367dfc76ba',
});
export const ALLOWED_URLS=Object.freeze([...refs.map(([ref])=>factory+'/git/ref/heads/'+ref),archiveUrl,runUrl,
 calculatorRef,calculator+'/git/commits/'+PINS.base,
 calculator+'/git/trees/c34b805ab225809fdfa58d4d0b0b49d2661e5b9e?recursive=1',
 ...Object.values(blobs).map(sha=>calculator+'/git/blobs/'+sha)]);
export function assertReadOnlyRequest(url,init){
 assert.equal(typeof url,'string');assert.ok(ALLOWED_URLS.includes(url));
 assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(init?.body,undefined);
}
function decodeContent(value,max){
 assert.equal(value.encoding,'base64');assert.equal(value.type,'file');assert.equal(typeof value.content,'string');
 const encoded=value.content.replace(/\n/g,''),bytes=Buffer.from(encoded,'base64');
 assert.equal(bytes.toString('base64'),encoded);assert.ok(bytes.length<=max);
 assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex'),value.sha);
 return bytes;
}
async function boundedJson(response){
 assert.equal(response.status,200);assert.ok(response.body);
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;
  if(size>1048576){await reader.cancel();throw Error('Bound exceeded');}chunks.push(next.value);}}
 finally{reader.releaseLock();}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function runInspection(env){
 assert.equal(env.GITHUB_REPOSITORY,PINS.repository);assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
 assert.equal(env.GITHUB_EVENT_NAME,'push');assert.equal(env.GITHUB_REF,'refs/heads/'+PINS.branch);
 for(const name of ['GROQ_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY','OPENROUTER_API_KEY','CLOUDFLARE_API_KEY',
  'AGENT_FACTORY_PROJECT_LIVE_APPROVED','AGENT_FACTORY_ENABLE_GITHUB_WRITES','FACTORY_STATE_TOKEN'])assert.equal(env[name],undefined);
 assert.ok(env.FACTORY_INSPECTION_READ_TOKEN&&env.FACTORY_RECOVERY_KEY_BASE64);
 assert.equal(env.FACTORY_RECOVERY_KEY_ID,'onay-runtime-key-v1');
 const native=globalThis.fetch,started=performance.now();let requests=0,key,directory,destroy;
 globalThis.fetch=async(url,init)=>{
  assertReadOnlyRequest(url,init);assert.ok(++requests<=40&&performance.now()-started<180000);
  return native(url,init);
 };
 const get=url=>fetch(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+env.FACTORY_INSPECTION_READ_TOKEN}}).then(boundedJson);
 const current=async()=>{for(const [ref,sha]of refs){const value=await get(factory+'/git/ref/heads/'+ref);
  assert.equal(value.ref,'refs/heads/'+ref);assert.equal(value.object.type,'commit');assert.equal(value.object.sha,sha);}};
 try{
  await current();const failed=await get(runUrl);
  assert.equal(failed.id,PINS.run);assert.equal(failed.head_sha,PINS.code);assert.equal(failed.run_attempt,1);
  assert.equal(failed.status,'completed');assert.equal(failed.conclusion,'failure');
  const outer=JSON.parse(decodeContent(await get(archiveUrl),262144));
  assert.equal(outer.projectKey,PINS.projectKey);assert.equal(outer.sequence,16);assert.equal(outer.kind,'reply-rejected');
  assert.equal(outer.taskId,PINS.task);assert.equal(outer.sha256,PINS.envelope);
  assert.equal(outer.previousHead,'65fc297e19ad83cd4bacde53e160299afbc3597c');
  const bytes=Buffer.from(outer.ciphertextBase64,'base64');
  assert.equal(bytes.toString('base64'),outer.ciphertextBase64);assert.equal(hash(bytes),PINS.envelope);
  const recovery=await production('orchestration/projectRuntimeRecovery.js');
  const crypto=await production('orchestration/projectCorrectionCheckpoint.js');
  destroy=crypto.destroyProjectCorrectionRecoveryKey;key=recovery.loadProjectRuntimeRecoveryKey(env);
  directory=mkdtempSync(join(tmpdir(),'onay-readonly-reply16-'));
  const path=join(directory,'encrypted-reply.json');writeFileSync(path,bytes,{mode:0o600,flag:'wx'});
  const event=JSON.parse(crypto.readProjectHostEnvelope('onay-runtime-rejected-reply-v1',key,path,PINS.envelope));
  assert.equal(event.version,1);assert.equal(event.executionId,PINS.execution);assert.equal(event.taskId,PINS.task);
  assert.equal(event.repository,'erman-ksv/Onay-Factory-Calculator');
  assert.equal(event.role,'author');assert.equal(event.stage,'author-proposal');assert.equal(event.reason,'reply-rejected');
  assert.equal(event.changeReason,'change-path');assert.equal(event.baseSha,PINS.base);assert.equal(event.requestSha256,PINS.request);
  assert.equal(event.executionAuthorized,false);assert.equal(event.replayAuthorized,false);
  assert.equal(typeof event.content,'string');assert.ok(Buffer.byteLength(event.content)<=32768);
  assert.equal(event.responseSha256,hash(event.content));assert.equal(event.responseBytes,Buffer.byteLength(event.content));
  assert.equal(event.budget.projectKey,PINS.projectKey);assert.equal(event.budget.grantSha256,PINS.grant);
  assert.deepEqual(event.budget.used,{requests:72,requestBytes:661910,reservedTokens:285346});
  const manifest=await production('orchestration/projectRuntimeManifest.js');
  const prepared=manifest.prepareProjectRuntimeManifest(readFileSync('.factory/rejected-proposal-runtime-manifest.json','utf8'),PINS.manifest);
  // InspectionContext recreates policy only: no bootstrap/admission or budget controller.
  const {plan}=manifest.projectRuntimeManifestInspectionContext(prepared);
  assert.equal(event.planFingerprint,plan.fingerprint);
  const source=await production('github/projectSourceSnapshot.js');
  const snapshot=await source.loadGitHubProjectTaskSnapshot({plan,taskId:PINS.task,token:env.FACTORY_INSPECTION_READ_TOKEN});
  assert.equal(snapshot.baseSha,PINS.base);assert.deepEqual(snapshot.changePaths,['src/app.mjs']);
  for(const file of snapshot.files)assert.equal(file.blobSha,blobs[file.path]);
  const validator=await production('commander/projectChanges.js'),input=JSON.parse(event.content);
  let rejection='accepted';
  try{await validator.prepareProjectChanges(plan,PINS.task,snapshot,input);}
  catch(error){rejection=validator.projectChangesRejectionReason(error);}
  const analysis=inspectChangePaths(input,snapshot.changePaths,source.projectSourceContainsSecrets);
  await current();await source.verifyProjectSnapshot(snapshot);
  // A mismatch is an explicit diagnostic failure, never a successful recovery.
  assert.equal(rejection,'change-path');assert.ok(analysis.firstObservedGuardFailure);
  return {version:1,status:'saved-reply-inspected',sourceSha:PINS.code,failedRun:PINS.run,
   checkpointSequence:16,envelopeSha256:PINS.envelope,requestSha256:PINS.request,responseSha256:event.responseSha256,
   productionRejection:rejection,analysis,metadataGetRequests:requests,providerCalls:0,budgetWrites:0,archiveWrites:0,
   executionAuthorized:false,replayAuthorized:false};
 }finally{globalThis.fetch=native;if(key&&destroy)destroy(key);if(directory)rmSync(directory,{recursive:true,force:true});}
}

// Runs before Actions secrets are loaded. Fixtures are local validation evidence,
// never evidence of a real Coder reply, live recovery or completed Stage 8.
export async function runSelfTests(){
 const {default:test}=await import('node:test');
 const source=await production('github/projectSourceSnapshot.js');
 const {prepareProjectChanges,projectChangesRejectionReason}=await production('commander/projectChanges.js');
 const {createProjectTargetRegistry}=await production('orchestration/projectTargetRegistry.js');
 const {prepareProjectGoal,createProjectPlan,projectPlanTaskId}=await production('orchestration/projectPlan.js');
 const text='export const value = 1;\n',blob=createHash('sha1').update('blob '+Buffer.byteLength(text)+'\0'+text).digest('hex');
 const definition={version:1,id:'notes',repository:'example/notes',writablePaths:['src/app.mjs','test/notes.test.mjs'],branchPrefix:'feat/notes-agent/',
  requiredCiNames:['Notes CI'],requiredCiSteps:['Syntax','Task tests'],requiredActors:['security','reviewer','tester'],
  maxFiles:2,maxSourceBytes:131072,maxNewFileBytes:8192,maxChangedCharacters:6000,maxReviewBytes:12000,legalEnabled:false,mergesEnabled:false};
 const target=createProjectTargetRegistry([definition]).select('notes');
 const goal=prepareProjectGoal(target,{version:1,id:'notes-pilot',goal:'Show and update a small notes application.',
  baseRef:'feat/bootstrap',baseSha:'1'.repeat(40),provider:'groq',acceptance:[{id:'show-value',scenario:'The note value is shown correctly.'}],requiredPaths:['src/app.mjs']});
 const taskId=projectPlanTaskId(goal,1),plan=createProjectPlan(goal,{tasks:[{id:taskId,role:'coder',goal:'Implement the required note display.',
  acceptanceIds:['show-value'],paths:['src/app.mjs'],dependsOn:[]}],blockers:[],unverifiedAreas:['Local fixture only.']});
 const reader={getHead:async()=>plan.request.baseSha,readCommit:async sha=>({sha,treeSha:'2'.repeat(40),parents:[]}),
  readTree:async sha=>({sha,truncated:false,tree:[{path:'src',sha:'3'.repeat(40),type:'tree',mode:'040000'},
   {path:'src/app.mjs',sha:blob,type:'blob',mode:'100644',size:Buffer.byteLength(text)}]}),
  readBlob:async sha=>({sha,encoding:'base64',content:Buffer.from(text).toString('base64')})};
 const snapshot=await source.loadProjectTaskSnapshot(plan,taskId,reader);
 const base=()=>({summary:'Update the note value.',changes:[{operation:'patch',path:'src/app.mjs',sourceSha256:hash(text),
  edits:[{before:'value = 1',after:'value = 2'}],message:'Update value.'}]});
 const inspect=input=>inspectChangePaths(input,snapshot.changePaths,source.projectSourceContainsSecrets);
 const cases=[
  ['missing path',c=>{delete c.path;},'path-not-string'],
  ['null path',c=>{c.path=null;},'path-not-string'],
  ['numeric path',c=>{c.path=42;},'path-not-string'],
  ['foreign path',c=>{c.path='PRIVATE_REPLY_MARKER';},'path-outside-task'],
  ['other task path',c=>{c.path='test/ui.test.mjs';},'path-outside-task'],
  ['missing message',c=>{delete c.message;},'message-not-string'],
  ['non-string message',c=>{c.message={private:'PRIVATE_REPLY_MARKER'};},'message-not-string'],
  ['blank message',c=>{c.message=' \n\t';},'message-blank'],
  ['201 characters',c=>{c.message='x'.repeat(201);},'message-too-long'],
  ['multibyte over UTF16 limit',c=>{c.message='я'.repeat(201);},'message-too-long'],
  ['control message',c=>{c.message='private\u0000text';},'message-control-character'],
  ['Groq secret pattern',c=>{c.message='gsk_'+'x'.repeat(24);},'message-secret-pattern'],
  ['missing operation',c=>{delete c.operation;},'unsupported-operation'],
  ['unknown operation',c=>{c.operation='PRIVATE_REPLY_MARKER';},'unsupported-operation'],
 ];
 for(const [name,mutate,expected] of cases)await test(name,async()=>{
  const input=base();mutate(input.changes[0]);
  await assert.rejects(()=>prepareProjectChanges(plan,taskId,snapshot,input),e=>projectChangesRejectionReason(e)==='change-path');
  const result=inspect(input);assert.equal(result.firstObservedGuardFailure,expected);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_REPLY_MARKER'));
 });
 await test('valid bounded proposal accepted by production validator',async()=>{await prepareProjectChanges(plan,taskId,snapshot,base());assert.equal(inspect(base()).firstObservedGuardFailure,null);});
 await test('message exactly 200 UTF16 characters accepted',async()=>{const input=base();input.changes[0].message='я'.repeat(200);
  await prepareProjectChanges(plan,taskId,snapshot,input);assert.equal(inspect(input).changes[0].message.utf8Bytes,400);});
 await test('duplicate path rejected after first valid patch',async()=>{const input=base();input.changes.push(structuredClone(input.changes[0]));
  await assert.rejects(()=>prepareProjectChanges(plan,taskId,snapshot,input),e=>projectChangesRejectionReason(e)==='change-path');
  assert.equal(inspect(input).firstObservedGuardFailure,'duplicate-path');});
 await test('null change diagnosed without reply serialization',async()=>{const input=base();input.changes[0]=null;
  await assert.rejects(()=>prepareProjectChanges(plan,taskId,snapshot,input),e=>projectChangesRejectionReason(e)==='change-path');
  assert.equal(inspect(input).firstObservedGuardFailure,'change-not-object');});
 await test('schema failure not mislabeled as change-path',async()=>{const input=base();delete input.summary;
  await assert.rejects(()=>prepareProjectChanges(plan,taskId,snapshot,input),e=>projectChangesRejectionReason(e)==='input-schema');});
 await test('ambiguous anchor remains rejected by unmodified production guard',async()=>{const input=base();input.changes[0].edits=[{before:' ',after:'  '}];
  await assert.rejects(()=>prepareProjectChanges(plan,taskId,snapshot,input),e=>projectChangesRejectionReason(e)==='bounded-patch');assert.equal(inspect(input).firstObservedGuardFailure,null);});
 for(const [name,url,init] of [
  ['POST forbidden',ALLOWED_URLS[0],{method:'POST',redirect:'error'}],
  ['redirect forbidden',ALLOWED_URLS[0],{method:'GET',redirect:'follow'}],
  ['body forbidden',ALLOWED_URLS[0],{method:'GET',redirect:'error',body:'x'}],
  ['provider forbidden','https://api.groq.com/openai/v1/chat/completions',{method:'GET',redirect:'error'}],
  ['unpinned URL forbidden',factory+'/actions/runs/1',{method:'GET',redirect:'error'}],
 ])await test(name,()=>assert.throws(()=>assertReadOnlyRequest(url,init)));
 await test('fixed GETs permitted',()=>{for(const url of ALLOWED_URLS)assertReadOnlyRequest(url,{method:'GET',redirect:'error'});});
 await test('native entry refuses without Actions environment before fetch/key',async()=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No network in test');};
  try{await assert.rejects(()=>runInspection({}));assert.equal(calls,0);}finally{globalThis.fetch=original;}
 });
 for(const [name,status,body] of [
  ['stale state head refuses without retry',200,{ref:'refs/heads/'+refs[0][0],object:{type:'commit',sha:'0'.repeat(40)}}],
  ['GitHub 429 refuses without retry',429,{message:'PRIVATE_REPLY_MARKER'}],
  ['GitHub 503 refuses without retry',503,{message:'PRIVATE_REPLY_MARKER'}],
 ])await test(name,async()=>{
  const native=globalThis.fetch;let calls=0;
  const fake=async()=>{calls++;return new Response(JSON.stringify(body),{status});};globalThis.fetch=fake;
  try{await assert.rejects(()=>runInspection({GITHUB_REPOSITORY:PINS.repository,GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'push',
   GITHUB_REF:'refs/heads/'+PINS.branch,FACTORY_INSPECTION_READ_TOKEN:'local-fixture',FACTORY_RECOVERY_KEY_BASE64:'local-fixture',
   FACTORY_RECOVERY_KEY_ID:'onay-runtime-key-v1'}));assert.equal(calls,1);assert.equal(globalThis.fetch,fake);}
  finally{globalThis.fetch=native;}
 });
 await test('provider key in environment refused before any fetch',async()=>{
  await assert.rejects(()=>runInspection({GITHUB_REPOSITORY:PINS.repository,GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'push',
   GITHUB_REF:'refs/heads/'+PINS.branch,GROQ_API_KEY:'synthetic-test-only'}));
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv[2]==='--self-test')await runSelfTests();
 else try{console.log(JSON.stringify(await runInspection(process.env)));}
 catch{console.error('Read-only saved-reply inspection refused; no execution, retry or state write authorized.');process.exitCode=1;}
}
