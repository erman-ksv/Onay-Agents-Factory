/** Offline-safe, one-event historical t02 admission. This module does not
 * import an AI provider or execute a task; a trusted host must supply a callback.
 * The historical receipt is never edited, and the durable event is consumed
 * before the callback can be invoked. */
import { TeamTaskStore } from "./teamTaskStore.js";
import { CalculatorPlanStore } from "./calculatorPlanStore.js";
import type { CalculatorSnapshotReader } from "../github/calculatorSnapshot.js";
import type { CalculatorCiEvidence } from "../github/calculatorCi.js";
import type { CalculatorCheckRunner } from "./calculatorWorkspace.js";
import { openCalculatorWorkspace, selectCalculatorWorkspaceTask, assertCalculatorWorkspaceCurrent } from "./calculatorWorkspace.js";
import { calculatorAfterCiEventIdentity, prepareCalculatorAfterCiRequest,
  verifyCalculatorAfterCiCandidateCi } from "./calculatorAfterCi.js";
import { assertCalculatorT02InspectedSuccessorPreview,
  type CalculatorT02ReadOnlyPreselection } from "./calculatorT02SuccessorPreview.js";
import { inspectCalculatorT02AfterCiEvent } from "./calculatorT02AfterCiEventPreflight.js";

export const CALCULATOR_T02_ADMISSION_ERROR = "Historical t02 admission refused; no replay or model request authorized.";
type Report = Readonly<{status:"blocked"|"consumed";reason:string;callbackInvoked:boolean;wholeStep8Closed:false}>;
export type HistoricalT02AdmissionTools = Readonly<{
  eventDirectory:string;
  ci:(input:{repository:string;branch:string;candidateSha:string})=>Promise<CalculatorCiEvidence>;
  verifyDependencies:CalculatorCheckRunner;
  /** Must persist the claimed event to external durable state before any callback. */
  persistBarrier:(identity:Readonly<{id:string;fingerprint:string}>)=>Promise<void>;
  /** Host-owned callback; this adapter neither provides nor invokes a model itself. */
  executeOne:(taskId:string)=>Promise<void>;
}>;
const blocked=(reason:string):Report=>Object.freeze({status:"blocked",reason,callbackInvoked:false,wholeStep8Closed:false});
/** The execution callback is deliberately not a factory agent connector.
 * This is an ordering/replay barrier tested offline; live approval remains separate. */
export async function admitHistoricalT02OneSuccessor(store:CalculatorPlanStore,
  reader:CalculatorSnapshotReader, preview:CalculatorT02ReadOnlyPreselection,
  tools:HistoricalT02AdmissionTools):Promise<Report> {
  let barrier:TeamTaskStore|undefined,claimed=false,invoked=false;
  try {
    assertCalculatorT02InspectedSuccessorPreview(preview);
    if(!tools || typeof tools.ci!=="function" || typeof tools.verifyDependencies!=="function" ||
       typeof tools.persistBarrier!=="function" || typeof tools.executeOne!=="function" ||
       preview.executionAuthorized!==false || preview.readOnly!==true ||
       preview.nextTaskId!=="calculator-pilot-step7-v1-34ee03-t03" ||
       preview.previousTaskId!=="calculator-pilot-step7-v1-34ee03-t02")return blocked("configuration_unverified");
    const plan=store.inspect();
    if(!plan || plan.status!=="planned" || plan.fingerprint!==preview.planFingerprint)return blocked("plan_changed");
    const request=prepareCalculatorAfterCiRequest({version:1,planFingerprint:preview.planFingerprint,
      previousTaskId:preview.previousTaskId,candidateSha:preview.candidateSha,
      expectedNextTaskId:preview.nextTaskId});
    const id=calculatorAfterCiEventIdentity(request);
    barrier=new TeamTaskStore(tools.eventDirectory,id);
    if(barrier.inspectExisting()||barrier.inspectExistingLock())return blocked("event_already_consumed");
    const ciInput={repository:plan.owner.repository,branch:plan.branch,candidateSha:preview.candidateSha};
    if(!verifyCalculatorAfterCiCandidateCi(await tools.ci(ciInput),ciInput.repository,ciInput.branch,ciInput.candidateSha))
      return blocked("ci_unverified");
    const workspace=await openCalculatorWorkspace(store,reader,plan.branch,preview.candidateSha);
    const chosen=await selectCalculatorWorkspaceTask(workspace,tools.verifyDependencies,
      {inspectedT02:preview,eventDirectory:tools.eventDirectory});
    if(chosen.status!=="ready" || chosen.task?.id!==preview.nextTaskId ||
       !chosen.verifiedTaskIds.includes(preview.previousTaskId))return blocked("successor_unverified");
    if(!verifyCalculatorAfterCiCandidateCi(await tools.ci(ciInput),ciInput.repository,ciInput.branch,ciInput.candidateSha))
      return blocked("ci_changed");
    await assertCalculatorWorkspaceCurrent(workspace);
    if(inspectCalculatorT02AfterCiEvent(tools.eventDirectory,preview).status!=="not-consumed-read-only")
      return blocked("event_changed");
    if(barrier.claim()!=="claimed")return blocked("event_already_consumed");
    claimed=true;
    barrier.recordStage("execute_next_task","running");
    await tools.persistBarrier(id);
    // Nothing is executed until this host recheck returns positive.
    if(!verifyCalculatorAfterCiCandidateCi(await tools.ci(ciInput),ciInput.repository,ciInput.branch,ciInput.candidateSha))
      throw Error("CI changed after persistence");
    await assertCalculatorWorkspaceCurrent(workspace);
    // NOTE: caller is responsible for a second pre-model barrier in its own executor.
    invoked=true;
    await tools.executeOne(preview.nextTaskId);
    barrier.recordStage("execute_next_task","passed");
    barrier.finish("needs-review","after_ci_one_task_consumed_no_replay");
    return Object.freeze({status:"consumed",reason:"one_host_callback_completed",callbackInvoked:true,wholeStep8Closed:false});
  }catch{
    if(claimed)try{barrier!.recordStage("execute_next_task","blocked");barrier!.finish("blocked","after_ci_interrupted_no_replay");}catch{}
    return Object.freeze({status:"blocked",reason:"admission_unverified_no_replay",callbackInvoked:invoked,wholeStep8Closed:false});
  }finally{barrier?.close();}
}
