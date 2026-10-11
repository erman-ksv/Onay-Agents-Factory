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
- **Dispatch & Ride Operations** — taxi matching, FIFO queue fairness, pickup eligibility, driver offer timeouts, seat capacity, and ride lifecycle invariants.
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

## Run the Commander

```bash
pnpm install
pnpm typecheck
pnpm dev -- "Review TezJet driver agreement and privacy obligations for the target jurisdiction"
```

The Commander produces a task plan and specialist routing. Without `OPENAI_API_KEY`, it uses deterministic planning; with the key, it enables AI orchestration. **This command does not itself run the TezJet change pipeline.**

## Run the TezJet change pipeline

Start with read-only analysis. This inspects the configured TezJet repository and its test/security context but does not create a branch or pull request:

```bash
pnpm run pipeline -- --goal "Analyze the driver queue fairness rules"
```

To request a generated change and draft PR, explicitly supply a feature branch, PR title/body, and both write opt-ins:

```bash
AGENT_FACTORY_ENABLE_GITHUB_WRITES=true pnpm run pipeline -- \
  --goal "Fix a confirmed dispatch bug" \
  --branch "feat/dispatch-bug-fix" \
  --title "Fix dispatch bug" \
  --body "Summary, rationale, and validation plan" \
  --publish
```

Publishing can write to the configured TezJet repository. Use only a feature branch, inspect the resulting draft PR, and never place tokens in command arguments or committed files. The CLI blocks direct `main`/`master` targets and refuses publishing unless the environment write gate is explicitly enabled. To see options, run `pnpm run pipeline -- --help`.

The pipeline's analysis stage is not proof that generated changes are correct. A successful Agent Factory CI run validates the factory code, not a TezJet change. A TezJet change is considered CI-passed only when the target commit's required TezJet workflow has completed successfully. Review all diffs and CI evidence before any human-authorized merge.

## Safety and release gates

- `main` is protected by application policy.
- Proposed files are scanned for common secret patterns before writes.
- Generated edits to `.github/workflows/**` and `.github/actions/**` are blocked unless `AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES=true` is explicitly set; inspect such diffs carefully because they can change CI execution.
- Changes are created on a dedicated feature branch and submitted as a Draft PR.
- Failed CI may trigger a bounded repair loop (maximum 3 attempts), with review and security gates before each repair.
- No agent may claim a write, test, deployment, legal verification, or merge without evidence from the relevant tool.
- Legal and other high-impact outputs are drafts only; qualified humans retain final responsibility.
