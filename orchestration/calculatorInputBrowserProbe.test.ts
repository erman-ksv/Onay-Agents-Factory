import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createCalculatorInputBrowserProbe,createCalculatorInputBrowserProbeForTests,calculatorInputBrowserContract,calculatorInputLabelMatches,CALCULATOR_INPUT_BROWSER_ERROR} from './calculatorInputBrowserProbe.js';
import type {CalculatorSandboxProcess} from './calculatorSandbox.js';
const image='mcr.microsoft.com/playwright@sha256:'+'1'.repeat(64),contract=calculatorInputBrowserContract(),sources=new Map(['index.html','styles.css','src/app.mjs','src/calculator.mjs'].map(p=>[p,'PRIVATE_SOURCE_MARKER'])),input={candidateSha:'a'.repeat(40),sources};
const stopped=(e:unknown)=>e instanceof Error&&e.message===CALCULATOR_INPUT_BROWSER_ERROR;
test('typographic minus on the original button is equivalent to keyboard subtraction',()=>{
 for(const text of ['-','−','‑','–',' ‑ '])assert.equal(calculatorInputLabelMatches(text,'-'),true);
 assert.equal(calculatorInputLabelMatches('×','*'),true);assert.equal(calculatorInputLabelMatches('÷','/'),true);assert.equal(calculatorInputLabelMatches('+','-'),false);assert.equal(calculatorInputLabelMatches('⌫','-'),false);
});
function fixture(mode='normal'){
 let runs=0,cleanups=0;
 const process:CalculatorSandboxProcess=async(args,options)=>{
  assert.equal(args[0],'--host=unix:///var/run/docker.sock');assert.equal(options.env.GROQ_API_KEY,undefined);assert.equal(options.env.GITHUB_TOKEN,undefined);
  if(args.includes('inspect'))return {code:0,stdout:JSON.stringify(mode==='image-string'?image:mode==='wrong-image'?[]:[image]),stderr:''};
  if(args.includes('rm')){cleanups++;return {code:0,stdout:'',stderr:''};}runs++;
  for(const flag of ['--network=none','--read-only','--pull=never','--cap-drop=ALL','--security-opt=no-new-privileges'])assert.ok(args.includes(flag));
  assert.ok(!args.some(a=>/--privileged|--no-sandbox|--network=host|docker.sock,/.test(a)));
  const mount=args.find(a=>a.endsWith(',dst=/manifest.json,readonly'))!,path=mount.slice('--mount=type=bind,src='.length,-',dst=/manifest.json,readonly'.length),manifest=JSON.parse(readFileSync(path,'utf8'));
  const proof:any=manifest.mode==='preflight'?{version:1,mode:'preflight',ready:true,browser:'Chrome/141.0.0.0',sandboxDisabled:mode==='unsafe',networkIsolated:true,credentialsExcluded:true}:{version:1,mode:'check',status:mode==='failed'?'failed':'passed',testsExecuted:true,browser:'Chrome/141.0.0.0',sandboxDisabled:false,pageErrors:0,blockedRequests:mode==='network'?1:0,caseSha256:mode==='wrong-contract'?'b'.repeat(64):contract.sha256,caseIds:mode==='missing-check'?contract.caseIds.slice(1):contract.caseIds,failures:mode==='failed'?[contract.caseIds[0]]:mode==='unknown-failure'?['unowned']:[]};
  return {code:manifest.mode==='check'&&mode==='failed'?1:0,stdout:mode==='malformed'?'bad':JSON.stringify(proof),stderr:'PRIVATE_SOURCE_MARKER_SHOULD_NOT_ESCAPE'};
 };
 return {process,runs:()=>runs,cleanups:()=>cleanups};
}
test('separate host contract preserves negative/decimal cases and exercises real UI events',()=>{
 const cases=JSON.parse(readFileSync(new URL('../config/calculator-input-browser/cases.json',import.meta.url),'utf8'));
 assert.equal(cases.find((c:any)=>c.id==='repeat-multiply').expected,'12');assert.equal(cases.find((c:any)=>c.id==='replace-multiply-plus').expected,'8');assert.equal(cases.find((c:any)=>c.id==='negative-right-preserved').expected,'-6');assert.equal(cases.find((c:any)=>c.id==='decimal-zero-preserved').expected,'0.05');assert.equal(new Set(contract.caseIds).size,contract.caseIds.length);assert.equal(contract.caseIds.length,25);
});
test('probe uses two isolated containers and a source-bound simulated proof grants no publication',async()=>{
 const f=fixture(),probe=createCalculatorInputBrowserProbeForTests(image,f.process),proof=await probe.run(input);
 assert.equal(proof.provenance,'simulated');assert.equal(proof.status,'passed');assert.equal(proof.publicationAuthorized,false);assert.equal(proof.executionAuthorized,false);assert.equal(f.runs(),2);assert.equal(f.cleanups(),2);assert.equal(JSON.stringify(proof).includes('PRIVATE_SOURCE_MARKER'),false);await assert.rejects(()=>probe.run(input),stopped);
});
test('real assertion failures remain failed rather than accepted or hidden as a successful probe',async()=>{
 const f=fixture('failed'),proof=await createCalculatorInputBrowserProbeForTests(image,f.process).run(input);assert.equal(proof.status,'failed');assert.deepEqual(proof.failures,[contract.caseIds[0]]);assert.equal(proof.testsExecuted,true);assert.equal(proof.wholeAppCompleted,false);
});
test('missing scenarios wrong contract failed isolation and malformed replies cannot become acceptance',async()=>{
 for(const mode of ['image-string','wrong-image','unsafe','network','wrong-contract','missing-check','unknown-failure','malformed']){const f=fixture(mode);await assert.rejects(()=>createCalculatorInputBrowserProbeForTests(image,f.process).run(input),stopped);}
});
test('unpinned images, unexpected files, incomplete or secret-bearing source stop before Docker',async()=>{
 assert.throws(()=>createCalculatorInputBrowserProbe('mcr.microsoft.com/playwright:latest'),stopped);
 for(const source of [new Map([...sources,['outside.mjs','bad']]),new Map([['index.html','only']]),new Map([...sources].map(([p,s])=>[p,p==='src/app.mjs'?'gsk_'+'a'.repeat(48):s]))]){const f=fixture();await assert.rejects(()=>createCalculatorInputBrowserProbeForTests(image,f.process).run({...input,sources:source}),stopped);assert.equal(f.runs(),0);}
});
