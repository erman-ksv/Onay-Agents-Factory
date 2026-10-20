# Private execution evidence — step 7

The previous live attempt stopped before Reviewer HTTP. Its Coder proposal and execution ledger were never saved and cannot be recovered. These changes do not reopen that receipt, refund its unknown usage, or authorize another attempt.

## What is saved

The executor now checkpoints validated proposals and completed Security/Reviewer/Tester assessments before marking a stage passed or calling the next specialist. The Groq adapter reserves both budgets, saves the conservative aggregate charge, and only then invokes HTTP. Failed persistence stops execution. Admission diagnostics contain only bounded codes and counters; provider bodies and source never enter diagnostic logs.

Private evidence lives in `execution-private/<metadata-directory-digest>/`, next to the metadata directory, never inside `state/`. A capsule binds repository, owner/plan fingerprints, task, branch, current/bootstrap SHA and runtime configuration/model digest. Files use mode 0600, directories 0700, exclusive writer locks and atomic writes with fsync. The maximum capsule is 512 KiB, including at most 64 snapshots. Previous proposals and assessments survive the single permitted repair. Exhausting this bound blocks execution.

Request count, bytes and elapsed time cannot decrease. Token reservations retain their conservative high-water mark even when confirmed provider usage lowers the live ledger. An interrupted HTTP call stays marked uncertain; no completed-call inference or replay permission follows from these data. Publication intent is saved before the publisher runs. A read or source-free `inspect()` never authorizes replay.

The runtime currently requires the reviewed Groq accounting adapter for execution with private evidence. Inspect, preflight and planning keep their existing behavior. Dependency reviews use a separate private runtime-budget record and the same live team's aggregate ledger before the next task is claimed. This record is not another execution task.

## Rollout and remaining checks

The existing one-cycle workflow pins an older runtime and uploads a validated metadata-only capsule. Its format is unchanged. This patch alone does **not** make private execution evidence survive removal of an Actions runner: a reviewed immutable runtime pin and a separate private artifact upload/manifest still need to be integrated and checked. Never add proposal source to the metadata-only collector or public report.

No automatic resume is implemented. An existing private capsule causes a new runtime writer to refuse execution. A future continuation must separately verify original receipts, remote artifact identity/digest, exact source/configuration and the original aggregate charge, and must receive explicit bounded authorization. A new goal ID or fresh budget cannot bypass an interrupted task.

Step 7 remains open until a live task passes Reviewer, Tester, host proposal tests, publication and CI for the actual candidate SHA. Factory unit tests do not establish that result. Steps 8–12 are not claimed by this change.
