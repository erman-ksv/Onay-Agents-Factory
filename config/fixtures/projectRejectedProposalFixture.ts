/** Offline OWNER/provider responses, real AES files, ledger and local Git. */
import {createHash} from 'node:crypto';import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
import {createProjectRecoveryWorkerFixtureForTests} from './projectRecoveryWorkerFixture.js';
import {createProjectUncertainRecoveryRuntimeForTests} from '../../orchestration/projectNextTaskWorker.js';
import {loadGitHubProjectTaskSnapshot} from '../../github/projectSourceSnapshot.js';
import {readProjectHostEnvelope} from '../../orchestration/projectCorrectionCheckpoint.js';
import {projectBudgetStateDigest} from '../../orchestration/projectBudgetExtensionAuthorization.js';
import {projectBudgetApprovalDigest} from '../../orchestration/projectBudgetAuthorization.js';
import {inspectProjectRejectedProposalForTests,proposeProjectRejectedProposalAdmission,authorizeProjectRejectedProposalForTests} from '../../orchestration/projectRejectedProposalRecovery.js';
export async function createProjectRejectedProposalFixtureForTests(maxRequests=16){
 const f=await createProjectRecoveryWorkerFixtureForTests('normal',false,'openai/gpt-oss-120b',maxRequests);let rejectedCalls=0;
 const rejectModel:typeof fetch=async(_url,init)=>{rejectedCalls++;const p=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({summary:'Ambiguous initial fixture proposal.',changes:[{operation:'patch',path:'src/note.mjs',sourceSha256:p.sourceFiles.find((s:any)=>s.path==='src/note.mjs').sourceSha256,edits:[{before:' ',after:'  '}],message:'Ambiguous whitespace fixture.'}]})}}]});};
 try{await createProjectUncertainRecoveryRuntimeForTests(f.options,{...f.injections,model:rejectModel}).recover(f.ticket);throw Error('Expected fixture rejection');}catch{if(rejectedCalls!==1)throw Error('Fixture failed before provider');}
 const snapshot=await loadGitHubProjectTaskSnapshot({plan:f.plan,taskId:f.taskId,token:'offline',transport:f.injections.github}),history=await f.archive.history(),event=history.at(-1)!;
 const privatePath=join(f.root,'saved-rejected.json');writeFileSync(privatePath,Buffer.from(event.ciphertextBase64,'base64'),{mode:0o600,flag:'wx'});const reply=JSON.parse(readProjectHostEnvelope('onay-runtime-rejected-reply-v1',f.options.key,privatePath,event.sha256));
 const binding={taskId:f.taskId,archiveHead:f.archive.snapshot().pin!.head,archiveSequence:history.length,checkpointSha256:event.sha256,budgetStateSha256:projectBudgetStateDigest((await f.store.read())!.data),priorExecutionId:reply.executionId,priorRequestSha256:reply.requestSha256,priorResponseSha256:reply.responseSha256,baseSha:f.baseSha};
 const evidenceOptions={plan:f.plan,controller:f.controller,archive:f.archive,key:f.options.key,binding};
 const evidence=await inspectProjectRejectedProposalForTests(evidenceOptions,snapshot,f.store),created=new Date().toISOString(),document=proposeProjectRejectedProposalAdmission(evidence,new Date(Date.now()+86400000).toISOString()),decision={issueNumber:75,commentId:9901,bodySha256:projectBudgetApprovalDigest(document)},owner={valid:true,edited:false};
 const ownerTransport:typeof fetch=async()=>Response.json({id:9901,user:{login:'erman-ksv',type:'User'},author_association:owner.valid?'OWNER':'NONE',issue_url:'https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/75',html_url:'https://github.com/erman-ksv/Onay-Agents-Factory/pull/75#issuecomment-9901',created_at:created,updated_at:owner.edited?new Date(Date.now()+1000).toISOString():created,body:JSON.stringify(document)});
 const authorize=()=>authorizeProjectRejectedProposalForTests(evidence,decision,'offline-owner',ownerTransport),approval=await authorize(),directory=join(f.root,'rejected-recovery');mkdirSync(directory,{mode:0o700});
 return {...f,snapshot,evidenceOptions,evidence,approval,authorize,document,decision,owner,ownerTransport,binding,rejectedCalls:()=>rejectedCalls,options:{...f.options,directory}};
}
