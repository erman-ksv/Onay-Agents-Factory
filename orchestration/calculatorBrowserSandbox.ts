/** Actual isolated Chromium runner. Host-selected immutable image only; no
 * downloads, shell, provider requests, target writes or no-sandbox fallback. */
import { randomBytes, createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, chownSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCalculatorSandboxProcess, type CalculatorSandboxProcess } from "./calculatorSandbox.js";
import { CALCULATOR_UI_BROWSER_SCENARIOS, CALCULATOR_KEYBOARD_BROWSER_SCENARIOS, CALCULATOR_NARROW_BROWSER_SCENARIOS } from "./calculatorAssessmentEvidence.js";
import { calculatorProposalDigest } from "./calculatorExecutionEvidence.js";
import { validateCalculatorScope, CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
import { scanForSecrets } from "../github/secretScanner.js";
import type { CalculatorRepairBrowserRunner } from "./calculatorAgentRepairHost.js";

export const CALCULATOR_BROWSER_SANDBOX_ERROR = "Isolated browser unavailable or checks failed. Preserve state; no weaker browser or retry is authorized.";
type FailureCode = "browser_unverified" | "image_unavailable" | "browser_timeout" | "browser_runtime_failed" | "browser_sandbox_unavailable" | "browser_checks_failed";
const refuse = (code: FailureCode = "browser_unverified"): never => {
  throw Object.assign(Error(CALCULATOR_BROWSER_SANDBOX_ERROR), { code });
};
const IMAGE = /^mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}$/;
const PATHS = ["index.html", "styles.css", "src/app.mjs", "src/calculator.mjs"];
const PREFIX = ["--host=unix:///var/run/docker.sock"];
export function createCalculatorBrowserSandbox(config: Readonly<{ image: string }>, env: NodeJS.ProcessEnv = process.env,
  run: CalculatorSandboxProcess = runCalculatorSandboxProcess): CalculatorRepairBrowserRunner {
  const image = config?.image;
  if (typeof image !== "string" || !IMAGE.test(image) || typeof run !== "function") return refuse();
  const clientEnv: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "DOCKER_CONFIG", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR"])
    if (env[key] !== undefined) clientEnv[key] = env[key];
  const options = Object.freeze({ env: Object.freeze(clientEnv), timeoutMs: 45000, maxOutputBytes: 16384 });
  const policy = fileURLToPath(new URL("../config/calculator-browser/seccomp.json", import.meta.url));
  const harness = readFileSync(new URL("../config/calculator-browser/check.mjs", import.meta.url), "utf8");
  const seccomp = JSON.parse(readFileSync(policy, "utf8"));
  if (seccomp.defaultAction !== "SCMP_ACT_ERRNO") return refuse();
  let preflightStarted = false, ready = false, checkStarted = false;
  async function execute(mode: "preflight" | "check", sources: ReadonlyMap<string, string> = new Map(), keyboard = false, narrow = false) {
    let directory: string | undefined, name: string | undefined;
    try {
      const inspected = await run([...PREFIX, "image", "inspect", "--format={{json .RepoDigests}}", image], options);
      const digests: unknown = inspected.code === 0 ? JSON.parse(inspected.stdout) : undefined;
      if (inspected.code !== 0 || inspected.timedOut || !Array.isArray(digests) || !digests.includes(image)) return refuse("image_unavailable");
      const uid = process.getuid?.() ?? -1, gid = process.getgid?.() ?? -1;
      if (uid < 0 || gid < 0) return refuse(); const user = uid === 0 ? 1000 : uid, group = uid === 0 ? 1000 : gid;
      directory = mkdtempSync(join(tmpdir(), "factory-browser-"));
      const app = join(directory, "app"); mkdirSync(app, { mode: 0o700 });
      const owned: string[] = [directory, app];
      for (const [path, content] of sources) {
        if (!PATHS.includes(path) || Buffer.byteLength(content) > CALCULATOR_PROFILE.maxSourceBytes || scanForSecrets(content).length) return refuse();
        if (path.startsWith("src/") && !owned.includes(join(app, "src"))) { mkdirSync(join(app, "src"), { mode: 0o700 }); owned.push(join(app, "src")); }
        const target = join(app, path); writeFileSync(target, content, { mode: 0o600, flag: "wx" }); owned.push(target);
      }
      const harnessPath = join(directory, "harness.mjs"), manifest = join(directory, "manifest.json");
      writeFileSync(harnessPath, harness, { mode: 0o600, flag: "wx" });
      writeFileSync(manifest, JSON.stringify({ version: 1, mode, suite: narrow ? "narrow-screen" : keyboard ? "keyboard" : "clear-backspace" }), { mode: 0o600, flag: "wx" }); owned.push(harnessPath, manifest);
      if (uid === 0) for (const path of owned) chownSync(path, user, group);
      name = "factory-browser-" + randomBytes(10).toString("hex");
      const args = [...PREFIX, "run", "--rm", "--name=" + name, "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL",
        "--security-opt=no-new-privileges", "--security-opt=seccomp=" + policy, "--user=" + user + ":" + group,
        "--pids-limit=128", "--memory=1g", "--memory-swap=1g", "--cpus=1", "--shm-size=256m",
        "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=128m,mode=1777", "--env=HOME=/tmp", "--env=PATH=/usr/bin:/bin", "--env=NODE_OPTIONS=",
        "--env=NODE_EXTRA_CA_CERTS=", ...["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "FTP_PROXY", "ftp_proxy"].map(key => "--env=" + key + "="),
        "--mount=type=bind,src=" + harnessPath + ",dst=/harness.mjs,readonly", "--mount=type=bind,src=" + manifest + ",dst=/manifest.json,readonly",
        "--mount=type=bind,src=" + app + ",dst=/app,readonly", "--entrypoint=/usr/bin/node", image, "/harness.mjs"];
      const result = await run(args, options);
      if (result.timedOut) return refuse("browser_timeout");
      if (result.code !== 0) {
        let reason: unknown; try { reason = JSON.parse(result.stdout)?.reason; } catch { /* Do not expose stderr or source. */ }
        if (reason === "browser_checks_failed") return refuse("browser_checks_failed");
        return refuse(reason === "browser_sandbox_unavailable" ? "browser_sandbox_unavailable" : "browser_runtime_failed");
      }
      const proof = JSON.parse(result.stdout);
      if (proof.version !== 1 || proof.mode !== mode || proof.sandboxDisabled !== false || !/^Chrome\/[0-9.]+$/.test(proof.browser)) return refuse();
      if (mode === "preflight" && (proof.ready !== true || proof.networkIsolated !== true || proof.credentialsExcluded !== true)) return refuse();
      if (mode === "check" && (proof.status !== "passed" || proof.testsExecuted !== true || proof.pageErrors !== 0 || proof.blockedRequests !== 0 ||
          JSON.stringify(proof.scenarios) !== JSON.stringify(narrow ? CALCULATOR_NARROW_BROWSER_SCENARIOS : keyboard ? CALCULATOR_KEYBOARD_BROWSER_SCENARIOS : CALCULATOR_UI_BROWSER_SCENARIOS))) return refuse();
      return proof;
    } catch (error) {
      if (error instanceof Error && error.message === CALCULATOR_BROWSER_SANDBOX_ERROR) throw error;
      return refuse();
    }
    finally {
      if (name) try { await run([...PREFIX, "rm", "--force", name], options); } catch { /* No unsafe retry. */ }
      if (directory) rmSync(directory, { recursive: true, force: true });
    }
  }
  return Object.freeze({
    async preflight() {
      if (preflightStarted) return refuse(); preflightStarted = true;
      await execute("preflight"); ready = true;
      return Object.freeze({ ready: true as const, sandboxDisabled: false as const, networkIsolated: true as const, credentialsExcluded: true as const });
    },
    async check(input: Parameters<CalculatorRepairBrowserRunner["check"]>[0]) {
      if (!ready || checkStarted) return refuse(); checkStarted = true;
      const { changes, task } = input;
      validateCalculatorScope({ repository: changes.repository, baseRef: changes.baseRef, baseSha: changes.baseSha, changePaths: task.paths });
      const narrow = task.acceptanceIds.length === 1 && task.acceptanceIds[0] === "narrow-screen";
      const keyboard = task.acceptanceIds.length === 1 && task.acceptanceIds[0] === "keyboard";
      const paths = narrow ? ["index.html","styles.css"] : keyboard ? ["src/app.mjs", "test/ui.test.mjs"] : PATHS.slice(0, 3);
      if (task.role !== "frontend" || (!keyboard && !narrow && (task.acceptanceIds.length !== 2 || !["clear", "backspace"].every(id => task.acceptanceIds.includes(id)))) ||
          task.paths.length !== paths.length || !paths.every(path => task.paths.includes(path)) ||
          !changes.files.length || new Set(changes.files.map(f => f.path)).size !== changes.files.length ||
          changes.files.some(f => !paths.includes(f.path)) || input.proposalDigest !== calculatorProposalDigest(changes) ||
          !/^[a-f0-9]{64}$/.test(input.dependencySha256)) return refuse();
      const sources = new Map(PATHS.map(path => [path, input.baseSources.get(path) ?? ""]));
      for (const file of changes.files) if (PATHS.includes(file.path)) sources.set(file.path, file.content);
      if (!sources.get("src/calculator.mjs") || createHash("sha256").update(sources.get("src/calculator.mjs")!).digest("hex") !== input.dependencySha256) return refuse();
      const proof = await execute("check", sources, keyboard, narrow);
      if (calculatorProposalDigest(changes) !== input.proposalDigest) return refuse();
      return Object.freeze({ repository: changes.repository, taskId: task.id, baseSha: changes.baseSha,
        proposalDigest: input.proposalDigest, dependencySha256: input.dependencySha256,
        status: "passed" as const, testsExecuted: true as const, browser: proof.browser, sandboxDisabled: false as const,
        pageErrors: 0 as const, blockedRequests: 0 as const, scenarios: narrow ? CALCULATOR_NARROW_BROWSER_SCENARIOS : keyboard ? CALCULATOR_KEYBOARD_BROWSER_SCENARIOS : CALCULATOR_UI_BROWSER_SCENARIOS });
    },
  });
}
