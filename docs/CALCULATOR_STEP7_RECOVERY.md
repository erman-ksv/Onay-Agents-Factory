# One explicit step-7 recovery

This operation is authorized by the owner after inspecting failed planning run
39437299742. It retains the same goal `calculator-pilot-step7-v1`, bootstrap SHA,
requirements and exact task-CI pins. It does not erase, reopen or relabel the old
blocked planning receipt. The original launcher remains terminal for that attempt.

The initial recovery uses run number 1, attempt 1. A separately reviewed JSON
request correction uses only run number 2, attempt 1 of the SAME workflow, and
only after verifying the exact failed first recovery and both of its artifacts.
No third slot or arbitrary prior run is accepted.
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

The first recovery (39446900969) stopped before a plan/task with provider HTTP 400.
The error body was intentionally discarded, so the exact provider error message
is unavailable. Local inspection proved that the newly enabled JSON object mode
had no explicit JSON instruction in the Commander messages. Groq documents that
instruction as required: https://console.groq.com/docs/structured-outputs#json-object-mode .
The sender now adds that instruction and a regression checks the actual request.

The reviewed correction preserves both terminal attempts and fixed artifact
IDs/digests. It accepts only the known failed planning receipt with no plan/task
or publication. It conservatively carries two requests, 48000 bytes, 12000 tokens
and 60000 ms. Thus only 4000 of the original 16000 planning tokens remain; the
same per-request/context/output ceilings and 429 terminal stop apply. The prior
recovery capsule and old failed receipt remain immutable. This is an explicit
host-reviewed request correction, not an automatic HTTP retry, new goal, or
permission to repeat any execution task. On any further failure, stop and report.
