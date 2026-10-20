# Calculator execution coordinator — pilot part 7b

This connects the saved workspace/task claim to the model team, independent
assessments, trusted proposal tests, one bounded repair, publication verification
and one read of exact-candidate task CI. It is an orchestration library, not yet a
configured live calculator runner. Legal, merge and deployment remain disabled.

## API and authorization

runCalculatorExecution(workspace, { team, tools, verifyDependencies, env }) uses a
genuine current workspace. team is the instance from createCalculatorModelTeam;
all model calls, including repair, retain its shared budget. tools must contain
trusted checkProposal, publish and ci implementations. Missing tools stop before
a claim or model request. No shell command or tool implementation comes from AI.

Live execution additionally requires CALCULATOR_EXECUTION_LIVE_APPROVED set to
RUN_ONE_FREE_CALCULATOR_TASK, AGENT_FACTORY_ENABLE_GITHUB_WRITES=true,
AGENT_FACTORY_TARGET_PROFILE=calculator, ONAY_TEAM_FREE_TIER_CONFIRMED=true,
AGENT_FACTORY_LEGAL_ENABLED=false, the calculator in AGENT_ALLOWED_REPOSITORIES,
and no workflow-change opt-in. Existing model adapter consent remains required.
Only trusted offline tests may select execution=offline-test with fixture tools;
this switch is not a model argument or approval for a live publisher.

## Execution and repair

- Claim the selected task durably before the first model/tool action; all stages
  are persisted. A concurrent, interrupted, blocked or uncertain task is never
  automatically replayed or replaced with a fresh instance.
- Load current source, generate once, and independently reconstruct the proposal's
  role, secret and policy gates against the original genuine snapshot.
- Require every task path to exist in the base or candidate. Run independent
  Security, Reviewer and Tester calls. Test design/advice never proves execution.
- checkProposal must execute checks in an isolated trusted test harness against
  the exact proposal. Its source-free evidence must identify repository, task,
  base SHA and the full proposal digest. False execution, missing evidence or an
  unverified test harness stops; it is never turned into a successful check.
- An assessment failure or an actually executed failed check permits ONE repair.
  Persist the failure and repair stage before the call; feed bounded source-free
  issues and complete prior changed text to the same model instance. The repair
  is a complete replacement proposal against the ORIGINAL snapshot. It cannot
  change criteria, reuse invented source, reset the budget or request tools.
- Rerun all proposal/static, Security, Reviewer, Tester and host test gates after
  repair. A second failure or HTTP 429 stops durably. Reports contain metadata,
  not original source, raw model responses or provider error bodies.

## Publication and task CI

The injected publisher must enforce the expected SHA and publish only to the
host-derived project branch/Draft PR. It must implement an actual atomic lease;
this coordinator's preflight reads cannot lock GitHub. An uncertain response
leaves needs-review metadata; it must be investigated, never retried blindly.
A known candidate whose scope/parent/blobs cannot be verified is blocked so its
receipt cannot silently open a dependency.

The returned candidate is recorded immediately. Verification checks the current
branch, a single parent equal to the pinned base, every proposed Git blob, complete
trees and the absence of unrelated additions/changes/deletions (including CI).
Candidate head is checked again after CI. This detects bad evidence but cannot
undo a publisher's write, so only a trusted least-privilege publisher may be used.

Task CI must prove Calculator task CI with successful Syntax and Task tests steps
for the exact candidate/run attempt. Pending or absent CI produces needs-review
without polling/model replay. Failed CI blocks and requires explicit subsequent
repair work. No failed CI is automatically rerun in this one-shot coordinator.

This intermediate task gate DOES NOT replace the unchanged final Calculator CI
(Syntax, Unit tests, Browser tests). Even a verified candidate is stored as
needs-review and reports wholeAppCompleted=false/finalCalculatorCiVerified=false.
Dependency selection still requires fresh current-SHA host verification; a receipt
alone cannot approve the next task. Final product acceptance remains mandatory.

## Remaining live setup

There is no configured production tools adapter or CLI in this part. Before a
real run, provide isolated proposal-test execution, a least-privilege atomic
publisher and paginated current-attempt CI reader; pin trusted task/final workflows
without allowing the models to modify them. Configure provider credentials and
explicit free-mode consent. Offline coordinator tests use synthetic test/CI/Git
responses and are not evidence that agents built or tested an application.
