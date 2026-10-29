import {parseCalculatorExecutionCheckpointBytes,type CalculatorExecutionCheckpointIdentity} from './calculatorExecutionCheckpoint.js';
import {createCalculatorPlan,type CalculatorPlan} from './calculatorPlan.js';
import {calculatorRejectedProposalMetadata} from './calculatorRejectedProposalCheckpoint.js';
import {buildCalculatorRejectedDraftCorrection} from './calculatorRejectedDraftCorrection.js';
import type {CalculatorSnapshot} from '../github/calculatorSnapshot.js';
import {createHash} from 'node:crypto';

export const CALCULATOR_REJECTED_RECOVERY_ERROR='Rejected proposal recovery evidence refused. No model request, replay or publication is authorized.';
/** Offline request preparation only. The digest/identity must come from the
 * trusted host barrier, never from model input. This does not claim that barrier,
 * consume a grant, reset charges or authorize transport. */
export function prepareCalculatorRejectedProposalRecovery(input:Readonly<{
 bytes:Buffer;expectedSha256:string;identity:CalculatorExecutionCheckpointIdentity;
 plan:CalculatorPlan;taskId:string;snapshot:CalculatorSnapshot;model:string;
}>){
 try{
  if(!input||typeof input.expectedSha256!=='string'||!/^([a-f0-9]{64})$/.test(input.expectedSha256))throw Error();
  const plan=createCalculatorPlan(input.plan.request,input.plan.proposal),task=plan.tasks.find(t=>t.id===input.taskId);
  const identity=input.identity,snapshot=input.snapshot;
  // The existing correction prompt is scoped to Frontend, not a generic coder.
  if(!task||task.role!=='frontend'||plan.status!=='planned'||input.plan.fingerprint!==plan.fingerprint||
   identity.repository!==plan.owner.repository||identity.goalId!==plan.owner.id||identity.ownerFingerprint!==plan.owner.ownerFingerprint||
   identity.planFingerprint!==plan.fingerprint||identity.taskId!==task.id||identity.branch!==plan.branch||
   snapshot.repository!==identity.repository||snapshot.baseRef!==identity.branch||snapshot.baseSha!==identity.baseSha||
   snapshot.changePaths.length!==task.paths.length||task.paths.some(p=>!snapshot.changePaths.includes(p)))throw Error();
  const parsed=parseCalculatorExecutionCheckpointBytes(input.bytes,identity,input.expectedSha256),payload=parsed.data.payload,rejected=payload.rejectedProposal;
  if(payload.status!=='blocked'||payload.attempt!==1||payload.stage!=='generate_1'||payload.httpInFlight||payload.publicationStarted||
   payload.proposal||payload.assessments.length||!rejected||rejected.kind!=='generation'||rejected.validationCode!=='proposal_changes_invalid'||
   payload.failure?.reasonCode!=='proposal_changes_invalid'||(payload.failure.httpStatus!==undefined&&payload.failure.httpStatus!==200)||
   payload.modelState.attemptedRequests<1||payload.modelState.totalRequestBytes<1||payload.modelState.reservedRunTokens<1)throw Error();
  const request=buildCalculatorRejectedDraftCorrection(input.model,task,rejected,snapshot);
  const rejection=calculatorRejectedProposalMetadata(rejected);
  // Independent of runtime execution IDs and checkpoint serialization/sequence.
  // The shared ledger reserves this stable scope before sending any correction.
  const executionId='rejected-'+createHash('sha256').update(JSON.stringify([plan.fingerprint,task.id,identity.baseSha,rejection.resultSha256])).digest('hex').slice(0,64);
  return Object.freeze({request:Object.freeze(request),metadata:Object.freeze({
   checkpointSha256:input.expectedSha256,sequence:parsed.data.sequence,taskId:task.id,baseSha:identity.baseSha,executionId,
   rejectedProposal:rejection,historicalCharge:Object.freeze({...payload.modelState}),
   modelRequestAuthorized:false as const,publicationAuthorized:false as const,
  })});
 }catch{throw Error(CALCULATOR_REJECTED_RECOVERY_ERROR);}
}
