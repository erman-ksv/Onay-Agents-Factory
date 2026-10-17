# Onay Agent Factory — five free AI APIs: confirmation plan (2026-10-17)

Status: ACTIVE PLAN, NOT A COMPLETION REPORT.

## Objective and order

1. Fully verify the Cloudflare Workers AI integration before testing additional API providers.
2. Confirm a total of **five distinct genuinely free AI API providers** for Agent Factory. No card, paid tier, pay-as-you-go, automatic billing, purchases, or non-free model routes.
3. Only after the provider qualification gate succeeds, consider real Onay development tasks under separate human authorization. Do not equate read-only validation with development or launch readiness.

## Target list, not verified completion

| # | Provider | Evidence as of 2026-10-17 | Next gate |
|---|---|---|---|
| 1 | Cloudflare Workers AI | Credentials and standalone chat/function call smoke reported PASS by user; provider adapter, free-route pin and offline SDK tool-call round trip PASS; latest CI on `3ca977a992c3744776667f0afe60dafc7dd0331e` PASS; **live full Commander audit was blocked** on previous head | ONE controlled live read-only audit on newest green head; require Explorer, Security and Tester host evidence plus no unrelated specialist fanout |
| 2 | Groq | 14/14 synthetic specialist qualification passed with Qwen3; read-only Explorer/Tester/Security handlers 3/3 passed independently; **live Commander not complete**, blocked by local TPM budget | Respect actual free account quota, prove a bounded multi-turn audit without raising limits blindly |
| 3 | Gemini | Provider implemented; previous free daily quota exhausted; **full live run not verified** | Resume only after observed free quota reset; no paid fallback |
| 4 | OpenRouter | Explicit :free routes allowed; earlier HTTP 429; **full live run not verified** | Check actual free allowance and exact :free model; one bounded live validation if within limits |
| 5 | Mistral AI | Not yet integrated or keyed; **not verified** | Set up Free mode (official docs: no card); add free-only adapter and offline tests; verify function calling and a bounded read-only audit |

Alternative candidate if a proposed provider cannot be used at no cost: Cohere free trial key, subject to account availability and trial usage restrictions. Do not quietly substitute or falsely mark the failed provider as qualified.

Official Mistral docs:
- https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key
- https://docs.mistral.ai/studio/conversations/function-calling
Official Cohere trial details: https://docs.cohere.com/v2/docs/rate-limits

## Exact evidence gate for **each** provider

- **F0 Zero-price**: API access and model are demonstrably available under the user's free plan; no card, billing enablement or paid route. Record model ID and actual quota before contacting the provider.
- **F1 Secret safety**: key present only in Codespaces secrets; no API keys or account IDs in git, user chat, CI logs, tool-output excerpts or PRs.
- **F2 Offline compatibility**: typecheck and regression tests PASS; mock transport confirms SDK payload conversion, function-call round trip, provider isolation, rate-limit failure closure, no uncontrolled retries or fallback. CI green at exact SHA.
- **F3 Live API**: one bounded real request returns HTTP 200 and a real tool/function call. A successful text-only chat or token presence alone does NOT count.
- **F4 Read-only Commander**: exact immutable Onay commit explored; host records clean security and exact-commit passing Tester evidence, with Commander status `completed`. Unrequested specialists must not consume requests. No writes, no release or legal claims.
- **F5 Documentation**: preserve CI URL/SHA, source model, bounded request count, host evidence and verdict. Mark `CONFIRMED` ONLY after F0–F4 pass. Otherwise `BLOCKED` or `PENDING`, with reason and next action.

The goal is **5/5 confirmed**, not 5 configured keys. Current confirmed full end-to-end tally: **0/5** (based on evidence available when this plan was created); prior smoke and specialist passes remain valid as narrower evidence.

## Safety constraints

- `main` never changes; all changes are feature branches and Draft PRs. PR #41 and #42 remain Draft. No merges or deployments without explicit user authorization.
- `AGENT_FACTORY_LEGAL_ENABLED=false`: Rasul/legal disabled, never called or counted as approved.
- `AGENT_FACTORY_ENABLE_GITHUB_WRITES=false`: qualification reads only.
- Target allowlist `erman-ksv/Onay`. Use read-only `ONAY_READ_TOKEN` in the hosted runtime; do not include token values in diagnostics.
- No paid API/model, no credit card, no automatic repeated failing requests. Stop on 400/429, local budget or privacy failures; investigate offline first. Never raise a budget based on guesswork.
- Do not declare 24/7 production readiness from free API quotas; verify sustainability separately.
- User works via phone: one short and safe instruction at a time.

## Execution checklist (today, in this order)

- [x] Cloudflare fix in Draft PR #42; adapter and mocked multi-turn function-call round trip.
- [x] 2026-10-17 CI on `3ca977a992c3744776667f0afe60dafc7dd0331e`: Typecheck PASS, Test PASS (offline evidence).
- [ ] Controlled Cloudflare LIVE Commander read-only audit on green exact head; mark VERIFIED only if F0–F4 pass.
- [ ] Complete Groq free-tier full audit or retain BLOCKED with exact local TPM evidence.
- [ ] Verify Gemini free quota and live audit or retain BLOCKED.
- [ ] Verify OpenRouter exact :free model quota and live audit or retain BLOCKED.
- [ ] Add and qualify Mistral Free as the fifth provider (requires user to create API key in Codespaces).
- [ ] Publish final provider scorecard, including 5/5 or explicit remaining blockers with supporting run links.
