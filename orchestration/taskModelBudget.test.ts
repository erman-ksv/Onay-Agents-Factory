import assert from "node:assert/strict";
import test from "node:test";
import {
  createTaskModelBudgetFetch,
  HARD_TASK_MODEL_BUDGET,
} from "./taskModelBudget.js";

const endpoint = "https://model.invalid/v1/chat/completions";
const request = (extra: Record<string, unknown> = {}): RequestInit => ({
  method: "POST",
  headers: { authorization: "Bearer private-test-key", "content-type": "application/json" },
  body: JSON.stringify({ model: "offline", messages: [{ role: "user", content: "test" }], ...extra }),
});
const success = () => new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
const okFetch: typeof fetch = async () => success();

test("caps output while counting the complete UTF-8 request", async () => {
  let outbound: RequestInit | undefined;
  const budget = createTaskModelBudgetFetch({ maxOutputTokens: 64 }, async (_input, init) => {
    outbound = init;
    return success();
  });
  const response = await budget.fetch(endpoint, request({ tools: [{ schema: "ж".repeat(20) }], max_tokens: 999 }));
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(JSON.parse(String(outbound?.body)).max_tokens, 64);
  assert.equal(budget.snapshot().totalRequestBytes, Buffer.byteLength(String(outbound?.body)));
  assert.equal(budget.snapshot().attemptedRequests, 1);
  assert.equal(budget.failure, undefined);
  assert.equal(JSON.stringify(budget.snapshot()).includes("private-test-key"), false);
});

test("preserves max_completion_tokens and applies the tighter output cap", async () => {
  let sent: Record<string, unknown> | undefined;
  const budget = createTaskModelBudgetFetch({ maxOutputTokens: 64 }, async (_input, init) => {
    sent = JSON.parse(String(init?.body));
    return success();
  });
  await (await budget.fetch(endpoint, request({ max_tokens: 30, max_completion_tokens: 90 }))).text();
  assert.equal(sent?.max_completion_tokens, 30);
  assert.equal(sent?.max_tokens, undefined);
});

test("adds an output cap when the model client omitted it", async () => {
  let output: unknown;
  const budget = createTaskModelBudgetFetch({ maxOutputTokens: 77 }, async (_input, init) => {
    output = JSON.parse(String(init?.body)).max_tokens;
    return success();
  });
  await (await budget.fetch(endpoint, request())).text();
  assert.equal(output, 77);
});

test("shares one cumulative request ledger across independent callers", async () => {
  let calls = 0;
  const budget = createTaskModelBudgetFetch({ maxRequests: 2 }, async () => { calls++; return success(); });
  const commander = budget.fetch;
  const specialist = budget.fetch;
  await (await commander(endpoint, request())).text();
  await (await specialist(endpoint, request())).text();
  assert.equal((await commander(endpoint, request())).status, 400);
  assert.equal((await specialist(endpoint, request())).status, 400);
  assert.equal(calls, 2);
  assert.equal(budget.failure?.code, "request_limit");
  assert.equal(budget.snapshot().attemptedRequests, 2);
});

test("concurrent callers cannot overspend and a rejection aborts an in-flight call", async () => {
  let calls = 0;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  let aborted = false;
  const budget = createTaskModelBudgetFetch({ maxRequests: 1 }, async (_input, init) => {
    calls++;
    init?.signal?.addEventListener("abort", () => { aborted = true; }, { once: true });
    started();
    return new Promise<Response>(() => {});
  });
  const first = budget.fetch(endpoint, request());
  await startedPromise;
  const second = await budget.fetch(endpoint, request());
  assert.equal(second.status, 400);
  assert.equal((await first).status, 400);
  assert.equal(calls, 1);
  assert.equal(aborted, true);
  assert.equal(budget.failure?.code, "request_limit");
});

test("request byte limit includes instructions, tools and history and is terminal", async () => {
  let calls = 0;
  const budget = createTaskModelBudgetFetch({ maxRequestBytes: 300 }, async () => { calls++; return success(); });
  const response = await budget.fetch(endpoint, request({ tools: [{ description: "private-source".repeat(100) }] }));
  assert.equal(response.status, 400);
  assert.equal(budget.failure?.code, "request_bytes_limit");
  await budget.fetch(endpoint, request());
  assert.equal(calls, 0);
  assert.equal(budget.snapshot().attemptedRequests, 0);
  assert.equal((await response.text()).includes("private-source"), false);
});

test("run byte limit remains charged across successful requests", async () => {
  let calls = 0;
  const budget = createTaskModelBudgetFetch({ maxRunBytes: 160 }, async () => { calls++; return success(); });
  await (await budget.fetch(endpoint, request())).text();
  const charged = budget.snapshot().totalRequestBytes;
  assert.ok(charged > 80 && charged <= 160);
  assert.equal((await budget.fetch(endpoint, request())).status, 400);
  assert.equal(budget.failure?.code, "run_bytes_limit");
  assert.equal(budget.snapshot().totalRequestBytes, charged);
  assert.equal(calls, 1);
});

test("HTTP 429 discards upstream body and headers and permanently stops all callers", async () => {
  let calls = 0;
  let cancelled = false;
  const budget = createTaskModelBudgetFetch({}, async () => {
    calls++;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      status: 429, headers: { "retry-after": "private-header", "x-request-id": "private-request-id" },
    });
  });
  const response = await budget.fetch(endpoint, request());
  assert.equal(response.status, 429);
  const body = await response.text();
  assert.equal(cancelled, true);
  assert.equal(response.headers.get("retry-after"), null);
  assert.equal(response.headers.get("x-request-id"), null);
  assert.equal(response.headers.get("x-should-retry"), "false");
  assert.equal(body.includes("private-"), false);
  assert.equal(budget.failure?.code, "rate_limited");
  assert.equal((await budget.fetch(endpoint, request())).status, 429);
  assert.equal(calls, 1);
  assert.equal(budget.snapshot().attemptedRequests, 1);
});

test("transport exceptions cannot leak source, authorization, URLs or diagnostics", async () => {
  let calls = 0;
  const budget = createTaskModelBudgetFetch({}, async () => {
    calls++;
    throw new Error("Bearer private-test-key private-source https://private.invalid/?secret=1");
  });
  const response = await budget.fetch(endpoint, request());
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes("private"), false);
  assert.equal(JSON.stringify(budget.failure).includes("private"), false);
  await budget.fetch(endpoint, request());
  assert.equal(calls, 1);
  assert.equal(budget.failure?.code, "transport_error");
  assert.equal(budget.snapshot().attemptedRequests, 1);
});

test("non-429 unsuccessful HTTP responses are sanitized and stop the run", async () => {
  const budget = createTaskModelBudgetFetch({}, async () => new Response("private-error", {
    status: 401, headers: { "x-secret": "private-header" },
  }));
  const response = await budget.fetch(endpoint, request());
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes("private"), false);
  assert.equal(response.headers.get("x-secret"), null);
  assert.equal(budget.failure?.code, "transport_error");
});

test("deadline aborts transport even when a transport never resolves", async () => {
  let aborted = false;
  const budget = createTaskModelBudgetFetch({ wallTimeMs: 15 }, async (_input, init) => {
    init?.signal?.addEventListener("abort", () => { aborted = true; }, { once: true });
    return new Promise<Response>(() => {});
  });
  // Keep this offline test's event loop alive; production ledger timers are unref'ed.
  const keepAlive = setTimeout(() => {}, 200);
  try {
    const response = await budget.fetch(endpoint, request());
    assert.equal(response.status, 408);
    assert.equal(aborted, true);
    assert.equal(budget.failure?.code, "task_timeout");
    assert.equal((await budget.fetch(endpoint, request())).status, 408);
    assert.equal(budget.snapshot().attemptedRequests, 1);
  } finally { clearTimeout(keepAlive); }
});

test("deadline still aborts a response that stalls after successful HTTP headers", async () => {
  let aborted = false;
  let cancelled = false;
  const budget = createTaskModelBudgetFetch({ wallTimeMs: 15 }, async (_input, init) => {
    init?.signal?.addEventListener("abort", () => { aborted = true; }, { once: true });
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  });
  const keepAlive = setTimeout(() => {}, 200);
  try {
    const response = await budget.fetch(endpoint, request());
    await assert.rejects(response.text(), /deadline reached/);
    assert.equal(aborted, true);
    assert.equal(cancelled, true);
    assert.equal(budget.failure?.code, "task_timeout");
  } finally { clearTimeout(keepAlive); }
});

test("clock deadlines cannot be restored by rolling the injected clock back", async () => {
  let clock = 10;
  let calls = 0;
  const budget = createTaskModelBudgetFetch({ wallTimeMs: 100, now: () => clock }, async () => { calls++; return success(); });
  clock = 110;
  assert.equal((await budget.fetch(endpoint, request())).status, 408);
  clock = 10;
  assert.equal((await budget.fetch(endpoint, request())).status, 408);
  assert.equal(calls, 0);
  assert.equal(budget.snapshot().elapsedMs, 100);
});

test("caller cancellation stops all subsequent model traffic", async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort(new Error("private-abort-reason"));
  const budget = createTaskModelBudgetFetch({}, async () => { calls++; return success(); });
  const response = await budget.fetch(endpoint, { ...request(), signal: controller.signal });
  assert.equal(response.status, 400);
  assert.equal((await response.text()).includes("private"), false);
  assert.equal(budget.failure?.code, "request_aborted");
  await budget.fetch(endpoint, request());
  assert.equal(calls, 0);
});

test("Request inputs are bounded and preserve authorization only in transport", async () => {
  let outboundHeaders: Headers | undefined;
  const budget = createTaskModelBudgetFetch({}, async (_input, init) => {
    outboundHeaders = new Headers(init?.headers);
    return success();
  });
  await (await budget.fetch(new Request(endpoint, request()))).text();
  assert.equal(outboundHeaders?.get("authorization"), "Bearer private-test-key");
  assert.equal(JSON.stringify(budget.snapshot()).includes("private-test-key"), false);
});

test("an oversized Request stream is cancelled without contacting a model", async () => {
  let calls = 0;
  const budget = createTaskModelBudgetFetch({ maxRequestBytes: 100 }, async () => { calls++; return success(); });
  const response = await budget.fetch(new Request(endpoint, request({ secret: "source".repeat(100) })));
  assert.equal(response.status, 400);
  assert.equal(budget.failure?.code, "request_bytes_limit");
  assert.equal(calls, 0);
});

test("deadline cancels a stalled input Request stream before contacting a model", async () => {
  let calls = 0;
  let cancelled = false;
  const budget = createTaskModelBudgetFetch({ wallTimeMs: 15 }, async () => { calls++; return success(); });
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const input = new Request(endpoint, { method: "POST", body: stream, duplex: "half" } as RequestInit);
  const keepAlive = setTimeout(() => {}, 200);
  try {
    const response = await budget.fetch(input);
    assert.equal(response.status, 408);
    assert.equal(cancelled, true);
    assert.equal(calls, 0);
    assert.equal(budget.failure?.code, "task_timeout");
  } finally { clearTimeout(keepAlive); }
});

test("invalid header diagnostics are replaced with fixed metadata", async () => {
  let calls = 0;
  const budget = createTaskModelBudgetFetch({}, async () => { calls++; return success(); });
  const response = await budget.fetch(endpoint, { ...request(), headers: { "private\nheader": "private-test-key" } });
  assert.equal(response.status, 400);
  assert.equal((await response.text()).includes("private"), false);
  assert.equal(budget.failure?.code, "invalid_request");
  assert.equal(calls, 0);
});

test("invalid shapes and multiplied completions are rejected before transport", async () => {
  for (const body of ["not json private-source", "[]", "null", JSON.stringify({ n: 2 }),
    JSON.stringify({ max_tokens: null }), JSON.stringify({ max_completion_tokens: 0 })]) {
    let calls = 0;
    const budget = createTaskModelBudgetFetch({}, async () => { calls++; return success(); });
    const response = await budget.fetch(endpoint, { method: "POST", body });
    assert.equal(response.status, 400);
    assert.equal(budget.failure?.code, "invalid_request");
    assert.equal((await response.text()).includes("private-source"), false);
    assert.equal(calls, 0);
  }
});

test("host hard ceilings and invalid numeric limits cannot be overridden", () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => createTaskModelBudgetFetch({ maxRequests: value }, okFetch), /positive safe integers/);
  }
  for (const key of Object.keys(HARD_TASK_MODEL_BUDGET) as (keyof typeof HARD_TASK_MODEL_BUDGET)[]) {
    assert.throws(() => createTaskModelBudgetFetch({ [key]: HARD_TASK_MODEL_BUDGET[key] + 1 }, okFetch), /host ceilings/);
  }
});

test("returned failure metadata is a copy and cannot clear the terminal latch", async () => {
  const budget = createTaskModelBudgetFetch({}, okFetch);
  await budget.fetch(endpoint, { method: "POST", body: "invalid" });
  const metadata = budget.failure!;
  metadata.code = "rate_limited";
  metadata.message = "private-mutated";
  assert.equal(budget.failure?.code, "invalid_request");
  assert.equal(budget.failure?.message.includes("private-mutated"), false);
  assert.equal((await budget.fetch(endpoint, request())).status, 400);
});

import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {openProjectModelBudget,type ProjectModelGrant} from './projectModelBudget.js';
import {createProjectModelBudgetFileStore} from './projectModelBudgetFileStore.js';
const groqEndpoint='https://api.groq.com/openai/v1/chat/completions';
async function projectFixture(maxRequests=2){const dir=mkdtempSync(join(tmpdir(),'task-shared-project-')),store=createProjectModelBudgetFileStore(dir),grant:ProjectModelGrant={version:1,projectId:'offline-project',repository:'erman-ksv/Onay-Factory-Calculator',planFingerprint:'a'.repeat(64),grantId:'offline-explicit-owner-grant',maxRequests,maxRequestBytes:24000,maxTotalRequestBytes:96000,maxReservedTokens:16000,historical:{requests:0,requestBytes:0,reservedTokens:0},historicalEvidenceSha256:'d'.repeat(64),provider:'groq',freeTierConfirmed:true,legalEnabled:false},ledger=openProjectModelBudget(grant,store);await ledger.initialize();return {dir,store,grant,ledger,scope:(executionId:string)=>({ledger,taskId:'task-one',executionId,provider:'groq' as const}),cleanup:()=>rmSync(dir,{recursive:true,force:true})};}
test('project reservation persists before provider HTTP and stores no request content or credentials',async()=>{const f=await projectFixture();try{let sends=0;const client=createTaskModelBudgetFetch({maxOutputTokens:32,projectBudget:f.scope('run-one')},async()=>{sends++;assert.equal((await f.ledger.inspect()).used.requests,1);return success();});await(await client.fetch(groqEndpoint,request({messages:[{role:'user',content:'PRIVATE_SOURCE_SENT_ONLY_TO_FAKE_PROVIDER'}]}))).text();assert.equal(sends,1);const bytes=readFileSync(join(f.dir,'project-model-budget.json'),'utf8');assert.ok(!bytes.includes('PRIVATE_SOURCE_SENT_ONLY_TO_FAKE_PROVIDER'));assert.ok(!bytes.includes('private-test-key'));}finally{f.cleanup();}});
test('fresh task client cannot reset an exhausted shared project request allowance',async()=>{const f=await projectFixture(1);try{let sends=0;const transport:typeof fetch=async()=>{sends++;return success();};await(await createTaskModelBudgetFetch({projectBudget:f.scope('run-one')},transport).fetch(groqEndpoint,request())).text();const second=createTaskModelBudgetFetch({projectBudget:f.scope('run-two')},transport),response=await second.fetch(groqEndpoint,request());assert.equal((await response.json()).error.taskBudgetFailure.code,'project_budget_refused');assert.equal(sends,1);assert.equal((await f.ledger.inspect()).used.requests,1);}finally{f.cleanup();}});
test('provider 429 remains charged and a restored execution ID cannot replay it',async()=>{const f=await projectFixture();try{let sends=0;const failed=createTaskModelBudgetFetch({projectBudget:f.scope('same-execution')},async()=>{sends++;return new Response('PRIVATE_UPSTREAM_BODY',{status:429});});await(await failed.fetch(groqEndpoint,request())).text();assert.equal((await f.ledger.inspect()).used.requests,1);await(await createTaskModelBudgetFetch({projectBudget:f.scope('same-execution')},async()=>{sends++;return success();}).fetch(groqEndpoint,request())).text();assert.equal(sends,1);}finally{f.cleanup();}});
test('uncertain project persistence refuses provider transport while keeping its conservative charge',async()=>{const f=await projectFixture();try{let sends=0,writes=0;const ledger=openProjectModelBudget(f.grant,{read:f.store.read,compareAndSwap:async(...args)=>{writes++;await f.store.compareAndSwap(...args);throw Error('PRIVATE_STORAGE_DATA');}}),client=createTaskModelBudgetFetch({projectBudget:{...f.scope('uncertain-run'),ledger}},async()=>{sends++;return success();});const response=await client.fetch(groqEndpoint,request());assert.equal((await response.json()).error.taskBudgetFailure.code,'project_budget_refused');assert.equal(sends,0);assert.equal(writes,1);assert.equal((await f.ledger.inspect()).used.requests,1);}finally{f.cleanup();}});
test('project scope rejects cloned ledger and foreign provider without sending HTTP',async()=>{const f=await projectFixture();try{assert.throws(()=>createTaskModelBudgetFetch({projectBudget:{...f.scope('forged'),ledger:{...f.ledger}}}));let sends=0;const client=createTaskModelBudgetFetch({projectBudget:f.scope('wrong-endpoint')},async()=>{sends++;return success();});await(await client.fetch(endpoint,request())).text();assert.equal(sends,0);assert.equal((await f.ledger.inspect()).used.requests,0);}finally{f.cleanup();}});
test('local size refusal happens before any project reservation',async()=>{const f=await projectFixture();try{const client=createTaskModelBudgetFetch({maxRequestBytes:10,projectBudget:f.scope('too-large')},async()=>{assert.fail('No provider HTTP');});await(await client.fetch(groqEndpoint,request())).text();assert.equal((await f.ledger.inspect()).used.requests,0);}finally{f.cleanup();}});
test('cancellation during persistent project reservation never sends HTTP after storage completes',async()=>{const f=await projectFixture();try{let release!:()=>void,started!:()=>void,finished!:()=>void,sends=0;const gate=new Promise<void>(r=>{release=r;}),entered=new Promise<void>(r=>{started=r;}),done=new Promise<void>(r=>{finished=r;});const ledger=openProjectModelBudget(f.grant,{read:f.store.read,compareAndSwap:async(...args)=>{started();await gate;try{return await f.store.compareAndSwap(...args);}finally{finished();}}});const controller=new AbortController(),client=createTaskModelBudgetFetch({projectBudget:{...f.scope('cancelled-run'),ledger}},async()=>{sends++;return success();});const pending=client.fetch(groqEndpoint,{...request(),signal:controller.signal});await entered;controller.abort();const response=await pending;assert.equal((await response.json()).error.taskBudgetFailure.code,'request_aborted');release();await done;await new Promise<void>(r=>setImmediate(r));assert.equal(sends,0);assert.equal((await f.ledger.inspect()).used.requests,1);}finally{f.cleanup();}});
