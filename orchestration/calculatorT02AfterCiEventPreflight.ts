/** Read-only binding of an independently inspected t02->t03 preview to the
 * existing after-CI event identity. Never call claim(), write a receipt,
 * dispatch agents, or create a new event directory here.
 */
import { TeamTaskStore } from "./teamTaskStore.js";
import { calculatorAfterCiEventIdentity, prepareCalculatorAfterCiRequest } from "./calculatorAfterCi.js";
import { assertCalculatorT02InspectedSuccessorPreview, type CalculatorT02ReadOnlyPreselection } from "./calculatorT02SuccessorPreview.js";
export const CALCULATOR_T02_EVENT_PREFLIGHT_ERROR =
  "Historical t02 after-CI event preflight refused. Preserve all receipts, event locks and costs; no replay.";
const refuse=():never=>{throw Error(CALCULATOR_T02_EVENT_PREFLIGHT_ERROR);};
export type CalculatorT02EventPreflight = Readonly<{
  status:"not-consumed-read-only"; eventId:string; eventFingerprint:string;
  previousTaskId:string; expectedNextTaskId:string; candidateSha:string;
  executionAuthorized:false; eventClaimed:false; resumeAuthorized:false;
  wholeStep8Closed:false;
}>;
/** Requires a brand from the live in-process verified preview, not a JSON clone.
 * Even a positive result is not an execution capability. */
export function inspectCalculatorT02AfterCiEvent(eventDirectory:string,preview:CalculatorT02ReadOnlyPreselection):CalculatorT02EventPreflight {
  assertCalculatorT02InspectedSuccessorPreview(preview);
  let store:TeamTaskStore|undefined;
  try {
    if(preview.status!=="candidate-preview-only" || preview.readOnly!==true ||
       preview.executionAuthorized!==false || preview.publicationAuthorized!==false ||
       preview.resumeAuthorized!==false || preview.budgetResetAuthorized!==false ||
       preview.wholeStep8Closed!==false) return refuse();
    const request=prepareCalculatorAfterCiRequest({
      version:1,planFingerprint:preview.planFingerprint,
      previousTaskId:preview.previousTaskId,candidateSha:preview.candidateSha,
      expectedNextTaskId:preview.nextTaskId
    });
    const identity=calculatorAfterCiEventIdentity(request);
    store=new TeamTaskStore(eventDirectory,identity);
    if(store.inspectExisting()||store.inspectExistingLock())return refuse();
    return Object.freeze({
      status:"not-consumed-read-only" as const,eventId:identity.id,eventFingerprint:identity.fingerprint,
      previousTaskId:request.previousTaskId,expectedNextTaskId:request.expectedNextTaskId,
      candidateSha:request.candidateSha,executionAuthorized:false as const,
      eventClaimed:false as const,resumeAuthorized:false as const,wholeStep8Closed:false as const
    });
  } catch {return refuse();}
  finally{store?.close();}
}
