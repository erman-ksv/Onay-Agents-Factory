# Calculator model team — pilot step 7a

This is a real HTTP adapter for Commander planning, role-scoped Coder/Frontend
proposals and independent Security/Reviewer/Tester assessments. It does not write
a repository, run application code or host tests, publish a candidate, repair a
failed candidate, complete a project, or invoke legal. Step 7 is not yet complete.

## Host preconditions

- A validated calculator owner request with an explicit groq, cloudflare or gemini
  provider, matching AGENT_FACTORY_PROVIDER and configured provider credentials.
- AGENT_FACTORY_TARGET_PROFILE=calculator.
- CALCULATOR_MODEL_LIVE_APPROVED=ONE_FREE_BOUNDED_RUN.
- ONAY_TEAM_FREE_TIER_CONFIRMED=true (owner confirmation, not provider billing discovery).
- AGENT_FACTORY_LEGAL_ENABLED=false.

No API key is returned in snapshots or diagnostics. Configuration is captured on
construction, without later environment fallback. The fixed provider endpoints
and existing provider selection policy are reused. Redirects, tools, streaming,
multiple choices and automatic retries are disabled. This adapter never uses
OpenAI paid routes or silently changes provider; free-tier eligibility must be
confirmed for the selected account before invoking a live run.

## Model calls

createCalculatorModelTeam(...).plan() makes one bounded model request and validates
the complete proposal with the fixed acceptance/dependency contract. A missing
coverage plan stays blocked; calling plan again stops rather than silently
replacing the original plan. Persist it through CalculatorPlanStore before work.

For a selected task, generate(plan, taskId, snapshot) validates the approved task,
path list and genuine snapshot capability. Full originals stay in host memory.
Only host-selected prefix excerpts (at most half a file and 1000 characters each),
exact file hashes, absence metadata and explicit unknown areas are sent. Missing
anchors must stop; the model cannot request arbitrary files/tools. Only validated
role-scoped create/patch changes are returned.

assess(role, plan, taskId, changes) accepts only a genuine proposal produced by this
instance. Security, Reviewer and Tester each receive complete bounded changed text
and fixed task criteria in separate calls. Their assessments are schema-checked;
they cannot claim host tests or publication. A role cannot be called twice on the
same proposal; generation cannot repeat the same task within one instance.

All calls share the existing task HTTP ledger and, for Groq, one local TPM ledger
with 1200 reserved output tokens. Source packets are at most 16000 bytes, full
requests are bounded by the task ledger, and responses are at most 65536 bytes.
HTTP 429, other errors, truncation, secret detection, malformed JSON and budget
failure stop the entire instance with a fixed diagnostic and no replay. These are
local resource bounds, not discovered provider quota. Even a successful model
assessment has testsExecuted=false and publicationAuthorized=false.

## Still required to finish step 7

Wire the model team to durable workspace claims, real host task tests, precise
bounded repair attempts, safe expected-SHA publication and exact-candidate CI.
Fresh dependency checks must use actual current-SHA evidence; a model assessment
is not a CalculatorCurrentChecks attestation. Validate final browser/product
scenarios separately. Do not enable model/live execution just because offline
transport tests pass. A restarted process also needs the persistent project/run
barriers and budget; this adapter's in-memory counters do not replace those.
