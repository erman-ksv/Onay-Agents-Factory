import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {prepareProjectRecoveryPreflight as prepare,runProjectRecoveryPreflight as run} from './projectRecoveryPreflight.js';
const runtime=readFileSync(new URL('../.factory/runtime-project-manifest.json',import.meta.url),'utf8'),body=readFileSync(new URL('../.factory/recovery-preflight.json',import.meta.url),'utf8'),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const env={GITHUB_REPOSITORY:'erman-ksv/Onay-Agents-Factory',GITHUB_RUN_ATTEMPT:'1',AGENT_FACTORY_LEGAL_ENABLED:'false',ONAY_TEAM_FREE_TIER_CONFIRMED:'true',FACTORY_STATE_TOKEN:'offline-only'};
test('outer and nested byte pins bind the recovery scope and every existing host policy',()=>{
 assert.ok(prepare(body,hash(body),runtime));assert.throws(()=>prepare(body,'0'.repeat(64),runtime));assert.throws(()=>prepare(body,hash(body),runtime+' '));
 const v=JSON.parse(body);for(const change of [{kind:'first-task'},{extra:true},{budgetHead:'bad'},{binding:{...v.binding,taskId:'other'}},{binding:{...v.binding,archiveSequence:3}}]){const s=JSON.stringify({...v,...change});assert.throws(()=>prepare(s,hash(s),runtime));}
});
test('copied capabilities, provider keys, reruns and live flags cannot start preflight or HTTP',async()=>{
 const transport=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No HTTP allowed');};try{await assert.rejects(()=>run({...prepare(body,hash(body),runtime)},env));for(const extra of [{GROQ_API_KEY:'offline'},{GITHUB_RUN_ATTEMPT:'2'},{AGENT_FACTORY_LEGAL_ENABLED:'true'},{ONAY_TEAM_FREE_TIER_CONFIRMED:'false'}])await assert.rejects(()=>run(prepare(body,hash(body),runtime),{...env,...extra}));assert.equal(calls,0);}finally{globalThis.fetch=transport;}
});
test('unverified native authorization uses GET only, cannot initialize and cannot reuse a consumed preflight',async()=>{
 const transport=globalThis.fetch;let calls=0;globalThis.fetch=async(_url,init)=>{calls++;assert.equal(init?.method,'GET');assert.equal(init?.body,undefined);return Response.json({},{status:403});};try{const cap=prepare(body,hash(body),runtime);await assert.rejects(()=>run(cap,env));assert.ok(calls>0);const before=calls;await assert.rejects(()=>run(cap,env));assert.equal(calls,before);}finally{globalThis.fetch=transport;}
});
