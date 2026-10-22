// Read-only probe of a pinned historical candidate. No model, task resume,
// receipts, publication or claim of autonomous development.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,copyFileSync} from 'node:fs';
import {join,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
const source=process.cwd(),compiled=join(process.env.RUNNER_TEMP,'factory-browser-compiled');
function walk(dir){for(const name of readdirSync(dir,{withFileTypes:true})){if(['.git','node_modules','original'].includes(name.name))continue;const p=join(dir,name.name);if(name.isDirectory()){walk(p);continue;}if(name.name.endsWith('.test.ts'))continue;const dest=join(compiled,relative(source,p).replace(/\.ts$/,'.js'));mkdirSync(dirname(dest),{recursive:true});if(p.endsWith('.ts'))writeFileSync(dest,stripTypeScriptTypes(readFileSync(p,'utf8'),{mode:'transform'}));else if(/\.(mjs|json)$/.test(p))copyFileSync(p,dest);}}
for(const dir of ['agents','commander','config','github','orchestration'])walk(join(source,dir));
writeFileSync(join(compiled,'package.json'),'{"type":"module"}');
const {createCalculatorBrowserSandbox}=await import(join(compiled,'orchestration/calculatorBrowserSandbox.js'));
const {calculatorProposalDigest}=await import(join(compiled,'orchestration/calculatorExecutionEvidence.js'));
const candidate='949a0bf874722fd8cbd886c2cb0af8f2b502ac05',root=join(process.env.GITHUB_WORKSPACE,'calculator-candidate');
const paths=['index.html','styles.css','src/app.mjs'];
const changes={repository:'erman-ksv/Onay-Factory-Calculator',baseRef:'feat/calculator-agent/calculator-pilot-step7-v1',baseSha:candidate,
 files:paths.map(path=>({path,content:readFileSync(join(root,path),'utf8'),message:'Read-only historical candidate probe'}))};
const core=readFileSync(join(root,'src/calculator.mjs'),'utf8'),hash=s=>createHash('sha256').update(s).digest('hex');
assert.equal(hash(changes.files.find(f=>f.path==='src/app.mjs').content),'db16d014e906787deb4f888e3e6f6a4b54e189b4b8eb3afdcedf7792e252b9b5');
const runner=createCalculatorBrowserSandbox({image:process.env.BROWSER_IMAGE});
const result={version:1,candidateSha:candidate,readOnlyCandidateProbe:true,autonomousDevelopmentProven:false,modelsRun:false,publicationAuthorized:false,wholeStep8Closed:false};
try{
 result.readiness=await runner.preflight();
 result.browser=await runner.check({task:{id:'calculator-pilot-step7-v1-34ee03-t02',role:'frontend',paths,acceptanceIds:['clear','backspace']},
 changes,proposalDigest:calculatorProposalDigest(changes),dependencySha256:hash(core),baseSources:new Map([['src/calculator.mjs',core]])});
 result.status='passed';
}catch(error){result.status='blocked_browser_runtime';result.reason=['image_unavailable','browser_timeout','browser_runtime_failed','browser_sandbox_unavailable'].includes(error?.code)?error.code:'browser_unverified';process.exitCode=1;}
writeFileSync(join(process.env.RUNNER_TEMP,'factory-browser-probe.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(result));
