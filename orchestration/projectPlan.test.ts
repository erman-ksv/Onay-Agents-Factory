import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createProjectTargetRegistry,type ProjectTargetDefinition} from './projectTargetRegistry.js';
import {prepareProjectGoal,createProjectPlan,projectPlanTaskId,projectPlanTarget,projectPlanBudgetIdentity,buildProjectPlanningContext,PROJECT_PLAN_ERROR} from './projectPlan.js';
import {createProjectExecutionAdmission,consumeProjectExecutionAdmission,PROJECT_EXECUTION_ADMISSION_ERROR} from './projectExecutionAdmission.js';
import {authorizeProjectBudget,reconcileProjectBudgetHistory,projectBudgetApprovalDigest,type ProjectBudgetHistory} from './projectBudgetAuthorization.js';
import {createProjectModelBudgetFileStore} from './projectModelBudgetFileStore.js';
import {createHash} from 'node:crypto';
import {createProjectTaskModelTransport,PROJECT_TASK_MODEL_ERROR,type ProjectRequestCheckpoint} from './projectTaskModelTransport.js';

function fixture(repository='example/notes'){
 const d:ProjectTargetDefinition={version:1,id:'notes',repository,writablePaths:['index.html','src/app.mjs','test/app.test.mjs'],branchPrefix:'feat/notes-agent/',requiredCiNames:['Notes task CI'],requiredCiSteps:['Syntax','Task tests'],requiredActors:['security','reviewer','tester'],maxFiles:3,maxSourceBytes:131072,maxNewFileBytes:8192,maxChangedCharacters:6000,maxReviewBytes:12000,legalEnabled:false,mergesEnabled:false};
 const registry=createProjectTargetRegistry([d]),target=registry.select('notes'),request={version:1,id:'notes-pilot',goal:'Create a small application for adding and deleting notes.',baseRef:'feat/bootstrap',baseSha:'1'.repeat(40),provider:'groq',acceptance:[{id:'create-item',scenario:'Adding a note shows the new item.'},{id:'delete-item',scenario:'Deleting a note removes the item.'}],requiredPaths:['index.html','src/app.mjs','test/app.test.mjs']};
 const goal=prepareProjectGoal(target,request),proposal={tasks:[{id:projectPlanTaskId(goal,1),role:'coder',goal:'Implement note operations and state.',acceptanceIds:['create-item'],paths:['src/app.mjs'],dependsOn:[] as string[]},{id:projectPlanTaskId(goal,2),role:'frontend',goal:'Connect interface and test both note operations.',acceptanceIds:['create-item','delete-item'],paths:['index.html','test/app.test.mjs'],dependsOn:[projectPlanTaskId(goal,1)]}],blockers:[] as string[],unverifiedAreas:['Real source contents have not been inspected.']};
 return{d,target,request,goal,proposal,plan:()=>createProjectPlan(goal,proposal)};
}
const planRefusal=(e:unknown)=>e instanceof Error&&e.message===PROJECT_PLAN_ERROR;
const admissionRefusal=(e:unknown)=>e instanceof Error&&e.message===PROJECT_EXECUTION_ADMISSION_ERROR;
async function authorized(f=fixture(),mode:'development'|'read-only-review'='development',maxRequests=8){
 const plan=f.plan(),identity=projectPlanBudgetIdentity(plan),history:ProjectBudgetHistory={version:1,projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,observations:['planning',...identity.taskIds].map(scopeId=>({scopeId,kind:'cumulative-scope-total',charge:{requests:0,requestBytes:0,reservedTokens:0},evidenceSha256:'c'.repeat(64)}))};
 const h=reconcileProjectBudgetHistory(history,identity),document={version:1,kind:'authorize-project-model-budget',mode,grant:{version:1,projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,grantId:'offline-only-project-plan',maxRequests,maxRequestBytes:24000,maxTotalRequestBytes:192000,maxReservedTokens:48000,historical:h.charge,historicalEvidenceSha256:h.digest,provider:'groq',freeTierConfirmed:true,legalEnabled:false},targetProfileSha256:plan.targetProfileSha256,expiresAt:'2026-10-27T12:00:00.000Z'};
 const comment={id:321,user:{login:'erman-ksv',type:'User'},author_association:'OWNER',issue_url:'https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/75',html_url:'https://github.com/erman-ksv/Onay-Agents-Factory/pull/75#issuecomment-321',created_at:'2026-10-26T11:00:00Z',updated_at:'2026-10-26T11:00:00Z',body:JSON.stringify(document)};
 const root=mkdtempSync(join(tmpdir(),'project-plan-admission-')),store=createProjectModelBudgetFileStore(root);let ownerReads=0;
 const transport:typeof fetch=async(url,init)=>{ownerReads++;assert.equal(String(url),'https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/comments/321');assert.equal(init?.method,'GET');return Response.json(comment);};
 const authorizationOptions={identity,history,decision:{issueNumber:75,commentId:321,bodySha256:projectBudgetApprovalDigest(document)},targetProfile:f.target,token:'offline-owner-token',store,transport,now:()=>Date.parse('2026-10-26T12:00:00Z')};
 const controller=await authorizeProjectBudget(authorizationOptions);await controller.initialize();
 return{...f,plan,controller,comment,store,authorizationOptions,ownerReads:()=>ownerReads,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
const guards=()=>({assertSource:async()=>{},assertDependencies:async()=>{}});

test('generic goal derives repository, criteria digest, branch and IDs from a genuine profile',()=>{
 const f=fixture(),plan=f.plan();assert.equal(plan.repository,'example/notes');assert.equal(plan.branch,'feat/notes-agent/notes-pilot');assert.equal(plan.status,'planned');assert.equal(plan.executionAuthorized,false);assert.equal(plan.publicationAuthorized,false);assert.equal(projectPlanTarget(plan),f.target);assert.deepEqual(projectPlanBudgetIdentity(plan).taskIds,plan.tasks.map(t=>t.id));assert.ok(Object.isFrozen(plan.tasks[0]!.paths));
 f.proposal.tasks[0]!.goal='Mutated task goal';assert.notEqual(plan.tasks[0]!.goal,f.proposal.tasks[0]!.goal);assert.equal(createProjectPlan(f.goal,JSON.parse(JSON.stringify({...f.proposal,tasks:plan.tasks}))).fingerprint,plan.fingerprint);
});
test('model cannot supply repository, branch, criteria, task IDs, role or foreign paths',()=>{
 for(const mode of ['repository','branch','criteria','id','role','path']){const f=fixture(),p:any=JSON.parse(JSON.stringify(f.proposal));if(['repository','branch','criteria'].includes(mode))p[mode]='untrusted';if(mode==='id')p.tasks[0].id='model-chosen-id';if(mode==='role')p.tasks[0].role='security';if(mode==='path')p.tasks[0].paths=['.github/workflows/change.yml'];assert.throws(()=>createProjectPlan(f.goal,p),planRefusal);}
 const f=fixture();assert.throws(()=>prepareProjectGoal({} as any,f.request),planRefusal);assert.throws(()=>createProjectPlan({...f.goal},f.proposal),planRefusal);assert.throws(()=>projectPlanBudgetIdentity(JSON.parse(JSON.stringify(f.plan()))),planRefusal);
});
test('unknown dependencies, cycles and unordered overlapping files are refused',()=>{
 for(const mode of ['unknown','cycle','overlap']){const f=fixture();if(mode==='unknown')f.proposal.tasks[1]!.dependsOn=['unknown'];if(mode==='cycle')f.proposal.tasks[0]!.dependsOn=[f.proposal.tasks[1]!.id];if(mode==='overlap'){f.proposal.tasks[1]!.paths.push('src/app.mjs');f.proposal.tasks[1]!.dependsOn=[];}assert.throws(()=>f.plan(),planRefusal);}
});
test('missing criteria, missing required files and reported blockers remain explicitly blocked',()=>{
 for(const mode of ['criteria','path','blocker','empty']){const f=fixture();if(mode==='criteria')f.proposal.tasks[1]!.acceptanceIds=['create-item'];if(mode==='path')f.proposal.tasks[1]!.paths=['index.html'];if(mode==='blocker')f.proposal.blockers=['Source contract needs confirmation.'];if(mode==='empty')f.proposal.tasks=[];const p=f.plan();assert.equal(p.status,'blocked');assert.ok(p.blockers.length>0);assert.equal(p.wholeAppCompleted,false);}
});
test('goal and plan fingerprints bind profile, criteria and task contents',()=>{
 const a=fixture(),b=fixture('example/other');assert.notEqual(a.goal.ownerFingerprint,b.goal.ownerFingerprint);assert.notEqual(a.plan().fingerprint,b.plan().fingerprint);
 const changed=prepareProjectGoal(a.target,{...a.request,acceptance:[{id:'create-item',scenario:'A different required behavior must be confirmed.'},a.request.acceptance[1]]});assert.notEqual(changed.requirementsSha256,a.goal.requirementsSha256);assert.notEqual(changed.ownerFingerprint,a.goal.ownerFingerprint);
 const before=a.plan().fingerprint;a.proposal.tasks[0]!.goal='Implement an updated note state contract.';assert.notEqual(a.plan().fingerprint,before);
});
test('planning context is bounded metadata with explicit uncertainty and no executable status',()=>{
 const f=fixture(),s=buildProjectPlanningContext(f.goal),d=JSON.parse(s);assert.equal(d.repository,'example/notes');assert.equal(d.exactTaskIds.length,8);assert.deepEqual(d.fixedAcceptance,f.request.acceptance);assert.ok(Buffer.byteLength(s)<=16000);assert.equal(Object.hasOwn(d,'source'),false);assert.equal(Object.hasOwn(d,'executionAuthorized'),false);assert.throws(()=>buildProjectPlanningContext({...f.goal}),planRefusal);
});
test('getters, sparse/huge arrays and oversized planner data refuse without evaluating getters',()=>{
 const f=fixture();let reads=0;const goal={...f.request};Object.defineProperty(goal,'goal',{enumerable:true,get(){reads++;return 'PRIVATE_SOURCE';}});assert.throws(()=>prepareProjectGoal(f.target,goal),planRefusal);
 const tasks:any[]=[f.proposal.tasks[0]];Object.defineProperty(tasks,'0',{enumerable:true,get(){reads++;return f.proposal.tasks[0];}});assert.throws(()=>createProjectPlan(f.goal,{...f.proposal,tasks}),planRefusal);assert.equal(reads,0);
 assert.throws(()=>createProjectPlan(f.goal,{...f.proposal,tasks:new Array(1000000)}),planRefusal);assert.throws(()=>createProjectPlan(f.goal,{...f.proposal,unverifiedAreas:['x'.repeat(25000)]}),planRefusal);
});
test('planning context overflow fails safely instead of trimming required evidence',()=>{
 const f=fixture(),paths=Array.from({length:64},(_,i)=>'src/'+String(i).padStart(2,'0')+'x'.repeat(230)+'.mjs'),target=createProjectTargetRegistry([{...f.d,writablePaths:paths}]).select('notes');const goal=prepareProjectGoal(target,{...f.request,requiredPaths:paths.slice(0,4)});assert.throws(()=>buildProjectPlanningContext(goal),planRefusal);
});
test('native development controller admits a one-use plan-bound task with no HTTP model or ledger write',async()=>{
 const f=await authorized();try{const before=await f.store.read(),session=createProjectExecutionAdmission(f.plan,f.controller,guards()),id=f.plan.tasks[0]!.id,admission=await session.prepare(id);const host=consumeProjectExecutionAdmission(admission,f.plan,id);assert.equal(host.host.projectBudget.taskId,id);assert.equal(host.host.targetProfile,f.target);assert.equal(host.executionAuthorized,false);await host.assertCurrent();assert.deepEqual(await f.store.read(),before);assert.equal(session.snapshot().modelCalls,0);assert.throws(()=>consumeProjectExecutionAdmission(admission,f.plan,id),admissionRefusal);}finally{f.cleanup();}
});
test('copied plans, copied admissions and foreign task/controller identities never bind',async()=>{
 const a=await authorized(),b=await authorized(fixture('example/other'));try{assert.throws(()=>createProjectExecutionAdmission({...a.plan},a.controller,guards()),admissionRefusal);assert.throws(()=>createProjectExecutionAdmission(a.plan,{...a.controller},guards()),admissionRefusal);assert.throws(()=>createProjectExecutionAdmission(a.plan,b.controller,guards()),admissionRefusal);
 const id=a.plan.tasks[0]!.id,admission=await createProjectExecutionAdmission(a.plan,a.controller,guards()).prepare(id);assert.throws(()=>consumeProjectExecutionAdmission({...admission},a.plan,id),admissionRefusal);assert.throws(()=>consumeProjectExecutionAdmission(admission,a.plan,a.plan.tasks[1]!.id),admissionRefusal);assert.throws(()=>consumeProjectExecutionAdmission(admission,b.plan,id),admissionRefusal);assert.equal(consumeProjectExecutionAdmission(admission,a.plan,id).taskId,id);
 }finally{a.cleanup();b.cleanup();}
});
test('read-only owner mode cannot admit development',async()=>{const f=await authorized(fixture(),'read-only-review');try{assert.throws(()=>createProjectExecutionAdmission(f.plan,f.controller,guards()),admissionRefusal);}finally{f.cleanup();}});
test('insufficient budget refuses before scope consumption with no reset or charge',async()=>{const f=await authorized(fixture(),'development',3);try{const before=await f.store.read(),s=createProjectExecutionAdmission(f.plan,f.controller,guards());await assert.rejects(()=>s.prepare(f.plan.tasks[0]!.id),admissionRefusal);assert.equal(s.snapshot().stopped,true);assert.deepEqual(await f.store.read(),before);}finally{f.cleanup();}});
test('unknown task, missing guards and blocked plan cannot open an execution path',async()=>{
 const f=await authorized();try{assert.throws(()=>createProjectExecutionAdmission(f.plan,f.controller,{} as any),admissionRefusal);const s=createProjectExecutionAdmission(f.plan,f.controller,guards());await assert.rejects(()=>s.prepare('unknown'),admissionRefusal);await assert.rejects(()=>s.prepare(f.plan.tasks[0]!.id),admissionRefusal);const input=fixture();input.proposal.blockers=['Requirements need owner confirmation.'];assert.throws(()=>createProjectExecutionAdmission(input.plan(),f.controller,guards()),admissionRefusal);}finally{f.cleanup();}
});
test('source and dependency failure are terminal and cannot be replaced by boolean JSON evidence',async()=>{
 for(const mode of ['source','dependencies','false']){const f=await authorized();try{let fail=true;const g=guards();if(mode==='source')g.assertSource=async()=>{if(fail)throw Error('PRIVATE_SOURCE_BODY');};if(mode==='dependencies')g.assertDependencies=async()=>{if(fail)throw Error('PRIVATE_RECEIPT');};if(mode==='false')g.assertSource=(async()=>false) as any;const s=createProjectExecutionAdmission(f.plan,f.controller,g),before=await f.store.read();await assert.rejects(()=>s.prepare(f.plan.tasks[0]!.id),admissionRefusal);fail=false;await assert.rejects(()=>s.prepare(f.plan.tasks[0]!.id),admissionRefusal);assert.deepEqual(await f.store.read(),before);}finally{f.cleanup();}}
});
test('native owner edits during async host validation refuse before a capability is returned',async()=>{
 const f=await authorized();try{const g=guards();g.assertSource=async()=>{f.comment.updated_at='2026-10-26T11:01:00Z';};const before=await f.store.read(),s=createProjectExecutionAdmission(f.plan,f.controller,g);await assert.rejects(()=>s.prepare(f.plan.tasks[0]!.id),admissionRefusal);assert.deepEqual(await f.store.read(),before);}finally{f.cleanup();}
});
test('duplicate admission and guards after consumption remain terminal and source-free',async()=>{
 const f=await authorized();try{let sourceValid=true;const g=guards();g.assertSource=async()=>{if(!sourceValid)throw Error('PRIVATE_CHANGED_SOURCE');};const s=createProjectExecutionAdmission(f.plan,f.controller,g),id=f.plan.tasks[0]!.id,cap=await s.prepare(id),host=consumeProjectExecutionAdmission(cap,f.plan,id);sourceValid=false;await assert.rejects(()=>host.assertCurrent(),admissionRefusal);sourceValid=true;await assert.rejects(()=>host.assertCurrent(),admissionRefusal);assert.equal(s.snapshot().stopped,true);
 }finally{f.cleanup();}
 const b=await authorized();try{const s=createProjectExecutionAdmission(b.plan,b.controller,guards()),id=b.plan.tasks[0]!.id;await s.prepare(id);await assert.rejects(()=>s.prepare(id),admissionRefusal);assert.equal(s.snapshot().stopped,true);}finally{b.cleanup();}
});
test('concurrent admission latches refusal rather than creating two task scopes',async()=>{
 const f=await authorized();try{let release!:()=>void;const wait=new Promise<void>(r=>{release=r;}),g=guards();g.assertSource=async()=>wait;const s=createProjectExecutionAdmission(f.plan,f.controller,g),id=f.plan.tasks[0]!.id,first=s.prepare(id);await assert.rejects(()=>s.prepare(id),admissionRefusal);release();await assert.rejects(()=>first,admissionRefusal);assert.equal(s.snapshot().stopped,true);}finally{f.cleanup();}
});

const wireRefusal=(e:unknown)=>e instanceof Error&&e.message===PROJECT_TASK_MODEL_ERROR;
const completion=(content='{"proposal":"unverified"}',finish_reason='stop')=>Response.json({choices:[{message:{role:'assistant',content},finish_reason}]});
const wireBody=(content='Bounded task metadata only.')=>JSON.stringify({model:'openai/gpt-oss-120b',messages:[{role:'user',content}],max_completion_tokens:1200});
async function wireFixture(){
 const f=await authorized(),id=f.plan.tasks[0]!.id,g=guards();let sourceValid=true,clock=0,contextChecks=0;
 g.assertSource=async()=>{if(!sourceValid)throw Error('PRIVATE_SOURCE_ERROR');};
 const admission=await createProjectExecutionAdmission(f.plan,f.controller,g).prepare(id),sent:string[]=[],checkpoints:ProjectRequestCheckpoint[]=[];
 const options={admission,plan:f.plan,taskId:id,env:{AGENT_FACTORY_PROVIDER:'groq',GROQ_API_KEY:'offline-model-token',ONAY_TEAM_FREE_TIER_CONFIRMED:'true',AGENT_FACTORY_PROJECT_LIVE_APPROVED:'ONE_FREE_BOUNDED_RUN',AGENT_FACTORY_LEGAL_ENABLED:'false'},
  assertRequestContext:async(_body:string)=>{contextChecks++;},checkpoint:async(event:ProjectRequestCheckpoint)=>{const state=await f.store.read();assert.ok((state?.data as any).reservations.length>0);checkpoints.push(event);},timing:{now:()=>clock,wait:async(ms:number)=>{clock+=ms;}},
  transport:(async(input,init)=>{assert.equal(String(input),'https://api.groq.com/openai/v1/chat/completions');assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer offline-model-token');const body=String(init?.body);sent.push(body);const event=checkpoints.at(-1)!;assert.equal(event.requestSha256,createHash('sha256').update(body).digest('hex'));assert.equal(event.requestBytes,Buffer.byteLength(body));return completion();}) as typeof fetch};
 return{...f,options,sent,checkpoints,contextChecks:()=>contextChecks,setSource:(valid:boolean)=>{sourceValid=valid;},setClock:(value:number)=>{clock=value;},sourceGuards:g};
}
test('generic model transport reserves native scope and persists hash-only checkpoint before mock HTTP',async()=>{
 const f=await wireFixture();try{const t=createProjectTaskModelTransport(f.options),result=await t.request(wireBody());assert.equal(result.proposalVerified,false);assert.equal(result.wholeAppCompleted,false);assert.equal(f.sent.length,1);assert.ok(f.contextChecks()>=3);assert.equal((await f.controller.inspect()).used.requests,1);assert.equal(t.snapshot().providerCallsSent,1);assert.equal(f.checkpoints[0]!.providerCallsSent,0);assert.equal(Object.hasOwn(f.checkpoints[0]!,'body'),false);}finally{f.cleanup();}
});
test('four large generic requests fit 24k aggregate budget with TPM pacing and no fifth request',async()=>{
 const f=await wireFixture();try{const t=createProjectTaskModelTransport(f.options),body=wireBody('PRIVATE_SOURCE_FRAGMENT_'+ 'x'.repeat(11500));for(let i=0;i<4;i++)await t.request(body);assert.equal(f.sent.length,4);assert.ok(t.snapshot().reservedRunTokens>16000);assert.ok(t.snapshot().reservedRunTokens<=24000);await assert.rejects(()=>t.request(body),wireRefusal);assert.equal(f.sent.length,4);assert.equal((await f.controller.inspect()).used.requests,4);const publicData=JSON.stringify([t.snapshot(),f.checkpoints]);assert.equal(publicData.includes('PRIVATE_SOURCE_FRAGMENT_'),false);assert.equal(publicData.includes('offline-model-token'),false);}finally{f.cleanup();}
});
test('429 is terminal, retained in durable usage and never echoed or retried',async()=>{
 const f=await wireFixture();try{let calls=0;f.options.transport=async()=>{calls++;return new Response('PRIVATE_BODY offline-model-token',{status:429,headers:{'retry-after':'PRIVATE_HEADER'}});};const t=createProjectTaskModelTransport(f.options);await assert.rejects(()=>t.request(wireBody()),wireRefusal);await assert.rejects(()=>t.request(wireBody()),wireRefusal);assert.equal(calls,1);assert.equal((await f.controller.inspect()).used.requests,1);assert.equal(JSON.stringify(t.snapshot()).includes('PRIVATE'),false);}finally{f.cleanup();}
});
test('provider network and HTTP failures stop without releasing charges',async()=>{
 for(const mode of ['network','http']){const f=await wireFixture();try{let calls=0;f.options.transport=async()=>{calls++;if(mode==='network')throw Error('PRIVATE_TRANSPORT_ERROR');return new Response('PRIVATE_UPSTREAM',{status:503});};const t=createProjectTaskModelTransport(f.options);await assert.rejects(()=>t.request(wireBody()),wireRefusal);await assert.rejects(()=>t.request(wireBody()),wireRefusal);assert.equal(calls,1);assert.equal((await f.controller.inspect()).used.requests,1);}finally{f.cleanup();}}
});
test('malformed, wrong-model, streaming, tool-bearing and secret-bearing requests refuse before HTTP',async()=>{
 for(const body of ['invalid',wireBody('offline-model-token'),wireBody('gsk_'+'a'.repeat(32)),JSON.stringify({model:'other/model',messages:[{role:'user',content:'metadata'}]}),JSON.stringify({...JSON.parse(wireBody()),stream:true}),JSON.stringify({...JSON.parse(wireBody()),tools:[]}),JSON.stringify({...JSON.parse(wireBody()),n:2}),JSON.stringify({...JSON.parse(wireBody()),max_tokens:0}),JSON.stringify({...JSON.parse(wireBody()),temperature:3})]){const f=await wireFixture();try{const t=createProjectTaskModelTransport(f.options);await assert.rejects(()=>t.request(body),wireRefusal);assert.equal(f.sent.length,0);assert.equal((await f.controller.inspect()).used.requests,0);}finally{f.cleanup();}}
});
test('oversized byte and token contexts refuse without durable reservation or fallback',async()=>{
 for(const size of [20000,25000]){const f=await wireFixture();try{const t=createProjectTaskModelTransport(f.options);await assert.rejects(()=>t.request(wireBody('x'.repeat(size))),wireRefusal);assert.equal(f.sent.length,0);assert.equal((await f.controller.inspect()).used.requests,0);assert.equal(t.snapshot().stopped,true);}finally{f.cleanup();}}
});
test('missing live/free/legal flags and copied admission cannot start generic transport',async()=>{
 const f=await wireFixture();try{for(const env of [{...f.options.env,AGENT_FACTORY_PROJECT_LIVE_APPROVED:''},{...f.options.env,ONAY_TEAM_FREE_TIER_CONFIRMED:'false'},{...f.options.env,AGENT_FACTORY_LEGAL_ENABLED:'true'},{...f.options.env,AGENT_FACTORY_PROVIDER:'openai'}])assert.throws(()=>createProjectTaskModelTransport({...f.options,env}),wireRefusal);assert.throws(()=>createProjectTaskModelTransport({...f.options,admission:{...f.options.admission}}),wireRefusal);assert.equal((await f.controller.inspect()).used.requests,0);}finally{f.cleanup();}
});
test('preflight provenance refusal prevents reservation and cannot be replaced by boolean context evidence',async()=>{
 for(const mode of ['source','context','boolean']){const f=await wireFixture();try{if(mode==='source')f.setSource(false);if(mode==='context')f.options.assertRequestContext=async()=>{throw Error('PRIVATE_CONTEXT');};if(mode==='boolean')f.options.assertRequestContext=(async()=>false) as any;const t=createProjectTaskModelTransport(f.options);await assert.rejects(()=>t.request(wireBody()),wireRefusal);assert.equal(f.sent.length,0);assert.equal((await f.controller.inspect()).used.requests,0);}finally{f.cleanup();}}
});
test('checkpoint failure after WAL preserves charge and prevents provider HTTP',async()=>{
 for(const mode of ['throw','false']){const f=await wireFixture();try{f.options.checkpoint=(async()=>{if(mode==='throw')throw Error('PRIVATE_CHECKPOINT_ERROR');return false;}) as any;const t=createProjectTaskModelTransport(f.options);await assert.rejects(()=>t.request(wireBody()),wireRefusal);assert.equal(f.sent.length,0);assert.equal((await f.controller.inspect()).used.requests,1);assert.equal(t.snapshot().stage,'checkpoint');await assert.rejects(()=>t.request(wireBody()),wireRefusal);}finally{f.cleanup();}}
});
test('source loss, owner edit or context change after reservation stops before HTTP without refund',async()=>{
 for(const mode of ['source','owner','context']){const f=await wireFixture();try{const checkpoint=f.options.checkpoint;f.options.checkpoint=async e=>{await checkpoint(e);if(mode==='source')f.setSource(false);if(mode==='owner')f.comment.updated_at='2026-10-26T11:01:00Z';if(mode==='context')f.options.assertRequestContext=async()=>{throw Error('PRIVATE_CONTEXT');};};if(mode==='context'){let checks=0;f.options.assertRequestContext=async()=>{if(++checks>=3)throw Error('PRIVATE_CONTEXT');};}
 const t=createProjectTaskModelTransport(f.options);await assert.rejects(()=>t.request(wireBody()),wireRefusal);assert.equal(f.sent.length,0);assert.equal((await f.controller.inspect()).used.requests,1);assert.equal(t.snapshot().stopped,true);}finally{f.cleanup();}}
});
test('truncation, malformed JSON, oversized response and tool calls are terminal unverified output',async()=>{
 for(const mode of ['truncated','json','large','tools','secret']){const f=await wireFixture();try{let calls=0;f.options.transport=async()=>{calls++;if(mode==='truncated')return completion('PRIVATE_PARTIAL','length');if(mode==='json')return new Response('PRIVATE_INVALID_JSON');if(mode==='large')return new Response('x'.repeat(65537));if(mode==='secret')return completion('gsk_'+'a'.repeat(32));return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'content',tool_calls:[]}}]});};const t=createProjectTaskModelTransport(f.options);await assert.rejects(()=>t.request(wireBody()),wireRefusal);await assert.rejects(()=>t.request(wireBody()),wireRefusal);assert.equal(calls,1);assert.equal((await f.controller.inspect()).used.requests,1);}finally{f.cleanup();}}
});
test('fresh worker/controller cannot resend a previously reserved stable task request',async()=>{
 const f=await wireFixture();try{const first=createProjectTaskModelTransport(f.options);await first.request(wireBody());const before=await f.store.read(),controller=await authorizeProjectBudget(f.authorizationOptions),admission=await createProjectExecutionAdmission(f.plan,controller,f.sourceGuards).prepare(f.options.taskId);const restarted=createProjectTaskModelTransport({...f.options,admission});await assert.rejects(()=>restarted.request(wireBody()),wireRefusal);assert.equal(f.sent.length,1);assert.deepEqual(await f.store.read(),before);assert.equal(restarted.snapshot().providerCallsSent,0);}finally{f.cleanup();}
});
test('lost reservation acknowledgement retains charge and refuses HTTP without retry',async()=>{
 const f=await wireFixture();try{let writes=0;const store={read:f.store.read,compareAndSwap:async(...a:Parameters<typeof f.store.compareAndSwap>)=>{writes++;await f.store.compareAndSwap(...a);throw Error('PRIVATE_LOST_ACK');}},controller=await authorizeProjectBudget({...f.authorizationOptions,store}),admission=await createProjectExecutionAdmission(f.plan,controller,f.sourceGuards).prepare(f.options.taskId),t=createProjectTaskModelTransport({...f.options,admission});
 await assert.rejects(()=>t.request(wireBody()),wireRefusal);await assert.rejects(()=>t.request(wireBody()),wireRefusal);assert.equal(writes,1);assert.equal(f.sent.length,0);assert.equal((await f.controller.inspect()).used.requests,1);
 }finally{f.cleanup();}
});
test('deadline reached after checkpoint keeps reservation and sends no upstream request',async()=>{
 const f=await wireFixture();try{f.options.checkpoint=async()=>{f.setClock(300001);};const t=createProjectTaskModelTransport(f.options);await assert.rejects(()=>t.request(wireBody()),wireRefusal);assert.equal(f.sent.length,0);assert.equal((await f.controller.inspect()).used.requests,1);}finally{f.cleanup();}
});
test('concurrent generic requests latch stop before a second model call',async()=>{
 const f=await wireFixture();try{const t=createProjectTaskModelTransport(f.options),first=t.request(wireBody());await assert.rejects(()=>t.request(wireBody()),wireRefusal);await assert.rejects(()=>first,wireRefusal);assert.equal(f.sent.length,0);assert.equal((await f.controller.inspect()).used.requests,0);}finally{f.cleanup();}
});
