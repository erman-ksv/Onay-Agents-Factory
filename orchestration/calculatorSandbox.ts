import {calculatorTestDiagnosticFailures} from './calculatorTestDiagnostics.js';
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, chownSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { CALCULATOR_PROFILE, validateCalculatorScope } from "../config/calculatorProfile.js";
import { CALCULATOR_TEAM } from "../commander/calculatorTeam.js";
import { scanForSecrets } from "../github/secretScanner.js";
import { calculatorProposalDigest, type CalculatorProposalTests } from "./calculatorExecutionEvidence.js";
import type { CalculatorExecutionTools } from "./calculatorExecution.js";

export type CalculatorSandboxConfig = Readonly<{
  image: string; baseSha: string; baseSources: ReadonlyMap<string, string>; timeoutMs?: number; includeFailureDetails?: boolean;
}>;
export type CalculatorSandboxReadiness = Readonly<{
  ready: boolean; reasonCode: "ready" | "configuration_unverified" | "docker_unavailable" | "image_unavailable" | "runtime_unverified";
}>;
/** Test-only process injection. Live commands always target the local Docker
 * socket with fixed arguments; no shell or Docker API is exposed to a model. */
export type CalculatorSandboxProcess = (args: readonly string[], options: Readonly<{
  env: NodeJS.ProcessEnv; timeoutMs: number; maxOutputBytes: number;
}>) => Promise<Readonly<{ code: number | null; stdout: string; stderr: string; timedOut?: boolean }>>;

const MAX_OUTPUT = 32_768, MAX_TOTAL_SOURCE = CALCULATOR_PROFILE.maxSourceBytes * CALCULATOR_PROFILE.writablePaths.length;
const unavailable = "Isolated calculator task checks are unavailable; execution remains unverified.";
const failureNames = ["syntax", "arithmetic-interface", "addition", "negative-result", "multiplication", "division", "decimals", "decimal-display", "zero-recovery", "project-tests", "ui-structure"];
const imagePattern = /^(?:docker\.io\/library\/)?node(?::[A-Za-z0-9_.-]+)?@sha256:[a-f0-9]{64}$/;
const dockerPrefix = ["--host=unix:///var/run/docker.sock"];

export const runCalculatorSandboxProcess: CalculatorSandboxProcess = (args, options) => new Promise(resolve => {
  let settled = false, bytes = 0, stdout = "", stderr = "";
  const child = spawn("docker", [...args], { env: options.env, stdio: ["ignore", "pipe", "pipe"], shell: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  function finish(code: number | null, timedOut = false) {
    if (settled) return; settled = true; if (timer) clearTimeout(timer);
    resolve({ code, stdout, stderr, ...(timedOut ? { timedOut: true } : {}) });
  }
  timer = setTimeout(() => { child.kill("SIGKILL"); finish(null, true); }, options.timeoutMs);
  const capture = (kind: "stdout" | "stderr", chunk: Buffer) => {
    bytes += chunk.byteLength;
    if (bytes > options.maxOutputBytes) { child.kill("SIGKILL"); finish(null); return; }
    if (kind === "stdout") stdout += chunk.toString("utf8"); else stderr += chunk.toString("utf8");
  };
  child.stdout?.on("data", chunk => capture("stdout", chunk)); child.stderr?.on("data", chunk => capture("stderr", chunk));
  child.on("error", () => finish(null)); child.on("close", code => finish(code));
});

/** A selected host image must already exist. No dependency installation, pull,
 * registry fallback, remote daemon, source execution outside Docker or retries. */
export function createCalculatorSandbox(config: CalculatorSandboxConfig, env: NodeJS.ProcessEnv = process.env,
  processRunner: CalculatorSandboxProcess = runCalculatorSandboxProcess) {
  const image = config.image, baseSha = config.baseSha, timeoutMs = config.timeoutMs ?? 20_000;
  const baseSources = new Map(config.baseSources), includeFailureDetails=config.includeFailureDetails===true;
  // Preserve the Docker client's own configuration without passing provider keys.
  const clientEnv: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "HOME", "DOCKER_CONFIG", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR"])
    if (env[name] !== undefined) clientEnv[name] = env[name];
  const processOptions = Object.freeze({ env: Object.freeze(clientEnv), timeoutMs, maxOutputBytes: MAX_OUTPUT });
  function configurationValid(): boolean {
    let bytes = 0;
    if (!imagePattern.test(image) || !/^[a-f0-9]{40}$/.test(baseSha) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000 ||
        baseSources.size > CALCULATOR_PROFILE.writablePaths.length || typeof processRunner !== "function") return false;
    for (const [path, source] of baseSources) {
      if (!CALCULATOR_PROFILE.writablePaths.includes(path) || typeof source !== "string" || Buffer.from(source).toString("utf8") !== source ||
          Buffer.byteLength(source) > CALCULATOR_PROFILE.maxSourceBytes || scanForSecrets(source).length) return false;
      bytes += Buffer.byteLength(source);
    }
    return bytes <= MAX_TOTAL_SOURCE;
  }
  const containerLimits = ["--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=32",
    "--memory=256m", "--memory-swap=256m", "--cpus=1", "--tmpfs=/tmp:rw,noexec,nosuid,size=16m,mode=1777",
    "--env=HTTP_PROXY=", "--env=HTTPS_PROXY=", "--env=FTP_PROXY=", "--env=ftp_proxy=", "--env=NO_PROXY=", "--env=ALL_PROXY=", "--env=http_proxy=", "--env=https_proxy=", "--env=no_proxy=", "--env=all_proxy=",
    "--env=NODE_OPTIONS=", "--env=NODE_EXTRA_CA_CERTS=", "--env=HOME=/tmp"];
  async function preflight(): Promise<CalculatorSandboxReadiness> {
    const result = (ready: boolean, reasonCode: CalculatorSandboxReadiness["reasonCode"]) => Object.freeze({ ready, reasonCode });
    if (!configurationValid()) return result(false, "configuration_unverified");
    try {
      const daemon = await processRunner([...dockerPrefix, "info", "--format={{.ServerVersion}}"], processOptions);
      if (daemon.code !== 0 || daemon.timedOut || !/^\d+\.\d+/.test(daemon.stdout.trim())) return result(false, "docker_unavailable");
      const inspected = await processRunner([...dockerPrefix, "image", "inspect", "--format={{json .RepoDigests}}", image], processOptions);
      if (inspected.code !== 0 || inspected.timedOut) return result(false, "image_unavailable");
      const names: unknown = JSON.parse(inspected.stdout);
      if (!Array.isArray(names) || !names.some(name => typeof name === "string" && name.replace(/:.*@/, "@").endsWith("@" + image.split("@")[1]))) return result(false, "image_unavailable");
      const runtime = await processRunner([...dockerPrefix, "run", "--rm", ...containerLimits, "--user=65534:65534", "--entrypoint=/usr/local/bin/node", image, "--disable-sigusr1", "--version"], processOptions);
      const match = /^v(\d+)\.(\d+)\.\d+\s*$/.exec(runtime.stdout);
      if (runtime.code !== 0 || runtime.timedOut || !match || Number(match[1]) < 22 || (Number(match[1]) === 22 && Number(match[2]) < 13)) return result(false, "runtime_unverified");
      return result(true, "ready");
    } catch { return result(false, "docker_unavailable"); }
  }
  const checkProposal: CalculatorExecutionTools["checkProposal"] = async input => {
    const task = { ...input.task, paths: [...input.task.paths] };
    const changes = { ...input.changes, files: input.changes.files.map(file => ({ ...file })) };
    const requestedDigest = input.proposalDigest, actualDigest = calculatorProposalDigest(changes);
    const identity = { repository: CALCULATOR_PROFILE.repository, taskId: task.id, baseSha, proposalDigest: actualDigest };
    const answer = (status: CalculatorProposalTests["status"], testsExecuted: boolean, failures: readonly string[]): CalculatorProposalTests =>
      Object.freeze({ ...identity, status, testsExecuted, failures: Object.freeze([...failures]) });
    let directory: string | undefined, name: string | undefined;
    try {
      validateCalculatorScope({ repository: changes.repository, baseRef: changes.baseRef, baseSha: changes.baseSha, changePaths: task.paths });
      if (!configurationValid() || changes.baseSha !== baseSha || requestedDigest !== actualDigest ||
          !["coder", "frontend"].includes(task.role) || !changes.files.length ||
          new Set(changes.files.map(file => file.path)).size !== changes.files.length ||
          changes.files.some(file => !task.paths.includes(file.path) || !CALCULATOR_TEAM[task.role].writablePaths.includes(file.path)))
        return answer("unverified", false, [unavailable]);
      const sources = new Map(baseSources);
      for (const file of changes.files) {
        if (typeof file.content !== "string" || Buffer.byteLength(file.content) > CALCULATOR_PROFILE.maxSourceBytes ||
            Buffer.from(file.content).toString("utf8") !== file.content || scanForSecrets(file.content).length) return answer("unverified", false, [unavailable]);
        sources.set(file.path, file.content);
      }
      if (!sources.has("src/calculator.mjs") || task.paths.some(path => !sources.has(path)) || !(await preflight()).ready) return answer("unverified", false, [unavailable]);
      const harness = readFileSync(new URL("../config/calculator-harness/check.mjs", import.meta.url), "utf8");
      directory = mkdtempSync(join(tmpdir(), "onay-calculator-sandbox-")); chmodSync(directory, 0o700);
      const root = join(directory, "app"); mkdirSync(root, { mode: 0o700 });
      for (const [path, source] of sources) {
        const destination = join(root, path); mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
        writeFileSync(destination, source, { mode: 0o600, flag: "wx" });
      }
      const harnessPath = join(directory, "harness.mjs"), manifestPath = join(directory, "manifest.json"), diagnosticPath=join(directory,"diagnose.mjs");
      if(includeFailureDetails)writeFileSync(diagnosticPath,readFileSync(new URL("../config/calculator-harness/diagnose.mjs",import.meta.url)),{mode:0o600,flag:"wx"});
      const expected = ["syntax", ...(sources.has("src/calculator.mjs") ? ["fixed-arithmetic"] : []),
        ...([...sources.keys()].some(path => path.startsWith("test/")) ? ["project-tests"] : []), ...(task.role === "frontend" ? ["ui-structure"] : [])];
      writeFileSync(harnessPath, harness, { mode: 0o600, flag: "wx" });
      writeFileSync(manifestPath, JSON.stringify({ paths: [...sources.keys()].sort(), expected }), { mode: 0o600, flag: "wx" });
      const uid = typeof process.getuid === "function" ? process.getuid() : -1;
      const gid = typeof process.getgid === "function" ? process.getgid() : -1;
      if (uid < 0 || gid < 0) return answer("unverified", false, [unavailable]);
      const user = uid === 0 ? 65534 : uid, group = uid === 0 ? 65534 : gid;
      if (uid === 0) {
        for (const path of [...sources.keys()].map(path => join(root, path))) chownSync(path, user, group);
        for (const path of [join(root, "src"), join(root, "test")]) if ([...sources.keys()].some(key => key.startsWith(path.endsWith("src") ? "src/" : "test/"))) chownSync(path, user, group);
        for (const path of [root, harnessPath, manifestPath, directory,...(includeFailureDetails?[diagnosticPath]:[])]) chownSync(path, user, group);
      }
      name = "onay-calculator-check-" + randomBytes(10).toString("hex");
      const run = await processRunner([...dockerPrefix, "run", "--rm", "--name=" + name, ...containerLimits, "--user=" + user + ":" + group,
        "--mount=type=bind,src=" + root + ",dst=/app,readonly", "--mount=type=bind,src=" + harnessPath + ",dst=/harness.mjs,readonly",
        "--mount=type=bind,src=" + manifestPath + ",dst=/manifest.json,readonly", "--workdir=/app", "--entrypoint=/usr/local/bin/node", image, "--disable-sigusr1", "/harness.mjs"], processOptions);
      if (run.timedOut || ![0, 1].includes(run.code ?? -1) || Buffer.byteLength(run.stdout) > MAX_OUTPUT) return answer("unverified", false, [unavailable]);
      const proof: unknown = JSON.parse(run.stdout);
      if (!proof || typeof proof !== "object" || Array.isArray(proof)) return answer("unverified", false, [unavailable]);
      const record = proof as Record<string, unknown>;
      if (Object.keys(record).sort().join(",") !== "checks,failures,status,version" || record.version !== 1 ||
          !Array.isArray(record.checks) || record.checks.join(",") !== expected.join(",") || !Array.isArray(record.failures) ||
          record.failures.some(value => typeof value !== "string" || !failureNames.includes(value)) || new Set(record.failures).size !== record.failures.length ||
          (run.code === 0 ? record.status !== "passed" || record.failures.length !== 0 : record.status !== "failed" || record.failures.length === 0))
        return answer("unverified", false, [unavailable]);
      const failures=record.failures.slice(0,6).map(value=>"Trusted isolated task check failed: "+value+".");
      if(run.code===1&&includeFailureDetails&&record.failures.includes('project-tests')){
        try{
          const diagnostic=await processRunner([...dockerPrefix,'run','--rm','--name='+name,...containerLimits,'--user='+user+':'+group,
            '--mount=type=bind,src='+root+',dst=/app,readonly','--mount=type=bind,src='+diagnosticPath+',dst=/diagnose.mjs,readonly',
            '--mount=type=bind,src='+manifestPath+',dst=/manifest.json,readonly','--workdir=/app','--entrypoint=/usr/local/bin/node',image,'--disable-sigusr1','/diagnose.mjs'],processOptions);
          if(diagnostic.code===0&&!diagnostic.timedOut)failures.push(...calculatorTestDiagnosticFailures(diagnostic.stdout,[...sources.keys()]));
        }catch{/* Diagnostics never authorize success or replace the original failing verdict. */}
      }
      return answer(run.code===0?'passed':'failed',true,failures.slice(0,6));
    } catch { return answer("unverified", false, [unavailable]); }
    finally {
      if (name) try { await processRunner([...dockerPrefix, "rm", "--force", name], processOptions); } catch { /* Fixed source-free evidence only. */ }
      if (directory) rmSync(directory, { recursive: true, force: true });
    }
  };
  return Object.freeze({ preflight, checkProposal });
}
