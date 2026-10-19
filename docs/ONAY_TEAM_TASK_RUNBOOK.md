# Owner goal → bounded backlog → Onay team → Draft PR

The goal-driven CLI accepts an owner goal, asks the team to propose a bounded backlog, and preserves that backlog for later execution cycles. Each cycle handles at most one bounded task. The manual `Onay Team One Task` workflow described later accepts an already specified task; it does not dispatch the goal-driven CLI. Neither mode runs a permanent daemon, schedule, automatic task retry or provider fallback.

The host fixes the execution scope and gate order: Explorer → patch Coder → relevant specialists → independent Reviewer → Security → Draft PR → exact-candidate CI inspection. A model cannot widen the file list, authorize publication, merge, deploy or enable the legal agent.

This workflow is being prepared on a feature branch. **The checked default branch currently contains only the README. GitHub's `workflow_dispatch` button is unavailable until a separately authorized integration puts this workflow on the default branch.** Adding this file does not authorize changing `main`, starting the workflow or calling a model. A later authorized integration must use the complete tested Factory implementation, not this workflow file alone.

## Goal-driven local CLI

The owner describes the desired Onay behavior in natural language. The planner examines a bounded inventory and selected immutable source ranges, then proposes **at most six tasks in one planning batch**, with acceptance criteria, approved existing paths, source evidence, dependencies, blockers and unverified areas. The host validates the proposal before saving it. Inventory paths and SHAs alone do not prove that source was read. A saved plan is a proposal, not evidence that any code or test is complete.

Start from [`config/onayGoal.example.json`](../config/onayGoal.example.json). Its `baseSha` is forty placeholder `a` characters, and `dev/onay-working` is an **example branch name**. Replace both with an existing, verified Onay branch and its full current commit SHA before planning. Use a fresh goal ID for a changed goal, provider, base branch or SHA. The example does not authorize a real model call or GitHub write.

The CLI accepts exactly these mode arguments:

```sh
pnpm exec tsx orchestration/onayGoalCli.ts \
  --goal /absolute/private/onay-goal.json \
  --state-dir /absolute/private/onay-goal-state \
  --mode inspect \
  --output-dir /absolute/private/onay-goal-report
```

| Goal mode | Required approval/configuration | Behavior |
| --- | --- | --- |
| `plan` | `ONAY_GOAL_APPROVED=PLAN_FREE_GOAL`, `ONAY_TEAM_FREE_TIER_CONFIRMED=true`, `AGENT_FACTORY_ENABLE_GITHUB_WRITES=false`, `AGENT_FACTORY_LEGAL_ENABLED=false` | Read-only Onay inspection and bounded requests to the selected free-tier provider; validates and saves one proposed backlog. No Onay writes. |
| `continue` | `ONAY_GOAL_APPROVED=RUN_FREE_GOAL_CYCLE`, `ONAY_TEAM_LIVE_APPROVED=RUN_ONE_FREE_TASK`, `ONAY_TEAM_FREE_TIER_CONFIRMED=true`, `AGENT_FACTORY_ENABLE_GITHUB_WRITES=true`, `AGENT_FACTORY_LEGAL_ENABLED=false`; workflow changes remain disabled | Restores the saved backlog and executes or verifies at most one eligible task in one cycle, using the existing task gates and replay barriers. |
| `inspect` | No model/provider approval needed | Entirely offline inspection of saved state, without SDK imports, models or GitHub requests. It cannot prove current CI or past agent execution. |

Set credentials through the existing private runtime configuration described below. Only the selected provider is permitted; OpenAI, paid OpenRouter routes, fallback providers and billing lookups are not part of this goal interface. `ONAY_TEAM_FREE_TIER_CONFIRMED=true` is the owner's confirmation of the account/model's eligibility, not a billing guarantee from the code. Do not activate a plan or cycle if the account requires payment.

For example, after preparing a real private goal file and configuring the selected free-tier credentials, the approval flags for a planning invocation are:

```sh
ONAY_GOAL_APPROVED=PLAN_FREE_GOAL \
ONAY_TEAM_FREE_TIER_CONFIRMED=true \
AGENT_FACTORY_ENABLE_GITHUB_WRITES=false \
AGENT_FACTORY_LEGAL_ENABLED=false \
pnpm exec tsx orchestration/onayGoalCli.ts \
  --goal /absolute/private/onay-goal.json \
  --state-dir /absolute/private/onay-goal-state \
  --mode plan \
  --output-dir /absolute/private/onay-goal-report
```

Review the saved plan and explicit blockers before granting `continue` approval. The team chooses the next eligible task from that plan; the owner does not have to manually write each task. A cycle is bounded, with **at most twelve cycles per saved batch**. Pending CI is retained for a later verification cycle instead of keeping a runner idle or invoking Coder again. HTTP 429, ambiguous publication, missing receipts, exhausted budgets and interrupted execution stop work for inspection rather than replaying it.

Every initial card is pinned to the original verified base SHA. **A dependency's successful Draft PR does not integrate its changes into that base.** Dependent tasks therefore wait for explicit confirmation of an integrated base; they are not automatically executed against the old SHA merely because another PR's CI passed. Updating the integrated base requires a separately verified owner-approved plan. No merge or hidden rebase occurs through this interface.

The planner cannot expand the executor's existing-file write scope. Work requiring new files, dependencies, configuration, schemas/migrations, deployment, changed dispatch/payment policy or another unsupported area must appear as explicit blockers requiring a separate decision. Missing evidence must stay visible. The first batch does not claim to cover every requirement of Onay, and **completion of a task or planning batch does not mean that the whole application is finished or ready to release**.

Keep the goal file, state directory and reports private: directories `0700`, files `0600`. Preserve the complete durable state, including `<goal_id>.goal.json`, `<goal_id>.goal.identity.json` and task replay-barrier receipts. Do not delete a stale `.goal.lock` to force a restart. A missing state file with a surviving identity marker, an interrupted cycle or an unfinished task requires manual reconciliation. Deleting both identity and state removes local history; it does not establish that a goal/task ID is unused.

This section documents the local CLI. It does not publish or activate a goal workflow, change `main`, or start Codespaces. Model caps and exact-candidate checks remain required. Codespaces compute, Actions minutes and artifact storage are separate limited resources; planning and one-task cycles should run only when needed.

## Scope and task card

The ten dispatch inputs are `task_id`, `goal`, `criteria`, `profile`, `provider`, `base_ref`, `base_sha`, `change_paths`, `mode` and `confirmation`. Inputs become JSON through `process.env`; they are never interpolated into shell source. Keep secrets, personal information and private source code out of every input: GitHub stores workflow dispatch data.

Use a new lowercase task ID, 3–48 characters, letters/digits/hyphens, beginning and ending with a letter or digit. The derived proposal branch is `feat/onay-agent/<task_id>`. An ID identifies an immutable task; do not reuse it for a different goal, changed criteria, base SHA or file list.

Provide an exact existing Onay commit SHA and its existing base branch. The branch must still point to that SHA when execution starts and before publication. Choose **1–3 existing files** in one profile, one path per line:

| Profile | Allowed existing source/test paths |
| --- | --- |
| `mobile` | `mobile/tezjet-app/app/`, `components/`, `lib/` or `test/` beneath `mobile/tezjet-app/`; extensions `.ts`, `.tsx`, `.mjs` |
| `backend` | `artifacts/api-server/src/controllers/`, `routes/`, `utils/`, `middleware/` or `store/` beneath `artifacts/api-server/src/`, or `artifacts/api-server/test/`; extensions `.ts`, `.mjs` |

The dispatch card sets `contextPaths: []`; the host adds the root package manifest to the approved change files for read-only discovery. Existing directory names such as `mobile/tezjet-app` are canonical repository paths, even though the product is now Onay.

New files, dependencies, package manifests, schemas/migrations, configuration, workflows and Factory changes are outside this runner's write scope. One explicit objective and 1–6 short, observable acceptance criteria are required. Keep the combined task goal, criteria and host instructions within the card's 1,200-character limit. The goal-driven planner can split a broader owner goal into these bounded cards; a broad goal alone does not grant unrestricted changes to the whole project.

Suitable first task: correct one reproducible passenger form validation bug in an existing component and its existing test. State the trigger, expected behavior, allowed paths and required checks. Do not use this first bounded runner for payments, OTP policy changes, dispatch policy redesign or a mobile release.

## Modes and credentials

| Mode | Models | Onay writes | Result |
| --- | --- | --- | --- |
| `plan` (default) | None; no model secrets supplied | Disabled; no Onay token supplied | Local card/scope plan; this does not prove repository files or runtime behavior |
| `run` | Only the explicitly selected provider | One bounded proposal branch and Draft PR after gates | Metadata report and replay-barrier receipt; pending CI remains `needs-review` |
| `verify` | None; no model secrets supplied | Disabled | Read-only inspection of the recorded PR and exact candidate's CI; no task replay |

`run` requires the exact confirmation `RUN_ONE_FREE_TASK`. It confirms that the owner checked the selected provider/account/model is eligible for its **free tier** and approves one bounded task and one Draft PR. There is no billing API lookup or promise that a provider/account remains free. Do not confirm if paid billing is required. The workflow sets `ONAY_TEAM_LIVE_APPROVED=RUN_ONE_FREE_TASK`, `ONAY_TEAM_FREE_TIER_CONFIRMED=true` and `AGENT_FACTORY_ENABLE_GITHUB_WRITES=true` only for that confirmed `run`. These flags are false/empty in every other mode. Legal review and workflow changes remain disabled in all modes.

Configure secrets in the Factory repository, never in cards or source:

- `ONAY_TEAM_TOKEN`: an Onay-scoped token for `run` and `verify`. Grant only the permissions required by the existing GitHub integration: Contents and Pull requests for the Draft PR, plus read access for Actions/checks/status evidence. The workflow's default GitHub token is separately limited to Factory `contents: read` and `actions: read`; it is used for checkout and receipt artifacts, not Onay publication.
- Cloudflare: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` when `provider=cloudflare`; the existing provider policy fixes its reviewed free-tier model.
- Groq: `GROQ_API_KEY` when `provider=groq`; the existing reviewed default is used, together with the Groq context ledger.
- Gemini: `GEMINI_API_KEY` when `provider=gemini`. The model is `vars.GEMINI_MODEL` if configured, otherwise `gemini-3.5-flash-lite`. Check free-tier eligibility before confirmation.

Only the selected provider's secrets are supplied to the `run` CLI step. Neither `plan` nor `verify` receives model keys. Verify uses the same repository-scoped Onay token but the host disables all publication paths.

The CLI interface is:

```sh
pnpm exec tsx orchestration/teamTaskCli.ts \
  --task "$RUNNER_TEMP/onay-task.json" \
  --state-dir "$RUNNER_TEMP/onay-team-state" \
  --mode plan \
  --output-dir "$RUNNER_TEMP/onay-team-report"
```

Change only the mode argument to `run` or `verify` under the corresponding rules. Keep state directories private (`0700`) and receipt/card files private (`0600`). The workflow applies these permissions and restores artifact permissions before the CLI reads receipts.

## Replay protection and CI evidence

Before any CLI invocation, the workflow looks for the exact artifact `onay-task-state-<task_id>` using the default Factory read-only token. It inspects at most three pages of 100 matching artifacts. Truncated history, an expired matching artifact, a missing receipt on a GitHub rerun, unexpected downloaded files or an unreadable download stop execution. The newest valid matching artifact is restored before the CLI. Existing receipts are inspection-only and prevent automatic replay; the receipt does not restore a partially completed task.

The original receipt artifact is never overwritten by a later inspection. The task store also has a local exclusive lock and immutable task fingerprint; the runtime checks for the deterministic Onay proposal branch before the first model request. An existing branch stops a fresh run even if the earlier receipt is unavailable.

Artifacts are retained for **seven days**, not indefinitely. Deleted artifacts cannot prove that an ID has never been used. Never reuse an ID after receipt deletion or expiration. Inspect the Onay branch/PR and past run manually before deciding on a different task. A failed upload or interrupted publication requires inspection; do not remove the barrier to make execution proceed. GitHub's concurrency group serializes active runs by task ID with cancellation disabled; it is not a persistent backlog or a general queue.

Receipts contain task identity/fingerprint, stage states and optional PR/candidate metadata. They are **not proof that Security, models, tests or CI passed**. `verify` inspects the recorded PR and exact candidate SHA without models or writes; it reports CI evidence separately and does not turn an old checkpoint into a successful new run. A changed PR head, missing check, failed check or incomplete evidence must remain blocked/unverified.

After Draft PR publication, the runner does not wait and poll for CI. Pending CI is `needs-review`. Later dispatch `verify` with the **same exact card** and task ID. Completion requires the configured checks for the exact current candidate, never merely a green run on another commit. Physical Android/iPhone acceptance and release approval remain separate.

## Resource limits and artifacts

Each dispatch runs once, with a ten-minute Actions job limit and no automatic retries or provider fallback. The shared model ledger defaults to at most 16 requests, 24,000 serialized bytes per request, 192,000 cumulative bytes, 1,200 output tokens per request and a two-minute model-run deadline. Host hard ceilings also apply. Instructions, tools and history count toward the byte limits. HTTP 429, exhausted budget, timeout or transport failure stops the whole current model run and cancels in-flight requests; it does not restart the task. Groq's separate token/TPM guard remains active.

Locked Factory dependencies are installed in Actions. This workflow does not start Codespaces or install/build the Onay mobile app locally. Target checks remain on the candidate's existing CI. GitHub Actions minutes and artifact storage have their own account limits; this arrangement saves Codespaces compute but does not make GitHub usage unlimited. Avoid repeated dispatches and inspect reports before another task.

The `always()` artifact collection copies only the expected `<task_id>.json` receipt, optional empty `<task_id>.lock`, `report.json` and `summary.md` into dedicated export directories. It uploads the first replay barrier as `onay-task-state-<task_id>` and each report as `onay-task-report-<task_id>-<run_id>-<attempt>`, retained seven days. Raw cards, source files, model prompts/responses and credentials are not artifact paths. If execution failed before any safe metadata existed, no artifact is fabricated.

Review the Draft PR, exact-candidate CI and unverified areas before accepting work. The team never merges, deploys, changes `main` directly or invokes the legal agent through this runner.
