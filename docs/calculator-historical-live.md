# Historical t02 → live t03 host

The live bridge reuses `admitHistoricalT02OneSuccessor`, its bound one-use
permit and `runCalculatorExecution`. It never recreates or modifies t02.

`scripts/calculator-historical-live.mjs` authenticates the original GitHub run,
ZIP digest and all 255 archived files, authenticates the separate reconciliation
artifact, restores the exact four state files, and verifies the original receipt
hash. The old core capsule is validated by the existing published-state loader.
Current source must match the archived approved core/UI and exact candidate CI.
Real isolated arithmetic, project tests and Clear/Backspace browser checks run
before the historical admission.

The reviewed workflow must check out an immutable runtime that has successful
Factory Typecheck/Test CI. It runs only on the approved Factory feature branch;
PR code/forks cannot supply the runtime, request, or credentials. It explicitly
requires Factory `contents:write` for metadata-only Git objects and a host-only remote reference, and
`actions:read` for authenticated evidence. The Calculator token is separate. Neither
token is passed to sandboxed app/test/browser processes or model packets.

The remote key hashes repository, plan, predecessor task and exact predecessor
candidate. It excludes runtime, run ID and CI rerun ID. The marker is an orphan commit with one `calculator-live-event.json` blob containing only event identity, runtime SHA, source CI, plan fingerprint and candidate SHA. Its blob/tree Git hashes and empty parent list are checked. No workflow or application history is copied. A single atomic POST to
`refs/heads/state/calculator-live-event/<hash>` is read back before any model
request. A duplicate, 403/429, competing writer or lost acknowledgement stops;
there is no delete/update/retry API. A new ephemeral worker cannot reset it.
An interrupted worker with missing terminal evidence stays consumed and needs
inspection. The immutable runtime defines the full reserved new allowance even
if a runner dies before uploading its finer-grained private journal.

The new, host-only `calculator-keyboard-eight-roles` preset allows at most eight
requests (generation + three roles + at most one repair + three fresh roles),
24,000 bytes/request, 192,000 bytes/run, 32,000 context tokens/run, 2,048 output
tokens for Frontend and 1,200 for assessments, and 600 seconds. The 6,000 TPM
limit and HTTP-429 terminal stop remain. Existing presets/defaults are unchanged.
Old t02 costs remain 12 requests / 110138 bytes / 40564 reserved tokens / 513058ms.
Each pre-HTTP checkpoint includes conservative current and historical accounting.
This reservation is not a provider invoice or a project-wide budget reset.

The agent can modify only t03 paths `src/app.mjs`, `test/ui.test.mjs`. It receives
SHA-bound, incomplete head/tail excerpts rather than a complete private original.
The independent roles see the full proposed change, plus exact host evidence
when verified. Missing/failed evidence is never converted to a success capability.

Host checks execute unchanged core tests and new agent tests in the existing
networkless Node sandbox. The real browser additionally checks clear/backspace,
keyboard Enter, Escape, Backspace, and mixed keyboard/button input in the same
isolated Chromium runner. A genuine application acceptance failure may reach the
ordinary single repair path; unavailable sandbox/infrastructure remains unverified.
The host never edits agent source or changes fixed expected answers.

Publication uses the existing path-limited, leased Draft-PR publisher. The host
observes only the newly published candidate's CI for at most 36 × 5 seconds.
This does not replay a model call or task. Original receipts and event files are
retained; private checkpoint evidence is uploaded even on failure. No merge,
deployment, main change, legal agent or claim of whole-app completion is allowed.

Passing unit tests, a source CI, or a read-only browser probe does not close any
live acceptance gate. Gate 2 needs a genuine t03 commit and exact candidate CI;
gate 3 needs an actual AI-owned repair; gate 4 needs real automatic continuation.

When the repository is public, uploaded artifacts and logs must be treated as public too; filesystem-private evidence is not access-private on GitHub.
