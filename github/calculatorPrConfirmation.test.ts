import test from 'node:test';import assert from 'node:assert/strict';
import {CALCULATOR_PROFILE} from '../config/calculatorProfile.js';
import {confirmCalculatorDraftPublication} from './calculatorPrConfirmation.js';
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),scope={repository:CALCULATOR_PROFILE.repository,branch:'feat/agent-candidate',baseRef:'feat/owner-bootstrap',baseSha:A};
const pr=(sha=B)=>({number:1,html_url:'https://github.com/'+scope.repository+'/pull/1',state:'open',draft:true,head:{ref:scope.branch,sha,repo:{full_name:scope.repository as string}},base:{ref:scope.baseRef,sha:A,repo:{full_name:scope.repository as string}}});
test('stale PR metadata may converge only to exact candidate without publication or model actions',async()=>{
 let reads=0,checks=0;const waits:number[]=[];const result=await confirmCalculatorDraftPublication(scope,B,A,1,{readDetail:async()=>pr(++reads<3?A:B),assertCurrent:async()=>{checks++;},wait:async ms=>{waits.push(ms);}});
 assert.equal(result.headSha,B);assert.equal(reads,3);assert.equal(checks,6);assert.deepEqual(waits,[250,750]);assert.equal('publicationAuthorized' in result,false);
});
test('exact fresh metadata needs one read and no wait',async()=>{
 let reads=0;const result=await confirmCalculatorDraftPublication(scope,B,A,1,{readDetail:async()=>{reads++;return pr();},assertCurrent:async()=>{},wait:async()=>{assert.fail('No delay for current head');}});assert.equal(result.headSha,B);assert.equal(reads,1);
});
test('permanent stale detail stops at four reads and three bounded waits',async()=>{
 let reads=0,waits=0;await assert.rejects(()=>confirmCalculatorDraftPublication(scope,B,A,1,{readDetail:async()=>{reads++;return pr(A);},assertCurrent:async()=>{},wait:async()=>{waits++;}}));assert.equal(reads,4);assert.equal(waits,3);
});
test('foreign SHA, wrong PR, unsafe scope and lost Draft never receive another GET',async t=>{
 for(const kind of ['foreign-sha','pr-number','closed','not-draft','merged','head-repo','base-repo','head-ref','base-ref','base-sha','url'])await t.test(kind,async()=>{
  const value=pr(A);if(kind==='foreign-sha')value.head.sha=C;if(kind==='pr-number')value.number=2;if(kind==='closed')value.state='closed';if(kind==='not-draft')value.draft=false;if(kind==='merged')Object.assign(value,{merged:true});if(kind==='head-repo')value.head.repo.full_name='other/repo';if(kind==='base-repo')value.base.repo.full_name='other/repo';if(kind==='head-ref')value.head.ref='main';if(kind==='base-ref')value.base.ref='main';if(kind==='base-sha')value.base.sha=C;if(kind==='url')value.html_url='https://other.invalid/pull/1';
  let reads=0;await assert.rejects(()=>confirmCalculatorDraftPublication(scope,B,A,1,{readDetail:async()=>{reads++;return value;},assertCurrent:async()=>{},wait:async()=>{assert.fail('Unsafe detail must not wait');}}));assert.equal(reads,1);
 });
});
test('a changed authoritative ref during confirmation stops before more reads',async()=>{
 let reads=0,checks=0;await assert.rejects(()=>confirmCalculatorDraftPublication(scope,B,A,1,{readDetail:async()=>{reads++;return pr(A);},assertCurrent:async()=>{if(++checks===3)throw Error('Ref moved');},wait:async()=>{}}));assert.equal(reads,1);
});
test('HTTP, timeout or parse refusal is terminal even after one successful stale read',async()=>{
 for(const message of ['HTTP 429','HTTP 403','timeout','invalid JSON']){let reads=0;await assert.rejects(()=>confirmCalculatorDraftPublication(scope,B,A,1,{readDetail:async()=>{if(++reads===1)return pr(A);throw Error(message);},assertCurrent:async()=>{},wait:async()=>{}}));assert.equal(reads,2);}
});
