import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
import { CALCULATOR_ACCEPTANCE, calculatorPlanTaskId, createCalculatorPlan } from "../orchestration/calculatorPlan.js";
import { loadCalculatorSnapshot, type CalculatorSnapshotReader, type CalculatorTreeEntry } from "./calculatorSnapshot.js";
import { prepareCalculatorRoleChanges } from "../commander/calculatorTeam.js";
import { createCalculatorPublisher, calculatorPublicationDiagnostic, runCalculatorGit, CALCULATOR_PUBLISHER_ERROR, type CalculatorGitRequest } from "./calculatorPublisher.js";

const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40), D = "d".repeat(40);
const owner = { version: 1, id: "publisher-pilot", goal: "Create the agreed static calculator website with arithmetic and browser tests.",
  baseRef: "feat/calculator-pilot-bootstrap", baseSha: A, provider: "gemini" };
const ids = (n: number) => calculatorPlanTaskId(owner, n);
const plan = createCalculatorPlan(owner, { tasks: [
  { id: ids(1), role: "coder", goal: "Implement arithmetic and module tests.", acceptanceIds: CALCULATOR_ACCEPTANCE.slice(0, 7).map(item => item.id), paths: ["src/calculator.mjs", "test/calculator.test.mjs"], dependsOn: [] },
  { id: ids(2), role: "frontend", goal: "Implement responsive browser controls.", acceptanceIds: CALCULATOR_ACCEPTANCE.slice(7).map(item => item.id), paths: ["index.html", "styles.css", "src/app.mjs"], dependsOn: [ids(1)] },
  { id: ids(3), role: "frontend", goal: "Test keyboard and button interactions.", acceptanceIds: ["keyboard"], paths: ["test/ui.test.mjs"], dependsOn: [ids(2)] },
], blockers: [], unverifiedAreas: [] });
const authorized = { GITHUB_TOKEN: "fixture-private-token", CALCULATOR_EXECUTION_LIVE_APPROVED: "RUN_ONE_FREE_CALCULATOR_TASK",
  AGENT_FACTORY_ENABLE_GITHUB_WRITES: "true", AGENT_FACTORY_TARGET_PROFILE: "calculator", AGENT_FACTORY_LEGAL_ENABLED: "false",
  ONAY_TEAM_FREE_TIER_CONFIRMED: "true", AGENT_ALLOWED_REPOSITORIES: CALCULATOR_PROFILE.repository,
  UNRELATED_PRIVATE_SECRET: "never-pass-to-child", GIT_TRACE: "1", GIT_CONFIG_PARAMETERS: "untrusted-config",
  HTTP_PROXY: "http://fixture-proxy:8080", SSL_CERT_FILE: "/fixture/session-ca.crt" };
const refuse = (error: unknown) => error instanceof Error && error.message === CALCULATOR_PUBLISHER_ERROR;
const commands = ["init", "ls-remote", "fetch", "rev-parse", "read-tree", "hash-object", "update-index", "write-tree", "commit-tree", "rev-list", "diff-tree", "push"];
const command = (request: CalculatorGitRequest) => commands.find(name => request.args.includes(name))!;
async function fixture() {
  let head: string | undefined = A, baseHead = A;
  const requests: CalculatorGitRequest[] = [], scripts = new Map<string, string>(), http: Array<{ url: string; method: string; body?: unknown }> = [];
  const tree: CalculatorTreeEntry[] = [];
  const reader: CalculatorSnapshotReader = {
    getHead: async ref => { if (ref === owner.baseRef) return baseHead; if (ref === plan.branch && head) return head; throw new Error("No head; no absence inference permitted"); },
    readCommit: async hash => ({ sha: hash, treeSha: hash, parents: hash === A ? [] : [A] }),
    readTree: async hash => ({ sha: hash, truncated: false, tree }),
    readBlob: async () => { throw new Error("No source in this initial fixture"); },
  };
  const snapshot = await loadCalculatorSnapshot({ repository: plan.owner.repository, baseRef: plan.branch, baseSha: A, changePaths: plan.tasks[0].paths }, reader);
  const changes = prepareCalculatorRoleChanges("coder", { summary: "Add arithmetic module and tests", changes: [
    { operation: "create", path: "src/calculator.mjs", content: "export const add = (a,b) => a+b;", message: "Add arithmetic" },
    { operation: "create", path: "test/calculator.test.mjs", content: "import test from 'node:test'; test('fixture',()=>{});", message: "Add tests" },
  ] }, snapshot);
  const pr = () => ({ number: 7, html_url: "https://github.com/" + plan.owner.repository + "/pull/7", state: "open", draft: true,
    head: { ref: plan.branch, sha: C, repo: { full_name: plan.owner.repository } },
    base: { ref: owner.baseRef, sha: A, repo: { full_name: plan.owner.repository } } });
  const git = async (request: CalculatorGitRequest) => {
    requests.push(request); if (request.env.GIT_ASKPASS) scripts.set(request.env.GIT_ASKPASS, readFileSync(request.env.GIT_ASKPASS, "utf8"));
    const op = command(request);
    if (op === "ls-remote") return { status: 0, stdout: head ? head + "\trefs/heads/" + plan.branch + "\n" : "" };
    if (op === "rev-parse") return { status: 0, stdout: A + "\n" };
    if (op === "hash-object") { const source = request.input ?? ""; return { status: 0, stdout: createHash("sha1").update("blob " + Buffer.byteLength(source) + "\0" + source).digest("hex") + "\n" }; }
    if (op === "write-tree") return { status: 0, stdout: B + "\n" };
    if (op === "commit-tree") return { status: 0, stdout: C + "\n" };
    if (op === "rev-list") return { status: 0, stdout: C + " " + A + "\n" };
    if (op === "diff-tree") return { status: 0, stdout: changes.files.map(file => file.path).join("\n") + "\n" };
    if (op === "push") {
      const creating = request.args.some(arg => arg === "--force-with-lease=refs/heads/" + plan.branch + ":");
      head = creating ? A : C;
      return { status: 0, stdout: "To fixed-remote\n" + (creating ? "*" : " ") + "\t" + head + ":refs/heads/" + plan.branch + "\tverified\nDone\n" };
    }
    return { status: 0, stdout: "" };
  };
  const transport: typeof fetch = async (url, init) => {
    http.push({ url: String(url), method: init?.method ?? "GET", ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    assert.equal(init?.redirect, "error");
    if (String(url).includes("/pulls?")) return Response.json([]);
    return Response.json(pr());
  };
  return { reader, changes, pr, git, transport, requests, scripts, http, tree, move: (value?: string) => { head = value; },
    moveBase: (value: string) => { baseHead = value; }, input: { task: plan.tasks[0], changes, expectedSha: A, branch: plan.branch },
    options: { plan, reader, env: authorized, runGit: git, transport } };
}

test("publisher rechecks write authorization, legal disablement and target before any subprocess", async t => {
  for (const key of ["GITHUB_TOKEN", "CALCULATOR_EXECUTION_LIVE_APPROVED", "AGENT_FACTORY_ENABLE_GITHUB_WRITES", "AGENT_FACTORY_TARGET_PROFILE", "AGENT_FACTORY_LEGAL_ENABLED", "ONAY_TEAM_FREE_TIER_CONFIRMED", "AGENT_ALLOWED_REPOSITORIES"]) await t.test(key, async () => {
    const f = await fixture(); assert.throws(() => createCalculatorPublisher({ ...f.options, env: { ...authorized, [key]: "" } }), refuse);
    assert.equal(f.requests.length, 0); assert.equal(f.http.length, 0);
  });
  const f = await fixture();
  assert.throws(() => createCalculatorPublisher({ ...f.options, env: { ...authorized, AGENT_FACTORY_ALLOW_WORKFLOW_CHANGES: "true" } }), refuse);
});
test("exact-parent Git plumbing and atomic lease publish one verified Draft PR without exposing credentials", async () => {
  const f = await fixture(), publisher = createCalculatorPublisher(f.options);
  const result = await publisher.publish(f.input);
  assert.equal(result.headSha, C); assert.equal(result.branch, plan.branch); assert.equal(result.number, 7);
  const push = f.requests.find(request => command(request) === "push")!;
  assert.ok(push.args.includes("--force-with-lease=refs/heads/" + plan.branch + ":" + A));
  assert.equal(push.args.at(-1), C + ":refs/heads/" + plan.branch);
  assert.ok(!JSON.stringify(f.requests.map(request => request.args)).includes(authorized.GITHUB_TOKEN));
  assert.ok(f.requests.some(request => command(request) === "read-tree"));
  assert.ok(f.requests.some(request => command(request) === "rev-list"));
  assert.ok(!f.requests.some(request => request.args.includes("checkout") || request.args.includes("add") || request.args.includes("commit")));
  for (const request of f.requests) {
    assert.equal(request.env.UNRELATED_PRIVATE_SECRET, undefined); assert.equal(request.env.GIT_TRACE, undefined); assert.equal(request.env.GIT_CONFIG_PARAMETERS, undefined);
    assert.equal(request.env.GIT_CONFIG_GLOBAL, "/dev/null"); assert.equal(request.env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(request.env.HTTP_PROXY, authorized.HTTP_PROXY); assert.equal(request.env.SSL_CERT_FILE, authorized.SSL_CERT_FILE);
    if (["ls-remote", "fetch", "push"].includes(command(request))) {
      assert.equal(request.env.CALCULATOR_GIT_AUTH_TOKEN, authorized.GITHUB_TOKEN);
      const script = f.scripts.get(request.env.GIT_ASKPASS!)!;
      assert.ok(!script.includes(authorized.GITHUB_TOKEN)); assert.ok(script.includes("github.com"));
    } else assert.equal(request.env.CALCULATOR_GIT_AUTH_TOKEN, undefined);
  }
  assert.ok(f.http.every(request => request.url.startsWith("https://api.github.com/repos/" + plan.owner.repository + "/pulls")));
  const post = f.http.find(request => request.method === "POST")!;
  assert.equal((post.body as { draft: boolean }).draft, true); assert.equal((post.body as { base: string }).base, owner.baseRef);
  assert.ok(!JSON.stringify(result).includes("export const"));
  const count = f.requests.length; await assert.rejects(() => publisher.publish(f.input), refuse); assert.equal(f.requests.length, count);
  assert.ok(f.requests.every(request => !existsSync(request.cwd)), "temporary repositories are removed after publication");
});
test("bootstrap proves absence through ls-remote and uses an empty lease, not a file 404", async () => {
  const f = await fixture(); f.move();
  const result = await createCalculatorPublisher(f.options).bootstrapProjectBranch();
  assert.equal(result.created, true); assert.equal(result.headSha, A);
  const push = f.requests.find(request => command(request) === "push")!;
  assert.ok(push.args.includes("--force-with-lease=refs/heads/" + plan.branch + ":"));
  assert.equal(push.args.at(-1), A + ":refs/heads/" + plan.branch); assert.equal(f.http.length, 0);
});
test("an existing exact bootstrap branch is read-only and a different branch head is refused", async () => {
  const f = await fixture();
  assert.equal((await createCalculatorPublisher(f.options).bootstrapProjectBranch()).created, false);
  assert.ok(!f.requests.some(request => command(request) === "push"));
  const other = await fixture(); other.move(C);
  await assert.rejects(() => createCalculatorPublisher(other.options).bootstrapProjectBranch(), refuse);
  assert.ok(!other.requests.some(request => command(request) === "push"));
});
test("stale base, foreign branch, forged contents and unauthorized paths stop before writing", async t => {
  for (const name of ["base", "head", "branch", "sha", "content", "path", "role", "truncated-tree", "large-blob", "symlink"]) await t.test(name, async () => {
    const f = await fixture(); let input = f.input;
    if (name === "base") f.moveBase(D);
    if (name === "head") f.move(D);
    if (name === "branch") input = { ...input, branch: "main" };
    if (name === "sha") input = { ...input, expectedSha: "short" };
    if (name === "content") input = { ...input, changes: { ...input.changes, files: input.changes.files.map(file => ({ ...file, content: file.content + " forged" })) } };
    if (name === "path") input = { ...input, changes: { ...input.changes, files: [{ path: ".github/workflows/evil.yml", content: "unsafe", message: "unsafe" }] } };
    if (name === "role") input = { ...input, task: plan.tasks[1] };
    if (name === "truncated-tree") f.reader.readTree = async hash => ({ sha: hash, truncated: true, tree: [] });
    if (name === "large-blob") f.tree.push({ path: "README.md", sha: D, type: "blob", mode: "100644", size: 131_073 });
    if (name === "symlink") f.tree.push({ path: "link", sha: D, type: "blob", mode: "120000", size: 12 });
    await assert.rejects(() => createCalculatorPublisher(f.options).publish(input), refuse);
    assert.ok(!f.requests.some(request => command(request) === "push")); assert.equal(f.http.length, 0);
  });
});
test("Git errors, malformed refs, wrong parent, changed scope and no-op push never satisfy the lease", async t => {
  for (const name of ["fetch-failed", "malformed-refs", "wrong-fetch", "wrong-parent", "extra-path", "lease-rejected", "up-to-date", "extra-ref", "head-moved"]) await t.test(name, async () => {
    const f = await fixture();
    const git = async (request: CalculatorGitRequest) => {
      const op = command(request);
      if (name === "fetch-failed" && op === "fetch") return { status: 1, stdout: "private source and fixture-private-token" };
      if (name === "malformed-refs" && op === "ls-remote") return { status: 0, stdout: A + "\trefs/heads/main\n" };
      if (name === "wrong-fetch" && op === "rev-parse") return { status: 0, stdout: D + "\n" };
      if (name === "wrong-parent" && op === "rev-list") return { status: 0, stdout: C + " " + D + "\n" };
      if (name === "extra-path" && op === "diff-tree") return { status: 0, stdout: ".github/workflows/evil.yml\n" };
      if (name === "lease-rejected" && op === "push") return { status: 1, stdout: "rejected private upstream body" };
      const result = await f.git(request);
      if (name === "up-to-date" && op === "push") return { status: 0, stdout: "=\t" + C + ":refs/heads/" + plan.branch + "\t[up to date]\n" };
      if (name === "extra-ref" && op === "push") return { ...result, stdout: result.stdout + "*\t" + C + ":refs/heads/main\t[new branch]\n" };
      if (name === "head-moved" && op === "push") f.move(D);
      return result;
    };
    await assert.rejects(() => createCalculatorPublisher({ ...f.options, runGit: git }).publish(f.input), refuse);
    assert.equal(f.http.length, 0);
  });
});
test("existing PR is read back and must match exact repository, refs, SHA and Draft state", async t => {
  for (const name of ["valid", "stale-list-fresh-detail", "foreign-repo", "base", "head", "closed", "not-draft", "sha", "url", "many"]) await t.test(name, async () => {
    const f = await fixture(), candidate = f.pr();
    if (name === "foreign-repo") candidate.head.repo.full_name = "erman-ksv/Onay";
    if (name === "base") candidate.base.ref = "main";
    if (name === "head") candidate.head.ref = "main";
    if (name === "closed") candidate.state = "closed";
    if (name === "not-draft") candidate.draft = false;
    if (name === "sha" || name === "stale-list-fresh-detail") candidate.head.sha = A;
    if (name === "url") candidate.html_url = "https://github.com/erman-ksv/Onay/pull/7";
    let posts = 0, detail = 0;
    const transport: typeof fetch = async (url, init) => {
      if (init?.method === "POST") posts++;
      if (String(url).endsWith("/pulls/7")) detail++;
      return Response.json(String(url).includes("/pulls?") ? name === "many" ? [candidate, candidate] : [candidate] : name === "stale-list-fresh-detail" ? f.pr() : candidate);
    };
    if (name === "valid" || name === "stale-list-fresh-detail") { assert.equal((await createCalculatorPublisher({ ...f.options, transport }).publish(f.input)).number, 7); assert.equal(detail, 1); }
    else await assert.rejects(() => createCalculatorPublisher({ ...f.options, transport }).publish(f.input), refuse);
    assert.equal(posts, 0);
  });
});
test("uncertain PR response is never retried and upstream diagnostics are fixed", async () => {
  const f = await fixture(); let calls = 0;
  const publisher = createCalculatorPublisher({ ...f.options, transport: async () => { calls++; throw new Error("raw private upstream source"); } });
  await assert.rejects(() => publisher.publish(f.input), refuse);
  await assert.rejects(() => publisher.publish(f.input), refuse);
  assert.equal(calls, 1); assert.equal(f.requests.filter(request => command(request) === "push").length, 1);
});
test("real offline Git plumbing publishes locally and rejects a racing writer atomically", async () => {
  const directory = mkdtempSync(join(tmpdir(), "calculator-local-git-")), remote = join(directory, "remote.git");
  const cleanEnv: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Offline Fixture", GIT_AUTHOR_EMAIL: "offline@example.invalid", GIT_COMMITTER_NAME: "Offline Fixture", GIT_COMMITTER_EMAIL: "offline@example.invalid" };
  const local = async (args: string[], input?: string) => {
    const result = await runCalculatorGit({ args, cwd: directory, env: cleanEnv, ...(input === undefined ? {} : { input }) });
    assert.equal(result.status, 0); return result.stdout;
  };
  try {
    await local(["init", "--bare", remote]);
    const blob = (await local(["--git-dir=" + remote, "hash-object", "-w", "--stdin"], "# Offline fixture\n")).trim();
    await local(["--git-dir=" + remote, "read-tree", "--empty"]);
    await local(["--git-dir=" + remote, "update-index", "--add", "--cacheinfo", "100644," + blob + ",README.md"]);
    const tree = (await local(["--git-dir=" + remote, "write-tree"])).trim();
    const base = (await local(["--git-dir=" + remote, "commit-tree", tree], "Offline base\n")).trim();
    const request = { ...owner, id: "real-offline-publisher", baseSha: base }, id = (n: number) => calculatorPlanTaskId(request, n);
    const realPlan = createCalculatorPlan(request, { tasks: [
      { id: id(1), role: "coder", goal: "Implement arithmetic and module tests.", acceptanceIds: CALCULATOR_ACCEPTANCE.slice(0, 7).map(item => item.id), paths: ["src/calculator.mjs", "test/calculator.test.mjs"], dependsOn: [] },
      { id: id(2), role: "frontend", goal: "Implement responsive browser controls.", acceptanceIds: CALCULATOR_ACCEPTANCE.slice(7).map(item => item.id), paths: ["index.html", "styles.css", "src/app.mjs"], dependsOn: [id(1)] },
      { id: id(3), role: "frontend", goal: "Test keyboard and button interactions.", acceptanceIds: ["keyboard"], paths: ["test/ui.test.mjs"], dependsOn: [id(2)] },
    ], blockers: [], unverifiedAreas: [] });
    await local(["--git-dir=" + remote, "update-ref", "refs/heads/" + request.baseRef, base]);
    const reader: CalculatorSnapshotReader = {
      getHead: async ref => (await local(["--git-dir=" + remote, "rev-parse", "--verify", "refs/heads/" + ref])).trim(),
      readCommit: async sha => {
        const value = await local(["--git-dir=" + remote, "cat-file", "-p", sha]), match = /^tree ([a-f0-9]{40})$/m.exec(value);
        assert.ok(match); return { sha, treeSha: match[1], parents: [...value.matchAll(/^parent ([a-f0-9]{40})$/gm)].map(item => item[1]) };
      },
      readTree: async sha => {
        const output = await local(["--git-dir=" + remote, "ls-tree", "-r", "-t", "--long", "--full-tree", sha]);
        return { sha, truncated: false, tree: output.trim().split("\n").filter(Boolean).map(line => {
          const match = /^(\d+) (\w+) ([a-f0-9]{40})\s+(\d+|-)\t(.+)$/.exec(line); assert.ok(match);
          return { mode: match[1], type: match[2], sha: match[3], ...(match[4] === "-" ? {} : { size: Number(match[4]) }), path: match[5] };
        }) };
      },
      readBlob: async sha => ({ sha, encoding: "base64", content: Buffer.from(await local(["--git-dir=" + remote, "cat-file", "blob", sha])).toString("base64") }),
    };
    const fixedRemote = "https://github.com/" + realPlan.owner.repository + ".git";
    let racing = false, raceSha: string | undefined;
    const runner = async (gitRequest: CalculatorGitRequest) => {
      if (racing && gitRequest.args.includes("push")) {
        racing = false; const current = await reader.getHead(realPlan.branch), metadata = await reader.readCommit(current);
        raceSha = (await local(["--git-dir=" + remote, "commit-tree", metadata.treeSha, "-p", current], "Concurrent offline fixture\n")).trim();
        await local(["--git-dir=" + remote, "update-ref", "refs/heads/" + realPlan.branch, raceSha, current]);
      }
      // Test-only redirection to a temporary LOCAL bare remote. Production has no
      // URL override and remains https-only; no GitHub operation occurs here.
      for (const value of gitRequest.args) if (/^https?:\/\//.test(value)) assert.equal(value, fixedRemote);
      const args = ["-c", "protocol.file.allow=always", ...gitRequest.args.map(value => value === fixedRemote ? remote : value)];
      assert.ok(!args.some(value => /^https?:\/\//.test(value)), "all real Git operations remain local");
      return runCalculatorGit({ ...gitRequest, args });
    };
    const transport: typeof fetch = async (_url, init) => init?.method === "GET" ? Response.json([]) : Response.json({
      number: 1, html_url: "https://github.com/" + realPlan.owner.repository + "/pull/1", state: "open", draft: true,
      head: { ref: realPlan.branch, sha: await reader.getHead(realPlan.branch), repo: { full_name: realPlan.owner.repository } },
      base: { ref: request.baseRef, sha: base, repo: { full_name: realPlan.owner.repository } },
    });
    const options = { plan: realPlan, reader, env: authorized, runGit: runner, transport }, publisher = createCalculatorPublisher(options);
    assert.equal((await publisher.bootstrapProjectBranch()).created, true);
    const snapshot = await loadCalculatorSnapshot({ repository: realPlan.owner.repository, baseRef: realPlan.branch, baseSha: base, changePaths: realPlan.tasks[0].paths }, reader);
    const changes = prepareCalculatorRoleChanges("coder", { summary: "Add offline arithmetic fixture", changes: [
      { operation: "create", path: "src/calculator.mjs", content: "export const add=(a,b)=>a+b;", message: "Add module" },
      { operation: "create", path: "test/calculator.test.mjs", content: "export const fixture=true;", message: "Add fixture" },
    ] }, snapshot);
    const candidate = await publisher.publish({ task: realPlan.tasks[0], changes, expectedSha: base, branch: realPlan.branch });
    assert.deepEqual((await reader.readCommit(candidate.headSha)).parents, [base]);
    const next = await loadCalculatorSnapshot({ repository: realPlan.owner.repository, baseRef: realPlan.branch, baseSha: candidate.headSha, changePaths: realPlan.tasks[1].paths }, reader);
    const ui = prepareCalculatorRoleChanges("frontend", { summary: "Add offline browser fixture", changes: [
      { operation: "create", path: "index.html", content: "<!doctype html><title>Fixture</title>", message: "Add page" },
      { operation: "create", path: "styles.css", content: "body{margin:0}", message: "Add styles" },
      { operation: "create", path: "src/app.mjs", content: "export const fixture=true;", message: "Add UI" },
    ] }, next);
    racing = true;
    await assert.rejects(() => createCalculatorPublisher(options).publish({ task: realPlan.tasks[1], changes: ui, expectedSha: candidate.headSha, branch: realPlan.branch }), refuse);
    assert.ok(raceSha); assert.equal(await reader.getHead(realPlan.branch), raceSha);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("acknowledged push followed by stale API head reports its exact safe phase without retrying the push",async()=>{
 const f=await fixture();const git=async(request:CalculatorGitRequest)=>{const result=await f.git(request);if(command(request)==="push")f.move(A);return result;};
 const publisher=createCalculatorPublisher({...f.options,runGit:git});let failure:unknown;try{await publisher.publish(f.input);}catch(error){failure=error;}
 assert.ok(refuse(failure));const d=calculatorPublicationDiagnostic(failure)!;assert.deepEqual(d,{operation:"publish",phase:"git_ref_after_push",writeAttempted:true,pushAcknowledged:true,candidateSha:C});
 assert.ok(!JSON.stringify(d).includes(authorized.GITHUB_TOKEN));assert.equal(f.http.length,0);const count=f.requests.length;await assert.rejects(()=>publisher.publish(f.input),refuse);assert.equal(f.requests.length,count);assert.equal(f.requests.filter(r=>command(r)==="push").length,1);
 assert.equal(calculatorPublicationDiagnostic(JSON.parse(JSON.stringify(failure))),undefined);assert.equal(calculatorPublicationDiagnostic(Object.assign(new Error(CALCULATOR_PUBLISHER_ERROR),d)),undefined);
});
test("PR HTTP failure retains bounded status after acknowledged push and strips private response data",async()=>{
 const f=await fixture();let calls=0;let failure:unknown;try{await createCalculatorPublisher({...f.options,transport:async()=>{calls++;return new Response("PRIVATE_UPSTREAM_BODY "+authorized.GITHUB_TOKEN,{status:403});}}).publish(f.input);}catch(error){failure=error;}
 assert.ok(refuse(failure));const d=calculatorPublicationDiagnostic(failure)!;assert.equal(d.phase,"pr_list");assert.equal(d.httpStatus,403);assert.equal(d.pushAcknowledged,true);assert.equal(d.candidateSha,C);assert.equal(calls,1);assert.ok(!JSON.stringify(d).includes("PRIVATE_UPSTREAM_BODY"));assert.ok(!JSON.stringify(d).includes(authorized.GITHUB_TOKEN));
});
test("uncertain or no-op push never becomes an acknowledged publication diagnostic",async()=>{
 for(const mode of ["lost-ack","up-to-date"]){const f=await fixture();let failure:unknown;const git=async(request:CalculatorGitRequest)=>{const result=await f.git(request);if(command(request)==="push"){if(mode==="lost-ack")throw Error("PRIVATE_UPSTREAM_BODY "+authorized.GITHUB_TOKEN);return {status:0,stdout:"=\t"+C+":refs/heads/"+plan.branch+"\t[up to date]\n"};}return result;};
 try{await createCalculatorPublisher({...f.options,runGit:git}).publish(f.input);}catch(error){failure=error;}assert.ok(refuse(failure));const d=calculatorPublicationDiagnostic(failure)!;assert.equal(d.phase,"git_push");assert.equal(d.writeAttempted,true);assert.equal(d.pushAcknowledged,false);assert.equal(f.http.length,0);assert.equal(f.requests.filter(r=>command(r)==="push").length,1);}
});
