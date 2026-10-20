# One bounded Calculator plan / execution launcher

This is a host-rendered executable workflow, not an automatic development loop.
Render `renderCalculatorOneCycleWorkflow(reviewedFactorySha, image)` after the
helper is published and CI-reviewed, then install the resulting YAML at
`.github/workflows/calculator-one-cycle.yml`. No request or workflow installation
is performed by this code. Only a push changing the host-owned
`.factory/calculator-one-cycle-request.json` on
`feat/onay-task-runner-20261019` triggers it. Main and Onay are outside its scope.

The strict request is `{version:1, mode:"plan"|"run", factorySha:<reviewed SHA>,
freeTierConfirmed:true, goal:<CalculatorGoalRequest>, config:<CalculatorRuntimeConfig>}`.
The host sets free-tier confirmation only after the owner's explicit confirmation.
The renderer fixes executable Factory SHA and Node image independently of the
request. Repository/profile, Legal=false, workflow changes=false, selected
provider and existing model/free/write gates are preserved. Only the CLI step
receives the selected provider key and scoped `CALCULATOR_GITHUB_TOKEN`.

`prepare` reads bounded strict JSON without following links, validates actual
workflow registration and the entire bounded history (up to 40 runs / 256 GETs /
60 seconds). Each historical request and launcher blob is proved through its
commit and full Git tree; launcher bytes must match the reviewed renderer.
Run attempts other than one, incomplete pagination, source/runtime/config drift,
unknown artifacts, expired state, missing barriers/capsules and ambiguous history
stop before any model. A deleted artifact does not erase the matching old run;
complete, unique workflow `run_number` sequence 1..N is additionally required,
so deleting the old run itself also blocks instead of enabling a fresh plan.
Upgrades beyond this provenance require explicit host review, not a fallback.

For a goal, one `plan` is allowed, followed by one `run`. Run requires exactly one
successful prior plan with both immutable remote barrier and complete capsule.
The old barrier and capsule are downloaded by exact artifact/run IDs, validated
and restored before a new barrier is uploaded. Only successful remote upload
allows the model-capable CLI step. If the runner dies before uploading the final
capsule, the run/barrier history blocks repetition. A new goal ID must never be
used automatically to bypass a failed identity or exhausted budget.

State contains at most 21 regular files: owner plan, plan/planning receipts and
known task receipts, plus their empty lock files. Files are bounded to 32 KiB,
directories `0700`, files `0600`; links, subdirectories, unknown files and secret
patterns are rejected. Restored download permissions are tightened only after
bounded structural/link checks. Owner fingerprint, runtime SHA, config digest,
run/request/workflow identities, state digests and report digest are bound in the
capsule. A run requires a genuinely planned saved plan, a finished planning
receipt and no old task receipt/lock. An existing execution run is always a stop.

Only validated metadata/state and a schema-limited report are uploaded. Candidate
source, checkouts, Git scratch, raw model responses, tool stderr and secrets are
excluded. Unknown report fields are not exported. Blocked/429/uncertain outcomes
are preserved; no automatic retries, paid fallback or budget reset are added.
Dependency installation occurs only in the future trusted Actions setup; this
code does not install local dependencies or use Codespaces.

Pending candidate CI must be read separately without calling `run` again: the
existing runtime can otherwise proceed to the next task. Step 7 acceptance still
requires a live plan, one task, independent reviews, actual sandbox tests,
publication and exact-candidate CI. Event continuation and the persistent
project-wide budget remain steps 8–9; whole-app/browser acceptance remains later.
