# TezJet Agent Factory

AI-assisted engineering factory for the TezJet project.

## Flow

Commander → Explorer → Coder → Tester → Security → Reviewer → Draft PR

The factory reads TezJet from GitHub, asks the AI Coder for an explicit change set, gates it with review/security checks, writes only to a feature branch, and opens a Draft PR against `main`.

## Configuration

Copy `.env.example` to your runtime environment and provide:

- `GEMINI_API_KEY` — enables Gemini-backed AI orchestration when set.
- `GEMINI_MODEL` — optional Gemini model name; defaults to `gemini-2.5-flash`.
- `OPENAI_API_KEY` — optional fallback provider when Gemini is not configured.
- `GITHUB_TOKEN` — GitHub token with access to the allowed repository.
- `TEZJET_REPOSITORY=erman-ksv/TezJet`
- `AGENT_ALLOWED_REPOSITORIES=erman-ksv/TezJet`

When both model keys are set, Gemini is preferred. Never commit tokens or secrets.

## Run

```bash
pnpm install
pnpm typecheck
pnpm dev -- "Add automatic FIFO fallback when the first TezJet driver rejects or times out"
```

Without either `GEMINI_API_KEY` or `OPENAI_API_KEY`, the CLI only prints a deterministic plan and does not modify GitHub.

With a model key and `GITHUB_TOKEN` configured in the Agent Factory runtime, the AI Commander can generate and gate a change set. The API key must be added to the runtime where Agent Factory runs; a secret configured only in the separate TezJet Replit project is not automatically shared with this repository or another runtime. Actual test execution should happen in a trusted CI/runner before merge; the factory must not claim tests ran unless a runner reports them.

## Safety

- `main` is protected by application policy.
- Proposed files are scanned for common secret patterns before writes.
- Changes are created on a dedicated branch and submitted as Draft PR. Failed CI can trigger a bounded repair loop (maximum 3 attempts), with review and security gates before each repair.
- The Coder returns complete file contents for changed files rather than opaque patches.
