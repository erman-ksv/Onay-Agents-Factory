import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createCalculatorLiveBarrier } from "./calculatorLiveBarrier.js";
const config={runtimeSha:"a".repeat(40),sourceCiRunId:123,planFingerprint:"b".repeat(64),previousTaskId:"calculator-pilot-step7-v1-34ee03-t02",candidateSha:"c".repeat(40)};
const env={FACTORY_STATE_TOKEN:"fixture-secret",GITHUB_REPOSITORY:"erman-ksv/Onay-Agents-Factory",GITHUB_RUN_ATTEMPT:"1"};
function fixture(mode="ready") {
 let ref: any,posts=0,treeSha="",commitSha="";
 const metadata: any[]=[];
 const gitHash=(kind:string,bytes:Buffer)=>createHash("sha1").update(Buffer.concat([Buffer.from(kind+" "+bytes.length+"\0"),bytes])).digest("hex");
 const transport:typeof fetch=async(url,init)=>{
  assert.ok(String(url).startsWith("https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/"));
  assert.equal(init?.redirect,"error");
  if(init?.method==="POST"){
   const b=JSON.parse(String(init.body));
   if(String(url).endsWith("/git/blobs")) {
    metadata.push(b);const m=JSON.parse(b.content);assert.equal(m.runtimeSha,config.runtimeSha);assert.equal(m.candidateSha,config.candidateSha);
    assert.deepEqual(Object.keys(m).sort(),["version","repository","eventKey","runtimeSha","sourceCiRunId","planFingerprint","previousTaskId","candidateSha"].sort());
    return Response.json({sha:gitHash("blob",Buffer.from(b.content))},{status:201});
   }
   if(String(url).endsWith("/git/trees")) {
    metadata.push(b);assert.equal(b.base_tree,undefined);assert.equal(b.tree.length,1);assert.equal(b.tree[0].path,"calculator-live-event.json");
    assert.equal(b.tree[0].mode,"100644");assert.equal(b.tree[0].type,"blob");
    treeSha=gitHash("tree",Buffer.concat([Buffer.from("100644 calculator-live-event.json\0"),Buffer.from(b.tree[0].sha,"hex")]));
    return Response.json({sha:treeSha},{status:201});
   }
   if(String(url).endsWith("/git/commits")) {
    metadata.push(b);assert.deepEqual(b.parents,[]);assert.equal(b.tree,treeSha);commitSha="e".repeat(40);
    return Response.json({sha:commitSha,tree:{sha:treeSha},parents:[]},{status:201});
   }
   posts++;if(mode==="forbidden")return new Response("PRIVATE_UPSTREAM_BODY",{status:403});if(ref)return new Response("{}",{status:422});
   assert.ok(b.ref.startsWith("refs/heads/state/calculator-live-event/"));assert.equal(b.sha,commitSha);assert.notEqual(b.sha,config.runtimeSha);
   ref={ref:b.ref,object:{type:"commit",sha:b.sha}};
   if(mode==="lost-response")throw Error("Lost acknowledgement");
   return Response.json(ref,{status:201});
  }
  if(String(url).includes("/actions/jobs/456"))return Response.json({id:456,run_id:mode==="details-wrong-run"?124:123,run_attempt:1,head_sha:config.runtimeSha,status:"completed",conclusion:"success",steps:mode==="details-still-empty"?[]:["Typecheck","Test"].map(name=>({name,status:"completed",conclusion:mode==="details-skipped"&&name==="Test"?"skipped":"success"}))});
  if(String(url).includes("/jobs?")&&mode.startsWith("details-"))return Response.json({total_count:1,jobs:[{id:456,run_id:123,head_sha:config.runtimeSha,status:"completed",conclusion:"success",steps:[]}]});
  if(String(url).includes("/jobs?"))return Response.json({total_count:1,jobs:[{head_sha:config.runtimeSha,status:"completed",conclusion:"success",steps:["Typecheck","Test"].map(name=>({name,status:"completed",conclusion:mode==="missing-tests"&&name==="Test"?"skipped":"success"}))}]});
  if(String(url).includes("/actions/runs/"))return Response.json({head_sha:mode==="stale-source"?"d".repeat(40):config.runtimeSha,path:".github/workflows/ci.yml",run_attempt:1,status:"completed",conclusion:"success",repository:{full_name:env.GITHUB_REPOSITORY}});
  return ref?Response.json(ref):new Response("{}",{status:404});
 };
 return {transport,metadata,get posts(){return posts;}};
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

test("HTTP refusal reports only bounded status and phase; it never exposes response bodies or retries",async()=>{
 const f=fixture("forbidden"),barrier=createCalculatorLiveBarrier(config,env,f.transport);
 await assert.rejects(()=>barrier.claim(),(error:any)=>{
  assert.equal(error.code,"live_barrier_remote_compare_create");assert.equal(error.httpStatus,403);
  assert.equal(JSON.stringify(error).includes("PRIVATE_UPSTREAM_BODY"),false);
  assert.equal(error.message.includes("PRIVATE_UPSTREAM_BODY"),false);return true;
 });
 await assert.rejects(()=>barrier.claim());assert.equal(f.posts,1);
});

test("durable marker has only SHA metadata and an orphan tree; no workflow/source permission is requested",async()=>{
 const f=fixture();await createCalculatorLiveBarrier(config,env,f.transport).claim();
 assert.equal(f.metadata.length,3);assert.deepEqual(f.metadata[2].parents,[]);
 assert.equal(f.metadata[1].tree[0].path,"calculator-live-event.json");
 assert.equal(JSON.stringify(f.metadata).includes("fixture-secret"),false);
});

test("empty CI list steps require exact-job successful checks, never inferred approval",async()=>{
 const ready=fixture("details-ready");await createCalculatorLiveBarrier(config,env,ready.transport).claim();assert.equal(ready.posts,1);
 for(const mode of ["details-wrong-run","details-still-empty","details-skipped"]){const f=fixture(mode);await assert.rejects(()=>createCalculatorLiveBarrier(config,env,f.transport).claim());assert.equal(f.posts,0);}
});
