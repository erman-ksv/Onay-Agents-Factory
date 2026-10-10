import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

type DashboardEvent = {
  id: string;
  sequence: number;
  timestamp: string;
  kind: "agent_event" | "log" | "completed" | "failed";
  message: string;
  data?: unknown;
};
type RunRecord = {
  id: string;
  goal: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  events: DashboardEvent[];
  listeners: Set<(event: DashboardEvent) => void>;
};
export type DashboardRunSummary = Pick<RunRecord, "id" | "goal" | "status" | "startedAt" | "finishedAt"> & { eventCount: number };
export type DashboardRunner = (goal: string, emit: (kind: DashboardEvent["kind"], message: string, data?: unknown) => void) => Promise<void>;

const MAX_GOAL_LENGTH = 2_000;
const MAX_RUNS = 50;

const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Factory — рабочая панель</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#0b1020;color:#e8edf8}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at top,#172344,#0b1020 55%);min-height:100vh}.shell{max-width:1040px;margin:auto;padding:28px 18px 60px}.eyebrow{color:#7dd3fc;font-size:12px;letter-spacing:.18em;text-transform:uppercase}.head{display:flex;justify-content:space-between;gap:16px;align-items:center}.head h1{margin:8px 0;font-size:clamp(25px,5vw,38px)}.sub{color:#9ba9c5;line-height:1.55;max-width:680px}.status{border:1px solid #263452;border-radius:999px;padding:8px 12px;color:#a7f3d0;white-space:nowrap;font-size:12px}.panel{background:#111a2e;border:1px solid #263452;border-radius:18px;padding:18px;margin-top:20px;box-shadow:0 18px 55px #0002}label{display:block;color:#bdc9df;font-size:13px;margin-bottom:9px}textarea{width:100%;resize:vertical;min-height:100px;background:#0a1224;color:#eef4ff;border:1px solid #30415f;border-radius:12px;padding:14px;font:inherit;outline:none}textarea:focus{border-color:#60a5fa}button{background:#7dd3fc;color:#071323;border:0;border-radius:10px;padding:12px 18px;font-weight:750;font-size:14px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}.actions{display:flex;align-items:center;gap:14px;margin-top:12px}.hint{font-size:12px;color:#8292b0}.section-title{display:flex;justify-content:space-between;align-items:center;gap:10px}.section-title h2{font-size:17px;margin:0}.count{font-size:12px;color:#9ba9c5}.timeline{display:flex;flex-direction:column;gap:10px;margin-top:16px}.event{display:grid;grid-template-columns:92px 1fr;gap:12px;padding:12px;background:#0b1325;border:1px solid #202e49;border-radius:12px}.time{color:#8394b3;font-size:11px;padding-top:3px}.event h3{font-size:13px;margin:0 0 5px;color:#eaf1ff}.event p{font-size:13px;line-height:1.45;color:#aebbd2;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.tag{display:inline-block;font-size:10px;color:#7dd3fc;text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px}.empty{color:#8090ad;font-size:13px;padding:24px;text-align:center;border:1px dashed #30415f;border-radius:12px}.bottom{font-size:12px;color:#70809d;margin:16px 2px}.runlist{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.runchip{background:#101b30;color:#c3d3ef;border:1px solid #2a3a58;padding:8px 10px;border-radius:9px;font-size:12px;cursor:pointer}.runchip.active{border-color:#7dd3fc}.runchip span{color:#7dd3fc}@media(max-width:540px){.shell{padding:20px 12px}.head{align-items:flex-start;flex-direction:column}.event{grid-template-columns:1fr;gap:5px}.time{padding:0}.actions{align-items:flex-start;flex-direction:column}}
</style></head><body><main class="shell">
<div class="head"><div><div class="eyebrow">TezJet · Agent Factory</div><h1>Центр управления агентами</h1><div class="sub">Поставь задачу и наблюдай, как Commander передаёт работу агентам. Ошибки и непроверенные результаты остаются видимыми.</div></div><div class="status" id="connection">● локальная панель</div></div>
<section class="panel"><label for="goal">Что нужно сделать?</label><textarea id="goal" maxlength="2000" placeholder="Например: изучить обработку заказов и предложить безопасное исправление..."></textarea><div class="actions"><button id="start">Запустить задачу</button><span class="hint">Запуск локальный · изменения в GitHub автоматически не публикуются</span></div></section>
<section class="panel"><div class="section-title"><h2>Запуски</h2><span class="count" id="run-count">0 задач</span></div><div class="runlist" id="runs"></div></section>
<section class="panel"><div class="section-title"><h2 id="timeline-title">Ход выполнения</h2><span class="count" id="timeline-count">ожидание</span></div><div class="timeline" id="timeline"><div class="empty">Введи задачу выше — события появятся здесь в реальном времени.</div></div></section>
<div class="bottom">События хранятся в памяти запущенного сервера и исчезнут после его перезапуска. Успешный запуск не означает, что тесты действительно выполнились или код готов к публикации.</div>
</main><script>
const $=id=>document.getElementById(id);let currentRun=null,source=null;const knownRuns=new Map();
function addEvent(e){const box=$('timeline');if(box.querySelector('.empty'))box.innerHTML='';const row=document.createElement('article');row.className='event';const time=document.createElement('div');time.className='time';time.textContent=new Date(e.timestamp).toLocaleTimeString();const body=document.createElement('div');const tag=document.createElement('div');tag.className='tag';tag.textContent=e.kind==='agent_event'?(e.data?.event?.actor||'agent'):e.kind;const title=document.createElement('h3');title.textContent=e.message;const p=document.createElement('p');if(e.data?.event?.details)p.textContent=JSON.stringify(e.data.event.details,null,2);body.append(tag,title,p);row.append(time,body);box.append(row);$('timeline-count').textContent=box.children.length+' событий';box.scrollIntoView({block:'nearest',behavior:'smooth'});}
function drawRuns(){const root=$('runs');root.innerHTML='';for(const r of knownRuns.values()){const b=document.createElement('button');b.className='runchip'+(r.id===currentRun?' active':'');b.textContent=r.goal.slice(0,42)+(r.goal.length>42?'…':'')+' · '+r.status;b.onclick=()=>selectRun(r.id);root.append(b)}$('run-count').textContent=knownRuns.size+' задач'}
function selectRun(id){currentRun=id;const r=knownRuns.get(id);if(!r)return;if(source)source.close();$('timeline').innerHTML='';$('timeline-title').textContent=r.goal;for(const e of r.events||[])addEvent(e);source=new EventSource('/api/runs/'+id+'/events');source.onmessage=msg=>{const e=JSON.parse(msg.data);if(!r.events.some(x=>x.id===e.id)){r.events.push(e);addEvent(e)}if(e.kind==='completed'||e.kind==='failed'){r.status=e.kind;drawRuns()}};source.onerror=()=>{$('connection').textContent='● переподключение';};source.onopen=()=>{$('connection').textContent='● соединение активно';}}
async function refreshRuns(){try{const data=await fetch('/api/runs').then(r=>r.json());for(const r of data.runs){if(!knownRuns.has(r.id))knownRuns.set(r.id,{...r,events:[]});else Object.assign(knownRuns.get(r.id),r)}drawRuns()}catch{$('connection').textContent='● сервер недоступен'}}
$('start').onclick=async()=>{const goal=$('goal').value.trim();if(!goal){$('goal').focus();return}$('start').disabled=true;try{const res=await fetch('/api/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({goal})});const data=await res.json();if(!res.ok)throw new Error(data.error||'Не удалось запустить задачу');knownRuns.set(data.run.id,{...data.run,events:[]});$('goal').value='';drawRuns();selectRun(data.run.id)}catch(e){alert(e.message)}finally{$('start').disabled=false}};
refreshRuns();setInterval(refreshRuns,5000);
</script></body></html>`;

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}
function summary(run: RunRecord): DashboardRunSummary {
  return { id: run.id, goal: run.goal, status: run.status, startedAt: run.startedAt, ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}), eventCount: run.events.length };
}
async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 16_384) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const commanderRunner: DashboardRunner = async (goal, emit) => {
  const child = spawn("pnpm", ["dev", "--", goal], { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  const stdout = createInterface({ input: child.stdout });
  const stderr = createInterface({ input: child.stderr });
  stdout.on("line", line => {
    try {
      const parsed = JSON.parse(line) as { type?: string; event?: unknown };
      if (parsed.type === "agent_event") emit("agent_event", (parsed.event as { message?: string })?.message ?? "Agent event", parsed);
      else emit("log", line);
    } catch {
      if (line.trim()) emit("log", line);
    }
  });
  stderr.on("line", line => { if (line.trim()) emit("log", line); });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(`Commander exited with code ${code ?? "unknown"}`)));
  });
};

export function createDashboardServer(options: { runner?: DashboardRunner; host?: string; port?: number } = {}): Server {
  const runs = new Map<string, RunRecord>();
  const runner = options.runner ?? commanderRunner;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(DASHBOARD_HTML);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/runs") {
      json(response, 200, { runs: [...runs.values()].reverse().map(summary) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/runs") {
      let body: unknown;
      try { body = await readBody(request); } catch (error) {
        json(response, 400, { error: error instanceof Error ? error.message : "Invalid request." });
        return;
      }
      const goal = typeof body === "object" && body !== null && "goal" in body ? (body as { goal?: unknown }).goal : undefined;
      if (typeof goal !== "string" || !goal.trim() || goal.length > MAX_GOAL_LENGTH) {
        json(response, 400, { error: `Task goal must be 1-${MAX_GOAL_LENGTH} characters.` });
        return;
      }
      if (runs.size >= MAX_RUNS) {
        const oldestFinished = [...runs.values()].find(run => run.status !== "running");
        if (!oldestFinished) { json(response, 429, { error: "Too many active task runs." }); return; }
        runs.delete(oldestFinished.id);
      }
      const run: RunRecord = { id: randomUUID(), goal: goal.trim(), status: "running", startedAt: new Date().toISOString(), events: [], listeners: new Set() };
      runs.set(run.id, run);
      const emit = (kind: DashboardEvent["kind"], message: string, data?: unknown) => {
        const event: DashboardEvent = { id: randomUUID(), sequence: run.events.length + 1, timestamp: new Date().toISOString(), kind, message, ...(data === undefined ? {} : { data }) };
        run.events.push(event);
        for (const listener of run.listeners) listener(event);
      };
      json(response, 202, { run: summary(run) });
      void runner(run.goal, emit).then(() => {
        run.status = "completed";
        run.finishedAt = new Date().toISOString();
        emit("completed", "Commander завершил запуск. Проверяй отчёт и доказательства тестов.");
      }).catch(error => {
        run.status = "failed";
        run.finishedAt = new Date().toISOString();
        emit("failed", error instanceof Error ? error.message : String(error));
      });
      return;
    }
    const match = request.method === "GET" ? url.pathname.match(/^\/api\/runs\/([a-f0-9-]+)\/events$/i) : null;
    if (match) {
      const run = runs.get(match[1]);
      if (!run) { json(response, 404, { error: "Run not found." }); return; }
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
      response.flushHeaders();
      const send = (event: DashboardEvent) => response.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
      for (const event of run.events) send(event);
      const listener = (event: DashboardEvent) => send(event);
      run.listeners.add(listener);
      request.on("close", () => run.listeners.delete(listener));
      return;
    }
    json(response, 404, { error: "Not found." });
  });

  server.listen(options.port ?? 4173, options.host ?? "127.0.0.1");
  return server;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("/orchestration/dashboardServer.ts")) {
  const port = Number(process.env.AGENT_FACTORY_DASHBOARD_PORT ?? 4173);
  createDashboardServer({ port, host: "127.0.0.1" });
  console.log(`Agent Factory dashboard available at http://127.0.0.1:${port}`);
}
