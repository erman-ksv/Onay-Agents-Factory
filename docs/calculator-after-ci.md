# One bounded transition after Calculator CI

This is step 8 work for the separate Calculator pilot. Step 7 remains completed.
It does not change the completion percentage of the Onay taxi application.

`runCalculatorAfterCi` accepts a host-bound plan fingerprint, previous task,
candidate SHA and expected successor. It obtains fresh CI through the trusted
Calculator CI reader, requires actual Syntax and Task tests, and selects a task
through the existing branded workspace and plan store. It records a separate
one-use event receipt before invoking the existing single-task executor.

The event key identifies the plan and published candidate, not a CI run number.
An event duplicate or a rerun of the same candidate cannot authorize another
task. A failed, pending, skipped or stale check cannot authorize a model call.
The old task receipt, approvals and historical model charges are not rewritten.
The expected successor cannot be replaced with a different task during selection.

The runtime entry is host-only. It now also requires a trusted `persistBarrier`
tool that durably saves the claimed event outside the current worker before
the successor is claimed or any model is called. Upload failure consumes the
event and blocks execution. CI/head/receipt are checked again after persistence.
Its dependency checker must authenticate archived
approvals, bind them to the unchanged proposal and current sources, and actually
run host tests. Receipt labels and model JSON cannot supply that capability.
The after-CI entry requires four-request limits with no repair and cannot be
combined with the earlier first-task restoration entry. These are limits for a
new bounded task, not a reset of the project's historical costs. The persistent
project-wide budget remains step 9.

## Current operational boundary

The observer workflow performs a fresh, fixed, read-only check of candidate
`5c4bc71b3119a50d2ca7ce1dbdf12bcaa000ce75` and CI run `39610242811`.
It reads API metadata only. It does not run models, download artifacts, execute
candidate source, dispatch workflows, mutate receipts or grant resume authority.

The controller and runtime entry do not install a cross-repository event
subscription. `workflow_run` does not deliver Calculator events into Factory.
There is no new production successor runner using this entry yet.
`calculatorPublishedTaskState.ts` now authenticates the fixed final step-7
archive, retains historical charges, restores exact task receipts and supplies
a dependency checker that revalidates saved approvals and actually tests current
committed sources without model calls. Its separate audit workflow validates
this path with the private artifact. Before a live successor run, the trusted
host must persist/upload the new one-use barrier, and preserve and
restore the after-CI event receipts as well as task receipts across runners.
`calculatorAfterCiEventState.ts` separately exports and restores one consumed
event receipt and/or crash lock, preserving its identity across worker paths.
The legacy flat private-execution exporter must still not be used to silently
drop event state. The dedicated artifact requires a host-pinned digest and
origin, and does not authorize a retry. A trusted callback or
registered observer is also needed for future unattended event delivery.

Step 8 stays open until that live path and its independent verification pass.
The first Calculator task must not be regenerated to test the new entry.
