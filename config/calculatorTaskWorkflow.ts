/** Host-only render of a reviewable workflow. This never writes a repository and
 * has no model input. Pin its resulting Git blob/id in CalculatorRuntimeConfig. */
export function renderCalculatorTaskWorkflow(factorySha: string, image: string): string {
  if (!/^[a-f0-9]{40}$/.test(factorySha) || !/^node@sha256:[a-f0-9]{64}$/.test(image)) throw Error('Calculator workflow pins are invalid.');
  return `name: Calculator task CI
on:
  push:
    branches: ['feat/calculator-pilot-bootstrap', 'feat/calculator-agent/**']
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: calculator-task-\${{ github.ref }}
  cancel-in-progress: false
jobs:
  registration:
    name: Workflow registration only
    if: github.ref == 'refs/heads/feat/calculator-pilot-bootstrap'
    runs-on: ubuntu-latest
    timeout-minutes: 1
    steps:
      - name: Register trusted workflow without app execution
        run: node -e 'console.log(JSON.stringify({workflowRegistrationOnly:true,modelsRun:false,testsExecuted:false,writesPerformed:false}))'
  task:
    name: Calculator task CI
    if: startsWith(github.ref, 'refs/heads/feat/calculator-agent/')
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - name: Checkout candidate
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          ref: \${{ github.sha }}
          path: app
          persist-credentials: false
      - name: Checkout trusted Factory
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          repository: erman-ksv/Onay-Agents-Factory
          ref: ${factorySha}
          path: factory
          token: \${{ secrets.FACTORY_READ_TOKEN }}
          persist-credentials: false
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Install trusted Factory dependencies
        working-directory: factory
        run: pnpm install --frozen-lockfile
      - name: Prepare pinned sandbox image
        run: docker pull '${image}'
      - name: Syntax
        shell: bash
        run: |
          set -euo pipefail
          for file in src/calculator.mjs src/app.mjs test/calculator.test.mjs test/ui.test.mjs; do
            if [ -f "app/$file" ]; then node --check "app/$file" >/dev/null 2>&1; fi
          done
      - name: Task tests
        working-directory: factory
        env:
          CANDIDATE_SHA: \${{ github.sha }}
        run: pnpm exec tsx orchestration/calculatorTaskCi.ts "$GITHUB_WORKSPACE/app" "$CANDIDATE_SHA" '${image}'
`;
}
