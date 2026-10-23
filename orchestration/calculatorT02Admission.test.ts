import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitHistoricalT02OneSuccessor, createHistoricalT03ExecutionCallback, consumeCalculatorT02ExecutionPermit } from "./calculatorT02Admission.js";

test("historical admission never consumes an event or calls models from unbranded JSON",async()=>{
 const root=mkdtempSync(join(tmpdir(),"calculator-historical-admission-"));
 try{
  const events=join(root,"events");mkdirSync(events,{mode:0o700});
  let calls=0;
  const stop=async()=>{calls++;throw Error("untrusted callback must not execute");};
  const options={eventDirectory:events,ci:stop,verifyDependencies:stop,persistBarrier:stop,executeOne:stop};
  const forged={previousTaskId:"calculator-pilot-step7-v1-34ee03-t02",
   nextTaskId:"calculator-pilot-step7-v1-34ee03-t03",readOnly:true,executionAuthorized:false};
  const result=await admitHistoricalT02OneSuccessor({} as never,{} as never,forged as never,options as never);
  assert.equal(result.status,"blocked");assert.equal(result.callbackInvoked,false);
  assert.equal(result.failurePhase,"preview");
  assert.equal(result.wholeStep8Closed,false);assert.equal(calls,0);
  assert.deepEqual(readdirSync(events),[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("forged permit and absent execution tools cannot start a historic successor",async()=>{
 const fake={kind:"t02-to-t03-admitted"} as const;
 assert.throws(()=>consumeCalculatorT02ExecutionPermit({} as never,fake),/admission refused/);
 let invoked=0;
 const callback=createHistoricalT03ExecutionCallback({
   team:{} as never,tools:{} as never,verifyDependencies:async()=>{invoked++;return undefined;},
   execution:"offline-test",
 });
 await assert.rejects(()=>callback("calculator-pilot-step7-v1-34ee03-t03",{} as never,fake),
   /admission refused/);
 assert.equal(invoked,0);
});
