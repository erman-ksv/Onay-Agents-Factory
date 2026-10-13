# Real-provider Agent-Factory verification

`live-cycle` first coordinates a **real OpenAI or Gemini model** through the
production `runAiCommander` implementation. By default it performs a read-only
audit. With explicit publication metadata and the existing write gate, a
successful audit is followed by a small code task, a draft PR, and exact-commit
CI verification. It never merges or deploys.

Unit tests for this CLI use an injected executor. Their artifacts are marked
`executionMode: "test-executor"` and `liveProviderVerified: false`. Passing
those tests does **not** establish that a real provider or GitHub request ran.

## Runtime requirements

Run in the Codespace or server where the selected provider credentials are
already bound to the process. Do not put keys in CLI arguments, PR descriptions,
chat messages, or committed files.

- `GEMINI_API_KEY` for `--provider gemini` (the CLI default, matching the
  selected existing TezJet runtime).
- `OPENAI_API_KEY` for an explicit `--provider openai` run.
- `GITHUB_TOKEN` for reading repository files and CI evidence; publication also
  needs permission to create a feature branch, commits, and a draft PR.
- `AGENT_ALLOWED_REPOSITORIES` must explicitly contain
  `erman-ksv/TezJet-Agent-Factory`.
- Optionally set `OPENAI_MODEL` or `GEMINI_MODEL` to a model available to your
  provider account. When `OPENAI_MODEL` is absent, evidence records
  `model: "sdk-default"`: this describes the SDK selector, not an observed
  provider response model identity.

Explicit provider selection never falls back to the other provider. A Gemini
key does not satisfy an OpenAI run, and an OpenAI key does not satisfy a Gemini
run. The CLI sets `AGENT_FACTORY_PROVIDER` for its Commander and Coder together.

Install the project dependencies before running the CLI:

```bash
pnpm install
```

## Read-only audit

Select the complete expected SHA from the reviewed remote branch. The default
base is `fix/verified-agent-execution`; override `--base-ref` explicitly when
testing a different reviewed branch. A branch that has moved away from the
supplied SHA fails verification before source files are inspected or changes
are published.

```bash
git fetch origin fix/verified-agent-execution
FACTORY_BASE_SHA="$(git rev-parse origin/fix/verified-agent-execution)"

AGENT_ALLOWED_REPOSITORIES=erman-ksv/TezJet-Agent-Factory \
  pnpm run live-cycle -- \
  --provider gemini \
  --base-ref fix/verified-agent-execution \
  --base-sha "$FACTORY_BASE_SHA" \
  --output-dir /tmp/tezjet-gemini-audit-001
```

To compare an OpenAI account later, use `--provider openai` and a different
new output directory. No publication metadata is supplied for an audit.

The output directory must be a new absolute path with existing directory
parents. Existing paths and symlink parents are rejected. Use `/tmp` or another
private artifact location, outside source-control and credential directories.
The CLI creates the directory with mode `0700` and evidence files with `0600`.

An `audit-passed` result verifies successful production tool coordination,
repository security checks, and trusted CI evidence for the exact base SHA.
It reports no proposed or changed files. It does not prove that the model can
generate, publish, or verify a new change. It inspects existing CI evidence;
the audit does not trigger a new CI run.

## Small published task

The fixed acceptance task is a journal task-ID collision fix. Two default IDs
currently based on `Date.now()` can collide in the same millisecond. The model
must use Node `crypto.randomUUID()` while preserving the `task-` prefix,
explicit IDs, constructor compatibility, and journal events. It must add a
regression test with a frozen clock.

The host permits only these two exact paths:

- `orchestration/agentRunJournal.ts`
- `orchestration/agentRunJournal.test.ts`

Use a new feature branch distinct from the base. Changes outside this file
scope are rejected before publication. Both permitted files must be present
in the final result for this live-cycle task to pass.

```bash
AGENT_ALLOWED_REPOSITORIES=erman-ksv/TezJet-Agent-Factory \
AGENT_FACTORY_ENABLE_GITHUB_WRITES=true \
  pnpm run live-cycle -- \
  --provider gemini \
  --base-ref fix/verified-agent-execution \
  --base-sha "$FACTORY_BASE_SHA" \
  --output-dir /tmp/tezjet-gemini-change-001 \
  --publish \
  --branch feat/live-journal-ids-001 \
  --title 'Prevent default journal task ID collisions' \
  --body 'Use random UUIDs for default journal task IDs and cover same-clock construction while preserving explicit IDs and initial events. Verify TypeScript and the complete test suite for the exact candidate commit.'
```

The CLI repeats the real-provider audit first. If it fails, no change stage
runs. Publication requires both `--publish` and
`AGENT_FACTORY_ENABLE_GITHUB_WRITES=true`, plus branch, title, and body. No
credentials are accepted as command-line options.

## Evidence and acceptance

Every stage streams its actual host journal into `audit.events.jsonl` or
`change.events.jsonl` and stores its returned result in `audit.result.json` or
`change.result.json`. `evidence.json` contains the final host decision, provider
and model selector, boolean credential presence, stage evidence, and failure
reasons. Exact provider and GitHub credential values are recursively redacted
from strings and object keys. Artifacts may still contain private repository
findings and should remain in the private output directory.

A published task receives `status: "completed"` only when both stages verify
and the final change evidence confirms all of the following:

- Commander returned `completed`, empty reasons, and no missing actors.
- Publication returned a valid draft PR URL, number, authorized branch, and a
  full new head SHA distinct from the pinned base SHA.
- Proposed and changed paths exactly match the two permitted journal files.
- Independent review and security scans passed.
- Required CI executed successfully for that exact head and branch.
- The journal contains successful exploration, generation, review, security,
  publication, test, and final-head verification tool events.
- Returned events match the journal persisted for this task.

Here, `completed` confirms orchestration, publication, and exact-commit CI.
The requested task remains `taskAcceptance: "requires-independent-review"`
whenever the change stage runs, including a completed run. A reviewer must
independently inspect the actual published diff and verify that it fixes the
same-millisecond ID collision while preserving explicit IDs and journal
behavior. Only that separate review can mark the bug fix complete in the
project checklist. Audit-only runs or runs blocked before the change stage
record `taskAcceptance: "not-applicable"`.

Unknown or inconsistent metadata, final model prose without executable tools,
pending/skipped checks, an unchanged head, or a changed branch head cannot
complete the run. A blocked result exits with code `1`; verified audit or
publication exits with code `0`.

## Failure and retry limits

Commander has the production maximum of 30 turns; CI polling currently has a
five-minute default deadline per verification. Provider and GitHub HTTP
requests do not have a new end-to-end cancellation mechanism in this CLI, so
these limits are not a strict wall-clock deadline. If the process is stopped
or a request times out after publication begins, a branch, commits, or draft
PR may already exist. The streamed journal can help inspect the attempt; no
remote rollback is claimed. An interrupted process may have no final
`evidence.json`.

Inspect the journal and remote branch before retrying a publication failure.
Use a fresh output directory and review whether a new feature branch is needed.
This acceptance CLI does not automatically repair a failed published change;
it records the blocker for a developer and preserves the draft for review.
