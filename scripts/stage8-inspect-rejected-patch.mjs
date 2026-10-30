import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const hash=s=>createHash('sha256').update(s).digest('hex');
export const PINS=Object.freeze({repository:'erman-ksv/Onay-Agents-Factory',projectKey:'abb7eb35a69bf638cb5b57278226170e2f6b02fd039344c29044014531ca5a0b',code:'8c96bcc6ffa1304d71a38335078bae809d81bd40',application:'fe971f092b68a7894d580c8ae73b2a93b2c7f3c9',budget:'868e730263cc1f551511d1537158fb5fe1965fad',archive:'79e01d083f87d50f208c91bd39ceec944987929a',envelope:'ca597384eb90d13d8fd1260f08e05d23af7b194da5ad8d697770667e3f1a5bb4',base:'558993981c9bbb7c6100c8335860ac5668768314',execution:'project-run-57d3d6770ae7ecef60ac24def70e010d',task:'calculator-input-repair-202610-29e2a8-t01',request:'0c8eb62455a23f98fa2c14059de40cc7ac0a6f2dbc63d22786ca4ce6652a4bf8'});

// Diagnostic metadata only. Never applies a patch to disk or returns source/reply text.
export function inspectPatch(input,source,{applyBoundedPatches,scanForSecrets}){
 assert.ok(input&&Array.isArray(input.changes)&&input.changes.length===1);
 const c=input.changes[0];assert.equal(c.path,'src/app.mjs');assert.equal(c.operation,'patch');assert.ok(Array.isArray(c.edits)&&c.edits.length<=64);
 const failures=new Set(),edits=[],ranges=[];let changed=0;
 if(c.sourceSha256!==hash(source))failures.add('source-sha-mismatch');
 if(c.edits.length<1||c.edits.length>8)failures.add('edit-count');
 if(typeof c.message!=='string'||!c.message.trim()||c.message.length>600)failures.add('message-invalid');
 else if(scanForSecrets(c.message).length)failures.add('message-secret');
 for(const [i,e]of c.edits.entries()){
  if(!e||typeof e.before!=='string'||typeof e.after!=='string'){failures.add('edit-schema');edits.push({index:i,validStrings:false});continue;}
  let matches=0,first=-1;for(let pos=0;e.before.length;){const at=source.indexOf(e.before,pos);if(at<0)break;if(first<0)first=at;matches++;pos=at+1;}
  changed+=e.before.length+e.after.length;
  if(!e.before.length)failures.add('empty-anchor');else if(matches===0)failures.add('anchor-missing');else if(matches>1)failures.add('anchor-ambiguous');
  if(e.before===e.after)failures.add('no-op-edit');
  if(scanForSecrets(e.before).length||scanForSecrets(e.after).length)failures.add('edit-secret');
  if(matches===1)ranges.push({start:first,end:first+e.before.length});
  edits.push({index:i,validStrings:true,beforeBytes:Buffer.byteLength(e.before),afterBytes:Buffer.byteLength(e.after),matches,unchanged:e.before===e.after,utf8RoundTrip:Buffer.from(e.before).toString('utf8')===e.before&&Buffer.from(e.after).toString('utf8')===e.after});
 }
 if(changed>12000)failures.add('changed-character-limit');
 ranges.sort((a,b)=>a.start-b.start);if(ranges.some((r,i)=>i>0&&r.start<ranges[i-1].end))failures.add('overlapping-edits');
 let accepted=false,resultBytes=null;
 try{const [result]=applyBoundedPatches([c],new Map([['src/app.mjs',source]]),['src/app.mjs']);accepted=true;resultBytes=Buffer.byteLength(result.content);}catch{}
 if(!accepted&&!failures.size)failures.add('other-bounded-patch-guard');
 return Object.freeze({sourceShaMatches:c.sourceSha256===hash(source),editCount:c.edits.length,changedCharacters:changed,failures:[...failures],edits,productionBoundedPatchAccepted:accepted,resultBytes});
}

const api='https://api.github.com/repos/';
const refs=[['state/project-model-budget/'+PINS.projectKey,PINS.budget],['state/project-checkpoints/'+PINS.projectKey,PINS.archive]];
const archiveUrl=api+PINS.repository+'/contents/encrypted-checkpoint.json?ref='+PINS.archive;
const sourceUrl=api+'erman-ksv/Onay-Factory-Calculator/contents/src/app.mjs?ref='+PINS.base;
const runUrl=api+PINS.repository+'/actions/runs/41049869313';
export const ALLOWED_URLS=Object.freeze([...refs.map(([r])=>api+PINS.repository+'/git/ref/heads/'+r),archiveUrl,sourceUrl,runUrl]);
export function assertReadOnlyRequest(url,init){assert.ok(ALLOWED_URLS.includes(String(url)));assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(init?.body,undefined);}
function decodeContent(j,max){assert.equal(j.encoding,'base64');assert.equal(j.type,'file');assert.equal(typeof j.content,'string');const encoded=j.content.replace(/\n/g,''),b=Buffer.from(encoded,'base64');assert.equal(b.toString('base64'),encoded);assert.ok(b.length<=max);assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex'),j.sha);return b;}
export async function runInspection(env){
 assert.equal(env.GITHUB_REPOSITORY,PINS.repository);assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
 for(const k of ['GROQ_API_KEY','GEMINI_API_KEY','CLOUDFLARE_API_KEY','AGENT_FACTORY_PROJECT_LIVE_APPROVED','AGENT_FACTORY_ENABLE_GITHUB_WRITES','FACTORY_STATE_TOKEN'])assert.equal(env[k],undefined);
 assert.ok(env.FACTORY_INSPECTION_READ_TOKEN&&env.FACTORY_RECOVERY_KEY_BASE64);assert.equal(env.FACTORY_RECOVERY_KEY_ID,'onay-runtime-key-v1');
 const native=globalThis.fetch,started=performance.now();let requests=0,key,directory;
 globalThis.fetch=async(url,init)=>{assertReadOnlyRequest(url,init);assert.ok(++requests<=11&&performance.now()-started<120000);return native(url,init);};
 const get=async url=>{const r=await fetch(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+env.FACTORY_INSPECTION_READ_TOKEN}});assert.equal(r.status,200);const text=await r.text();assert.ok(Buffer.byteLength(text)<=1048576);return JSON.parse(text);};
 const current=async()=>{for(const [r,sha]of refs)assert.equal((await get(api+PINS.repository+'/git/ref/heads/'+r)).object.sha,sha);};
 let destroy;
 try{
  await current();const failed=await get(runUrl);assert.equal(failed.id,41049869313);assert.equal(failed.head_sha,PINS.code);assert.equal(failed.run_attempt,1);assert.equal(failed.status,'completed');assert.equal(failed.conclusion,'failure');
  const outer=JSON.parse(decodeContent(await get(archiveUrl),262144));
  assert.equal(outer.projectKey,PINS.projectKey);assert.equal(outer.sequence,13);assert.equal(outer.kind,'reply-rejected');assert.equal(outer.taskId,PINS.task);assert.equal(outer.sha256,PINS.envelope);
  const bytes=Buffer.from(outer.ciphertextBase64,'base64');assert.equal(bytes.toString('base64'),outer.ciphertextBase64);assert.equal(hash(bytes),PINS.envelope);
  const recovery=await import(pathToFileURL(resolve('orchestration/projectRuntimeRecovery.js'))),crypto=await import(pathToFileURL(resolve('orchestration/projectCorrectionCheckpoint.js')));destroy=crypto.destroyProjectCorrectionRecoveryKey;key=recovery.loadProjectRuntimeRecoveryKey(env);
  directory=mkdtempSync(join(tmpdir(),'onay-readonly-reply-'));const path=join(directory,'reply.json');writeFileSync(path,bytes,{mode:0o600,flag:'wx'});
  const event=JSON.parse(crypto.readProjectHostEnvelope('onay-runtime-rejected-reply-v1',key,path,PINS.envelope));
  assert.equal(event.executionId,PINS.execution);assert.equal(event.taskId,PINS.task);assert.equal(event.role,'author');assert.equal(event.stage,'author-proposal');assert.equal(event.changeReason,'bounded-patch');assert.equal(event.baseSha,PINS.base);assert.equal(event.requestSha256,PINS.request);assert.equal(event.executionAuthorized,false);assert.equal(event.replayAuthorized,false);assert.equal(event.responseSha256,hash(event.content));assert.equal(event.responseBytes,Buffer.byteLength(event.content));
  const source=decodeContent(await get(sourceUrl),131072).toString('utf8');
  const bounded=await import(pathToFileURL(resolve('commander/boundedPatch.js'))),scan=await import(pathToFileURL(resolve('github/secretScanner.js')));
  const analysis=inspectPatch(JSON.parse(event.content),source,{...bounded,...scan});await current();
  return {version:1,status:'saved-reply-inspected',checkpointSequence:13,envelopeSha256:PINS.envelope,requestSha256:PINS.request,responseSha256:event.responseSha256,analysis,metadataGetRequests:requests,providerCalls:0,budgetWrites:0,archiveWrites:0,executionAuthorized:false,replayAuthorized:false};
 }finally{globalThis.fetch=native;if(key&&destroy)destroy(key);if(directory)rmSync(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log(JSON.stringify(await runInspection(process.env)));}catch{console.error('Read-only saved-reply inspection refused; no execution, retry or state write authorized.');process.exitCode=1;}}
