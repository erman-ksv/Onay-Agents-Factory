import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,lstatSync,mkdirSync,copyFileSync} from 'node:fs';
import {join,relative,dirname} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
const FACTORY='erman-ksv/Onay-Agents-Factory',TARGET='erman-ksv/Onay-Factory-Calculator';
const SOURCE='e22c946c77095868deb7e65c230e2e6ab5c860f1',CANDIDATE='949a0bf874722fd8cbd886c2cb0af8f2b502ac05',BASE='5c4bc71b3119a50d2ca7ce1dbdf12bcaa000ce75';
const TASK='calculator-pilot-step7-v1-34ee03-t02',PLAN='1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2';
const sha=b=>createHash('sha256').update(b).digest('hex'),canonical=v=>sha(JSON.stringify(v));
const root=join(process.env.RUNNER_TEMP,'publication-reconcile-archive'),compiled=join(process.env.RUNNER_TEMP,'publication-reconcile-compiled');
let phase='compile';const report={version:1,sourceSha:SOURCE,sourceRunId:39790544926,sourceArtifactId:12431481505,
 candidateSha:CANDIDATE,readOnlyAudit:true,modelsRun:false,githubWritesPerformed:false,receiptsChanged:false,
 automaticReplay:false,resumeAuthorized:false,budgetResetAuthorized:false,autonomousDevelopmentProven:false,wholeStep8Closed:false};
async function get(path){assert.ok(process.env.CALCULATOR_READ_TOKEN);const r=await fetch('https://api.github.com/repos/'+TARGET+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+process.env.CALCULATOR_READ_TOKEN,Accept:'application/vnd.github+json'}});assert.equal(r.status,200);const text=await r.text();assert.ok(Buffer.byteLength(text)<=1048576);return JSON.parse(text);}
try{
 function compile(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const p=join(dir,entry.name);if(entry.isDirectory()){compile(p);continue;}if(entry.name.endsWith('.test.ts'))continue;const dest=join(compiled,relative(process.cwd(),p).replace(/\.ts$/,'.js'));mkdirSync(dirname(dest),{recursive:true});if(p.endsWith('.ts'))writeFileSync(dest,stripTypeScriptTypes(readFileSync(p,'utf8'),{mode:'transform'}));else if(/\.(mjs|json)$/.test(p))copyFileSync(p,dest);}}
 for(const dir of ['agents','commander','config','github','orchestration'])compile(join(process.cwd(),dir));writeFileSync(join(compiled,'package.json'),'{"type":"module"}');
 const {parseCalculatorExecutionCheckpointBytes}=await import(join(compiled,'orchestration/calculatorExecutionCheckpoint.js'));
 const {calculatorProposalDigest}=await import(join(compiled,'orchestration/calculatorExecutionEvidence.js'));
 const {scanForSecrets}=await import(join(compiled,'github/secretScanner.js'));
 phase='manifest';const manifestBytes=readFileSync(join(root,'qualified-manifest.json')),manifest=JSON.parse(manifestBytes.toString('utf8'));
 assert.equal(manifest.version,1);assert.equal(manifest.kind,'calculator-qualified-ui-forensic');assert.equal(manifest.resumeAuthorized,false);assert.equal(manifest.budgetResetAuthorized,false);assert.equal(manifest.automaticReplay,false);assert.equal(manifest.previousCostsPreserved,true);
 assert.ok(Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=512);assert.equal(manifest.fileCount,manifest.files.length);assert.equal(manifest.treeSha256,canonical(manifest.files));
 const files=new Map();let total=0;
 for(const f of manifest.files){assert.equal(typeof f.path,'string');assert.ok(f.path.split('/').every(n=>/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(n)&&!n.includes('..')));assert.ok(!files.has(f.path));const path=join(root,f.path),s=lstatSync(path);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.size<524288);const b=readFileSync(path);assert.equal(b.length,f.bytes);assert.equal(sha(b),f.sha256);total+=b.length;assert.ok(total<3*1024*1024);
  if(!f.path.endsWith('.png')){const text=new TextDecoder('utf8',{fatal:true}).decode(b);assert.equal(scanForSecrets(text).length,0);assert.ok(!/(?:gsk_|gh[pousr]_)[A-Za-z0-9_-]{20,}/.test(text));}files.set(f.path,b);
 }
 let seen=0;function walk(dir,prefix=''){for(const name of readdirSync(dir)){const p=join(dir,name),path=prefix?prefix+'/'+name:name,s=lstatSync(p);assert.ok(!s.isSymbolicLink());if(s.isDirectory())walk(p,path);else{assert.ok(path==='qualified-manifest.json'||files.has(path));seen++;}}}walk(root);assert.equal(seen,files.size+1);assert.equal(total,manifest.totalBytes);
 const json=path=>{assert.ok(files.has(path));return JSON.parse(files.get(path).toString('utf8'));};
 report.archive={manifestSha256:sha(manifestBytes),fileCount:files.size,totalBytes:total,allFilesVerified:true};
 phase='capsule';const capsulePath='execution-private/'+TASK+'.execution.json',capsuleBytes=files.get(capsulePath);assert.ok(capsuleBytes);
 const raw=JSON.parse(capsuleBytes.toString('utf8'));const capsule=parseCalculatorExecutionCheckpointBytes(capsuleBytes,raw.identity,sha(capsuleBytes)).data;
 assert.equal(capsule.identity.repository,TARGET);assert.equal(capsule.identity.taskId,TASK);assert.equal(capsule.identity.planFingerprint,PLAN);assert.equal(capsule.identity.baseSha,BASE);
 assert.equal(capsule.identity.branch,'feat/calculator-agent/calculator-pilot-step7-v1');
 const p=capsule.payload;assert.equal(p.stage,'execution_complete');assert.equal(p.status,'passed');assert.equal(p.httpInFlight,false);assert.equal(p.publicationStarted,true);assert.ok(p.proposal);
 assert.equal(p.assessments.length,3);assert.ok(p.assessments.every((a,i)=>a.role===['security','reviewer','tester'][i]&&a.ready===true&&a.testsExecuted===false&&a.publicationAuthorized===false&&!a.findings.some(f=>['blocker','high'].includes(f.severity))));
 assert.equal(capsule.proposalDigest,calculatorProposalDigest(p.proposal));assert.equal(capsule.proposalDigest,'bc1e0790d5d4c54c06ea1abe8b6f5d8f6eca767a9a477f4146947d59f3fd6f5b');
 const savedReport=json('calculator-report.json');assert.equal(savedReport.reasonCode,'publication_or_ci_uncertain_inspect_no_replay');assert.equal(savedReport.status,'needs-review');assert.equal(savedReport.proposalTestsExecuted,true);assert.equal(savedReport.candidateTestsExecuted,false);assert.equal(savedReport.publication,undefined);assert.equal(savedReport.wholeAppCompleted,false);assert.equal(savedReport.legalEnabled,false);
 report.capsule={sha256:sha(capsuleBytes),proposalDigest:capsule.proposalDigest,publicationStarted:true,httpInFlight:false,
  assessments:p.assessments.map(a=>({role:a.role,ready:a.ready,findings:a.findings.length,unverifiedAreas:a.unverifiedAreas.length})),oldReceiptReason:savedReport.reasonCode};
 phase='charges';const charge=json('model-charge-final.json'),keys=['attemptedRequests','totalRequestBytes','reservedRunTokens','elapsedMs'];
 for(const item of [charge.carried,charge.newCharge,savedReport.aggregateT02Charge,p.modelState])assert.ok(keys.every(k=>Number.isSafeInteger(item[k])&&item[k]>=0));
 assert.equal(charge.carried.attemptedRequests,9);assert.equal(charge.newCharge.attemptedRequests,3);
 assert.ok(keys.every(k=>charge.carried[k]+charge.newCharge[k]===savedReport.aggregateT02Charge[k]));
 assert.equal(savedReport.aggregateT02Charge.attemptedRequests,12);
 const phases=[
  {runId:39747322491,settled:{attemptedRequests:1,totalRequestBytes:4840,reservedRunTokens:3070,elapsedMs:23206}},
  {runId:39753293947,settled:{attemptedRequests:1,totalRequestBytes:5300,reservedRunTokens:3223,elapsedMs:19922}},
  {runId:39756457942,settled:{attemptedRequests:4,totalRequestBytes:33403,reservedRunTokens:11835,elapsedMs:201580}},
  {runId:39765383540,settled:{attemptedRequests:3,totalRequestBytes:33296,reservedRunTokens:9071,elapsedMs:129638}},
  {runId:39790544926,settled:{attemptedRequests:3,totalRequestBytes:33299,reservedRunTokens:9036,elapsedMs:138709}},
 ];
 const observations=new Map();for(const [path,b] of files){if(!path.endsWith('.execution.json'))continue;const item=JSON.parse(b.toString('utf8'));if(item.identity?.taskId!==TASK)continue;const validated=parseCalculatorExecutionCheckpointBytes(b,item.identity,sha(b)).data;
  assert.equal(validated.identity.baseSha,BASE);assert.equal(validated.identity.repository,TARGET);
  const value=validated.payload.modelState,key=value.attemptedRequests+':'+value.totalRequestBytes;
  assert.ok(phases.some(p=>p.settled.attemptedRequests+':'+p.settled.totalRequestBytes===key));
  const old=observations.get(key);observations.set(key,old?Object.fromEntries(keys.map(k=>[k,Math.max(old[k],value[k])])):value);
 }
 const phaseCosts=phases.map(item=>{const high=observations.get(item.settled.attemptedRequests+':'+item.settled.totalRequestBytes);assert.ok(high);return {...item,checkpointHighWater:high,conservative:Object.fromEntries(keys.map(k=>[k,Math.max(item.settled[k],high[k])]))};});
 const recorded=Object.fromEntries(keys.map(k=>[k,phases.reduce((n,p)=>n+p.settled[k],0)]));assert.equal(canonical(recorded),canonical(savedReport.aggregateT02Charge));
 const conservative=Object.fromEntries(keys.map(k=>[k,phaseCosts.reduce((n,p)=>n+p.conservative[k],0)]));
 report.charges={carried:charge.carried,settledNew:charge.newCharge,capsuleHighWater:p.modelState,recordedAggregate:savedReport.aggregateT02Charge,conservativeAggregate:conservative,phaseCosts,allPriorCostsPreserved:true};
 phase='candidate';const head=await get('/git/ref/heads/feat/calculator-agent/calculator-pilot-step7-v1');assert.equal(head.object.sha,CANDIDATE);
 const commit=await get('/git/commits/'+CANDIDATE);assert.equal(commit.parents.length,1);assert.equal(commit.parents[0].sha,BASE);
 const current=await get('/git/trees/'+commit.tree.sha+'?recursive=1'),baseCommit=await get('/git/commits/'+BASE),before=await get('/git/trees/'+baseCommit.tree.sha+'?recursive=1');
 for(const tree of [current,before]){assert.equal(tree.truncated,false);assert.ok(tree.tree.length<=512);assert.ok(tree.tree.every(e=>e.type==='tree'||(e.type==='blob'&&e.mode==='100644')));}
 const currentFiles=new Map(current.tree.filter(e=>e.type==='blob').map(e=>[e.path,e.sha])),oldFiles=new Map(before.tree.filter(e=>e.type==='blob').map(e=>[e.path,e.sha]));
 const changed=[...new Set([...currentFiles.keys(),...oldFiles.keys()])].filter(path=>currentFiles.get(path)!==oldFiles.get(path)).sort();
 assert.equal(canonical(changed),canonical(p.proposal.files.map(f=>f.path).sort()));
 for(const f of p.proposal.files){const bytes=Buffer.from(f.content);const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');assert.equal(currentFiles.get(f.path),blob);}
 const pr=await get('/pulls/1');assert.equal(pr.state,'open');assert.equal(pr.draft,true);assert.equal(pr.head.sha,CANDIDATE);assert.equal(pr.head.ref,capsule.identity.branch);assert.equal(pr.base.ref,'feat/calculator-pilot-bootstrap');assert.equal(pr.base.sha,capsule.identity.bootstrapSha);
 report.candidate={sha:CANDIDATE,parent:BASE,changedPaths:changed,approvedFileBytesMatch:true,unchangedDependencyAndWorkflowBlobs:true,pr:1,draft:true};
 phase='ci';const {createCalculatorCiReader}=await import(join(compiled,'github/calculatorCi.js'));
 const {evaluateTestExecutionEvidence}=await import(join(compiled,'agents/tester/agent.js'));
 const ci=await createCalculatorCiReader({trustedWorkflows:[{id:390241255,path:'.github/workflows/calculator-task-ci.yml',blobSha:'45fae4a292a04e89a631ad7ff2469a3af7265e70'}]},
  {GITHUB_TOKEN:process.env.CALCULATOR_READ_TOKEN,AGENT_FACTORY_TARGET_PROFILE:'calculator',AGENT_ALLOWED_REPOSITORIES:TARGET})({repository:TARGET,branch:capsule.identity.branch,candidateSha:CANDIDATE});
 const checks=evaluateTestExecutionEvidence(ci.runs,ci.jobs,CANDIDATE,['Calculator task CI'],['Syntax','Task tests']);assert.equal(checks.status,'passed');assert.equal(checks.testsExecuted,true);
 const final=await get('/git/ref/heads/'+encodeURIComponent(capsule.identity.branch));assert.equal(final.object.sha,CANDIDATE);
 report.ci={status:'passed',testsExecuted:true,verifiedRunIds:ci.provenance.verifiedRunIds,workflowPins:ci.provenance.workflowPins};
 report.status='publication_reconciled_read_only';report.historicalManualCorrectionsDisclosed=true;
}catch{report.status='blocked';report.reason='publication_reconciliation_'+phase+'_unverified';process.exitCode=1;}
const text=JSON.stringify(report);assert.ok(Buffer.byteLength(text)<32768);writeFileSync(join(process.env.RUNNER_TEMP,'publication-reconcile-report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(text);
