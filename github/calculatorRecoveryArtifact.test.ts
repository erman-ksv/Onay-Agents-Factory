import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {loadCalculatorRecoveryArtifact,isCalculatorRecoveryArtifact,CALCULATOR_RECOVERY_ARTIFACT_ERROR,type CalculatorRecoveryArtifactPin} from './calculatorRecoveryArtifact.js';
import {createCalculatorRecoveryArtifactHost} from '../orchestration/calculatorRecoveryArtifactHost.js';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/calculatorRecoveryZip.json',import.meta.url),'utf8'));
const env={GITHUB_REPOSITORY:'erman-ksv/Onay-Agents-Factory',FACTORY_READ_TOKEN:'fixture-read-token'},error={message:CALCULATOR_RECOVERY_ARTIFACT_ERROR};
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function fixture(kind='deflate',mode='ready'){
 const f=kind==='recovery'?fixtures.validRecovery:fixtures.archives[kind],zip=Buffer.from(f.zipBase64,'base64');let expired=false,gets=0;
 const pin:CalculatorRecoveryArtifactPin={runId:123,runAttempt:1,headSha:'a'.repeat(40),workflowPath:'.github/workflows/source-fixture.yml',conclusion:'success',artifactId:456,name:'private-synthetic-fixture',size:f.size,sha256:f.sha256,files:kind==='recovery'?f.files:[{path:'checkpoint.json',bytes:fixtures.fileBytes,sha256:fixtures.fileSha256}]};
 const transport:typeof fetch=async(input,init)=>{
  gets++;assert.equal(init?.method,'GET');const url=String(input);
  if(url.startsWith('https://signed.blob.core.windows.net/')){assert.equal(init?.headers,undefined);assert.equal(init?.redirect,'error');return new Response(mode==='corrupt-zip'?Buffer.concat([zip.subarray(0,-1),Buffer.from([zip.at(-1)!^1])]):zip);}
  assert.ok(url.startsWith('https://api.github.com/repos/'+env.GITHUB_REPOSITORY+'/'));assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+env.FACTORY_READ_TOKEN);
  if(url.endsWith('/actions/runs/123'))return Response.json({id:123,run_attempt:mode==='rerun'?2:1,head_sha:mode==='wrong-head'?'b'.repeat(40):pin.headSha,path:pin.workflowPath,status:'completed',conclusion:'success',repository:{full_name:env.GITHUB_REPOSITORY}});
  if(url.endsWith('/actions/artifacts/456'))return Response.json({id:456,name:pin.name,expired:expired||mode==='expired',size_in_bytes:pin.size,digest:'sha256:'+pin.sha256,workflow_run:{id:123,head_sha:pin.headSha}});
  assert.ok(url.endsWith('/actions/artifacts/456/zip'));if(mode==='direct')return new Response(zip);
  return new Response(null,{status:302,headers:{location:mode==='evil-redirect'?'https://signed.blob.core.windows.net.evil.test/private?secret=do-not-log':'https://signed.blob.core.windows.net/private?signature=do-not-log'}});
 };
 return {pin,transport,zip,expire:()=>{expired=true;},gets:()=>gets};
}
test('stored, deflate and streamed descriptor ZIPs verify actual bytes and expose only pinned private file copies',async()=>{
 for(const kind of ['stored','deflate','descriptor']){const f=fixture(kind),cap=await loadCalculatorRecoveryArtifact(f.pin,env,f.transport);assert.equal(isCalculatorRecoveryArtifact(cap),true);assert.equal(f.gets(),6);const bytes=cap.readPrivateFile('checkpoint.json');assert.equal(bytes.toString('base64'),fixtures.contentBase64);bytes.fill(0);assert.equal(cap.readPrivateFile('checkpoint.json').toString('base64'),fixtures.contentBase64);assert.ok(!JSON.stringify(cap).includes('PRIVATE_SOURCE_MARKER'));assert.throws(()=>cap.readPrivateFile('not-pinned.json'),error);}
});
test('duplicate, traversal, symlink and unsafe unselected entries refuse without extraction',async()=>{
 for(const kind of ['duplicate','traversal','symlink','unselected-dangerous']){const f=fixture(kind);await assert.rejects(()=>loadCalculatorRecoveryArtifact(f.pin,env,f.transport),error);}
});
test('corrupt ZIP digest, wrong selected-file digest and local/central disagreement refuse',async()=>{
 const corrupt=fixture('deflate','corrupt-zip');await assert.rejects(()=>loadCalculatorRecoveryArtifact(corrupt.pin,env,corrupt.transport),error);
 const wrong=fixture();await assert.rejects(()=>loadCalculatorRecoveryArtifact({...wrong.pin,files:[{...wrong.pin.files[0]!,sha256:'b'.repeat(64)}]},env,wrong.transport),error);
 const mismatch=fixture('stored','direct'),zip=Buffer.from(mismatch.zip);zip[30]=zip[30]!^1;
 const transport:typeof fetch=async(u,i)=>String(u).endsWith('/zip')?new Response(zip):mismatch.transport(u,i);
 await assert.rejects(()=>loadCalculatorRecoveryArtifact({...mismatch.pin,sha256:hash(zip)},env,async(u,i)=>{
  const r=await transport(u,i);if(String(u).endsWith('/actions/artifacts/456')){const a=await r.json();return Response.json({...a,digest:'sha256:'+hash(zip)});}return r;
 }),error);
});
test('expired artifact, source rerun or wrong head and untrusted redirect stop read-only loading',async()=>{
 for(const mode of ['expired','rerun','wrong-head','evil-redirect']){const f=fixture('deflate',mode);await assert.rejects(()=>loadCalculatorRecoveryArtifact(f.pin,env,f.transport),e=>e instanceof Error&&e.message===CALCULATOR_RECOVERY_ARTIFACT_ERROR&&!e.message.includes('signature='));}
});
test('later remote loss latches refusal and never redownloads or returns private bytes again',async()=>{
 const f=fixture(),cap=await loadCalculatorRecoveryArtifact(f.pin,env,f.transport);f.expire();await assert.rejects(()=>cap.assertRemote(),error);const before=f.gets();await assert.rejects(()=>cap.assertRemote(),error);assert.equal(f.gets(),before);assert.throws(()=>cap.readPrivateFile('checkpoint.json'),error);
});
test('invalid independent pins and oversized or lazy expectations refuse before HTTP',async()=>{
 const f=fixture();let reads=0;const lazy=Object.defineProperty({...f.pin},'files',{enumerable:true,get(){reads++;return f.pin.files;}});
 for(const pin of [lazy,{...f.pin,size:8388609},{...f.pin,files:[...f.pin.files,...f.pin.files]},{...f.pin,files:[{...f.pin.files[0]!,path:'../escape'}]}])await assert.rejects(()=>loadCalculatorRecoveryArtifact(pin,env,f.transport),error);
 assert.equal(reads,0);assert.equal(f.gets(),0);
});
test('a real artifact capability supplies runtime source assertion while a JSON copy cannot',async()=>{
 const f=fixture('recovery'),cap=await loadCalculatorRecoveryArtifact(f.pin,env,f.transport),identity={...fixtures.validRecovery.identity},mapping={checkpointPath:'checkpoint.json',receiptPath:'receipt.json',identity};let claims=0;
 const operations={verifyDependencies:async()=>undefined,claimRecovery:async()=>{claims++;},assertRecovery:async()=>{}};
 assert.equal(isCalculatorRecoveryArtifact({...cap}),false);assert.throws(()=>createCalculatorRecoveryArtifactHost({...cap},mapping,operations));
 const host=createCalculatorRecoveryArtifactHost(cap,mapping,operations),binding={checkpointSha256:host.expectedSha256,receiptSha256:host.receiptSha256,taskId:host.identity.taskId,baseSha:host.identity.baseSha,executionId:'rejected-'+'f'.repeat(64)};
 identity.taskId='mutated-after-creation';await host.assertSourceRemote(binding);assert.equal(claims,0);await assert.rejects(()=>host.assertSourceRemote({...binding,receiptSha256:'b'.repeat(64)}));f.expire();await assert.rejects(()=>host.assertSourceRemote(binding));
});

test('exact archive coverage refuses omitted unselected entries without exposing their contents',async()=>{
 const f=fixture('recovery'),pin={...f.pin,files:[f.pin.files[0]!]},cap=await loadCalculatorRecoveryArtifact(pin,env,f.transport);
 assert.throws(()=>cap.assertExactFiles([pin.files[0]!.path]),error);assert.ok(!JSON.stringify(cap).includes('PRIVATE_SOURCE_MARKER'));
 const all=await loadCalculatorRecoveryArtifact(f.pin,env,f.transport);all.assertExactFiles(f.pin.files.map(file=>file.path));
 for(const paths of [[],[f.pin.files[0]!.path,f.pin.files[0]!.path],['../escape'],['missing.json']])assert.throws(()=>all.assertExactFiles(paths),error);
});
test('exact inventory refuses lazy arrays and refuses again after provenance is lost',async()=>{
 const f=fixture(),cap=await loadCalculatorRecoveryArtifact(f.pin,env,f.transport);let evaluations=0;const paths=['checkpoint.json'];Object.defineProperty(paths,'0',{get(){evaluations++;return 'checkpoint.json';}});assert.throws(()=>cap.assertExactFiles(paths),error);assert.equal(evaluations,0);
 cap.assertExactFiles(['checkpoint.json']);f.expire();await assert.rejects(()=>cap.assertRemote(),error);assert.throws(()=>cap.assertExactFiles(['checkpoint.json']),error);
});
