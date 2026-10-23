import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {loadCalculatorSnapshot} from '../github/calculatorSnapshot.js';import {prepareCalculatorRoleChanges} from '../commander/calculatorTeam.js';import {prepareUnpublishedCalculatorCorrection as prepare} from './calculatorUnpublishedCorrection.js';
const sha='a'.repeat(40),path='test/ui.test.mjs',content='export const text = /\\d/.test("1");\n',next='export const text = true;\n';
async function fixture(exists=false){const source='export const original=true;\n',blob=createHash('sha1').update('blob '+Buffer.byteLength(source)+'\0'+source).digest('hex');
 const snapshot=await loadCalculatorSnapshot({repository:'erman-ksv/Onay-Factory-Calculator',baseRef:'feat/calculator-agent/calculator-pilot-step7-v1',baseSha:sha,changePaths:[path,"src/app.mjs"]},{getHead:async()=>sha,readCommit:async()=>({sha,treeSha:sha}),readTree:async()=>({sha,truncated:false,tree:exists?[{path:'test',type:'tree',mode:'040000',sha},{path,type:'blob',mode:'100644',sha:blob}]:[]}),readBlob:async()=>({sha:blob,encoding:'base64',content:Buffer.from(source).toString('base64')})});
 const previous=prepareCalculatorRoleChanges('frontend',{summary:'Unpublished fixture',changes:[exists?{operation:'patch',path,sourceSha256:createHash('sha256').update(source).digest('hex'),edits:[{before:source,after:content}],message:'Fixture'}:{operation:'create',path,content,message:'Fixture'}]},snapshot);
 const raw={summary:'Agent correction',changes:[{operation:'patch',path,sourceSha256:createHash('sha256').update(content).digest('hex'),edits:[{before:content.replace(/\\/g,'\\\\'),after:next}],message:'Correct unpublished file'}]};return {snapshot,previous,raw};}
test('exact escaped whole-file anchor of an agent-created absent file preserves the returned after bytes',async()=>{const f=await fixture();const p=prepare(f.raw,f.previous,f.snapshot);assert.equal(p.files[0]!.content,next);assert.equal(JSON.parse(p.reviewEvidence).changes[0].operation,'create');assert.equal(p.gates.publicationAuthorized,false);});
test('no decoding/fallback for existing files, mismatched SHA, partial/fuzzy anchors or cloned absence evidence',async()=>{const f=await fixture();const existing=await fixture(true);assert.throws(()=>prepare(existing.raw,existing.previous,existing.snapshot));
 for(const mutate of [(r:any)=>r.changes[0].sourceSha256='0'.repeat(64),(r:any)=>r.changes[0].edits[0].before+=' ',(r:any)=>r.changes[0].edits[0].before='fragment',(r:any)=>r.changes[0].path='../outside']){const r=structuredClone(f.raw);mutate(r);assert.throws(()=>prepare(r,f.previous,f.snapshot));}
 assert.throws(()=>prepare(f.raw,f.previous,structuredClone(f.snapshot)));
});

test('correction carries unrelated agent changes unchanged and never transfers approvals',async()=>{
 const f=await fixture();
 const untouched={operation:'create',path:'src/app.mjs',content:'export const unchanged = true;\n',message:'Keep prior agent change'};
 const original=JSON.parse(f.previous.reviewEvidence).changes[0];
 const previous=prepareCalculatorRoleChanges('frontend',{summary:f.previous.summary,changes:[{operation:'create',path,content:original.content,message:'Fixture'},untouched]},f.snapshot);
 const corrected=prepare(f.raw,previous,f.snapshot);
 assert.deepEqual(corrected.files.find(v=>v.path==='src/app.mjs'),previous.files.find(v=>v.path==='src/app.mjs'));
 assert.deepEqual(JSON.parse(corrected.reviewEvidence).changes[1],JSON.parse(previous.reviewEvidence).changes[1]);
 assert.equal(corrected.gates.independentReview,'required');assert.equal(corrected.gates.tests,'required');assert.equal(corrected.gates.publicationAuthorized,false);
});
