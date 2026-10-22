# Agent-owned correction of a saved failed proposal

The owner wants Factory to develop the pilot and fix its own errors. Host-written
Calculator edits are not evidence of autonomous development. The manually
corrected pilot remains historical evidence and must not be reported as such.

`createCalculatorAgentRepairTeam` is a bounded corrective adapter for the existing
executor. Its proposal comes from one real Developer/Frontend model call, using
the saved proposal and complete independent findings, evidence references and
unverified areas. A fresh branded dependency snapshot supplies only the verified
module path, SHA and calculate(left, operator, right) signature to the developer;
the full unchanged dependency source stays private. Missing or forged dependency
metadata fails before a model call. Host test failures can also be attached. The host does not
provide replacement application code. The output is reconstructed against the
same fresh original snapshot and passes the normal scope/secret/static checks.

The separately named host profile allows at most four calls: one correction and
fresh Security, Reviewer and Tester. Frontend correction has a 2048-token output
ceiling; all assessments remain at 1200. Existing presets and runtime admissions
remain unchanged. The profile cannot plan, generate a task from scratch, approve
the old proposal, reuse old approvals, repeat a correction or accept a JSON copy
of the in-memory corrective request. The entire augmented request still uses the
existing context/TPM/run budgets. Unknown provider usage stays conservatively
charged; insufficient budget stops the phase instead of extending it.

The host must first authenticate the stopped private archive, all prior costs,
no uncertain HTTP/publication, the current repository SHA and a new one-use
remote admission. Only then may its `loadAuthenticatedFailure` FUNCTION supply
the stopped data. Serialized state by itself does not grant resume authority.
All old receipts, artifacts and consumed barriers must remain intact. The
adapter preserves the supplied prior charge and exposes the new/aggregate
charge, but cannot authenticate an artifact or fund a new phase by itself.
Both `checkpointCharge()` and the pre-HTTP persistence hook receive cumulative
old-plus-new charges, including the reservation for the imminent request. A
failed persistence hook stops before transport; it cannot refund the reservation
or let a restart forget the earlier phase. Phase budget diagnostics remain
separate. An unrepresentable cumulative charge stops instead of rounding it.

`verifyRepairedProposal` must execute/verify actual checks of the agent's NEW
digest and return the existing branded host-evidence capability. JSON assertions
or old-digest proof fail before any specialist call. The current browser evidence
capability covers the pilot's clear/backspace UI task; other task acceptance
groups still require their own host runners. Model verdicts remain assessments,
not test execution or write permission.

Plug the adapter into `runCalculatorExecution` with `maxRepairs:0`: this forbids a
second automatic correction after the single separately admitted corrective
call. Every fresh independent gate, executor host check, publisher lease and
exact-candidate CI remains mandatory. A disputed review is shown to the agent
with its evidence; it is not automatically dismissed or converted into approval.
If the new independent review still fails, preserve a blocked result.

This change supplies the corrective team mechanism and offline regression proof.
It does not install a live archive/admission workflow, authorize a consumed
workflow replay, modify Calculator files, merge a PR, deploy, enable the legal
agent, prove whole-application completion or finish automatic CI event delivery.

## Remote one-use admission

`createCalculatorRemotelyAdmittedRepairTeam` composes the corrective adapter with
`createCalculatorRepairAdmission` and requires the existing trusted archive
loader, actual proposal verifier and a cumulative pre-HTTP persistence hook.
There is no default-success loader or verifier. The live runner must explicitly
set `CALCULATOR_AGENT_REPAIR_APPROVED=ONE_SEPARATELY_BOUNDED_AGENT_CORRECTION`,
confirm Free, disable the legal role, use run attempt 1 and bind the reviewed
runtime SHA and its source CI run through trusted host configuration.

Before a phase is admitted, the GitHub adapter independently reads successful
Factory CI for that exact runtime SHA, attempt-1 `typecheck` job and successful
`Typecheck` and `Test` steps. It also checks the current Calculator branch SHA
against the saved failure. Missing, queued, partial or failed evidence refuses
before any remote write. Factory-scoped `GITHUB_TOKEN` needs contents:write for
the control ref; `FACTORY_READ_TOKEN` alone is insufficient. The Calculator token
is used only for fixed GET requests by this adapter. No credentials enter model
packets or diagnostic errors.

One atomic GitHub POST creates a Factory control ref under
`refs/heads/state/calculator-agent-repair/<sha256>`. Its key binds the target
repository, plan, task and target base SHA. Changing the proposal, archive or
runtime cannot create a second correction allowance for that same task/base.
The ref points to the reviewed Factory runtime; it contains no application code
or source text. The `state/` namespace does not trigger the current source CI's
branch filters. Creation is read back before any model call. An existing ref,
conflict, 429, lost response or mismatched readback stops without retry. The
adapter never updates or deletes this ref; operators must preserve it together
with the old artifact/receipt history. Manual deletion outside this protocol
must not be treated as a new authorization.

The permit is bound to the exact in-memory adapter. A JSON copy cannot authorize
transport. Before EACH correction/review model request, the wrapper checks the
remote control ref and target SHA, persists cumulative charges and checks both
again after the persistence await. A moved target, failed write or lost barrier
stops the phase. The normal executor's independent test and publication leases
remain required; a remote admission never replaces those gates.

Regression proof covers duplicate events, concurrent claims, process restart,
changed proposal, stale SHA, uncertain creation, forged permit and target
movement during persistence, including composition with the actual model-team
adapter using fake HTTP. No live control ref or model request was created by
these tests. The production archive loader and actual isolated host runners
still need to be wired into a reviewed live workflow; this module does not
silently activate one or revive a consumed/stale historical run.
