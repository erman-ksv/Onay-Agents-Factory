# Calculator current-base and dependency verification

This layer is host-only preparation for pilot step 6. It does not invoke a model,
run product checks, write GitHub refs, create a PR, merge, or complete the app.
Legal remains disabled. Onay profiles, qualification fixtures and gates are unchanged.

## Host sequence

1. Restore the immutable CalculatorPlanStore. Read an explicitly selected ref and
   pin its expected SHA; never fall back on an HTTP 404 or silently adopt a new head.
2. openCalculatorWorkspace permits only the approved bootstrap ref or the
   host-derived project branch. Bootstrap is read-only preparation. Before claiming
   the first task, the future executor must create/verify the project branch at the
   owner's original SHA. After any receipt exists, bootstrap cannot be reopened.
3. selectCalculatorWorkspaceTask checks saved candidate receipts using immutable
   Git commit parents. Both the owner base and candidate must be ancestors of the
   current SHA; the owner base must also be an ancestor of the candidate. A bounded
   64-commit traversal per check fails closed on incomplete or longer histories.
4. Both candidate and current complete trees must contain the task's regular files
   with regular parent directories. Blob changes are explicitly passed as
   changedSinceCandidate to a trusted host CalculatorCheckRunner. An ancestor can
   have been reverted: ancestry alone never proves the behavior still works.
5. The runner must actually run Security, independent Reviewer and task-scoped
   tests at the pinned current SHA. Its result must identify the exact repository,
   plan fingerprint, task, candidate SHA and current SHA. Missing, failed or stale
   checks block selection. Stored statuses and model assessments are not checks.
6. claimCalculatorWorkspaceTask uses the existing durable replay barrier and checks
   the working head again afterwards. A movement after claim leaves a blocked
   receipt requiring explicit investigation; it is never deleted to retry.
7. loadCalculatorWorkspaceTask loads the task's sources at the pinned current SHA
   through the existing private snapshot capability, not the original owner base.
   Recheck assertCalculatorWorkspaceCurrent immediately before each future model
   call or side effect. Git writes must additionally use expected-SHA atomic ref
   updates: a preflight read cannot lock a remote branch.

The snapshot GET adapter now preserves parent SHAs. Legacy snapshot-only host
readers may omit parents; dependency verification explicitly refuses missing parent
metadata. No alternative repository, arbitrary endpoint, write API or retry was
added. Workspace handles cannot be forged by JSON serialization; only metadata
and file hashes leave host memory.

## Remaining integration, not claimed as complete

The check runner is a dependency injected by the trusted executor. There is no
production implementation or live model invocation in this step. Test fixtures
return synthetic attestations; they are not product acceptance. Step 7 must wire
real tools and specialist execution to this API and maintain SHA-bound evidence.
The future executor must use this workspace wrapper rather than the lower-level
plan-store callback alone. No automatic continuation or repair is implemented here.

A passing task-scoped arithmetic test is not full calculator CI. The final fixed
Calculator CI still requires Syntax, Unit tests and Browser tests; all 11 agreed
scenarios, browser/device layout and delivery documentation remain mandatory.
Missing credentials or unavailable checks must stop, never manufacture a pass.
