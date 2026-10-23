import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALCULATOR_T02_EVENT_PREFLIGHT_ERROR, inspectCalculatorT02AfterCiEvent } from "./calculatorT02AfterCiEventPreflight.js";
import { calculatorAfterCiEventIdentity } from "./calculatorAfterCi.js";
import { CALCULATOR_T02_PRESELECTION_ERROR as ERROR,
  previewCalculatorT02Successor, calculatorT02TreeDeltaMatches } from "./calculatorT02SuccessorPreview.js";

test("t03 preview cannot accept JSON, missing host objects or absent reconciliation sidecar",async()=>{
  const root=mkdtempSync(join(tmpdir(),"t02-successor-preview-"));
  try {
    const sidecar=join(root,"sidecar");mkdirSync(sidecar,{mode:0o700});
    const bad={taskId:"calculator-pilot-step7-v1-34ee03-t02",resumeAuthorized:false};
    let reads=0;
    const reader={getHead:async()=>{reads++;return "a".repeat(40);}};
    const verifier=async()=>{reads++;return undefined;};
    await assert.rejects(()=>previewCalculatorT02Successor({} as any,reader as any,sidecar,bad as any,verifier),{message:ERROR});
    await assert.rejects(()=>previewCalculatorT02Successor({} as any,reader as any,sidecar,null as any,verifier),{message:ERROR});
    await assert.rejects(()=>previewCalculatorT02Successor({} as any,reader as any,sidecar,bad as any,{} as any),{message:ERROR});
    assert.equal(reads,0);
    assert.deepEqual(readdirSync(sidecar),[]);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test("event preflight rejects cloned preview, does not create event claims, and uses existing exact event identity",()=>{
  const root=mkdtempSync(join(tmpdir(),"t02-event-preflight-"));
  try{
    const events=join(root,"events");mkdirSync(events,{mode:0o700});
    const fake=Object.freeze({status:"candidate-preview-only",readOnly:true,executionAuthorized:false,
      publicationAuthorized:false,resumeAuthorized:false,budgetResetAuthorized:false,wholeStep8Closed:false,
      planFingerprint:"1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2",
      previousTaskId:"calculator-pilot-step7-v1-34ee03-t02",nextTaskId:"calculator-pilot-step7-v1-34ee03-t03",
      candidateSha:"949a0bf874722fd8cbd886c2cb0af8f2b502ac05"});
    const key=calculatorAfterCiEventIdentity({version:1,planFingerprint:fake.planFingerprint,
      previousTaskId:fake.previousTaskId,expectedNextTaskId:fake.nextTaskId,candidateSha:fake.candidateSha});
    assert.ok(key.id.startsWith("calc-after-ci-"));
    assert.throws(()=>inspectCalculatorT02AfterCiEvent(events,fake as never),
      {message:ERROR});
    assert.deepEqual(readdirSync(events),[]);
    writeFileSync(join(events,key.id+".lock"),"",{mode:0o600,flag:"wx"});
    assert.throws(()=>inspectCalculatorT02AfterCiEvent(events,structuredClone(fake) as never),
      {message:ERROR});
    assert.deepEqual(readdirSync(events),[key.id+".lock"]);
  }finally{rmSync(root,{recursive:true,force:true});}
});

// Public Git trees read at immutable t01 and t02 SHAs; no application source.
const observedTrees = {"before":[{"path":".github","mode":"040000","type":"tree","sha":"868804443b66382f2b46d7a6410d99bbb8fab804","url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/trees/868804443b66382f2b46d7a6410d99bbb8fab804"},{"path":".github/workflows","mode":"040000","type":"tree","sha":"1d084ff32d9f48375eec1e2ad555f7fa72fc1497","url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/trees/1d084ff32d9f48375eec1e2ad555f7fa72fc1497"},{"path":".github/workflows/calculator-setup-readiness.yml","mode":"100644","type":"blob","sha":"a58ba0a538ddd4eab09da02ae60e224944ccaae5","size":4808,"url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/blobs/a58ba0a538ddd4eab09da02ae60e224944ccaae5"},{"path":".github/workflows/calculator-task-ci.yml","mode":"100644","type":"blob","sha":"45fae4a292a04e89a631ad7ff2469a3af7265e70","size":2416,"url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/blobs/45fae4a292a04e89a631ad7ff2469a3af7265e70"},{"path":"README.md","mode":"100644","type":"blob","sha":"71076b4befd7df33685792a49930529ba39855b8","size":25,"url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/blobs/71076b4befd7df33685792a49930529ba39855b8"},{"path":"src","mode":"040000","type":"tree","sha":"8b30dceff6275666f1c34cd867a635a2c66c4bed","url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/trees/8b30dceff6275666f1c34cd867a635a2c66c4bed"},{"path":"src/calculator.mjs","mode":"100644","type":"blob","sha":"e80e4cf99b5f2f892a60af61e0b82293c33445b1","size":882,"url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/blobs/e80e4cf99b5f2f892a60af61e0b82293c33445b1"},{"path":"test","mode":"040000","type":"tree","sha":"369aa28015f4a325285eee043e82934c23c90bd6","url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/trees/369aa28015f4a325285eee043e82934c23c90bd6"},{"path":"test/calculator.test.mjs","mode":"100644","type":"blob","sha":"bfb51b49639454e37185178f542cc30b1bdb5a5f","size":1036,"url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/blobs/bfb51b49639454e37185178f542cc30b1bdb5a5f"}],"now":[{"path":".github","mode":"040000","type":"tree","sha":"868804443b66382f2b46d7a6410d99bbb8fab804","url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/trees/868804443b66382f2b46d7a6410d99bbb8fab804"},{"path":".github/workflows","mode":"040000","type":"tree","sha":"1d084ff32d9f48375eec1e2ad555f7fa72fc1497","url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/trees/1d084ff32d9f48375eec1e2ad555f7fa72fc1497"},{"path":".github/workflows/calculator-setup-readiness.yml","mode":"100644","type":"blob","sha":"a58ba0a538ddd4eab09da02ae60e224944ccaae5","size":4808,"url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/blobs/a58ba0a538ddd4eab09da02ae60e224944ccaae5"},{"path":".github/workflows/calculator-task-ci.yml","mode":"100644","type":"blob","sha":"45fae4a292a04e89a631ad7ff2469a3af7265e70","size":2416,"url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/blobs/45fae4a292a04e89a631ad7ff2469a3af7265e70"},{"path":"README.md","mode":"100644","type":"blob","sha":"71076b4befd7df33685792a49930529ba39855b8","size":25,"url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/blobs/71076b4befd7df33685792a49930529ba39855b8"},{"path":"index.html","mode":"100644","type":"blob","sha":"18150ee8ab02586759ec1ef341d83a5d4df0bd14","size":1344,"url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/blobs/18150ee8ab02586759ec1ef341d83a5d4df0bd14"},{"path":"src","mode":"040000","type":"tree","sha":"5278db460d68c340e25a055fe98e3fe50f0d1ed5","url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/trees/5278db460d68c340e25a055fe98e3fe50f0d1ed5"},{"path":"src/app.mjs","mode":"100644","type":"blob","sha":"a689c9778cbb75cf1bd1834dd3128408685d879c","size":1302,"url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/blobs/a689c9778cbb75cf1bd1834dd3128408685d879c"},{"path":"src/calculator.mjs","mode":"100644","type":"blob","sha":"e80e4cf99b5f2f892a60af61e0b82293c33445b1","size":882,"url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/blobs/e80e4cf99b5f2f892a60af61e0b82293c33445b1"},{"path":"styles.css","mode":"100644","type":"blob","sha":"9a8cb5e31edda435cf148fc5a692a8d2efdcabd6","size":564,"url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/blobs/9a8cb5e31edda435cf148fc5a692a8d2efdcabd6"},{"path":"test","mode":"040000","type":"tree","sha":"369aa28015f4a325285eee043e82934c23c90bd6","url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/trees/369aa28015f4a325285eee043e82934c23c90bd6"},{"path":"test/calculator.test.mjs","mode":"100644","type":"blob","sha":"bfb51b49639454e37185178f542cc30b1bdb5a5f","size":1036,"url":"https://api.github.com/repos/erman-ksv/Onay-Factory-Calculator/git/blobs/bfb51b49639454e37185178f542cc30b1bdb5a5f"}]};

const approved = ['index.html','styles.css','src/app.mjs'];
test('real t01 to t02 tree permits the derived src tree hash change', () => {
  assert.equal(calculatorT02TreeDeltaMatches(observedTrees.before, observedTrees.now, approved), true);
});
test('approved ancestor never permits unrelated blobs, tree hashes, removals or duplicate entries', () => {
  for (const path of ['src/calculator.mjs','.github/workflows/calculator-task-ci.yml','test','README.md']) {
    const altered=observedTrees.now.map(e=>e.path===path?{...e,sha:'a'.repeat(40)}:e);
    assert.equal(calculatorT02TreeDeltaMatches(observedTrees.before,altered,approved),false,path);
  }
  for (const path of ['src','test/calculator.test.mjs'])
    assert.equal(calculatorT02TreeDeltaMatches(observedTrees.before,observedTrees.now.filter(e=>e.path!==path),approved),false);
  assert.equal(calculatorT02TreeDeltaMatches(observedTrees.before,[...observedTrees.now,observedTrees.now[0]!],approved),false);
  assert.equal(calculatorT02TreeDeltaMatches(observedTrees.before,[...observedTrees.now,{path:'src/extra.mjs',mode:'100644',type:'blob',sha:'a'.repeat(40)}],approved),false);
});
test('ancestor and approved paths retain exact modes and types; symlinks and submodules refused', () => {
  for (const path of ['src','src/app.mjs','src/calculator.mjs'])
    for (const change of [{mode:'100755'},{mode:'120000',type:'blob'},{mode:'160000',type:'commit'}]) {
      const altered=observedTrees.now.map(e=>e.path===path?{...e,...change}:e);
      assert.equal(calculatorT02TreeDeltaMatches(observedTrees.before,altered,approved),false,path);
    }
});
