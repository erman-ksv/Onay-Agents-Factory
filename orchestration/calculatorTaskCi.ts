import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CALCULATOR_PROFILE } from "../config/calculatorProfile.js";
import { createCalculatorSandbox } from "./calculatorSandbox.js";
import { calculatorProposalDigest } from "./calculatorExecutionEvidence.js";
import type { PreparedCalculatorChanges } from "../commander/calculatorChanges.js";

/** Trusted CI entry point: read six allowed regular files, run only in Docker.
 * The calculator checkout cannot supply a package script, command or harness. */
export async function runCalculatorTaskCi(sourceDirectory: string, sha: string, image: string) {
  if (!isAbsolute(sourceDirectory) || resolve(sourceDirectory) !== sourceDirectory || !/^[a-f0-9]{40}$/.test(sha) ||
      !/^node@sha256:[a-f0-9]{64}$/.test(image)) throw Error("Calculator task CI configuration is invalid.");
  const root = lstatSync(sourceDirectory); if (!root.isDirectory() || root.isSymbolicLink()) throw Error("Calculator task source is unverified.");
  const sources = new Map<string, string>();
  for (const path of CALCULATOR_PROFILE.writablePaths) {
    const parts = path.split('/'); let parentMissing = false;
    for (let i = 1; i < parts.length; i++) {
      try { const stat = lstatSync(join(sourceDirectory, ...parts.slice(0, i)));
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Calculator task source is unverified.");
      } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') { parentMissing = true; break; } throw error; }
    }
    if (parentMissing) continue;
    let fd: number;
    try { fd = openSync(join(sourceDirectory, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue; throw error; }
    try { const stat = fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1 || stat.size > CALCULATOR_PROFILE.maxSourceBytes) throw Error("Calculator task source is unverified.");
      const data = readFileSync(fd); if (!Buffer.from(data.toString('utf8')).equals(data)) throw Error("Calculator task source is unverified.");
      sources.set(path, data.toString('utf8'));
    } finally { closeSync(fd); }
  }
  const ui = ['index.html', 'styles.css', 'src/app.mjs'], frontend = ui.some(path => sources.has(path));
  const paths = frontend ? ui : ['src/calculator.mjs','test/calculator.test.mjs'];
  if (paths.some(path => !sources.has(path))) return { status: 'unverified', testsExecuted: false };
  const changes: PreparedCalculatorChanges = { repository: CALCULATOR_PROFILE.repository, baseRef: 'feat/calculator-agent/trusted-ci', baseSha: sha,
    summary: 'Trusted current task CI input', files: paths.map(path => ({path, content: sources.get(path)!, message: 'Inspect current task source'})),
    reviewEvidence: '{}', gates: {secretScan:'passed',policyReview:'passed',independentReview:'required',tests:'required',publicationAuthorized:false} };
  const task = {id:'trusted-ci-task',role:frontend?'frontend' as const:'coder' as const,goal:'Check current task code independently.',paths,dependsOn:[],acceptanceIds:[]};
  return createCalculatorSandbox({image,baseSha:sha,baseSources:sources}).checkProposal({task,changes,proposalDigest:calculatorProposalDigest(changes)});
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);
  if(args.length!==3) { console.error('Calculator task CI requires source directory, exact SHA and pinned image.');process.exitCode=10; }
  else runCalculatorTaskCi(args[0],args[1],args[2]).then(result=>{console.log(JSON.stringify({status:result.status,testsExecuted:result.testsExecuted}));process.exitCode=result.status==='passed'&&result.testsExecuted?0:10;})
    .catch(()=>{console.error('Calculator task CI stopped: configuration, source or isolated execution is unverified.');process.exitCode=10;});
}
