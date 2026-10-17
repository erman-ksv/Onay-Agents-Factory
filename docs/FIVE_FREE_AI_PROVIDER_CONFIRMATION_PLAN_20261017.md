# Onay Agent Factory — five free AI APIs: confirmation plan (2026-10-17)

Status: ACTIVE PLAN. Cloudflare and Groq live read-only Commanders verified 2026-10-17 by user Codespaces screenshots. Three providers pending.

## Objective and order

1. Fully verify the Cloudflare Workers AI integration before testing additional API providers.
2. Confirm a total of **five distinct genuinely free AI API providers** for Agent Factory. No card, paid tier, pay-as-you-go, automatic billing, purchases, or non-free model routes.
3. Only after the provider qualification gate succeeds, consider real Onay development tasks under separate human authorization. Do not equate read-only validation with development or launch readiness.

## Target list, not verified completion

| # | Provider | Evidence as of 2026-10-17 | Next gate |
|---|---|---|---|
| 1 | Cloudflare Workers AI | **CONFIRMED (1/5)**. User Codespaces screenshot 2026-10-17 20:26 +05:00: live Commander `STATUS: completed`, `SECURITY: clean`, `TESTS: true`, `MISSING: []`, `REASONS: []`. Free Workers AI token and function-call smoke were previously reported PASS. CI on `abe0965fd6d2eb231055257829d4c3f23b78bc08` successful: https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/39044533896 . Proof is a read-only audit, not autonomous coding/release. | Preserve confirmed evidence; no need to repeat this live audit |
| 2 | Groq | **CONFIRMED (2/5)**. 2026-10-17 22:28 +05:00 user Codespaces screenshot on `feat/groq-compact-audit-20261017`: live read-only Commander `STATUS: completed`, `SECURITY: clean`, `TESTS: true`, `MISSING: []`, `REASONS: []`, `PROVIDER_FAILURE: NONE`. Groq Qwen3 previous synthetic specialists 14/14 and CI `f6f25cf76f445d29a1f1c1116ce59e0953fec41d` PASS: https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/39053542927 . Read-only audit only, not proven AI Coder or deployment readiness. | Preserve evidence and free-tier quota; no need to repeat Groq live audit |
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

The goal is **5/5 confirmed**, not 5 configured keys. **Confirmed provider tally: 2/5 (Cloudflare, Groq).** Evidence is a user-provided terminal screenshot of the live read-only audit (not an independently downloaded full terminal trace). Remaining providers are still NOT confirmed. This proof does not establish 24/7 availability, paid plan eligibility, production release readiness, or AI Coder capability.

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
- [x] Controlled Cloudflare LIVE Commander read-only audit: user screenshot at 20:26 +05:00 shows `completed` + `clean` + `true`, no missing actors or reasons. This verifies read-only Explorer/Security/Tester gates, not live source modification.
- [x] Complete Groq free-tier live read-only Commander audit: screenshot at 22:28 +05:00 shows completed + clean + exact-commit TESTS true, no missing actors/reasons/provider failure.
- [ ] Verify Gemini free quota and live audit or retain BLOCKED.
- [ ] Verify OpenRouter exact :free model quota and live audit or retain BLOCKED.
- [ ] Add and qualify Mistral Free as the fifth provider (requires user to create API key in Codespaces).
- [ ] Publish final provider scorecard, including 5/5 or explicit remaining blockers with supporting run links.

## Confirmation ledger (user-visible evidence)

- 2026-10-17 20:26 (+05:00): Cloudflare Workers AI live read-only Commander test after latest green code and secrets configuration: `STATUS=completed; SECURITY=clean; TESTS=true; MISSING=[]; REASONS=[]` (screenshot supplied in chat). Count = **1/5**. Do not claim publication, merge, production release or legal approval.
- Next: Gemini, then OpenRouter, then Mistral Free. Before live Gemini requests verify remaining free daily quota and reuse the bounded single-audit-tool pattern. Existing Groq+Cloudflare confirmations are for read-only audits; full coding collaboration remains a separate test.

- 2026-10-17 22:28 (+05:00): Groq live read-only Commander on compact audit branch, model `qwen/qwen3.8-27b`: `STATUS=completed; SECURITY=clean; TESTS=true; MISSING=[]; REASONS=[]; PROVIDER_FAILURE=NONE`. Screenshot supplied in chat. **2/5** fully verified read-only providers. Corresponding code CI green at `f6f25cf76f445d29a1f1c1116ce59e0953fec41d`. No API-key values or Onay private source included.
