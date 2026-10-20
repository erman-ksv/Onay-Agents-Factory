# Calculator production adapters and entry points — part 7c

The runtime now wires the real model adapter to the durable coordinator, Docker
proposal tests, expected-SHA Git publication and pinned current-attempt CI reads.
This is code readiness, not a live-agent/product acceptance claim. Legal remains
disabled. No automatic chain, background watcher, whole-task retry or paid fallback.

## Tools and trust

- `createCalculatorSandbox`: an already-present `node@sha256:<64>` image only;
  no pull/install fallback. Docker is pinned to the local managed socket. Containers
  have no network, capabilities, secrets or Docker socket, a readonly root and
  mounts, non-root user and CPU/RAM/PID/time/output limits. The trusted supervisor
  lives outside candidate paths. Candidate imports and tests run in child Node
  permission mode. Missing daemon/image/isolation returns unverified.
- `createCalculatorPublisher`: fixed calculator repository and host plan branch.
  Own authorization checks, bounded bare Git plumbing, no global hooks/config,
  no token in URLs/argv/logs. Git push uses an exact force-with-lease; concurrent
  writers are preserved. Only Draft PRs to the approved bootstrap feature base.
  Unknown outcomes stop; repeated publication on the same instance is forbidden.
- `createCalculatorCiReader`: GET only, exact SHA/ref before/after, bounded complete
  pagination, host-pinned workflow ID/path/blob, fresh run attempts and jobs.
  Another workflow with the same job name cannot supply proof. PR merge refs and
  pull_request_target do not prove exact-candidate testing.

The arithmetic module contract is explicit: calculate(left, operator, right)
returns a finite normalized number and throws a nonempty Error on zero division.
The immutable 11 acceptance outcomes are unchanged. UI task checks are structural
and syntax checks; final real-browser acceptance is still mandatory.

## Invocation

With existing Factory dependencies, use `pnpm exec tsx orchestration/calculatorCli.ts`
with five pairs: --goal ABS_JSON --config ABS_JSON --state-dir ABS_PRIVATE_DIR
--output-dir ABS_PRIVATE_DIR --mode inspect|preflight|plan|run.

The goal keeps the existing strict CalculatorGoalRequest schema. Config is:

```json
{"version":1,"sandboxImage":"node@sha256:<approved 64-hex digest>","trustedWorkflows":[{"id":123,"path":".github/workflows/calculator-task-ci.yml","blobSha":"<40-hex Git blob SHA>"}]}
```

Values are reviewable owner/host pins, not model-selected fields. A final workflow
pin is additionally supported. Do not substitute example IDs or floating image
names. Preflight requires configured credentials, explicit free-mode consent,
existing sandbox image, current owner SHA and read-only workflow provenance.
It runs no model and performs no publication. Inspect is entirely local.

Plan makes one model request only after preflight, with a persisted planning
claim before the request. Interrupted planning cannot silently replay. Run restores
the immutable plan, verifies/configures the project branch, validates current
workflow pins before model/task work, tests and publishes one bounded candidate.
Failures and pending CI are retained; continuation after CI is a later step.

Live run consent: CALCULATOR_EXECUTION_LIVE_APPROVED=RUN_ONE_FREE_CALCULATOR_TASK,
AGENT_FACTORY_ENABLE_GITHUB_WRITES=true, CALCULATOR_MODEL_LIVE_APPROVED=
ONE_FREE_BOUNDED_RUN, ONAY_TEAM_FREE_TIER_CONFIRMED=true,
AGENT_FACTORY_TARGET_PROFILE=calculator, AGENT_FACTORY_LEGAL_ENABLED=false,
AGENT_ALLOWED_REPOSITORIES containing the exact calculator repository, selected
AGENT_FACTORY_PROVIDER and its configured key, plus a scoped GITHUB_TOKEN. Workflow
change opt-in must stay disabled. Secrets belong in host runtime bindings, never
in goal/config files or source. No command here creates secrets or confirms billing.

## Trusted task workflow setup (not installed automatically)

`renderCalculatorTaskWorkflow(factorySha, image)` in config/calculatorTaskWorkflow.ts
renders a reviewable workflow for `.github/workflows/calculator-task-ci.yml`. Pin
an actually reviewed Factory revision and approved image digest. It checks out
candidate data separately from the trusted Factory, runs Syntax and isolated Task
tests through calculatorTaskCi.ts, and never executes candidate package scripts
on the host. Its image pull and trusted Factory dependency install happen only
in the future GitHub Actions setup, not in local development or Codespaces.
Private Factory checkout needs a scoped FACTORY_READ_TOKEN. The rendered workflow
is not yet written to the calculator repository or enabled by this change.

Install/review the trusted workflow on the bootstrap feature branch BEFORE creating
the owner goal; then pin the resulting current bootstrap SHA, workflow ID and Git
blob. A stale original SHA must be replaced in a newly approved goal, not silently
adopted by an existing saved plan. Final Calculator CI with Syntax, Unit tests and
Browser tests remains a separate required gate; this task template does not invent
or skip browser evidence. Browser harness/product work remains steps 10–11.

## Current observed limits

No provider credentials are configured in this managed runtime. Docker preflight
reports docker_unavailable (local socket permission failure). Additional Docker
access was interrupted, so no image/container acceptance is claimed. Workflow
installation/pins and the sandbox image are not configured for a live pilot yet.

Git unit regressions include a real local bare-remote bootstrap/publication and
concurrent-writer lease race, without any external GitHub writes. CI/model/Docker
regressions use injected responses where stated. Successful library tests do not
mean agents created the calculator. Project-wide persisted resource budget and
event continuation are still later steps; runtime preflight does not claim those.
