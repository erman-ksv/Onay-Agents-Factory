import {createHash} from 'node:crypto';
import {createCalculatorPlan,calculatorPlanDigest,type CalculatorPlan} from './calculatorPlan.js';
import {parseCalculatorExecutionCheckpointBytes,type CalculatorExecutionCheckpointIdentity} from './calculatorExecutionCheckpoint.js';
import {parseTeamTaskSnapshotBytes,type TeamTaskSnapshot} from './teamTaskStore.js';
import {calculatorRejectedProposalMetadata} from './calculatorRejectedProposalCheckpoint.js';
import {verifyCalculatorAfterCiCandidateCi} from './calculatorAfterCi.js';
import type {CalculatorCiEvidence} from '../github/calculatorCi.js';
import type {CalculatorCurrentChecks} from './calculatorWorkspace.js';
export const CALCULATOR_VERIFIED_CORRECTION_ERROR='Corrected task evidence refused. Preserve original failed receipt and charges; no successor execution is authorized.';
const refuse=():never=>{throw Error(CALCULATOR_VERIFIED_CORRECTION_ERROR);};
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
type Archive=Readonly<{bytes:Buffer;sha256:string;identity:CalculatorExecutionCheckpointIdentity}>;
type Receipt=Readonly<{bytes:Buffer;sha256:string}>;
export type CalculatorVerifiedCorrection=Readonly<{kind:'verified-corrected-task';planFingerprint:string;taskId:string;candidateSha:string;originalCheckpointSha256:string;originalReceiptSha256:string;correctionReceiptSha256:string;checkpointSha256:string;executionAuthorized:false}>;
type Binding=Omit<CalculatorVerifiedCorrection,'kind'|'executionAuthorized'>;
type State={original:string;receipt:TeamTaskSnapshot;plan:CalculatorPlan;binding:Binding;assertRemote:(binding:Binding)=>Promise<void>;ci:(input:{repository:string;branch:string;candidateSha:string})=>Promise<CalculatorCiEvidence>;getHead:(branch:string)=>Promise<string>;failed:boolean};
const verified=new WeakMap<object,State>();
/** Host-only archive qualification; self-consistent JSON is not provenance.
 * Expected digests and assertRemote must originate in authenticated host tools. */
export async function qualifyCalculatorVerifiedCorrection(planInput:CalculatorPlan,input:Readonly<{
 original:Archive;originalReceipt:Receipt;correction:Archive;correctionReceipt:Receipt;
}>,host:Readonly<{
 assertRemote:(binding:Binding)=>Promise<void>;ci:State['ci'];getHead:State['getHead'];
 verifyCandidate:(input:{plan:CalculatorPlan;taskId:string;candidateSha:string;checkpoint:ReturnType<typeof parseCalculatorExecutionCheckpointBytes>['data']['payload']})=>Promise<CalculatorCurrentChecks|undefined>;
}>):Promise<CalculatorVerifiedCorrection>{
 try{
  if(!host||[host.assertRemote,host.ci,host.getHead,host.verifyCandidate].some(f=>typeof f!=='function'))return refuse();
  const plan=createCalculatorPlan(planInput.request,planInput.proposal);if(plan.fingerprint!==planInput.fingerprint||plan.status!=='planned')return refuse();
  const parse=(a:Archive)=>{if(!a||typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256))return refuse();return parseCalculatorExecutionCheckpointBytes(a.bytes,a.identity,a.sha256).data;};
  const source=parse(input.original),correction=parse(input.correction),task=plan.tasks.find(t=>t.id===source.identity.taskId),s=source.payload,p=correction.payload;
  if(!task||task.role!=='frontend'||source.identity.repository!==plan.owner.repository||source.identity.goalId!==plan.owner.id||source.identity.ownerFingerprint!==plan.owner.ownerFingerprint||source.identity.planFingerprint!==plan.fingerprint||source.identity.branch!==plan.branch||source.identity.bootstrapSha!==plan.owner.baseSha||
   ['repository','goalId','ownerFingerprint','planFingerprint','taskId','branch','baseSha','bootstrapSha'].some(k=>source.identity[k as keyof typeof source.identity]!==correction.identity[k as keyof typeof correction.identity])||
   s.status!=='blocked'||s.attempt!==1||s.stage!=='generate_1'||s.proposal||s.assessments.length||s.httpInFlight||s.publicationStarted||s.failure?.reasonCode!=='proposal_changes_invalid'||(s.failure.httpStatus!==undefined&&s.failure.httpStatus!==200)||!s.rejectedProposal||s.rejectedProposal.kind!=='generation'||s.rejectedProposal.validationCode!=='proposal_changes_invalid'||
   p.status!=='passed'||p.stage!=='execution_complete'||p.attempt!==2||p.httpInFlight||!p.publicationStarted||p.failure||p.rejectedProposal||!p.proposal||p.modelState.attemptedRequests!==4||p.assessments.length!==3||
   p.assessments.some(a=>!a.ready||a.findings.some(f=>f.severity==='blocker'||f.severity==='high'))||p.proposal.files.some(f=>!task.paths.includes(f.path)))return refuse();
  const resultHash=calculatorRejectedProposalMetadata(s.rejectedProposal).resultSha256;
  const executionId='rejected-'+hash(JSON.stringify([plan.fingerprint,task.id,source.identity.baseSha,resultHash])).slice(0,64),fingerprint=hash(executionId);
  const receipt=(a:Receipt,id:string,fp:string)=>{if(!a||typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256)||hash(a.bytes)!==a.sha256)return refuse();return parseTeamTaskSnapshotBytes(a.bytes,{id,fingerprint:fp});};
  const original=receipt(input.originalReceipt,'calc-'+task.id,calculatorPlanDigest({planFingerprint:plan.fingerprint,taskId:task.id})),corrected=receipt(input.correctionReceipt,'calc-recovery-'+fingerprint.slice(0,40),fingerprint),pub=corrected.publication;
  if(original.status!=='blocked'||original.reasonCode!=='execution_failed_no_replay'||original.publication||!original.stages.some(a=>a.stage==='generate_1'&&a.status==='blocked')||
   corrected.status!=='needs-review'||!['task_candidate_verified_not_whole_app','candidate_ci_pending_no_polling'].includes(corrected.reasonCode??'')||!pub||pub.branch!==plan.branch||pub.url!=='https://github.com/'+plan.owner.repository+'/pull/'+pub.number||
   ['admit_project_correction','load_current_source','repair_2','security_2','reviewer_2','tester_2','host_tests_2','publish_candidate','verify_candidate_ci'].some(name=>!corrected.stages.some(a=>a.stage===name&&a.status==='passed')))return refuse();
  const binding=Object.freeze({planFingerprint:plan.fingerprint,taskId:task.id,candidateSha:pub.headSha,originalCheckpointSha256:input.original.sha256,originalReceiptSha256:input.originalReceipt.sha256,correctionReceiptSha256:input.correctionReceipt.sha256,checkpointSha256:input.correction.sha256});
  const state:State={original:JSON.stringify(original),receipt:structuredClone(corrected),plan,binding,assertRemote:host.assertRemote,ci:host.ci,getHead:host.getHead,failed:false};
  await check(state);
  const proof=await host.verifyCandidate({plan,taskId:task.id,candidateSha:pub.headSha,checkpoint:structuredClone(p)});
  if(!proof||proof.repository!==plan.owner.repository||proof.planFingerprint!==plan.fingerprint||proof.taskId!==task.id||proof.candidateSha!==pub.headSha||proof.currentSha!==pub.headSha||proof.securityReady!==true||proof.independentReviewReady!==true||proof.taskChecksPassed!==true||proof.testsExecuted!==true)return refuse();
  await check(state);
  const cap=Object.freeze({kind:'verified-corrected-task' as const,...binding,executionAuthorized:false as const});verified.set(cap,state);return cap;
 }catch{return refuse();}
}
async function check(s:State){
 if(s.failed)return refuse();try{
  await s.assertRemote(s.binding);
  if(await s.getHead(s.plan.branch)!==s.binding.candidateSha||!verifyCalculatorAfterCiCandidateCi(await s.ci({repository:s.plan.owner.repository,branch:s.plan.branch,candidateSha:s.binding.candidateSha}),s.plan.owner.repository,s.plan.branch,s.binding.candidateSha)||await s.getHead(s.plan.branch)!==s.binding.candidateSha)return refuse();
  await s.assertRemote(s.binding);
  if(await s.getHead(s.plan.branch)!==s.binding.candidateSha)return refuse();
 }catch{s.failed=true;return refuse();}
}
export function prepareCalculatorVerifiedCorrections(value:unknown):readonly CalculatorVerifiedCorrection[]|undefined{
 if(value===undefined)return undefined;
 if(!Array.isArray(value)||!value.length||value.length>64||value.some(c=>!c||typeof c!=='object'||!verified.has(c))||new Set(value.map(c=>c.taskId)).size!==value.length)return refuse();
 return Object.freeze([...value]);
}
export async function resolveCalculatorVerifiedCorrection(cap:CalculatorVerifiedCorrection,plan:CalculatorPlan,original:TeamTaskSnapshot|undefined,currentSha:string):Promise<TeamTaskSnapshot>{
 const state=verified.get(cap);if(!state)return refuse();
 if(plan.fingerprint!==state.plan.fingerprint||currentSha!==state.binding.candidateSha||JSON.stringify(original)!==state.original){state.failed=true;return refuse();}
 await check(state);return structuredClone(state.receipt);
}
