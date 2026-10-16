# Pipeline CLI runbook

## 1. What the commands do

- `pnpm dev -- "task"` runs the Commander planner/router. It is not the change-writing pipeline.
- `pnpm run pipeline -- --goal "task"` performs read-only repository/test/security analysis.
- Adding `--publish` asks the pipeline to generate a change, pass review/security gates, create a feature branch and Draft PR, and wait for Onay CI.

## 2. Required configuration

Set these in your local runtime environment or secret manager, never in source control:

- `GITHUB_TOKEN`: token authorized to read and create feature branches/PRs in the configured repository.
- `ONAY_REPOSITORY=erman-ksv/Onay`: target repository.
- `AGENT_ALLOWED_REPOSITORIES=erman-ksv/Onay`: repository allowlist used by the factory.
- `OPENAI_API_KEY`: needed for AI-generated changes.

Install dependencies and verify the factory first:

```bash
pnpm install
pnpm run typecheck
pnpm run test
```

## 3. Read-only analysis first

```bash
pnpm run pipeline -- --goal "Describe the behavior to investigate"
```

Read the output. It is analysis, not a claim that a fix was generated, tested, or written.

## 4. Explicitly request a draft PR

Only do this after reviewing the goal and confirming the target repository:

```bash
AGENT_FACTORY_ENABLE_GITHUB_WRITES=true pnpm run pipeline -- \
  --goal "Describe the confirmed change" \
  --branch "feat/short-descriptive-name" \
  --title "Short PR title" \
  --body "Problem, intended behavior, and validation plan" \
  --publish
```

The write gate requires both `--publish` and `AGENT_FACTORY_ENABLE_GITHUB_WRITES=true`. The CLI rejects exact `main` and `master` branch names. Do not use a branch that already contains unrelated work.

## 5. Interpret the result conservatively

- `analysis-only`: no branch/PR writes were requested by the CLI.
- `blocked`: inspect the reported exploration, review, or security issue; do not bypass the gate.
- `no-change`: the coder returned no files; no PR should be expected.
- `ci-blocked` / `ci-repair`: do not merge. Resolve the reported issue or wait for CI.
- `ci-passed`: the required target workflow was reported successful for the generated commit. Still inspect the full diff and test evidence.

Agent Factory's own CI checks the factory's types/tests. It does not prove a proposed Onay change is correct. Never merge automatically based solely on model output. Keep PRs as drafts until a human reviewer approves them.

## 6. Current limitations

- Read-only analysis does not run arbitrary test commands locally; it discovers the repository's test scripts.
- The actual Onay test result comes from the target repository's GitHub Actions workflow.
- The CLI's publishing mode can create real GitHub branches and Draft PRs. Keep write credentials scoped to the intended repository.
- No production deployment, database migration, legal approval, or PR merge is performed by this runbook.
