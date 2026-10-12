import assert from "node:assert/strict";
import test from "node:test";
import { TezJetRepositoryAdapter } from "./tezjetRepository.js";

type UpsertCall = [string, string, string, string];

function adapterWithFakeGitHub() {
  const calls: UpsertCall[] = [];
  const adapter = Object.create(TezJetRepositoryAdapter.prototype) as TezJetRepositoryAdapter;
  Object.assign(adapter, {
    github: {
      upsertFile: async (path: string, content: string, message: string, branch: string) => {
        calls.push([path, content, message, branch]);
        return { ok: true };
      },
    },
  });
  return { adapter, calls };
}

const branch = "agent-factory/test-change";

test("write refuses package.json changes before reaching GitHub", async () => {
  const { adapter, calls } = adapterWithFakeGitHub();
  await assert.rejects(
    adapter.write("package.json", '{"scripts":{"test":"exit 0"}}', "change test command", branch),
    /reviewer policy/,
  );
  assert.equal(calls.length, 0);
});

test("write refuses workflow changes without explicit opt-in", async () => {
  const previous = process.env.AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES;
  delete process.env.AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES;
  try {
    const { adapter, calls } = adapterWithFakeGitHub();
    await assert.rejects(
      adapter.write(".github/workflows/ci.yml", "name: ci", "edit ci", branch),
      /reviewer policy/,
    );
    assert.equal(calls.length, 0);
  } finally {
    if (previous === undefined) delete process.env.AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES;
    else process.env.AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES = previous;
  }
});

test("write refuses unsafe paths", async () => {
  const { adapter, calls } = adapterWithFakeGitHub();
  await assert.rejects(
    adapter.write("../outside.ts", "export const a = 1;", "escape repo", branch),
    /reviewer policy/,
  );
  assert.equal(calls.length, 0);
});

test("write passes ordinary source changes through", async () => {
  const { adapter, calls } = adapterWithFakeGitHub();
  await adapter.write("commander/summary.ts", "export const a = 1;", "update summary", branch);
  assert.equal(calls.length, 1);
});
