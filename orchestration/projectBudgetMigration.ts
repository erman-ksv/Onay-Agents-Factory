import {createCalculatorPlan} from './calculatorPlan.js';
import {reconcileProjectBudgetHistory,projectBudgetApprovalDigest} from './projectBudgetAuthorization.js';
export const PROJECT_HISTORY_STAGE_ERROR='Project history staging is unverified. No initialization, allowance or model call is authorized.';
/** Read-only staging data, deliberately NOT an authorization or ledger. The
 * host pins audited history; missing/changed totals never become zero. */
export function stageCalculatorProjectHistory(ownerRequest:unknown,proposal:unknown,history:unknown,expectedHistoryDigest:string){
 try{
  const plan=createCalculatorPlan(ownerRequest,proposal),identity=Object.freeze({projectId:plan.owner.id,repository:plan.owner.repository,
   planFingerprint:plan.fingerprint,ownerFingerprint:plan.owner.ownerFingerprint,taskIds:Object.freeze(plan.tasks.map(t=>t.id))});
  const reconciled=reconcileProjectBudgetHistory(history,identity);
  if(!/^[a-f0-9]{64}$/.test(expectedHistoryDigest)||reconciled.digest!==expectedHistoryDigest)throw Error();
  const projectKey=projectBudgetApprovalDigest({projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,ownerFingerprint:identity.ownerFingerprint});
  return Object.freeze({version:1 as const,status:'migration-prepared-no-new-allowance' as const,identity,historyDigest:reconciled.digest,
   historicalCharge:reconciled.charge,coveredScopes:reconciled.coveredScopes,projectKey,
   targetRepository:'erman-ksv/Onay-Agents-Factory' as const,targetRef:'refs/heads/state/project-model-budget/'+projectKey,
   ownerDecision:null,actualLedgerInitialized:false as const,additionalRequestsAuthorized:0 as const,additionalReservedTokensAuthorized:0 as const,
   modelCalls:0 as const,repositoryWrites:0 as const,legalEnabled:false as const});
 }catch{throw Error(PROJECT_HISTORY_STAGE_ERROR);}
}
