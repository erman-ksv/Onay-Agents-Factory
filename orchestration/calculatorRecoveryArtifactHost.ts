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
   assertSourceRemote:async binding=>{if(binding.checkpointSha256!==checkpoint.sha256||binding.receiptSha256!==receipt.sha256||binding.taskId!==taskId||binding.baseSha!==baseSha)return refuse();await artifact.assertRemote();},
  });if(!cap)return refuse();taskId=cap.identity.taskId;baseSha=cap.identity.baseSha;return cap;
 }catch{return refuse();}
}
