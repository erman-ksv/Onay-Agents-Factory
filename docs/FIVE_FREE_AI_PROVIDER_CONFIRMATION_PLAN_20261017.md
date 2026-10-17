# Onay Agent Factory — five free AI APIs: confirmation plan (2026-10-17)

Status: ACTIVE PLAN. Cloudflare and Groq VERIFIED (2/5). OpenRouter latest live free audit BLOCKED by HTTP 429 at 22:34 (+05:00), Gemini free daily quota previously exhausted. Next attempt a different truly free provider, not repeated 429 calls.

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
| 4 | OpenRouter | **BLOCKED — HTTP 429 again**. 2026-10-17 ~22:34 +05:00 live `openrouter/free` read-only audit screenshot: `STATUS: blocked`, `TESTS: false`, `MISSING: [explorer,tester,security]`, `REASONS` includes `429 Provider returned error` and no final explanation, `PROVIDER_FAILURE: NONE`. The exact cause of 429 (per-minute, daily quota, upstream limit) has NOT been verified; CI on `71768916d3dcb07102cc847f3ca55f440abec1fc` PASS. **Do not count as confirmed.** | Do not retry blindly; retain blocker and review precise free quota/settings when it changes |
| 5 | Mistral AI | **BLOCKED — upstream HTTP 429**. Key created and `MISTRAL_API_KEY` in Codespaces; user confirmed Free without payment; Draft PR #47 green CI at `84768c66fdaa69a0ed5b52602b645f91b4222342` (https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/39055398206). Live read-only Mistral audit at 2026-10-17 22:53 +05:00 screenshot: `STATUS=blocked`, `TESTS=false`, `MISSING=[explorer,tester,security]`, `REASONS` includes `429 Mistral provider returned HTTP 429. Stop without retrying.`. Wrapper intentionally strips upstream body, so actual quota source is unknown; **not counted**. | No automatic retries. Inspect Mistral Studio Admin > Usage and limits, check organization/workspace rate (RPS/TPM/monthly), then plan a smaller free request only after availability confirmed |

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
- [x] Verify OpenRouter current free API behaviour: one live read-only audit at ~22:34 +05:00 BLOCKED with HTTP 429 before Explorer/Tester/Security. Leave unconfirmed until quotas become available, no blind retries.
- [x] User created Mistral key and added `MISTRAL_API_KEY` Codespaces secret; adapter and tests in Draft PR #47.
- [x] Mistral Free confirmed by user and CI PASS on branch; one live audit attempted 22:53 +05:00 and was BLOCKED by upstream HTTP 429. Mistral remains unconfirmed. Do not retry without seeing workspace limits.
- [ ] Publish final provider scorecard, including 5/5 or explicit remaining blockers with supporting run links.

## Confirmation ledger (user-visible evidence)

- 2026-10-17 20:26 (+05:00): Cloudflare Workers AI live read-only Commander test after latest green code and secrets configuration: `STATUS=completed; SECURITY=clean; TESTS=true; MISSING=[]; REASONS=[]` (screenshot supplied in chat). Count = **1/5**. Do not claim publication, merge, production release or legal approval.
- Next: Mistral Free candidate. Gemini remains deferred due daily free quota, OpenRouter remains blocked by HTTP 429. Validate genuine no-billing free Mistral access before key creation; implement offline provider adapter and test tool calling before at most one bounded live run. For a fifth confirmed provider after this, scout an additional truly free option rather than counting blocked providers as successful. Existing Cloudflare+Groq confirmations are only for read-only audits; full coding collaboration remains a separate test.

- 2026-10-17 22:28 (+05:00): Groq live read-only Commander on compact audit branch, model `qwen/qwen3.8-27b`: `STATUS=completed; SECURITY=clean; TESTS=true; MISSING=[]; REASONS=[]; PROVIDER_FAILURE=NONE`. Screenshot supplied in chat. **2/5** fully verified read-only providers. Corresponding code CI green at `f6f25cf76f445d29a1f1c1116ce59e0953fec41d`. No API-key values or Onay private source included.

- 2026-10-17 ~22:34 (+05:00): OpenRouter `openrouter/free` compact Commander user terminal screenshot: `STATUS=blocked`, `TESTS=false`, `MISSING=[explorer,tester,security]`, `REASONS` includes `429 Provider returned error`, `PROVIDER_FAILURE=NONE` (the latter means the custom structured Groq-style failure diagnostic was not available, **not** that the HTTP failure did not occur). Do not re-issue API calls; **tally stays 2/5**. Gemini also deferred due its previously confirmed free daily quota exhaustion.

- 2026-10-17 22:53 (+05:00): User terminal screenshot proves Mistral read-only Commander `STATUS=blocked`, `TESTS=false`, `MISSING=[explorer,tester,security]`; API returned sanitized upstream HTTP 429 (not local 4-request guard). SDK is no-retry and the run has stopped. Exact trigger (RPS, TPM, monthly quota, workspace budget) is **unknown** because error body is deliberately scrubbed. Mistral Free with pay-as-you-go disabled was confirmed by user. CI PASS, but live not verified; **confirmed tally remains 2/5**. Official usage and limits: https://docs.mistral.ai/admin/billing-usage/usage-limits ; https://docs.mistral.ai/resources/known-limitations .

- 2026-10-17 23:13 (+05:00): User-supplied Mistral Admin Subscription screenshot: plan `Free`; `API/Studio included monthly usage $10` showing `$0 USD` consumed with 14 days until reset; `API Pay-as-you-go` button says `Включить` (enable), thus currently OFF. Earlier model-specific API Limits screenshot for `mistral-small-2603`: `20,000 tokens/min`, `1.00 requests/sec`; usage dashboard screenshot had `0 API requests` for selected period. These observations establish a displayed monthly allowance and no billed usage, **not** successful API access; upstream 429 cause still unresolved. The Studio API key page warns `Upgrade to use your API keys`, which potentially conflicts with Mistral Free-mode documentation; do NOT advise upgrade or billing. Review safe no-network request-size diagnostics and only consider another live attempt once rate-limit mechanism is understood.

- 2026-10-17 late evening: No-network hardening completed on Mistral Draft PR #47: serialized request queue, minimum 1.2s between outgoing attempts based on user 1 RPS screenshot, cumulative 48KB and per-attempt 32KB payload caps, 512 max completion tokens, and metadata-only request diagnostics (count, bytes, status, wait) with no key/body. Offline regression tests added; GitHub CI for code SHA `40422fad922ad599ce1e1dc75edb6e9760d953ae` pending at time of writing. 429 happened earlier and might be the first request due to account activation or upstream limits; pacing is preventive, NOT proof of a resolved issue. Do NOT repeat paid/free API calls until a genuinely useful no-network diagnostic demonstrates safe conditions. Confirmed tally remains **2/5**.

- 2026-10-17 23:33 (+05:00): User Codespaces screenshot confirms **MISTRAL_CHAT_HTTP=429** for a *direct*, one-shot `POST https://api.mistral.ai/v1/chat/completions` with model `mistral-small-latest`, single user message `Reply OK.`, `max_tokens=8`, `curl --retry 0`, no Onay source and no Commander execution. Immediately prior `GET /v1/models` test was user-reported HTTP 200. Therefore authentication/list-model access works, while even minimal generation is blocked by an upstream 429; request-size and Commander pacing changes **do not fix this demonstrated blocker**. Mistral docs say 429 can reflect RPS, TPM or monthly token cap at organization level. Do not repeat generation blindly or enable paid billing. CI test proof remains green but Mistral **NOT CONFIRMED**; tally **2/5**. Sources: https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them and https://docs.mistral.ai/admin/billing-usage/usage-limits .
