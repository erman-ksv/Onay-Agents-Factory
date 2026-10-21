/** Trusted host-only renderer; request/model output never selects runtime code. */
export function renderCalculatorContinuationWorkflow(runtimeSha: string, image: string): string {
  if (!/^[a-f0-9]{40}$/.test(runtimeSha) || !/^node@sha256:[a-f0-9]{64}$/.test(image))
    throw new Error("Calculator continuation pins are invalid.");
  return `name: Calculator one reviewed step-7 continuation
on:
  push:
    branches: ['feat/calculator-step7-regeneration-20261020']
    paths: ['.factory/calculator-step7-continuation-request.json']
permissions:
  contents: read
  actions: read
concurrency:
  group: calculator-one-cycle
  cancel-in-progress: false
jobs:
  continuation:
    runs-on: ubuntu-latest
    timeout-minutes: 12
    steps:
      - name: Checkout only reviewed continuation request
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          ref: \${{ github.sha }}
          path: request
          sparse-checkout: .factory/calculator-step7-continuation-request.json
          sparse-checkout-cone-mode: false
          persist-credentials: false
      - name: Checkout immutable reviewed continuation runtime
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
      - name: Install locked trusted runtime
        working-directory: runtime
        run: pnpm install --frozen-lockfile
      - name: Download the fixed preserved proposal without executing it
        uses: actions/download-artifact@v4
        with:
          artifact-ids: '12318598151'
          run-id: 39538233432
          github-token: \${{ github.token }}
          path: \${{ runner.temp }}/calculator-step7-continuation/prior-evidence
          merge-multiple: true
      - name: Verify preserved proposal, historical charges and one-use continuation
        working-directory: runtime
        env:
          GITHUB_TOKEN: \${{ github.token }}
        run: pnpm exec tsx orchestration/calculatorStep7Continuation.ts prepare "$RUNNER_TEMP/calculator-step7-continuation" '${runtimeSha}'
      - name: Persist immutable continuation barrier before any model call
        id: barrier
        uses: actions/upload-artifact@v4
        with:
          name: calculator-step7-continuation-barrier-\${{ github.run_id }}
          path: \${{ runner.temp }}/calculator-step7-continuation/barrier/continuation.json
          if-no-files-found: error
          retention-days: 7
          overwrite: false
      - name: Prepare exact original sandbox image
        run: docker --host=unix:///var/run/docker.sock pull '${image}'
      - name: Continue the saved proposal with three specialist calls and no repair
        id: execute
        working-directory: runtime
        env:
          CALCULATOR_CONTINUATION_BARRIER_UPLOADED: 'true'
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
        run: pnpm exec tsx orchestration/calculatorStep7Continuation.ts execute "$RUNNER_TEMP/calculator-step7-continuation" '${runtimeSha}'
      - name: Collect bounded private evidence even after blocked execution
        if: \${{ always() && steps.barrier.outcome == 'success' }}
        id: collect
        working-directory: runtime
        env:
          CALCULATOR_CONTINUATION_BARRIER_UPLOADED: 'true'
        run: pnpm exec tsx orchestration/calculatorStep7Continuation.ts collect "$RUNNER_TEMP/calculator-step7-continuation" '${runtimeSha}'
      - name: Preserve immutable private continuation evidence
        if: \${{ always() && steps.collect.outcome == 'success' }}
        uses: actions/upload-artifact@v4
        with:
          name: calculator-step7-continuation-evidence-\${{ github.run_id }}
          path: \${{ runner.temp }}/calculator-step7-continuation/continuation-artifact/
          if-no-files-found: error
          retention-days: 7
          overwrite: false
      - name: Preserve source-free execution report
        if: \${{ always() }}
        uses: actions/upload-artifact@v4
        with:
          name: calculator-step7-continuation-report-\${{ github.run_id }}
          path: \${{ runner.temp }}/calculator-step7-continuation/calculator-report.json
          if-no-files-found: warn
          retention-days: 7
          overwrite: false
`;
}
