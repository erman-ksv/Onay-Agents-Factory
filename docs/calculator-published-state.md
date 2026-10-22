# Importing the completed Calculator task

`calculatorPublishedTaskState.ts` is a host-only importer for the fixed step-7
artifact. The CLI accepts no replacement artifact IDs, manifests, expectations,
model providers or budgets. The Actions workflow separately checks the genuine
source run and artifact provenance before downloading data.

The importer checks the pinned manifest bytes, every listed file and directory,
complete checkpoint history, plan identity, exact published candidate, three
canonical assessments, terminal stages and conservative charges. It rejects
extra files, links, unsafe permissions and incomplete state. Parsing creates no
locks and calls no provider. Returned JSON is metadata, not resume authority.

The in-memory capability is kept in a WeakMap. A JSON copy cannot restore state
or become a dependency verifier. Restoring exclusively creates a new private
directory and copies original receipts byte for byte. Existing or interrupted
destinations are retained and cannot be overwritten by another restoration.
The original archive remains unchanged and must be preserved by the future
runner with all historical charges.

The dependency runner reconstructs the saved proposal from immutable bootstrap
evidence, compares exact committed file contents, runs the trusted host sandbox
and rechecks the branch. Prior role models are not called. Fresh candidate CI
and the one-use transition remain the responsibility of `calculatorAfterCi.ts`.

The audit workflow tests the current dependency and restores private state;
it does not execute the successor task, dispatch workflows or install a
cross-repository event subscription. Cross-run event barrier transport and a
live successor remain necessary before step 8 is complete. Project budgeting
remains step 9.
