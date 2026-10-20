# One explicit step-7 recovery

This operation is authorized by the owner after inspecting failed planning run
39437299742. It retains the same goal `calculator-pilot-step7-v1`, bootstrap SHA,
requirements and exact task-CI pins. It does not erase, reopen or relabel the old
blocked planning receipt. The original launcher remains terminal for that attempt.

The dedicated recovery workflow may execute only as run number 1, attempt 1.
Both workflow histories and the original artifact IDs/digests must be complete.
Missing/deleted/expired/altered or repeated history stops before model inference.
The prior capsule is validated against its binding, manifest, state and report
digests. A remote recovery barrier must be uploaded before any inference/write.
The old receipt is retained byte-for-byte alongside a separate recovery receipt.

The old provider outcome and actual token usage are unknown. The observed old CLI
lasted under 9 seconds and its reviewed code could make one planning request.
Recovery conservatively carries one request, the entire 24000-byte request ceiling,
6000 context tokens, and 30000 ms. These amounts reduce remaining planning ceilings;
they are not counted as zero or refunded. The old minute window must have elapsed.
The defaults, per-request output ceiling and HTTP-429 terminal stop remain intact.
The recovery plan and the single execution task have separate ledgers, as in the
original plan/task design. This is not a whole-project durable budget implementation.

For the reviewed Groq gpt-oss-120b route, requests explicitly select JSON object
output and low reasoning within the existing 1200-token completion cap. This avoids
relying on a default response format/effort. It does not establish the cause of the
old failure. Nonmatching routes do not inherit provider-specific options.

A successful plan must validate every original acceptance criterion/file, and its
first task must implement the arithmetic module and its tests. The unchanged live
runtime then attempts exactly that one task. Security, Reviewer, Tester, actual
sandbox tests, static/policy/authorization checks and exact-candidate CI stay
mandatory. Failed model calls are not repeated. Pending candidate CI is read
separately and never causes another execution call. There is no main update,
merge, deployment, Codespaces start or legal agent.

The recovery does not mark the whole app complete. Step 7 needs actual plan/task,
proposal test, publication and exact-SHA CI evidence. Later UI tasks and browser
acceptance remain separate.
