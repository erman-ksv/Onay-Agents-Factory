import test from 'node:test';import assert from 'node:assert/strict';
import {projectTaskFailureDiagnostic as diagnostic} from './projectTaskFailureDiagnostic.js';
test('distinguishes a charged pre-HTTP stop from a sent provider failure',()=>{
 const before=diagnostic({stage:'post-checkpoint-guard',reasonCode:'task_timeout',providerCallsSent:0,attemptedRequests:1});
 assert.equal(before.providerCallsSent,0);assert.equal(before.attemptedRequests,1);assert.equal(before.stage,'post-checkpoint-guard');
 const sent=diagnostic({stage:'http',reasonCode:'rate_limited',providerCallsSent:1,attemptedRequests:1});assert.equal(sent.providerCallsSent,1);assert.equal(sent.reasonCode,'rate_limited');assert.equal(sent.replayAuthorized,false);
});
test('private source, provider bodies and arbitrary error text are excluded',()=>{
 const privateText='PRIVATE_SOURCE_SENTINEL';const v=diagnostic({stage:privateText,reasonCode:privateText,content:privateText,apiKey:privateText,error:privateText,providerCallsSent:privateText});
 assert.equal(JSON.stringify(v).includes(privateText),false);assert.equal(v.stage,'unclassified');assert.equal(v.providerCallsSent,null);
});
test('malformed or excessive counters cannot masquerade as execution evidence',()=>{
 for(const value of [null,{}, {providerCallsSent:-1,attemptedRequests:Infinity,totalRequestBytes:1.2,reservedRunTokens:16000001}]){const v=diagnostic(value);assert.equal(v.providerCallsSent,null);assert.equal(v.executionAuthorized,false);}
});
test('last observed HTTP status is bounded numeric metadata, never provider text or proof of outcome',()=>{
 for(const status of [200,400,401,429,503])assert.equal(diagnostic({lastProviderHttpStatus:status}).lastProviderHttpStatus,status);
 for(const status of [undefined,null,99,600,401.5,'401','PRIVATE_SOURCE_SENTINEL']){const r=diagnostic({lastProviderHttpStatus:status});assert.equal(r.lastProviderHttpStatus,null);assert.equal(r.executionAuthorized,false);assert.equal(JSON.stringify(r).includes('PRIVATE_SOURCE_SENTINEL'),false);}
});
test('post-HTTP rejection exposes only whitelisted host stage and reason, never the rejected response',()=>{
 const value={stage:'done',lastProviderHttpStatus:200,failedReplyStage:'author-proposal',failedReplyRole:'author',replyRejectionReason:'reply-rejected',changeRejectionCode:'bounded-patch',rejectedReplyCheckpoint:'persisted',content:'PRIVATE_REPLY_MARKER'},d=diagnostic(value);assert.equal(d.failedReplyStage,'author-proposal');assert.equal(d.changeRejectionCode,'bounded-patch');assert.equal(d.rejectedReplyCheckpoint,'persisted');assert.equal(d.executionAuthorized,false);assert.equal(JSON.stringify(d).includes('PRIVATE_REPLY_MARKER'),false);
 for(const key of ['failedReplyStage','failedReplyRole','replyRejectionReason','changeRejectionCode','rejectedReplyCheckpoint'])assert.equal(JSON.stringify(diagnostic({...value,[key]:'PRIVATE_REPLY_MARKER'})).includes('PRIVATE_REPLY_MARKER'),false);
});
