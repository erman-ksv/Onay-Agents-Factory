# Synthetic advisory specialist qualification

This check exercises the existing ROLE_SKILLS profiles for product, UX, backend,
frontend/mobile, database, dispatch, legal and DevOps through the same Agent/Runner
SDK and Gemini provider configuration used by the factory. It is a direct profile
benchmark, not another Commander end-to-end run. PR #39 is the separate synthetic
Commander/Coder/publication/CI proof.

Each role receives an explicitly scoped faulty scenario and a corrected scenario.
No application code, repository context, real personal data or GitHub token is
required. Agents have no tools. The runner performs 16 sequential model runs,
subject to existing provider rate limits and bounded HTTP retries. It does not
rerun whole cases to turn failures green.

The evaluator requires both the expected ready decision and, for faulty cases,
a role-specific high/blocker finding. A blanket reject/approve strategy fails.
Expected answers and matching patterns are not sent in prompts. Patterns provide
only a coarse machine check: inspect the printed findings manually. A matching
phrase can still be a wrong explanation. This small, openly inspectable fixture
set does not establish general competence, production readiness or legal approval.

Security, Reviewer and Tester in the current Commander are deterministic gates,
not advisory model roles; they are covered separately by factory tests.
Commander/Coder and those gates are not re-qualified by this benchmark.

## Run

After the implementation branch CI is green, in its Codespaces checkout:

```bash
pnpm install --frozen-lockfile
pnpm exec tsx orchestration/specialistQualificationLive.ts
```

Only GEMINI_API_KEY is required. Existing provider model/base-URL configuration
still applies. Do not print keys. START lines show progress before each case.
Each result includes findings for human review. Nonzero exit means a mismatch
or an incomplete/blocked run. Do not change expected answers to obtain a pass;
investigate the fixture, evaluator and actual specialist explanation first.

Offline CI tests validate coverage and fail-closed evaluation with fake responses.
A green CI does not mean Gemini qualification has run. Record the live output,
implementation commit, provider/model and human review before accepting results.

## Free OpenRouter alternative

Set AGENT_FACTORY_PROVIDER=openrouter and OPENROUTER_MODEL=openrouter/free explicitly.
OPENROUTER_API_KEY must be set in the local runtime. A remaining Gemini key is
ignored under explicit OpenRouter selection. Missing keys stop execution; there
is no automatic fallback. Existing provider configuration rejects paid model
routes before any network request. A free route can still have availability or
quota limits, and openrouter/free can select different models across requests;
results qualify that route's observed responses, not a single fixed model.
Keep per-case output and review the explanations. Do not bypass blockers.

Example with a previously configured key:

```bash
AGENT_FACTORY_PROVIDER=openrouter OPENROUTER_MODEL=openrouter/free pnpm exec tsx orchestration/specialistQualificationLive.ts
```
