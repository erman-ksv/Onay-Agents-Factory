import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Call with the installed, frozen-lockfile tsx loader. No compilation of
 * uncommitted files, implicit mode, self-derived scope digest or retry. */
export async function rejectedProposalHostMain(args:string[],env:NodeJS.ProcessEnv){
 if(args.length!==1||!['--preflight','--live'].includes(args[0]))throw Error('Explicit host mode required');
 const mode=args[0]==='--preflight'?'preflight':'live';
 const host=await import('../orchestration/projectRejectedProposalHost.js');
 host.assertProjectRejectedHostEnvironment(env,mode);
 const git=(args:string[])=>execFileSync('/usr/bin/git',args,{encoding:'utf8',timeout:10000}).trim();
 // Frozen pnpm install creates node_modules in this repository (which has no
 // .gitignore). Ignore only that dependency directory, never source/config.
 if(git(['rev-parse','HEAD'])!==env.FACTORY_HOST_SOURCE_SHA||git(['status','--porcelain','--untracked-files=all','--','.',':(exclude)node_modules']))throw Error('Exact clean implementation checkout required');
 execFileSync('/usr/bin/git',['merge-base','--is-ancestor','7f9e4de0fa1a8d3518893ef8986c3d961a7ce1ce',env.FACTORY_HOST_SOURCE_SHA!],{timeout:10000});
 const scope=readFileSync('.factory/rejected-proposal-host.json','utf8'),expected=env.FACTORY_REJECTED_HOST_SCOPE_SHA256;
 if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)||createHash('sha256').update(scope).digest('hex')!==expected)throw Error('Separately pinned host config required');
 const cap=host.prepareProjectRejectedProposalHost(scope,expected,readFileSync('.factory/runtime-project-manifest.json','utf8'));
 const directory=mkdtempSync(join(tmpdir(),'onay-rejected-host-'));
 // Preserve private runtime files after failure for audit/recovery. Never
 // auto-clean, restart, replay a request or recreate a consumed admission.
 return mode==='preflight'?host.preflightProjectRejectedProposalHost(cap,env,directory):host.runProjectRejectedProposalHost(cap,env,directory);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await rejectedProposalHostMain(process.argv.slice(2),process.env)));}
 catch{console.error('Rejected proposal host stopped. Preserve checkpoint, ledger and runtime files. No retry or replay authorized.');process.exitCode=1;}
}
