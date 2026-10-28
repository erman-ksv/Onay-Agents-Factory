/** Synthetic failed uncertain-1 followed by a separately approved replacement.
 * All model/GitHub/CI calls are mocked; ciphertext and local Git are real. */
import assert from 'node:assert/strict';
import {createProjectRecoveryWorkerFixtureForTests} from './projectRecoveryWorkerFixture.js';
import {createProjectUncertainRecoveryRuntimeForTests} from '../../orchestration/projectNextTaskWorker.js';
import {createProjectCheckpointArchiveForTests} from '../../github/projectCheckpointArchive.js';
import {projectBudgetStateDigest} from '../../orchestration/projectBudgetExtensionAuthorization.js';
import {projectBudgetApprovalDigest} from '../../orchestration/projectBudgetAuthorization.js';
import {proposeProjectReplacementRecoveryApproval,authorizeProjectReplacementRecoveryForTests} from '../../orchestration/projectReplacementRecoveryApproval.js';
import {prepareProjectReplacementRecoveryClaimForTests} from '../../orchestration/projectUncertainRecoveryClaim.js';
export async function createProjectReplacementWorkerFixtureForTests(withGrantExtension=true){
 const f=await createProjectRecoveryWorkerFixtureForTests('provider-401',withGrantExtension),taskId=f.plan.tasks[0]!.id;
 await assert.rejects(()=>createProjectUncertainRecoveryRuntimeForTests(f.options,f.injections).recover(f.ticket));assert.equal(f.calls(),1);assert.equal((await f.controller.inspect()).used.requests,2);f.setMode('normal');
 const pin=f.archive.snapshot().pin!;assert.equal(pin.sequence,4);
 const binding={taskId,archiveHead:pin.head,archiveSequence:4 as const,budgetStateSha256:projectBudgetStateDigest((await f.store.read())!.data),originalRequestSha256:'f'.repeat(64),model:'openai/gpt-oss-120b' as const,failedRunId:123,failedRunSha:'1'.repeat(40)},decision={issueNumber:75,commentId:902,bodySha256:'0'.repeat(64)},approveOptions={controller:f.controller,binding,decision,token:'offline-only'},document=proposeProjectReplacementRecoveryApproval(approveOptions,new Date(Date.now()+86400000).toISOString());decision.bodySha256=projectBudgetApprovalDigest(document);const created=new Date(Date.now()-1000).toISOString(),owner={id:902,user:{login:'erman-ksv',type:'User'},author_association:'OWNER',issue_url:'https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/75',html_url:'https://github.com/erman-ksv/Onay-Agents-Factory/pull/75#issuecomment-902',created_at:created,updated_at:created,body:JSON.stringify(document)},run={id:123,status:'completed',conclusion:'failure',run_attempt:1,event:'push',head_sha:binding.failedRunSha,head_branch:'feat/calculator-t02-charge-reconcile-20261022',path:'.github/workflows/project-uncertain-recovery.yml',repository:{full_name:'erman-ksv/Onay-Agents-Factory'}};
 const approvalTransport:typeof fetch=async(url,init)=>{assert.equal(init?.method,'GET');return Response.json(String(url).includes('/actions/runs/')?run:owner);};
 async function claimOptions(){return {controller:f.controller,binding,approval:await authorizeProjectReplacementRecoveryForTests(approveOptions,approvalTransport),archive:createProjectCheckpointArchiveForTests({controller:f.controller,token:'offline-only',pin},f.api.transport),key:f.options.key,...(f.lineage?{lineage:f.lineage}:{})};}
 async function prepare(){const claim=await claimOptions();const ticket=await prepareProjectReplacementRecoveryClaimForTests(claim,f.store);return {ticket,claim,options:{...f.options,archive:claim.archive,env:{...f.options.env,GROQ_MODEL:binding.model}}};}
 return {...f,binding,owner,run,pin,claimOptions,prepare};
}
