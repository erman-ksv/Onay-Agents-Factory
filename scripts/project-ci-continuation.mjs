// Trusted host launch only. Workflow must pin EXPECTED_RUNTIME_MANIFEST_SHA256
// independently; event/model data must never supply or calculate that value.
import {constants,openSync,fstatSync,readFileSync,closeSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareProjectRuntimeManifest,bootstrapProjectRuntime,projectRuntimeManifestMetadata} from '../orchestration/projectRuntimeManifest.js';
import {createProjectInitialTaskRuntime} from '../orchestration/projectNextTaskWorker.js';
import {createProjectCiReader} from '../github/projectCi.js';
import {runProjectCiContinuation} from '../orchestration/projectCiContinuation.js';
let fd,host;
try{
 fd=openSync('.factory/runtime-project-manifest.json',constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>65536)throw Error('unverified manifest');
 const body=readFileSync(fd,'utf8');closeSync(fd);fd=undefined;
 const manifest=prepareProjectRuntimeManifest(body,process.env.EXPECTED_RUNTIME_MANIFEST_SHA256),directory=mkdtempSync(join(tmpdir(),'onay-native-continuation-'));
 host=await bootstrapProjectRuntime(manifest,process.env,directory);
 let continuation=host.options;
 if(host.mode==='first-task'){const {plan,ciPolicy,env}=host.options,baseCi=await createProjectCiReader(ciPolicy,env)({repository:plan.repository,branch:plan.request.baseRef,candidateSha:plan.request.baseSha}),initial=await createProjectInitialTaskRuntime(host.options).start(baseCi);continuation={...host.options,candidateSha:initial.candidate.candidateSha,polling:{maxPolls:12,intervalMs:10000}};}
 const result=await runProjectCiContinuation(continuation);
 console.log(JSON.stringify({version:1,manifest:projectRuntimeManifestMetadata(manifest),result,legalEnabled:false}));
 if(!['plan-ci-recorded','awaiting-ci','already-recorded'].includes(result.status))process.exitCode=1;
}catch{
 // Public hashes only. Retain the last acknowledged pin even when an unknown
 // response stopped the run; never reconstruct it from an older cache entry.
 if(host)console.log(JSON.stringify({version:1,status:'blocked-or-uncertain',archivePin:host.options.archive.snapshot().pin,executionAuthorized:false}));
 console.error('Factory continuation blocked or uncertain. Preserve the latest archive pin and budget; no automatic retry, key rotation, model replay or new allowance.');process.exitCode=1;
}finally{if(fd!==undefined)closeSync(fd);host?.dispose();}
