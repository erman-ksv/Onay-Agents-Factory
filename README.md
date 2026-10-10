# TezJet Agent Factory

AI-assisted engineering factory for the TezJet project, with role-specific operating skills.

## Agent workflow

Commander → Explorer → Product/UX/Domain Specialists → Coder → Tester → Security → Independent Reviewer → Draft PR

The Commander selects specialists based on the task. The planner routes legal/compliance requests to Rasul and relevant engineering/product tasks to the corresponding specialists. The team must distinguish proposals from changes actually written and tests actually executed.

## Specialist roster

- **Explorer** — codebase mapping, data flow, dependency and risk analysis.
- **Coder** — minimal, maintainable implementation and explicit changed-file contents.
- **Backend** — API contracts, auth, validation, transaction boundaries, idempotency and concurrency.
- **Frontend & Mobile** — React/Expo, Android/iOS, accessibility, offline/error states and location permissions.
- **Database** — schema, migrations, constraints, indexes, transaction safety and persistence.
- **Product Analyst** — scope, non-goals, business rules and measurable acceptance criteria.
- **UX & Accessibility** — user journeys, mobile usability, accessible controls and permission/error flows.
- **Tester** — deterministic unit/integration/regression tests, edge cases and concurrency.
- **Security** — threat modelling, authorization, secrets, privacy, dependencies and abuse cases.
- **DevOps & Release** — CI, secrets handling, deploy gates, monitoring, backups and rollback.
- **Independent Reviewer** — diff-based review, blockers and evidence-based readiness decision.
- **Rasul — Legal & Compliance Research Specialist** — jurisdiction-aware legal issue spotting, primary-source research checklist, contract/policy drafts, transport/platform compliance, privacy, consumer protection, insurance, tax and escalation to qualified counsel.

## Role skills

Detailed operational instructions are maintained in `commander/skills.ts` and injected into the corresponding AI agents. These are prompt-based role skills, not model fine-tuning or proof of professional certification. Improve them through reviewed examples, evaluation tests, and verified source material.

## Legal safety rules for Rasul

Rasul is an AI legal research assistant, not a licensed lawyer. For each legal task he must identify the jurisdiction and date, separate supplied facts from assumptions, prefer current official primary sources, provide source URLs and verification status, and never invent statutes, cases, article numbers, or citations. If sources cannot be verified, he must label the issue unverified and provide a research plan. Drafts must be marked **DRAFT — HUMAN LEGAL REVIEW REQUIRED**. He cannot sign, send, file, negotiate, or make binding legal commitments. Qualified human counsel must review external legal documents and high-impact decisions. Minimize confidential and personal data.

## Configuration

Copy `.env.example` to your runtime environment and provide:

- `OPENAI_API_KEY` — enables AI orchestration and specialist delegation.
- `GITHUB_TOKEN` — GitHub token with access to the allowed repository.
- `TEZJET_REPOSITORY=erman-ksv/TezJet`
- `AGENT_ALLOWED_REPOSITORIES=erman-ksv/TezJet`

Never commit tokens or secrets.

## Run

```bash
pnpm install
pnpm typecheck
pnpm dev -- "Review TezJet driver agreement and privacy obligations for the target jurisdiction"
```

Without `OPENAI_API_KEY`, the CLI only prints a deterministic plan and does not modify GitHub. With both keys configured, the AI Commander can generate and gate a change set. Actual test execution must happen in a trusted CI/runner before merge; the factory must not claim tests ran unless a runner reports them.

## Safety and release gates

- `main` is protected by application policy.
- Proposed files are scanned for common secret patterns before writes.
- Changes are created on a dedicated feature branch and submitted as a Draft PR.
- Failed CI may trigger a bounded repair loop (maximum 3 attempts), with review and security gates before each repair.
- No agent may claim a write, test, deployment, legal verification, or merge without evidence from the relevant tool.
- Legal and other high-impact outputs are drafts only; qualified humans retain final responsibility.
