# Calculator read-only Actions preflight

`.github/workflows/calculator-preflight.yml` connects the existing Calculator CLI
to **preflight only**. It never plans, calls a model, repairs a task, publishes a
candidate or changes main. Legal and GitHub writes remain disabled. This is not a
live development launcher or acceptance of step 7.

The trigger is a push to `feat/onay-task-runner-20261019` touching the
host-owned request path `.factory/calculator-preflight-request.json`. Adding the
workflow/document alone does not trigger this preflight. The host-owned request
now included under `.factory/` contains the reviewed pilot goal, actual pins and
the owner's explicit Free confirmation. It contains no credentials. A model
cannot select a mode, repository, profile or writable paths.

The request schema has exactly these fields:

```json
{
  "version": 1,
  "freeTierConfirmed": true,
  "factorySha": "18f6408007f95720e0e534636e8f2a322db82294",
  "goal": {"version": 1, "id": "unique-owner-goal-id", "goal": "Owner calculator goal, no source or secrets", "provider": "groq", "baseRef": "feat/calculator-pilot-bootstrap", "baseSha": "<current approved 40-hex bootstrap SHA>"},
  "config": {"version": 1, "sandboxImage": "node@sha256:<approved 64-hex digest>", "trustedWorkflows": [{"id": 123, "path": ".github/workflows/calculator-task-ci.yml", "blobSha": "<actual 40-hex Git blob SHA>"}]}
}
```

Placeholders are documentation, not usable pins. The host must supply real
reviewed SHA/image/workflow pins and a new owner goal matching the current base.
The runtime checkout itself is hard-coded to `18f6408...`; changing `factorySha`
in a request does not select arbitrary executable code.

The first checkout contains only the request at the event SHA, with persisted Git
credentials disabled. A bounded no-follow read validates strict schemas, the
bootstrap ref, supported provider, exact workflow paths, unique positive IDs and
hex pins. Request, state and report directories are private (`0700`/`0600`).

Before Node/pnpm setup, dependency installation or Docker pull, the job checks
boolean presence of the selected provider credentials and `CALCULATOR_GITHUB_TOKEN`.
The Calculator token then performs bounded GET-only checks of the bootstrap head,
pinned workflow file and active workflow registration. It never verifies write
permissions by making a write. Error bodies and token values are not reported.
Free-tier confirmation must come from the explicit owner request boolean or the
repository variable `ONAY_TEAM_FREE_TIER_CONFIRMED` being exactly `true`; the host
sets the request boolean only after the owner confirms the free account.
Key presence does not establish credential validity or a free account. Missing data produces a source-free
`calculator-report.json` with `status: blocked`, exits 10 and skips setup/runtime.
Secret values never enter the request or report. `CLOUDFLARE_API_KEY` is not an
alias for the required API token; Cloudflare also requires its account ID.

Only after those checks does a future Actions job install the pinned Factory
dependencies with pnpm 10/Node 24, pull the exact configured Node digest and invoke
the existing CLI with a literal `--mode preflight`. Runtime workflow provenance,
current SHA, provider, free-tier and Docker checks stay mandatory. The selected
provider key is scoped to that CLI step; the Calculator token is available only
to the GET-only metadata checks and CLI. The other provider keys are empty.
The workflow never derives free-tier confirmation from
key presence and never enables write/execution approvals.

The uploaded artifact contains only the exact sanitized
`report/calculator-report.json` and, when access was checked successfully,
`report/calculator-access.json`. The latter preserves read-only qualifications
and the Free confirmation source when CLI replaces the runtime report.
Goal/config inputs, state, checkouts, source files and credentials are not
uploaded. Before setup it also writes a blocked placeholder report; setup
failure leaves that report instead of claiming readiness. The CLI replaces it
only with its actual result. Inspect failures without repeating a model task.

The actual `plan`/`run` launcher remains to be built. It requires a remote launch
barrier before model calls, recoverable immutable metadata and fail-closed
handling of missing/expired receipts. Calling this workflow or obtaining a ready
preflight does not prove agents created or tested a calculator.
It does not verify the Calculator repository's `FACTORY_READ_TOKEN` or future
publication permissions; these remain separate required checks.
