import test from 'node:test';import assert from 'node:assert/strict';import {recoverUncertainProject} from './project-uncertain-recovery.mjs';
test('missing independent host pin stops without reading approvals or calling any network',async()=>{
 const native=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No HTTP');};try{await assert.rejects(()=>recoverUncertainProject({}));await assert.rejects(()=>recoverUncertainProject({EXPECTED_RECOVERY_HOST_SHA256:'event-controlled'}));assert.equal(calls,0);}finally{globalThis.fetch=native;}
});
