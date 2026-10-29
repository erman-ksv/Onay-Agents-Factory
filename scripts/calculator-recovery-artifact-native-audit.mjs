// Read-only transport audit of an existing metadata-only GitHub artifact.
// No model keys, state writer, app token or untrusted code execution.
import assert from 'node:assert/strict';import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
import {loadCalculatorRecoveryArtifact} from '../github/calculatorRecoveryArtifact.js';
const env=process.env,repo='erman-ksv/Onay-Agents-Factory';
const directory=join(env.RUNNER_TEMP??'/tmp','recovery-artifact-native-audit');mkdirSync(directory,{mode:0o700});
const report={version:1,status:'blocked',readOnly:true,modelCalls:0,githubWriteRequests:0,sourceArtifactSyntheticOnly:true,privateRecoverySourceValidated:false,mainChanged:false,applicationSourceChanged:false,legalEnabled:false};let apiReads=0,storageReads=0;
try{
 assert.equal(env.GITHUB_REPOSITORY,repo);assert.equal(env.GITHUB_RUN_ATTEMPT,'1');assert.equal(env.GITHUB_REF,'refs/heads/feat/calculator-t02-charge-reconcile-20261022');assert.equal(env.AGENT_FACTORY_LEGAL_ENABLED,'false');
 for(const key of ['GROQ_API_KEY','GEMINI_API_KEY','CLOUDFLARE_API_KEY','CALCULATOR_GITHUB_TOKEN','FACTORY_STATE_TOKEN'])assert.equal(env[key],undefined);
 assert.match(env.FACTORY_RUNTIME_SHA,/^[a-f0-9]{40}$/);assert.match(env.FACTORY_SOURCE_CI_RUN,/^[1-9][0-9]+$/);assert.ok(env.FACTORY_READ_TOKEN);
 const transport=async(input,init)=>{
  assert.equal(init?.method,'GET');const url=new URL(String(input));
  if(url.origin==='https://api.github.com'){apiReads++;assert.ok(url.pathname.startsWith('/repos/'+repo+'/'));}
  else{storageReads++;assert.equal(new Headers(init?.headers).get('authorization'),null);assert.equal(url.protocol,'https:');assert.ok(['.blob.core.windows.net','.actions.githubusercontent.com'].some(s=>url.hostname.endsWith(s)));}
  assert.ok(apiReads+storageReads<=32);return fetch(input,init);
 };
 const ci=await transport('https://api.github.com/repos/'+repo+'/actions/runs/'+env.FACTORY_SOURCE_CI_RUN,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+env.FACTORY_READ_TOKEN,Accept:'application/vnd.github+json'}});assert.equal(ci.status,200);const source=await ci.json();assert.equal(source.head_sha,env.FACTORY_RUNTIME_SHA);assert.equal(source.id,Number(env.FACTORY_SOURCE_CI_RUN));assert.equal(source.run_attempt,1);assert.equal(source.path,'.github/workflows/ci.yml');assert.equal(source.conclusion,'success');assert.equal(source.status,'completed');assert.equal(source.repository.full_name,repo);
 // Independent selected-file pin was derived from the authenticated native job
 // log of 121268688281, whose reviewed script wrote this same JSON object.
 const pin={runId:40226436989,runAttempt:1,headSha:'9ec0fb71f86bad9595bd56fe2e191feefd91c37d',workflowPath:'.github/workflows/recovery-claim-native-audit.yml',conclusion:'success',artifactId:12610938973,name:'recovery-claim-native-audit-40226436989',size:492,sha256:'7e9fc55edd989d9b331af589e38fe99dc446f623b70eb3f18909e5bfe3e59236',files:[{path:'result.json',bytes:603,sha256:'2c0516cc9f5d62a0a6bb69935f98215006e6852807f12db4b5522381dc0d00c2'}]};
 const artifact=await loadCalculatorRecoveryArtifact(pin,env,transport),bytes=artifact.readPrivateFile('result.json');const metadata=JSON.parse(bytes);assert.equal(metadata.status,'native-single-claim-and-restart-verified');assert.equal(metadata.auditOnly,true);assert.equal(metadata.modelCalls,0);assert.equal(metadata.successfulClaims,1);await artifact.assertRemote();
 Object.assign(report,{status:'native-artifact-zip-and-selected-file-verified',runtimeSha:env.FACTORY_RUNTIME_SHA,sourceCiRunId:Number(env.FACTORY_SOURCE_CI_RUN),artifactId:pin.artifactId,zipBytes:pin.size,zipSha256:pin.sha256,selectedFileBytes:pin.files[0].bytes,selectedFileSha256:pin.files[0].sha256,zipDigestRecomputed:true,selectedFileDigestRecomputed:true,tokenForwardedToStorage:false});
}catch{process.exitCode=10;report.reasonCode='recovery-artifact-native-audit-unverified-no-retry';}
finally{Object.assign(report,{githubReads:apiReads,storageReads});writeFileSync(join(directory,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));}
