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

The runtime entry is host-only. Its dependency checker must authenticate archived
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
There is no new production runner using this entry yet. Before a live successor
run, the trusted host must authenticate the final step-7 artifact, restore its
state and charges, persist/upload the new one-use barrier, and preserve and
restore the after-CI event receipts as well as task receipts across runners.
The legacy flat private-execution exporter does not export nested event state;
it must not be reused unchanged for the new runner. A trusted callback or
registered observer is also needed for future unattended event delivery.

Step 8 stays open until that live path and its independent verification pass.
The first Calculator task must not be regenerated to test the new entry.
