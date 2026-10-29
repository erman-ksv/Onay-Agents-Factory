import {createHash} from 'node:crypto';
import {createCalculatorPlan,prepareCalculatorGoal,type CalculatorPlan} from './calculatorPlan.js';
import {createProjectBudgetedCalculatorTeam} from './projectBudgetedCalculatorTeam.js';
import {isAuthorizedProjectBudgetController,type AuthorizedProjectBudgetController} from './projectBudgetAuthorization.js';
import {createCalculatorModelTeam,CALCULATOR_MODEL_ERROR,type CalculatorPriorModelCharge} from './calculatorModelTeam.js';
import {createTaskModelBudgetFetch,calculatorHostModelBudget,DEFAULT_TASK_MODEL_BUDGET} from './taskModelBudget.js';
import {createProviderContextBudget,createGroqBudgetedFetch} from '../commander/providerContextBudget.js';
import {createCalculatorGroqPacer} from './calculatorGroqPacing.js';
import {prepareCalculatorRejectedProposalRecovery} from './calculatorRejectedProposalRecovery.js';
import {selectProviderConfig} from '../commander/providerConfig.js';

type Team=ReturnType<typeof createCalculatorModelTeam>;
type Options=Readonly<{transport?:typeof fetch;timing?:Parameters<typeof createCalculatorModelTeam>[3];
 checkpoints?:Parameters<typeof createCalculatorModelTeam>[5];preset?:Parameters<typeof createCalculatorModelTeam>[6];
 evidence?:Parameters<typeof createCalculatorModelTeam>[7]}>;
export type CalculatorProjectRuntimeHost=Readonly<{controller:AuthorizedProjectBudgetController;executionId:string}>;
const refuse=():never=>{throw Error(CALCULATOR_MODEL_ERROR);};
/** Host objects are not restored from model output, environment JSON or receipts. */
export function prepareCalculatorProjectRuntimeHost(value:unknown):CalculatorProjectRuntimeHost|undefined{
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==2)return refuse();
 const d=Object.getOwnPropertyDescriptors(value);
 if(!d.controller||!d.executionId||!Object.hasOwn(d.controller,'value')||!Object.hasOwn(d.executionId,'value')||
 !isAuthorizedProjectBudgetController(d.controller.value)||typeof d.executionId.value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,47}$/.test(d.executionId.value))return refuse();
 return Object.freeze({controller:d.controller.value,executionId:d.executionId.value});
}
/** One runtime, one aggregate request/deadline/TPM gate, separate task-bound
 * teams. Dependency reviews consume their own task scope in the SAME ledger.
 * Constructing this router never initializes storage or grants an allowance. */
export async function createCalculatorProjectRuntimeTeam(ownerRequest:unknown,planInput:CalculatorPlan,env:NodeJS.ProcessEnv,
 hostInput:CalculatorProjectRuntimeHost,options:Options={}){
 const host=prepareCalculatorProjectRuntimeHost(hostInput);if(!host)return refuse();
 const owner=prepareCalculatorGoal(ownerRequest),plan=createCalculatorPlan(ownerRequest,planInput.proposal),identity=host.controller.identity;
 if(plan.fingerprint!==planInput.fingerprint||identity.projectId!==owner.id||identity.repository!==owner.repository||
 identity.ownerFingerprint!==owner.ownerFingerprint||identity.planFingerprint!==plan.fingerprint||
 JSON.stringify(identity.taskIds)!==JSON.stringify(plan.tasks.map(t=>t.id))||env.AGENT_FACTORY_PROVIDER!=='groq')return refuse();
 if(env.AGENT_FACTORY_PROJECT_BUDGET_MODE!==undefined&&env.AGENT_FACTORY_PROJECT_BUDGET_MODE!=='required')return refuse();
 await host.controller.assertAuthorized();await host.controller.inspect();
 const teams=new Map<string,Team>(),timing=options.timing??{},now=timing.now??(()=>performance.now());
 const recoveryEnv=Object.freeze({...env});
 const limits=options.preset?calculatorHostModelBudget(options.preset):DEFAULT_TASK_MODEL_BUDGET;
 let stopped=false,busy=false,providerCallsSent=0;
 let stopReason:'concurrent_operation'|'operation_failed'|'validation_failed'|'transport_stopped'|undefined;
 function stop(reason:NonNullable<typeof stopReason>){stopped=true;stopReason??=reason;}
 function active(){if(stopped||[...teams.values()].some(t=>t.snapshot().stopped)){stop('operation_failed');return refuse();}}
 const upstream=options.transport??fetch;
 const guardedUpstream:typeof fetch=async(input,init)=>{
  active();if(init?.signal?.aborted){stop('transport_stopped');return refuse();}
  providerCallsSent++;
  const result=await upstream(input,init);
  if(stopped||init?.signal?.aborted){void result.body?.cancel().catch(()=>undefined);stop('transport_stopped');return refuse();}
  return result;
 };
 const wire=createTaskModelBudgetFetch({...limits,...(options.preset?{hostPreset:options.preset}:{}),now},guardedUpstream);
 const context=createProviderContextBudget({now,reservedOutputTokens:limits.maxOutputTokens,
 ...(options.preset==='calculator-published-three-reviews'?{maxRunTokens:18000}:{}),
 ...(options.preset==='calculator-keyboard-eight-roles'?{maxRunTokens:32000}:{}),
 ...(options.preset==='calculator-successor-eight-roles'?{maxRunTokens:48000}:{}),
 ...(options.preset==='calculator-renewed-repair-four-roles'?{maxRunTokens:24000}:{})});
 const pace=createCalculatorGroqPacer(context,wire,{...timing,now},limits.wallTimeMs,options.preset);
 const bounded=createGroqBudgetedFetch(context,wire.fetch);
 const transport:typeof fetch=async(input,init)=>{
  if(stopped||typeof init?.body!=='string')return refuse();
  try{await pace(init.body);active();await host.controller.assertAuthorized();active();return await bounded(input,init);}
  catch{stop('transport_stopped');return refuse();}
 };
 function checkpointCharge():CalculatorPriorModelCharge{
  const sum={attemptedRequests:0,totalRequestBytes:0,reservedRunTokens:0,elapsedMs:0};
  for(const team of teams.values()){
   const c=team.checkpointCharge();if(!c)return refuse();
   sum.attemptedRequests+=c.attemptedRequests;sum.totalRequestBytes+=c.totalRequestBytes;
   sum.reservedRunTokens+=c.reservedRunTokens;sum.elapsedMs=Math.max(sum.elapsedMs,c.elapsedMs);
  }
  if(Object.values(sum).some(n=>!Number.isSafeInteger(n)||n<0))return refuse();return Object.freeze(sum);
 }
 for(const task of plan.tasks){
  const executionId=host.executionId+'-'+createHash('sha256').update(task.id).digest('hex').slice(0,16);
  const scope=await host.controller.taskScope(task.id,executionId);
  const team=createProjectBudgetedCalculatorTeam(ownerRequest,env,scope,transport,timing,{
   ...options.checkpoints,beforeRequest:async()=>{if(stopped)return refuse();if(options.checkpoints?.beforeRequest)await options.checkpoints.beforeRequest(checkpointCharge());},
  },options.preset,options.evidence);
  teams.set(task.id,team);
 }
 function taskTeam(actual:CalculatorPlan,id:string):Team{
  if(stopped||actual.fingerprint!==plan.fingerprint||actual.owner.ownerFingerprint!==owner.ownerFingerprint)return refuse();
  const team=teams.get(id);if(!team)return refuse();return team;
 }
 function enter(){active();if(busy){stop('concurrent_operation');return refuse();}busy=true;}
 async function call<T>(operation:()=>Promise<T>):Promise<T>{
  enter();try{const result=await operation();active();return result;}catch{stop('operation_failed');return refuse();}finally{busy=false;}
 }
 function callSync<T>(operation:()=>T):T{
  enter();try{const result=operation();active();return result;}catch{stop('validation_failed');return refuse();}finally{busy=false;}
 }
 return Object.freeze({
  plan:()=>call(async():Promise<CalculatorPlan>=>refuse()),
  generate:(...a:Parameters<Team['generate']>)=>call(()=>taskTeam(a[0],a[1]).generate(...a)),
  generateFromRejectedCheckpoint:(...a:Parameters<Team['generateFromRejectedCheckpoint']>)=>call(async()=>{
   const previous=taskTeam(a[0],a[1]),state=previous.snapshot();
   if(limits.maxOutputTokens!==2048||!options.checkpoints?.beforeRequest||!options.checkpoints.afterProposalRejected||
    state.generatedTasks||state.restoredTasks||state.repairedTasks||previous.checkpointCharge()?.attemptedRequests)return refuse();
   // Freeze/copy host evidence before authorization awaits. No request JSON or
   // environment variable supplies either the native grant or ledger scope.
   const evidence={bytes:Buffer.from(a[3].bytes),expectedSha256:a[3].expectedSha256,identity:Object.freeze({...a[3].identity})};
   const config=selectProviderConfig(recoveryEnv);if(config.provider!=='groq')return refuse();
   const prepared=prepareCalculatorRejectedProposalRecovery({...evidence,plan,taskId:a[1],snapshot:a[2],model:config.model});
   const scope=await host.controller.taskScope(a[1],prepared.metadata.executionId);active();
   const team=createProjectBudgetedCalculatorTeam(ownerRequest,recoveryEnv,scope,transport,timing,{
    ...options.checkpoints,beforeRequest:async()=>{active();await options.checkpoints!.beforeRequest!(checkpointCharge());},
   },options.preset,options.evidence);
   teams.set(a[1],team);
   return team.generateFromRejectedCheckpoint(plan,a[1],a[2],evidence);
  }),
  repair:(...a:Parameters<Team['repair']>)=>call(()=>taskTeam(a[0],a[1]).repair(...a)),
  assess:(...a:Parameters<Team['assess']>)=>call(()=>taskTeam(a[1],a[2]).assess(...a)),
  prepareRepairFeedback:(...a:Parameters<Team['prepareRepairFeedback']>)=>callSync(()=>taskTeam(a[0],a[1]).prepareRepairFeedback(...a)),
  restoreProposal:(...a:Parameters<Team['restoreProposal']>)=>callSync(()=>taskTeam(a[0],a[1]).restoreProposal(...a)),
  restoredAssessmentPrefix:(...a:Parameters<Team['restoredAssessmentPrefix']>)=>callSync(()=>taskTeam(a[0],a[1]).restoredAssessmentPrefix(...a)),
  observeCommitted:(...a:Parameters<Team['observeCommitted']>)=>callSync(()=>taskTeam(a[0],a[1]).observeCommitted(...a)),
  checkpointCharge,
  snapshot:()=>({stopped:stopped||[...teams.values()].some(t=>t.snapshot().stopped),projectBudgetRequired:true as const,aggregateCharge:checkpointCharge()}),
  diagnostic:()=>Object.freeze({reasonCode:stopReason??(stopped?'project_runtime_stopped':'project_runtime_ready'),...checkpointCharge(),
   providerCallsSent,providerAttemptsReserved:wire.snapshot().attemptedRequests,
   scopedFailures:Object.freeze([...teams].filter(([,team])=>team.snapshot().stopped).map(([taskId,team])=>{
    const d=team.diagnostic();return Object.freeze({taskId,reasonCode:d.reasonCode,
     ...(d.httpStatus!==undefined?{httpStatus:d.httpStatus}:{}),...(d.providerHttpStatus!==undefined?{providerHttpStatus:d.providerHttpStatus}:{}),
     ...(d.taskBudgetCode?{taskBudgetCode:d.taskBudgetCode}:{}),...(d.contextBudgetCode?{contextBudgetCode:d.contextBudgetCode}:{})});})),
  }),
 });
}
