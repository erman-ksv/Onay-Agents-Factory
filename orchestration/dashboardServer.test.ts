import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createDashboardServer } from "./dashboardServer.js";

async function startServer(runner?: Parameters<typeof createDashboardServer>[0]["runner"]) {
  const server = createDashboardServer({ host: "127.0.0.1", port: 0, runner });
  if (!server.listening) await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: ReturnType<typeof createDashboardServer>) {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test("dashboard serves UI and rejects empty task goals", async () => {
  const { server, baseUrl } = await startServer(async () => {});
  try {
    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Центр управления агентами/);

    const invalid = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "  " }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await closeServer(server);
  }
});

test("dashboard accepts a task and exposes live events over SSE", async () => {
  const { server, baseUrl } = await startServer(async (goal, emit) => {
    emit("agent_event", "Explorer started", { actor: "explorer" });
    emit("log", `goal received: ${goal}`);
  });
  try {
    const started = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "Inspect the order workflow" }),
    });
    assert.equal(started.status, 202);
    const payload = await started.json() as { run: { id: string; status: string } };
    assert.equal(payload.run.status, "running");

    const listing = await fetch(`${baseUrl}/api/runs`).then(response => response.json()) as { runs: Array<{ id: string; goal: string }> };
    assert.equal(listing.runs[0].id, payload.run.id);
    assert.equal(listing.runs[0].goal, "Inspect the order workflow");

    const stream = await fetch(`${baseUrl}/api/runs/${payload.run.id}/events`);
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get("content-type") ?? "", /text\/event-stream/);
    const reader = stream.body!.getReader();
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    assert.match(text, /Explorer started/);
    assert.match(text, /goal received: Inspect the order workflow/);
    await reader.cancel();
  } finally {
    await closeServer(server);
  }
});

test("dashboard validates task length and unknown run IDs", async () => {
  const { server, baseUrl } = await startServer(async () => {});
  try {
    const tooLong = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "x".repeat(2_001) }),
    });
    assert.equal(tooLong.status, 400);

    const missing = await fetch(`${baseUrl}/api/runs/not-a-run/events`);
    assert.equal(missing.status, 404);
  } finally {
    await closeServer(server);
  }
});
