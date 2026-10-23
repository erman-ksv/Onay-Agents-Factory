import test from "node:test";
import assert from "node:assert/strict";
import { createCalculatorLiveBarrier } from "./calculatorLiveBarrier.js";
const config={runtimeSha:"a".repeat(40),sourceCiRunId:123,planFingerprint:"b".repeat(64),previousTaskId:"calculator-pilot-step7-v1-34ee03-t02",candidateSha:"c".repeat(40)};
const env={FACTORY_STATE_TOKEN:"fixture-secret",GITHUB_REPOSITORY:"erman-ksv/Onay-Agents-Factory",GITHUB_RUN_ATTEMPT:"1"};
function fixture(mode="ready") {
 let ref: any,posts=0;
 const transport:typeof fetch=async(url,init)=>{
  assert.ok(String(url).startsWith("https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/"));
  assert.equal(init?.redirect,"error");
  if(init?.method==="POST"){
   posts++;if(ref)return new Response("{}",{status:422});
   const b=JSON.parse(String(init.body));assert.ok(b.ref.startsWith("refs/heads/state/calculator-live-event/"));assert.equal(b.sha,config.runtimeSha);
   ref={ref:b.ref,object:{type:"commit",sha:b.sha}};
   if(mode==="lost-response")throw Error("Lost acknowledgement");
   return Response.json(ref,{status:201});
  }
  if(String(url).includes("/jobs?"))return Response.json({total_count:1,jobs:[{head_sha:config.runtimeSha,status:"completed",conclusion:"success",steps:["Typecheck","Test"].map(name=>({name,status:"completed",conclusion:mode==="missing-tests"&&name==="Test"?"skipped":"success"}))}]});
  if(String(url).includes("/actions/runs/"))return Response.json({head_sha:mode==="stale-source"?"d".repeat(40):config.runtimeSha,path:".github/workflows/ci.yml",run_attempt:1,status:"completed",conclusion:"success",repository:{full_name:env.GITHUB_REPOSITORY}});
  return ref?Response.json(ref):new Response("{}",{status:404});
 };
 return {transport,get posts(){return posts;}};
}
test("remote admission survives a new worker and cannot be claimed twice",async()=>{
 const f=fixture(),a=createCalculatorLiveBarrier(config,env,f.transport);assert.equal(await a.inspectAbsent(),true);
 await assert.rejects(()=>a.assertClaimed());await a.claim();await a.assertClaimed();await assert.rejects(()=>a.claim());
 const b=createCalculatorLiveBarrier(config,env,f.transport);assert.equal(await b.inspectAbsent(),false);await assert.rejects(()=>b.claim());assert.equal(f.posts,1);
});
test("simultaneous workers, different CI run and runtime do not purchase another event",async()=>{
 const f=fixture(),a=createCalculatorLiveBarrier(config,env,f.transport),b=createCalculatorLiveBarrier({...config,runtimeSha:"d".repeat(40),sourceCiRunId:124},env,f.transport);
 assert.equal(a.ref,b.ref);const results=await Promise.allSettled([a.claim(),createCalculatorLiveBarrier(config,env,f.transport).claim()]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
});
test("lost acknowledgement retains the remote lock and blocks restart without retry",async()=>{
 const f=fixture("lost-response"),a=createCalculatorLiveBarrier(config,env,f.transport);await assert.rejects(()=>a.claim());await assert.rejects(()=>a.claim());
 const b=createCalculatorLiveBarrier(config,env,f.transport);assert.equal(await b.inspectAbsent(),false);await assert.rejects(()=>b.claim());assert.equal(f.posts,1);
});
test("stale source CI, skipped tests and run attempt 2 refuse before a remote write",async()=>{
 for(const mode of ["stale-source","missing-tests"]){const f=fixture(mode);await assert.rejects(()=>createCalculatorLiveBarrier(config,env,f.transport).claim());assert.equal(f.posts,0);}
 assert.throws(()=>createCalculatorLiveBarrier(config,{...env,GITHUB_RUN_ATTEMPT:"2"}));
});
