import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { isAbsolute, resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { prepareCalculatorGoal } from "./calculatorPlan.js";
import { runCalculatorRuntime, CALCULATOR_RUNTIME_ERROR } from "./calculatorRuntime.js";
function refuse(): never { throw new Error(CALCULATOR_RUNTIME_ERROR); }
export function parseCalculatorCli(args: string[]) {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!["--goal", "--config", "--state-dir", "--output-dir", "--mode"].includes(key) || Object.hasOwn(values, key) ||
        !value || value.startsWith("--")) return refuse();
    values[key] = value;
  }
  if (Object.keys(values).length !== 5 || !["inspect", "preflight", "plan", "run"].includes(values["--mode"]) ||
      ["--goal", "--config", "--state-dir", "--output-dir"].some(key => !isAbsolute(values[key]) || resolve(values[key]) !== values[key])) return refuse();
  return { goal: values["--goal"], config: values["--config"], state: values["--state-dir"], output: values["--output-dir"],
    mode: values["--mode"] as "inspect" | "preflight" | "plan" | "run" };
}
function read(path: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 2 || stat.size > 24_576) return refuse();
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
}
function directory(path: string): void {
  // Walk every ancestor: recursive mkdir plus a final lstat alone follows symlinks.
  let current = resolve(path).split("/")[0] || "/";
  for (const part of resolve(path).split("/").filter(Boolean)) {
    current = join(current, part);
    try { const stat = lstatSync(current); if (!stat.isDirectory() || stat.isSymbolicLink()) return refuse(); }
    catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") mkdirSync(current, { mode: 0o700 }); else throw error; }
  }
  const stat = lstatSync(path);
  if ((stat.mode & 0o777) !== 0o700 || (process.getuid && stat.uid !== process.getuid())) return refuse();
}
export async function runCalculatorCli(args: string[], env: NodeJS.ProcessEnv = process.env) {
  try {
    const options = parseCalculatorCli(args), owner = read(options.goal); prepareCalculatorGoal(owner);
    const config = options.mode === "inspect" ? undefined : read(options.config);
    directory(options.state); directory(options.output);
    const report = await runCalculatorRuntime(owner, config, options.state, options.mode, env);
    const temporary = join(options.output, ".calculator-report-" + randomBytes(12).toString("hex"));
    writeFileSync(temporary, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, join(options.output, "calculator-report.json"));
    return { code: report.status === "blocked" ? 10 : report.status === "needs-review" ? 11 : 0, report };
  } catch { return refuse(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCalculatorCli(process.argv.slice(2)).then(({ code, report }) => { console.log(JSON.stringify(report)); process.exitCode = code; })
    .catch(() => { console.error(CALCULATOR_RUNTIME_ERROR); process.exitCode = 10; });
}
