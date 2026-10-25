// Synthetic metadata-only native GitHub audit. No app/model/auth grant imports.
import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
import {createCalculatorRecoveryGitHubClaim} from '../github/calculatorRecoveryClaim.js';
const env=process.env,repo='erman-ksv/Onay-Agents-Factory',hash=s=>createHash('sha256').update(s).digest('hex');
const directory=join(env.RUNNER_TEMP??'/tmp','calculator-recovery-claim-native-audit');mkdirSync(directory,{mode:0o700});
let reads=0,writes=0;const report={version:1,status:'blocked',auditOnly:true,modelCalls:0,mainChanged:false,applicationSourceChanged:false,legalEnabled:false};
try{
 assert.equal(env.GITHUB_REPOSITORY,repo);assert.equal(env.GITHUB_REF,'refs/heads/feat/calculator-t02-charge-reconcile-20261022');assert.equal(env.GITHUB_EVENT_NAME,'push');assert.equal(env.GITHUB_RUN_ATTEMPT,'1');assert.equal(env.AGENT_FACTORY_LEGAL_ENABLED,'false');
 for(const key of ['GROQ_API_KEY','GEMINI_API_KEY','CLOUDFLARE_API_KEY','CALCULATOR_GITHUB_TOKEN'])assert.equal(env[key],undefined);
 assert.match(env.FACTORY_RUNTIME_SHA,/^[a-f0-9]{40}$/);assert.match(env.FACTORY_SOURCE_CI_RUN,/^[1-9][0-9]+$/);assert.match(env.GITHUB_RUN_ID,/^[1-9][0-9]+$/);
 const config={planFingerprint:hash('synthetic-recovery-claim-audit-only'),runtimeSha:env.FACTORY_RUNTIME_SHA,sourceCiRunId:Number(env.FACTORY_SOURCE_CI_RUN),binding:{checkpointSha256:hash('synthetic checkpoint, no source'),receiptSha256:hash('synthetic receipt, no task'),taskId:'recovery-claim-native-audit',baseSha:env.FACTORY_RUNTIME_SHA,executionId:'rejected-'+hash('audit-only:'+env.FACTORY_RUNTIME_SHA+':'+env.GITHUB_RUN_ID)}};
 const transport=async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,'https://api.github.com');assert.ok(url.pathname.startsWith('/repos/'+repo+'/'));
  const method=init?.method??'GET';assert.ok(['GET','POST'].includes(method));if(method==='GET')reads++;else{writes++;assert.ok(['/git/blobs','/git/trees','/git/commits','/git/refs'].some(path=>url.pathname==='/repos/'+repo+path));}
  assert.ok(reads+writes<=64);return fetch(input,init);
 };
 const first=createCalculatorRecoveryGitHubClaim(config,env,transport),second=createCalculatorRecoveryGitHubClaim(config,env,transport);
 assert.equal(first.ref,second.ref);assert.equal(await first.inspectAbsent(),true);
 const outcomes=await Promise.allSettled([first.claimRecovery(config.binding),second.claimRecovery(config.binding)]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 const winner=outcomes[0].status==='fulfilled'?first:second;await winner.assertRecovery(config.binding);
 const fresh=createCalculatorRecoveryGitHubClaim(config,env,transport);assert.equal(await fresh.inspectAbsent(),false);const before=writes;await assert.rejects(()=>fresh.claimRecovery(config.binding));assert.equal(writes,before);
 Object.assign(report,{status:'native-single-claim-and-restart-verified',runtimeSha:config.runtimeSha,sourceCiRunId:config.sourceCiRunId,ref:first.ref,successfulClaims:1,racingClaims:2,restartRefused:true,artifactAuthenticationVerified:false,liveRecoveryEnabled:false});
}catch{process.exitCode=10;report.reasonCode='native-recovery-claim-audit-unverified-no-retry';}
finally{Object.assign(report,{githubReads:reads,githubWriteRequests:writes});writeFileSync(join(directory,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));}
