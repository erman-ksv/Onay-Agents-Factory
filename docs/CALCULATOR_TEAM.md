# Calculator team contracts: step 4

The trusted host chooses roles; the model cannot choose its own authority.
`commander/calculatorTeam.ts` defines instructions and enforced proposal/handoff
boundaries. These functions do not start models, execute tests, publish source
or connect the backlog; those integrations remain steps 5–7.

| Role | Receives | Hands back to Commander | File proposals |
|---|---|---|---|
| Commander | Owner goal, evidence, saved tasks and budget | Plan, next task, repair task or explicit stop/report | None |
| Product | Owner goal and fixed expected answers | Criteria, priorities, unknown requirements | None |
| Explorer | Host paths and immutable SHA | Inspected references, host-proven absence and unknown scope | None |
| UX | Criteria and supplied UI evidence | Interaction, accessibility and narrow-screen checks | None |
| Coder | Approved arithmetic task and snapshot | Bounded create/patch proposal | src/calculator.mjs, test/calculator.test.mjs |
| Frontend | Approved UI task, UX criteria and arithmetic interface | Bounded browser UI proposal | index.html, styles.css, src/app.mjs, test/ui.test.mjs |
| Tester | Fixed acceptance, changes and actual host runner evidence | Cases, failed steps, observed vs unexecuted checks | None |
| Security | Scope and actual changed-code evidence | Independent evidence-backed assessment | None |
| Reviewer | Criteria, actual changes, findings and supplied test results | Independent assessment and repair findings | None |

Only Coder/Frontend can prepare file proposals, restricted again to the task's
snapshot paths and all step-3 budgets/checks. The host wrapper
`prepareCalculatorRoleChanges` enforces role paths before returning a proposal;
the proposal still cannot authorize publication. Protected acceptance tests,
workflows, configuration, dependencies and secrets remain outside their scope.
Tester derives independent cases and failure reports, not permission to alter
owner expectations or CI. Actual test execution is a separate host capability.

Specialists return through Commander; specialists cannot directly hand another
specialist a new task, self-approve, or request new permissions. The host uses
`assertCalculatorHandoff` to enforce routes. Commander stores precise repair
tasks rather than replaying the whole project. These contracts alone do not
implement the future execution loop.

Frontend/Product/UX get calculator-specific browser instructions. The original
Onay React Native/Expo, taxi, qualification scenarios and expected answers are
unchanged. Shared scope/evidence rules and appropriate general specialist
instructions are reused. Legal, dispatch, backend and database roles are not
selectable in this pilot; the legal agent stays disabled.

Assessments have strict ready/summary/findings/unverifiedAreas fields. Findings
cite only IDs supplied in a host evidence packet. Unknown IDs reject; missing
references remain explicitly unverified. Any high/blocker finding overrides a
model's ready=true. No supplied evidence means no approval. Late findings cannot
be silently truncated to fit a response budget. Every validated assessment has
testsExecuted=false, publicationAuthorized=false and
overallTaskCompletionVerified=false: a model assessment is not a tool receipt.

Stage-specific evidence still matters. A requirements-only Product/UX review can
assess owner criteria without pretending to inspect implementation. Security and
independent implementation review must receive actual changed-code evidence;
the later host runner must enforce that evidence kind and exact SHA. This step's
evidence-ID validator does not independently prove that the referenced tool ran.
