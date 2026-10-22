/** One reviewed production successor; only its request path triggers models. */
export function renderCalculatorSuccessorWorkflow(runtimeSha: string): string {
  if (!/^[a-f0-9]{40}$/.test(runtimeSha)) throw Error("Invalid successor runtime pin.");
  return `name: Calculator one saved-plan successor after exact CI
on:
  push:
    branches: ['feat/calculator-step7-regeneration-20261020']
    paths: ['.factory/calculator-after-ci-successor-request.json']
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
          sparse-checkout: .factory/calculator-after-ci-successor-request.json
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
      - name: Download fixed genuine completed task archive as data
        uses: actions/download-artifact@v4
        with:
          artifact-ids: '12350008132'
          run-id: 39609923862
          github-token: \${{ github.token }}
          path: \${{ runner.temp }}/calculator-successor/prior-evidence
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
        run: pnpm exec tsx orchestration/calculatorSuccessor.ts prepare "$RUNNER_TEMP/calculator-successor" '${runtimeSha}'
      - name: Persist exact consumed-event admission before any successor model
        id: barrier
        uses: actions/upload-artifact@v4
        with:
          name: calculator-successor-admission-\${{ github.run_id }}
          path: \${{ runner.temp }}/calculator-successor/admission-artifact/
          if-no-files-found: error
          retention-days: 7
          overwrite: false
      - name: Execute one next task from the saved plan
        working-directory: runtime
        env:
          CALCULATOR_SUCCESSOR_BARRIER_ID: \${{ steps.barrier.outputs.artifact-id }}
          CALCULATOR_SUCCESSOR_BARRIER_DIGEST: sha256:\${{ steps.barrier.outputs.artifact-digest }}
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
        run: pnpm exec tsx orchestration/calculatorSuccessor.ts execute "$RUNNER_TEMP/calculator-successor" '${runtimeSha}'
      - name: Collect private evidence even after a failed execution
        if: \${{ always() }}
        id: collect
        working-directory: runtime
        run: pnpm exec tsx orchestration/calculatorSuccessor.ts collect "$RUNNER_TEMP/calculator-successor" '${runtimeSha}'
      - name: Preserve immutable private successor evidence
        if: \${{ always() && steps.collect.outcome == 'success' }}
        uses: actions/upload-artifact@v4
        with:
          name: calculator-successor-evidence-\${{ github.run_id }}
          path: \${{ runner.temp }}/calculator-successor/successor-artifact/
          if-no-files-found: error
          retention-days: 7
          overwrite: false
`;
}
