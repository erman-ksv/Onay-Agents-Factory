# TezJet Agent Factory

AI-assisted engineering factory for the TezJet project.

## Flow

Commander → Explorer → Coder → Tester → Security → Reviewer → Draft PR

The factory reads TezJet from GitHub, asks the AI Coder for an explicit change set, gates it with review/security checks, writes only to a feature branch, and opens a Draft PR against `main`.

## Configuration

Copy `.env.example` to your runtime environment and provide:

- `OPENAI_API_KEY` — enables AI orchestration and Coder.
- `GITHUB_TOKEN` — GitHub token with access to the allowed repository.
- `TEZJET_REPOSITORY=erman-ksv/TezJet`
- `AGENT_ALLOWED_REPOSITORIES=erman-ksv/TezJet`

Never commit tokens or secrets.

## Run

```bash
pnpm install
pnpm typecheck
pnpm dev -- "Add automatic FIFO fallback when the first TezJet driver rejects or times out"
```

Without `OPENAI_API_KEY`, the CLI only prints a deterministic plan and does not modify GitHub.

With both keys configured, the AI Commander can generate and gate a change set. Actual test execution should happen in a trusted CI/runner before merge; the factory must not claim tests ran unless a runner reports them.

## Safety

- `main` is protected by application policy.
- Proposed files are scanned for common secret patterns before writes.
- Changes are created on a dedicated branch and submitted as Draft PR. Failed CI can trigger a bounded repair loop (maximum 3 attempts), with review and security gates before each repair.
- The Coder returns complete file contents for changed files rather than opaque patches.
