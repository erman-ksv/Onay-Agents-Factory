// One-time metadata activation. No provider credential or task execution here.
import assert from 'node:assert/strict';
import {constants,openSync,fstatSync,readFileSync,closeSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createProjectModelBudgetGitHubStore} from '../github/projectModelBudgetStore.js';
import {prepareProjectRuntimeManifest,projectRuntimeManifestMetadata} from '../orchestration/projectRuntimeManifest.js';
import {createProjectTargetRegistry} from '../orchestration/projectTargetRegistry.js';
import {prepareProjectGoal,createProjectPlan,projectPlanBudgetIdentity} from '../orchestration/projectPlan.js';
import {authorizeGitHubProjectBudget} from '../orchestration/projectBudgetAuthorization.js';
import {prepareProjectStateProtection,verifyProjectStateProtection} from '../github/projectStateProtection.js';
import {createProjectCheckpointArchive} from '../github/projectCheckpointArchive.js';
import {createProjectCiPolicy,createProjectCiReader} from '../github/projectCi.js';
import {loadProjectRuntimeRecoveryKey} from '../orchestration/projectRuntimeRecovery.js';
import {readProjectHostEnvelope,destroyProjectCorrectionRecoveryKey} from '../orchestration/projectCorrectionCheckpoint.js';

export const MANIFEST_SHA256='97a2b05c8aebcb11227230b0526375bea9aa45688d2b6b01ece2fe2dd6b77284';
export async function inspectStoppedInputRepair(env){
  assert.equal(env.GITHUB_REPOSITORY,'erman-ksv/Onay-Agents-Factory');
  assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
  assert.equal(env.AGENT_FACTORY_LEGAL_ENABLED,'false');
  for(const name of ['GROQ_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY','OPENROUTER_API_KEY','CLOUDFLARE_API_KEY'])assert.equal(env[name],undefined);
  let fd,key,directory;
  const native=globalThis.fetch;let phase='manifest',requests=0;
  const report=(status,extra={})=>console.error(JSON.stringify({version:1,phase,status,...extra}));
  globalThis.fetch=async(input,init)=>{
    const u=new URL(String(input));assert.equal(u.origin,'https://api.github.com');assert.ok(['/repos/erman-ksv/Onay-Agents-Factory/','/repos/erman-ksv/Onay-Factory-Calculator/'].some(p=>u.pathname.startsWith(p)));assert.equal(init?.method,'GET');assert.equal(init?.body,undefined);assert.equal(init?.redirect,'error');assert.ok(++requests<=200);
    const family=u.pathname.includes('/git/')?'git-metadata':u.pathname.includes('/issues/')?'owner-approval':u.pathname.includes('/rules')?'state-rules':u.pathname.includes('/actions/')?'ci-metadata':'repository-metadata';
    try{const r=await native(input,init);report('http-result',{request:requests,family,httpStatus:r.status});return r;}catch{report('http-failed',{request:requests,family});throw Error('Read-only inspection transport failed');}
  };
  try{
    fd=openSync('.factory/runtime-project-manifest.json',constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=fstatSync(fd);assert.ok(stat.isFile()&&stat.nlink===1&&stat.size<=65536);
    const body=readFileSync(fd,'utf8');closeSync(fd);fd=undefined;
    const metadata=projectRuntimeManifestMetadata(prepareProjectRuntimeManifest(body,MANIFEST_SHA256)),v=JSON.parse(body);
    assert.equal(metadata.mode,'first-task');
    const target=createProjectTargetRegistry([v.profile]).select(v.profile.id),plan=createProjectPlan(prepareProjectGoal(target,v.goal),v.proposal);
    const token=env.FACTORY_STATE_TOKEN;assert.ok(token);
    phase='owner-and-history';report('begin');
    const controller=await authorizeGitHubProjectBudget({identity:projectPlanBudgetIdentity(plan),history:v.history,decision:v.decision,token,targetProfile:target});
    assert.equal(controller.operationMode,'development');
    assert.deepEqual(controller.historicalCharge,{requests:65,requestBytes:626530,reservedTokens:263359});
    assert.equal(controller.grant.maxRequests,73);
    phase='state-protection';report('begin');
    const protection=await prepareProjectStateProtection({controller,token:env.FACTORY_READ_TOKEN||token});
    phase='pinned-stopped-archive';report('begin');
    const archive=createProjectCheckpointArchive({controller,token,pin:{head:'1e00aed68632320ceaaa36bfd668fd164e08d21c',sequence:2}});const stored=await archive.inspect();assert.equal(stored.pin.head,'1e00aed68632320ceaaa36bfd668fd164e08d21c');assert.equal(stored.pin.sequence,2);
    phase='recovery-key';report('begin');
    key=loadProjectRuntimeRecoveryKey(env);
    phase='base-ci';report('begin');
    const ciPolicy=createProjectCiPolicy(target,v.workflowPins),ci=await createProjectCiReader(ciPolicy,{...env,GITHUB_TOKEN:token,AGENT_FACTORY_TARGET_PROFILE:v.profile.id,AGENT_ALLOWED_REPOSITORIES:plan.repository})({repository:plan.repository,branch:plan.request.baseRef,candidateSha:plan.request.baseSha});
    assert.equal(ci.status,'passed');
    phase='fresh-state-protection';report('begin');
    await verifyProjectStateProtection(protection,controller,'native');
    await controller.assertAuthorized();
    phase='stopped-state-reconciliation';report('begin');
    const state=await controller.inspect(),raw=await createProjectModelBudgetGitHubStore({projectKey:controller.projectKey,token}).read();assert.ok(raw);
    assert.deepEqual(state.used,{requests:66,requestBytes:631198,reservedTokens:266371});
    assert.equal(raw.data.reservations.length,1);const reservation=raw.data.reservations[0];
    const history=await archive.history();assert.deepEqual(history.map(e=>e.kind),['task-start','before-http']);
    directory=mkdtempSync(join(tmpdir(),'onay-stopped-audit-'));const records=[];
    for(const event of history){const path=join(directory,event.name);assert.ok(/^[a-z0-9-]+[.]json$/.test(event.name));writeFileSync(path,Buffer.from(event.ciphertextBase64,'base64'),{mode:0o600,flag:'wx'});
      const kind=event.kind==='task-start'?'onay-task-start-v1':'onay-runtime-http-v1',payload=JSON.parse(readProjectHostEnvelope(kind,key,path,event.sha256));
      assert.equal(payload.taskId,plan.tasks[0].id);
      if(event.kind==='task-start'){assert.equal(payload.planFingerprint,plan.fingerprint);assert.equal(payload.executionAuthorized,false);}
      else{assert.equal(payload.requestSha256,reservation.requestSha256);assert.equal(payload.requestBytes,reservation.requestBytes);assert.equal(reservation.reservationId,payload.executionId+':r1');assert.equal(payload.attemptedRequests,1);assert.equal(payload.providerCallsSent,0);assert.equal(payload.httpInFlight,true);}
      records.push({kind:event.kind,sequence:event.sequence,sha256:event.sha256});
    }
    assert.equal((await archive.inspect()).pin.head,stored.pin.head);
    return {version:1,status:'stopped-state-verified-needs-review',archivePin:stored.pin,checkpoints:records,used:state.used,remaining:state.remaining,providerSentAtLastCheckpoint:0,providerOutcomeAfterCheckpoint:'unverified',newProviderCalls:0,applicationWrites:0,budgetWrites:0,stateWrites:0,replayAuthorized:false,firstTaskRestartAuthorized:false,legalEnabled:false};

  }catch{report('blocked',{requests,providerCalls:0,applicationWrites:0,budgetWrites:0,stateWrites:0});throw Error('Read-only launch inspection blocked');}
  finally{if(directory)rmSync(directory,{recursive:true,force:true});if(fd!==undefined)closeSync(fd);if(key)destroyProjectCorrectionRecoveryKey(key);globalThis.fetch=native;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await inspectStoppedInputRepair(process.env)));}
  catch{console.error('Read-only inspection stopped. No mutation or model execution was permitted.');process.exitCode=1;}
}
