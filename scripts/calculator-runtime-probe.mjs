// Trusted infrastructure self-test. No model calls, installs or repository writes.
import { stripTypeScriptTypes, builtinModules } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [image,output]=process.argv.slice(2);
if(process.argv.length!==4||!/^node@sha256:[a-f0-9]{64}$/.test(image??'')||!isAbsolute(output??'')) {
  console.error('Runtime probe requires an exact Node image digest and absolute report path.');process.exit(10);
}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const directory=mkdtempSync(join(tmpdir(),'calculator-runtime-probe-'));
const stage=join(directory,'trusted');mkdirSync(stage,{mode:0o700});
const report={version:1,image,modelsRun:false,calculatorWrites:false,
  providerPresence:Object.fromEntries(['HAS_GROQ','HAS_GEMINI','HAS_CLOUDFLARE','HAS_CALCULATOR_TOKEN','HAS_FACTORY_READ_TOKEN'].map(name=>[name,process.env[name]==='true'])),
  preflight:{ready:false,reasonCode:'probe_not_started'},fixtures:{}};
const builtins=new Set(builtinModules.flatMap(name=>[name,'node:'+name])),visited=new Set();
function compile(path){
  const rel=relative(root,path);
  if(rel.startsWith('..')||isAbsolute(rel)||!path.endsWith('.ts'))throw Error('unapproved module');
  if(visited.has(path))return;visited.add(path);
  const original=readFileSync(path,'utf8');
  const transformed=stripTypeScriptTypes(original,{mode:'transform'});
  const destination=join(stage,rel.replace(/\.ts$/,'.js'));mkdirSync(dirname(destination),{recursive:true,mode:0o700});
  writeFileSync(destination,transformed,{mode:0o600});
  for(const match of transformed.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\bfrom\s*)?["']([^"']+)["']/g)){
    const name=match[1];if(builtins.has(name))continue;
    if(!name.startsWith('.')||!name.endsWith('.js'))throw Error('external runtime dependency');
    const source=resolve(dirname(path),name.replace(/\.js$/,'.ts'));
    if(!existsSync(source))throw Error('missing trusted dependency');compile(source);
  }
}
try{
  compile(join(root,'orchestration/calculatorSandbox.ts'));
  const harness=join(stage,'config/calculator-harness/check.mjs');mkdirSync(dirname(harness),{recursive:true,mode:0o700});
  copyFileSync(join(root,'config/calculator-harness/check.mjs'),harness);
  writeFileSync(join(stage,'package.json'),'{"type":"module"}',{mode:0o600});
  const {createCalculatorSandbox}=await import(pathToFileURL(join(stage,'orchestration/calculatorSandbox.js')));
  const sha='a'.repeat(40);
  const sandbox=createCalculatorSandbox({image,baseSha:sha,baseSources:new Map()});
  report.preflight=await sandbox.preflight();
  if(report.preflight.ready){
    const task={id:'trusted-runtime-probe',role:'coder',goal:'Exercise the trusted isolated infrastructure with fixed public fixtures.',
      acceptanceIds:[],paths:['src/calculator.mjs','test/calculator.test.mjs'],dependsOn:[]};
    const fixtures={
      good:`export function calculate(a,op,b){if(op==='/'&&b===0)throw Error('Division by zero');const result=op==='+'?a+b:op==='-'?a-b:op==='*'?a*b:op==='/'?a/b:NaN;if(!Number.isFinite(result))throw Error('Invalid result');return Number(result.toPrecision(12));}`,
      bad:`export function calculate(){return 0;}`,
      earlyExit:`process.exit(0); export function calculate(){return 0;}`,
    };
    for(const [name,source] of Object.entries(fixtures)){
      const changes={repository:'erman-ksv/Onay-Factory-Calculator',baseRef:'feat/calculator-agent/runtime-probe',baseSha:sha,summary:'Trusted public probe fixture',
        files:[{path:'src/calculator.mjs',content:source,message:'Fixed public fixture'},{path:'test/calculator.test.mjs',content:`import test from 'node:test'; import assert from 'node:assert/strict'; test('public fixture only',()=>assert.equal(2+3,5));`,message:'Fixed fixture smoke'}],
        reviewEvidence:'{}',gates:{secretScan:'passed',policyReview:'passed',independentReview:'required',tests:'required',publicationAuthorized:false}};
      const digest=createHash('sha256').update(JSON.stringify({repository:changes.repository,baseRef:changes.baseRef,baseSha:sha,
        files:[...changes.files].sort((a,b)=>a.path.localeCompare(b.path)).map(file=>({path:file.path,content:file.content}))})).digest('hex');
      const result=await sandbox.checkProposal({task,changes,proposalDigest:digest});
      report.fixtures[name]={status:result.status,testsExecuted:result.testsExecuted};
    }
  }
  report.status=report.preflight.ready&&report.fixtures.good?.status==='passed'&&report.fixtures.good.testsExecuted===true&&
    ['bad','earlyExit'].every(name=>report.fixtures[name]?.status==='failed'&&report.fixtures[name].testsExecuted===true)?'passed':'blocked';
}catch{report.status='blocked';report.reasonCode='trusted_probe_execution_unverified';}
finally{
  writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(report));rmSync(directory,{recursive:true,force:true});
}
process.exitCode=report.status==='passed'?0:10;
