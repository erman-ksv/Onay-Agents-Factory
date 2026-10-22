# Carrying an after-CI replay barrier across workers

The controller identifies a consumed transition by saved plan, previous task
and candidate SHA. The fingerprint also binds the expected successor. Worker
paths and CI run IDs do not redefine this identity.

`exportCalculatorAfterCiEventState` preserves exactly one event receipt and/or
its crash lock. Missing or empty state is refused. Foreign event files also
stop export; they must be retained in their own authenticated history rather
than silently discarded. Source files and locks are never deleted. Partial
export or restoration destinations are retained and cannot be overwritten.

The importer requires an independently pinned manifest digest, exact request
and exact source workflow/run/SHA. It verifies every byte and receipt identity.
Downloaded files are treated as data and restored with private permissions.
A serialized capability cannot restore state. A lock left before any receipt
is itself a consumed barrier, and the real controller stops before CI, dependency
checks or model calls when either a receipt or a lock has been restored.

Live after-CI execution now requires a trusted `persistBarrier` tool. It runs
after the event has been durably claimed and before claiming the successor.
The host tool must actually persist/upload and acknowledge the barrier outside
the current worker; it must throw on failure. Returning without preservation
does not implement the contract. The controller rechecks CI, branch and old
receipt after this tool returns. Its failure cannot authorize replay.

The two-job Actions audit creates a synthetic consumed audit event, uploads its
immutable artifact and passes the digest through trusted job outputs. A separate
worker downloads it and proves that the real controller refuses a repeated
delivery before any tool/model call. This is transport evidence. Its origin is
the audit workflow, not a production task, and it cannot replace the provenance
checks required by a future production adapter.

The production wrapper still needs authenticated cross-run discovery and
delivery of real Calculator CI events, preservation of all prior state/costs,
and a genuine one-successor run. Step 8 remains open until that integration passes.
