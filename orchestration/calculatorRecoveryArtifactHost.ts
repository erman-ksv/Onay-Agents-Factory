import {createCalculatorPlan} from './calculatorPlan.js';
import {restoreCalculatorRecoveryState,type CalculatorRecoveryStateMapping} from './calculatorRecoveryState.js';
import {isCalculatorRecoveryArtifact,type CalculatorRecoveryArtifact} from '../github/calculatorRecoveryArtifact.js';
import {prepareCalculatorRuntimeRecoveryHost,type CalculatorRuntimeRecoveryHost} from './calculatorRuntimeRecovery.js';
import type {CalculatorExecutionCheckpointIdentity} from './calculatorExecutionCheckpoint.js';
/** Concrete source assertion from a digest-verified native artifact capability.
 * Claim callbacks remain the separately verified native claim adapter. No
 * provider/controller/grant is created and no raw contents enter metadata. */
export function createCalculatorRecoveryArtifactHost(artifact:CalculatorRecoveryArtifact,
 mapping:Readonly<{checkpointPath:string;receiptPath:string;identity:CalculatorExecutionCheckpointIdentity}>,
 operations:Pick<CalculatorRuntimeRecoveryHost,'verifyDependencies'|'claimRecovery'|'assertRecovery'>):CalculatorRuntimeRecoveryHost{
 const refuse=():never=>{throw Error('Authenticated recovery artifact host refused; no model or replay is authorized.');};
 try{
  if(!isCalculatorRecoveryArtifact(artifact)||!mapping||mapping.checkpointPath===mapping.receiptPath)return refuse();
  const checkpoint=artifact.metadata.files.find(f=>f.path===mapping.checkpointPath),receipt=artifact.metadata.files.find(f=>f.path===mapping.receiptPath);
  if(!checkpoint||!receipt)return refuse();
  let taskId='',baseSha='';
  const cap=prepareCalculatorRuntimeRecoveryHost({bytes:artifact.readPrivateFile(checkpoint.path),expectedSha256:checkpoint.sha256,identity:mapping.identity,receipt:artifact.readPrivateFile(receipt.path),receiptSha256:receipt.sha256,
   verifyDependencies:operations.verifyDependencies,claimRecovery:operations.claimRecovery,assertRecovery:operations.assertRecovery,
   assertSourceRemote:async(binding:Parameters<CalculatorRuntimeRecoveryHost['assertSourceRemote']>[0])=>{if(binding.checkpointSha256!==checkpoint.sha256||binding.receiptSha256!==receipt.sha256||binding.taskId!==taskId||binding.baseSha!==baseSha)return refuse();await artifact.assertRemote();},
  });if(!cap)return refuse();taskId=cap.identity.taskId;baseSha=cap.identity.baseSha;return cap;
 }catch{return refuse();}
}

/** Production composition: authenticate the checkpoint/receipt BEFORE restoring
 * metadata. The ordinary project runtime still owns budget admission, the
 * native one-use claim, dependency verification and every execution gate. */
export async function restoreCalculatorRecoveryArtifactHost(artifact:CalculatorRecoveryArtifact,
 source:Readonly<{checkpointPath:string;receiptPath:string;identity:CalculatorExecutionCheckpointIdentity}>,
 state:CalculatorRecoveryStateMapping,ownerRequest:unknown,directory:string,
 operations:Pick<CalculatorRuntimeRecoveryHost,'verifyDependencies'|'claimRecovery'|'assertRecovery'>){
 const host=createCalculatorRecoveryArtifactHost(artifact,source,operations);
 if(state.taskId!==host.identity.taskId||!state.receipts.some(r=>r.taskId===host.identity.taskId&&r.path===source.receiptPath))
  throw Error('Authenticated recovery source and state do not match.');
 const archived=JSON.parse(artifact.readPrivateFile(state.planPath).toString('utf8')),plan=createCalculatorPlan(ownerRequest,archived.proposal);
 if(plan.fingerprint!==host.identity.planFingerprint||plan.owner.ownerFingerprint!==host.identity.ownerFingerprint||plan.owner.id!==host.identity.goalId||plan.owner.baseSha!==host.identity.bootstrapSha||plan.branch!==host.identity.branch)throw Error('Authenticated recovery source and plan do not match.');
 const restored=await restoreCalculatorRecoveryState(artifact,state,ownerRequest,directory);
 if(restored.planFingerprint!==host.identity.planFingerprint)throw Error('Authenticated recovery source and plan do not match.');
 return Object.freeze({state:restored,host});
}
