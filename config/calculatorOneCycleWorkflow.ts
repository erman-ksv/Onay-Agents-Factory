/** Trusted host renderer. Neither a model nor a request selects executable code. */
export function renderCalculatorOneCycleWorkflow(reviewedFactorySha: string, image: string): string {
  if (!/^[a-f0-9]{40}$/.test(reviewedFactorySha) || !/^node@sha256:[a-f0-9]{64}$/.test(image)) throw Error("Calculator launch pins are invalid.");
  return `name: Calculator one bounded cycle
on:
  push:
    branches: ['feat/onay-task-runner-20261019']
    paths: ['.factory/calculator-one-cycle-request.json']
permissions:
  contents: read
  actions: read
concurrency:
  group: calculator-one-cycle
  cancel-in-progress: false
jobs:
  cycle:
    name: One owner-approved plan or execution, with remote replay barrier
    runs-on: ubuntu-latest
    timeout-minutes: 12
    steps:
      - name: Checkout only the host request
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          ref: \${{ github.sha }}
          path: request
          sparse-checkout: .factory/calculator-one-cycle-request.json
          sparse-checkout-cone-mode: false
          persist-credentials: false
      - name: Checkout immutable trusted Factory
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          repository: erman-ksv/Onay-Agents-Factory
          ref: ${reviewedFactorySha}
          path: runtime
          persist-credentials: false
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Install locked trusted Factory dependencies
        working-directory: runtime
        run: pnpm install --frozen-lockfile
      - name: Validate request, complete trusted history and model readiness
        id: prepare
        working-directory: runtime
        env:
          GITHUB_TOKEN: \${{ github.token }}
          HAS_GROQ: \${{ secrets.GROQ_API_KEY != '' }}
          HAS_GEMINI: \${{ secrets.GEMINI_API_KEY != '' }}
          HAS_CLOUDFLARE: \${{ secrets.CLOUDFLARE_API_TOKEN != '' && (secrets.CLOUDFLARE_ACCOUNT_ID != '' || vars.CLOUDFLARE_ACCOUNT_ID != '') }}
          HAS_CALCULATOR_TOKEN: \${{ secrets.CALCULATOR_GITHUB_TOKEN != '' }}
        run: pnpm exec tsx orchestration/calculatorLaunchState.ts prepare "$RUNNER_TEMP/calculator-one-cycle" '${reviewedFactorySha}' '${image}'
      - name: Restore exact prior planning barrier
        if: \${{ steps.prepare.outputs.restore == 'true' }}
        uses: actions/download-artifact@v4
        with:
          artifact-ids: \${{ steps.prepare.outputs.prior_barrier }}
          run-id: \${{ steps.prepare.outputs.prior_run }}
          github-token: \${{ github.token }}
          path: \${{ runner.temp }}/calculator-one-cycle/restored-barrier
          merge-multiple: true
      - name: Restore exact prior state capsule
        if: \${{ steps.prepare.outputs.restore == 'true' }}
        uses: actions/download-artifact@v4
        with:
          artifact-ids: \${{ steps.prepare.outputs.prior_capsule }}
          run-id: \${{ steps.prepare.outputs.prior_run }}
          github-token: \${{ github.token }}
          path: \${{ runner.temp }}/calculator-one-cycle/restored-capsule
          merge-multiple: true
      - name: Validate private state and prepare immutable launch barrier
        working-directory: runtime
        run: pnpm exec tsx orchestration/calculatorLaunchState.ts restore "$RUNNER_TEMP/calculator-one-cycle" '${reviewedFactorySha}' '${image}'
      - name: Persist remote barrier before any model or publication
        id: barrier
        uses: actions/upload-artifact@v4
        with:
          name: \${{ steps.prepare.outputs.barrier_name }}
          path: \${{ runner.temp }}/calculator-one-cycle/barrier/launch.json
          if-no-files-found: error
          retention-days: 7
          overwrite: false
      - name: Prepare the exact trusted sandbox image
        run: docker --host=unix:///var/run/docker.sock pull '${image}'
      - name: Execute exactly the approved CLI mode
        id: execute
        working-directory: runtime
        env:
          CALCULATOR_MODE: \${{ steps.prepare.outputs.mode }}
          AGENT_FACTORY_TARGET_PROFILE: calculator
          AGENT_ALLOWED_REPOSITORIES: erman-ksv/Onay-Factory-Calculator
          AGENT_FACTORY_PROVIDER: \${{ steps.prepare.outputs.provider }}
          AGENT_FACTORY_LEGAL_ENABLED: 'false'
          AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES: 'false'
          ONAY_TEAM_FREE_TIER_CONFIRMED: 'true'
          CALCULATOR_MODEL_LIVE_APPROVED: ONE_FREE_BOUNDED_RUN
          CALCULATOR_EXECUTION_LIVE_APPROVED: \${{ steps.prepare.outputs.mode == 'run' && 'RUN_ONE_FREE_CALCULATOR_TASK' || '' }}
          AGENT_FACTORY_ENABLE_GITHUB_WRITES: \${{ steps.prepare.outputs.mode == 'run' && 'true' || 'false' }}
          GITHUB_TOKEN: \${{ secrets.CALCULATOR_GITHUB_TOKEN }}
          GROQ_API_KEY: \${{ steps.prepare.outputs.provider == 'groq' && secrets.GROQ_API_KEY || '' }}
          GEMINI_API_KEY: \${{ steps.prepare.outputs.provider == 'gemini' && secrets.GEMINI_API_KEY || '' }}
          CLOUDFLARE_API_TOKEN: \${{ steps.prepare.outputs.provider == 'cloudflare' && secrets.CLOUDFLARE_API_TOKEN || '' }}
          CLOUDFLARE_ACCOUNT_ID: \${{ steps.prepare.outputs.provider == 'cloudflare' && (secrets.CLOUDFLARE_ACCOUNT_ID || vars.CLOUDFLARE_ACCOUNT_ID) || '' }}
        shell: bash
        run: |
          set +e
          pnpm exec tsx orchestration/calculatorCli.ts --goal "$RUNNER_TEMP/calculator-one-cycle/goal.json" --config "$RUNNER_TEMP/calculator-one-cycle/config.json" --state-dir "$RUNNER_TEMP/calculator-one-cycle/state" --output-dir "$RUNNER_TEMP/calculator-one-cycle/runtime-report" --mode "$CALCULATOR_MODE"
          calculator_exit=$?
          printf 'exit_code=%s\\n' "$calculator_exit" >> "$GITHUB_OUTPUT"
          exit "$calculator_exit"
      - name: Collect only validated metadata, even after blocked or uncertain execution
        if: \${{ always() && steps.barrier.outcome == 'success' }}
        id: collect
        working-directory: runtime
        env:
          CALCULATOR_REMOTE_BARRIER_UPLOADED: 'true'
          CALCULATOR_CLI_EXIT_CODE: \${{ steps.execute.outputs.exit_code || '10' }}
        run: pnpm exec tsx orchestration/calculatorLaunchState.ts collect "$RUNNER_TEMP/calculator-one-cycle" '${reviewedFactorySha}' '${image}'
      - name: Preserve immutable validated state capsule
        if: \${{ always() && steps.collect.outcome == 'success' }}
        uses: actions/upload-artifact@v4
        with:
          name: \${{ steps.prepare.outputs.capsule_name }}
          path: \${{ runner.temp }}/calculator-one-cycle/capsule/
          if-no-files-found: error
          retention-days: 7
          overwrite: false
      - name: Collect private execution evidence independently of metadata collection
        if: \${{ always() && steps.barrier.outcome == 'success' && steps.prepare.outputs.mode == 'run' }}
        id: collect_private
        working-directory: runtime
        env:
          CALCULATOR_REMOTE_BARRIER_UPLOADED: 'true'
        run: pnpm exec tsx orchestration/calculatorExecutionArtifact.ts "$RUNNER_TEMP/calculator-one-cycle" '${reviewedFactorySha}' '${image}'
      - name: Preserve immutable private execution evidence
        if: \${{ always() && steps.collect_private.outcome == 'success' && steps.prepare.outputs.mode == 'run' }}
        uses: actions/upload-artifact@v4
        with:
          name: calculator-cycle-execution-\${{ github.run_id }}
          path: \${{ runner.temp }}/calculator-one-cycle/execution-artifact/
          if-no-files-found: error
          retention-days: 7
          overwrite: false
      - name: Preserve source-free report
        if: \${{ always() }}
        uses: actions/upload-artifact@v4
        with:
          name: calculator-cycle-report-\${{ github.run_id }}
          path: \${{ runner.temp }}/calculator-one-cycle/report/calculator-report.json
          if-no-files-found: warn
          retention-days: 7
          overwrite: false
`;
}
