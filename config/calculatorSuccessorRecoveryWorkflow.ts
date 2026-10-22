/** One reviewed production successor; only its request path triggers models. */
export function renderCalculatorSuccessorRecoveryWorkflow(runtimeSha: string): string {
  if (!/^[a-f0-9]{40}$/.test(runtimeSha)) throw Error("Invalid successor runtime pin.");
  return `name: Calculator one truncated successor recovery
on:
  push:
    branches: ['feat/calculator-step7-regeneration-20261020']
    paths: ['.factory/calculator-successor-recovery-request.json']
permissions:
  contents: read
  actions: read
concurrency:
  group: calculator-one-cycle
  cancel-in-progress: false
jobs:
  successor:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout only reviewed successor request
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          ref: \${{ github.sha }}
          path: request
          sparse-checkout: .factory/calculator-successor-recovery-request.json
          sparse-checkout-cone-mode: false
          persist-credentials: false
      - name: Checkout immutable reviewed successor runtime
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          ref: ${runtimeSha}
          path: runtime
          persist-credentials: false
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Install locked host dependencies
        working-directory: runtime
        run: pnpm install --frozen-lockfile
      - name: Download fixed consumed truncated-task archive as data
        uses: actions/download-artifact@v4
        with:
          artifact-ids: '12411509353'
          run-id: 39747322491
          github-token: \${{ github.token }}
          path: \${{ runner.temp }}/calculator-successor-recovery/prior-evidence
          merge-multiple: true
      - name: Prepare fixed reviewed sandbox image
        run: docker --host=unix:///var/run/docker.sock pull 'node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392'
      - name: Verify history, saved plan, exact CI and prepare admission intent without models
        working-directory: runtime
        env:
          AGENT_FACTORY_TARGET_PROFILE: calculator
          AGENT_ALLOWED_REPOSITORIES: erman-ksv/Onay-Factory-Calculator
          FACTORY_HISTORY_TOKEN: \${{ github.token }}
          GITHUB_TOKEN: \${{ secrets.CALCULATOR_GITHUB_TOKEN }}
        run: pnpm exec tsx orchestration/calculatorSuccessorRecovery.ts prepare "$RUNNER_TEMP/calculator-successor-recovery" '${runtimeSha}'
      - name: Persist exact consumed-event admission before any successor model
        id: barrier
        uses: actions/upload-artifact@v4
        with:
          name: calculator-successor-recovery-admission-\${{ github.run_id }}
          path: \${{ runner.temp }}/calculator-successor-recovery/admission-artifact/
          if-no-files-found: error
          retention-days: 7
          overwrite: false
      - name: Regenerate only t02 under a separate one-use allowance
        working-directory: runtime
        env:
          CALCULATOR_SUCCESSOR_RECOVERY_BARRIER_ID: \${{ steps.barrier.outputs.artifact-id }}
          CALCULATOR_SUCCESSOR_RECOVERY_BARRIER_DIGEST: sha256:\${{ steps.barrier.outputs.artifact-digest }}
          AGENT_FACTORY_TARGET_PROFILE: calculator
          AGENT_ALLOWED_REPOSITORIES: erman-ksv/Onay-Factory-Calculator
          AGENT_FACTORY_PROVIDER: groq
          AGENT_FACTORY_LEGAL_ENABLED: 'false'
          AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES: 'false'
          ONAY_TEAM_FREE_TIER_CONFIRMED: 'true'
          CALCULATOR_MODEL_LIVE_APPROVED: ONE_FREE_BOUNDED_RUN
          CALCULATOR_EXECUTION_LIVE_APPROVED: RUN_ONE_FREE_CALCULATOR_TASK
          AGENT_FACTORY_ENABLE_GITHUB_WRITES: 'true'
          FACTORY_HISTORY_TOKEN: \${{ github.token }}
          GITHUB_TOKEN: \${{ secrets.CALCULATOR_GITHUB_TOKEN }}
          GROQ_API_KEY: \${{ secrets.GROQ_API_KEY }}
        run: pnpm exec tsx orchestration/calculatorSuccessorRecovery.ts execute "$RUNNER_TEMP/calculator-successor-recovery" '${runtimeSha}'
      - name: Collect private evidence even after a failed execution
        if: \${{ always() }}
        id: collect
        working-directory: runtime
        run: pnpm exec tsx orchestration/calculatorSuccessorRecovery.ts collect "$RUNNER_TEMP/calculator-successor-recovery" '${runtimeSha}'
      - name: Preserve immutable private successor evidence
        if: \${{ always() && steps.collect.outcome == 'success' }}
        uses: actions/upload-artifact@v4
        with:
          name: calculator-successor-recovery-evidence-\${{ github.run_id }}
          path: \${{ runner.temp }}/calculator-successor-recovery/successor-artifact/
          if-no-files-found: error
          retention-days: 7
          overwrite: false
`;
}

/** Read-only verification of the genuine archive before publishing a model request. */
export function renderCalculatorSuccessorRecoveryAuditWorkflow(runtimeSha: string): string {
  if (!/^[a-f0-9]{40}$/.test(runtimeSha)) throw Error("Invalid recovery audit runtime pin.");
  return `name: Calculator truncated successor recovery archive audit
on:
  push:
    branches: ['feat/calculator-step7-regeneration-20261020']
    paths: ['.factory/calculator-successor-recovery-audit-request.json']
permissions:
  contents: read
  actions: read
jobs:
  audit:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          ref: ${runtimeSha}
          persist-credentials: false
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: pnpm install --frozen-lockfile
      - uses: actions/download-artifact@v4
        with:
          artifact-ids: '12411509353'
          run-id: 39747322491
          github-token: \${{ github.token }}
          path: \${{ runner.temp }}/calculator-recovery-audit
          merge-multiple: true
      - name: Authenticate the fixed failed archive and unchanged completed dependency without models
        run: |
          pnpm exec tsx --eval 'import {join} from "node:path"; import {inspectCalculatorStoppedSuccessor} from "./orchestration/calculatorStoppedSuccessor.ts"; import {inspectCalculatorPublishedTaskState} from "./orchestration/calculatorPublishedTaskState.ts"; const root=join(process.env.RUNNER_TEMP!,"calculator-recovery-audit"); const stopped=inspectCalculatorStoppedSuccessor(root); const prior=inspectCalculatorPublishedTaskState(join(root,"evidence/prior-evidence")); console.log(JSON.stringify({status:"recovery-source-verified",stopped,priorTaskId:prior.taskId,modelsRun:false,githubWritesPerformed:false,resumeAuthorized:false}));'
`;
}
