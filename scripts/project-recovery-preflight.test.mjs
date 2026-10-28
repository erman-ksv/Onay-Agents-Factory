import test from 'node:test';import assert from 'node:assert/strict';import {inspectRecoveryPreflight} from './project-recovery-preflight.mjs';
const env={GITHUB_REPOSITORY:'erman-ksv/Onay-Agents-Factory',GITHUB_RUN_ATTEMPT:'1',AGENT_FACTORY_LEGAL_ENABLED:'false',ONAY_TEAM_FREE_TIER_CONFIRMED:'true',FACTORY_STATE_TOKEN:'offline'};
test('entrypoint refuses provider keys and Actions reruns before any network',async()=>{
 const native=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No network');};try{for(const extra of [{GROQ_API_KEY:'offline'},{GITHUB_RUN_ATTEMPT:'2'}])await assert.rejects(()=>inspectRecoveryPreflight({...env,...extra}));assert.equal(calls,0);}finally{globalThis.fetch=native;}
});
test('entrypoint keeps native rejection read-only and restores transport after failure',async()=>{
 const native=globalThis.fetch;let calls=0;const mocked=async(_url,init)=>{calls++;assert.equal(init?.method,'GET');assert.equal(init?.body,undefined);return Response.json({},{status:403});};globalThis.fetch=mocked;try{await assert.rejects(()=>inspectRecoveryPreflight(env));assert.ok(calls>0);assert.equal(globalThis.fetch,mocked);}finally{globalThis.fetch=native;}
});
