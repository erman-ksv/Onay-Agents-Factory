# Isolated calculator profile: step 3

This is a host preparation boundary for the calculator pilot, not a completed
calculator, a model run, a publication API or an extension of Onay permissions.

## Authority

`config/calculatorProfile.ts` fixes the target to
`erman-ksv/Onay-Factory-Calculator`. Only index.html, styles.css,
src/calculator.mjs, src/app.mjs, test/calculator.test.mjs and test/ui.test.mjs
may change. At most three explicitly approved paths can change per proposal.
The model cannot select the repository, base commit, branches, CI, credentials,
dependencies, protected acceptance tests or workflow files.

`calculatorBranch(taskId)` derives a feature branch. Snapshot baseRef is a read
reference only; no method in these modules writes a branch, including main.

## Provenance and absence

The trusted host calls `loadCalculatorSnapshot(scope, reader)` with an exact
commit SHA and changePaths. The reader confirms the base head before and after
reading, links commit to tree, requires a complete bounded tree, checks target
paths and ancestor modes, then verifies existing content against Git blob SHA.
A file's 404 never proves absence. Failed reads, a moved head, truncated tree,
symlink, submodule, invalid UTF-8, digest mismatch or possible secret stops the
operation with a fixed diagnostic.

Full originals remain in a private WeakMap. A frozen snapshot exposes metadata
and hashes only. JSON/model-generated snapshot objects cannot authorize a
creation. `calculatorSources` is host-only; do not expose it as a model tool or
serialize its returned map. `verifyCalculatorBase` rechecks a genuine snapshot
before a future execution layer attempts publication.

The optional live read adapter requires GITHUB_TOKEN, an explicit calculator
entry in AGENT_ALLOWED_REPOSITORIES and AGENT_FACTORY_TARGET_PROFILE=calculator.
It sends only fixed-target GitHub GETs, with response-size/time limits and no
retry. Tokens stay in request headers; no raw upstream error is returned.

## Proposal contract

`prepareCalculatorChanges(modelOutput, snapshot)` accepts exactly:

```
{ summary, changes: [
  { operation: "create", path, content, message },
  { operation: "patch", path, sourceSha256, edits: [{ before, after }], message }
] }
```

Create requires proven absence. Existing files require exact anchored patches
and their full-source SHA256, using the original bounded-patch implementation.
All files are validated before a proposal is returned; nothing is written.
Limits include three files, 8,192 bytes per new file, 6,000 changed characters
across create/patch combined, and 12,000 bytes of serialized reviewer evidence.
Complete new code and exact changed source are shown to reviewers; unchanged
private source is omitted and explicitly unverified.

Existing secret scanning and reviewer policy run with build/workflow opt-ins
false. Their success does not grant publication or completion: the result marks
independentReview/tests required and publicationAuthorized false. The host must
still perform independent assessments, exact-candidate CI and browser acceptance.
The fixed required CI contract is Calculator CI with Syntax, Unit tests and
Browser tests; the trusted workflow and acceptance harness are not created by
this preparation step. Legal remains disabled.

## Subsequent steps

Steps 4–7 connect assigned roles, the saved goal/backlog, sequential base SHAs,
the bounded Coder and independent gates to these APIs. Step 8 adds event-driven
continuation; step 9 persists the project-wide request budget. Do not report
these integrations as implemented by step 3. Existing Onay cards/runtime and
their permissions are unchanged.
