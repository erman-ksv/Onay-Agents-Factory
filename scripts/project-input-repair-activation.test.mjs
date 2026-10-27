import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {activateInputRepairBudget,MANIFEST_SHA256} from './project-input-repair-activation.mjs';
import {prepareProjectRuntimeManifest,projectRuntimeManifestMetadata} from '../orchestration/projectRuntimeManifest.js';
const body=readFileSync(new URL('../.factory/runtime-project-manifest.json',import.meta.url),'utf8');
const base={GITHUB_REPOSITORY:'erman-ksv/Onay-Agents-Factory',GITHUB_RUN_ATTEMPT:'1',AGENT_FACTORY_LEGAL_ENABLED:'false',FACTORY_STATE_TOKEN:'offline-test-only'};
async function isolated(content,operation){
  const previous=process.cwd(),directory=mkdtempSync(join(tmpdir(),'input-repair-activation-test-')),native=globalThis.fetch,requests=[];
  mkdirSync(join(directory,'.factory'));writeFileSync(join(directory,'.factory/runtime-project-manifest.json'),content);
  globalThis.fetch=async(url,init)=>{requests.push({url,method:init?.method});return new Response('{}',{status:403});};
  try{process.chdir(directory);await operation(requests);}finally{process.chdir(previous);globalThis.fetch=native;rmSync(directory,{recursive:true,force:true});}
}
test('approved manifest rebuilds native host policies but grants no execution by parsing',()=>{
  const cap=prepareProjectRuntimeManifest(body,MANIFEST_SHA256),m=projectRuntimeManifestMetadata(cap);
  assert.equal(m.executionAuthorized,false);assert.equal(m.mode,'first-task');assert.equal(m.taskIds.length,2);
  assert.throws(()=>projectRuntimeManifestMetadata(JSON.parse(JSON.stringify(cap))));
});
test('changed owner decision is rejected before any network request',async()=>{
  const v=JSON.parse(body);v.decision.commentId++;
  await isolated(JSON.stringify(v),async requests=>{await assert.rejects(activateInputRepairBudget(base));assert.equal(requests.length,0);});
});
test('provider credentials are refused before owner reads or ledger writes',async()=>{
  await isolated(body,async requests=>{await assert.rejects(activateInputRepairBudget({...base,GROQ_API_KEY:'offline-test-only'}));assert.equal(requests.length,0);});
});
test('Actions rerun cannot initialize the new ledger',async()=>{
  await isolated(body,async requests=>{await assert.rejects(activateInputRepairBudget({...base,GITHUB_RUN_ATTEMPT:'2'}));assert.equal(requests.length,0);});
});
test('unverified native history fails with GET only and never initializes',async()=>{
  await isolated(body,async requests=>{await assert.rejects(activateInputRepairBudget(base));assert.ok(requests.length>0);assert.ok(requests.every(r=>r.method==='GET'));assert.ok(requests.every(r=>String(r.url).startsWith('https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/')));});
});
