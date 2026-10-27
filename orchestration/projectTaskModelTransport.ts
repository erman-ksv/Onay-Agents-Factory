import {createHash} from 'node:crypto';
import {selectProviderConfig} from '../commander/providerConfig.js';
import {createProviderContextBudget,createGroqBudgetedFetch} from '../commander/providerContextBudget.js';
import {scanForSecrets} from '../github/secretScanner.js';
import {createTaskModelBudgetFetch,CALCULATOR_SUCCESSOR_TASK_BUDGET} from './taskModelBudget.js';
import {createCalculatorGroqPacer,type CalculatorModelTiming} from './calculatorGroqPacing.js';
import {consumeProjectExecutionAdmission,type ProjectExecutionAdmission} from './projectExecutionAdmission.js';
import type {PreparedProjectPlan} from './projectPlan.js';

export const PROJECT_TASK_MODEL_ERROR='Project model request stopped. Preserve reservations and checkpoint; no retry, reset, publication or completion is authorized.';
const ENDPOINT='https://api.groq.com/openai/v1/chat/completions';
const limits=CALCULATOR_SUCCESSOR_TASK_BUDGET,preset='calculator-successor-four-roles' as const;
const secrets=(text:string)=>scanForSecrets(text).length>0||/(?:^|[^A-Za-z0-9_])(?:gsk_[A-Za-z0-9_-]{20,}|gh[opusr]_[A-Za-z0-9_]{20,})/.test(text);
export type ProjectRequestCheckpoint=Readonly<{version:1;stage:'before-http';taskId:string;executionId:string;requestSha256:string;requestBytes:number;attemptedRequests:number;providerCallsSent:number;httpInFlight:true}>;
type Options=Readonly<{admission:ProjectExecutionAdmission;plan:PreparedProjectPlan;taskId:string;env:NodeJS.ProcessEnv;
 /** HOST ONLY: verify selected context/provenance before and after awaits. */
 assertRequestContext:(body:string)=>Promise<void>;checkpoint:(event:ProjectRequestCheckpoint)=>Promise<void>;
 transport?:typeof fetch;timing?:CalculatorModelTiming}>;
/** A bounded transport, not a role/result validator or a complete executor.
 * No provider is invoked during construction. Existing per-request ceilings,
 * TPM pacing and native reserve-before-HTTP rules remain mandatory. */
export function createProjectTaskModelTransport(options:Options){
 try{
  const env={...options.env};if(env.AGENT_FACTORY_PROVIDER!=='groq'||env.ONAY_TEAM_FREE_TIER_CONFIRMED!=='true'||env.AGENT_FACTORY_PROJECT_LIVE_APPROVED!=='ONE_FREE_BOUNDED_RUN'||env.AGENT_FACTORY_LEGAL_ENABLED!=='false'||typeof options.assertRequestContext!=='function'||typeof options.checkpoint!=='function')throw Error();
  const config=selectProviderConfig(env);if(config.provider!=='groq'||config.baseURL!=='https://api.groq.com/openai/v1'||!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,119}$/.test(config.model)||secrets(config.model))throw Error();const {apiKey,model}=config;
  const taskId=options.taskId,bound=consumeProjectExecutionAdmission(options.admission,options.plan,taskId),assertContext=options.assertRequestContext,checkpoint=options.checkpoint,upstream=options.transport??fetch,timing={...options.timing};
  const clock=timing.now??(()=>performance.now()),wait=timing.wait??(ms=>new Promise<void>(resolve=>setTimeout(resolve,ms))),correctionStart=clock();let correctionCooled=bound.attempt!==2&&!bound.cooldownBeforeFirstRequest;
  if(typeof upstream!=='function')throw Error();let stopped=false,busy=false,providerCallsSent=0,reasonCode='ready',stage='ready';const abort=new AbortController();
  const refuse=(code='request-stopped'):never=>{stopped=true;if(reasonCode==='ready')reasonCode=code;abort.abort();throw Error(PROJECT_TASK_MODEL_ERROR);};
  const active=()=>{if(stopped||wire.failure||context.failure)return refuse(wire.failure?.code??context.failure?.code??'request-stopped');};
  const context=createProviderContextBudget({now:timing.now,reservedOutputTokens:limits.maxOutputTokens,maxRunTokens:4*6000});
  const wire=createTaskModelBudgetFetch({...limits,hostPreset:preset,projectBudget:bound.host.projectBudget,now:timing.now},async(input,init)=>{
   active();if(String(input)!==ENDPOINT||init?.method!=='POST'||typeof init.body!=='string'||init.signal?.aborted)return refuse('invalid-wire-request');
   stage='post-reservation-guard';const body=init.body;await bound.assertCurrent();active();if(await assertContext(body)!==undefined)return refuse('context-unverified');active();
   stage='checkpoint';if(await checkpoint(Object.freeze({version:1,stage:'before-http',taskId,executionId:bound.host.projectBudget.executionId,requestSha256:createHash('sha256').update(body).digest('hex'),requestBytes:Buffer.byteLength(body),attemptedRequests:wire.snapshot().attemptedRequests,providerCallsSent,httpInFlight:true}))!==undefined)return refuse('checkpoint-unverified');
   stage='post-checkpoint-guard';active();await bound.assertCurrent();active();if(await assertContext(body)!==undefined)return refuse('context-unverified');active();if(init.signal?.aborted)return refuse('request-aborted');
   stage='http';providerCallsSent++;return upstream(input,init);
  });
  const pace=createCalculatorGroqPacer(context,wire,timing,limits.wallTimeMs,preset),budgeted=createGroqBudgetedFetch(context,wire.fetch);
  function requestBody(input:unknown){
   if(typeof input!=='string'||Buffer.byteLength(input)>limits.maxRequestBytes||input.includes(apiKey)||secrets(input))return refuse('invalid-request');
   const r=JSON.parse(input);if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!['model','messages','max_tokens','max_completion_tokens','temperature','top_p','stream','n','response_format'].includes(k))||r.model!==model||(r.n!==undefined&&r.n!==1)||(r.stream!==undefined&&r.stream!==false)||!Array.isArray(r.messages)||r.messages.length<1||r.messages.length>16)return refuse('invalid-request');
   for(const m of r.messages)if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).length!==2||!['system','developer','user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.length)return refuse('invalid-request');
   for(const k of ['max_tokens','max_completion_tokens'])if(r[k]!==undefined&&(!Number.isSafeInteger(r[k])||r[k]<1))return refuse('invalid-request');
   if((r.temperature!==undefined&&(typeof r.temperature!=='number'||r.temperature<0||r.temperature>2))||(r.top_p!==undefined&&(typeof r.top_p!=='number'||r.top_p<=0||r.top_p>1))||(r.response_format!==undefined&&(!r.response_format||typeof r.response_format!=='object'||Object.keys(r.response_format).length!==1||r.response_format.type!=='json_object')))return refuse('invalid-request');
   r.max_completion_tokens=Math.min(r.max_completion_tokens??r.max_tokens??limits.maxOutputTokens,limits.maxOutputTokens);delete r.max_tokens;r.n=1;r.stream=false;const body=JSON.stringify(r);if(Buffer.byteLength(body)>limits.maxRequestBytes)return refuse('invalid-request');return body;
  }
  return Object.freeze({
   async request(input:unknown){
    try{
     active();if(busy)return refuse('concurrent-request');busy=true;stage='preflight';const body=requestBody(input);await bound.assertCurrent();active();if(await assertContext(body)!==undefined)return refuse('context-unverified');active();
     // A fresh per-attempt TPM ledger cannot forget the previous attempt's
     // window. Wait one conservative full minute before the first correction
     // request; guards run between <=15s waits. No extra model call or retry.
     if(!correctionCooled){stage='correction-cooldown';let prior=correctionStart;for(let i=0;;i++){const now=clock();if(!Number.isFinite(now)||now<prior||i>8)return refuse('invalid-correction-clock');if(now-correctionStart>=60000)break;await wait(Math.min(15000,60000-(now-correctionStart)));active();await bound.assertCurrent();active();if(await assertContext(body)!==undefined)return refuse('context-unverified');active();prior=now;}correctionCooled=true;}
     stage='pacing';await pace(body);active();await bound.assertCurrent();active();stage='reserve-and-send';const response=await budgeted(ENDPOINT,{method:'POST',redirect:'error',signal:abort.signal,headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body});
     if(!response.ok||!response.body)return refuse(wire.failure?.code??context.failure?.code??'provider-refused');
     stage='response';const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
     try{for(;;){active();const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>65536){await reader.cancel();return refuse('response-too-large');}chunks.push(part.value);}}finally{reader.releaseLock();}
     active();const result=JSON.parse(Buffer.concat(chunks).toString('utf8')),choice=result?.choices?.[0],content=choice?.message?.content;
     if(!Array.isArray(result?.choices)||result.choices.length!==1||choice.finish_reason!=='stop'||choice.message?.role!=='assistant'||choice.message?.tool_calls!==undefined||typeof content!=='string'||!content.length||content.includes(apiKey)||secrets(content))return refuse('response-unverified');
     await bound.assertCurrent();active();stage='done';return Object.freeze({content,model,proposalVerified:false as const,publicationAuthorized:false as const,wholeAppCompleted:false as const});
    }catch{if(!stopped){stopped=true;reasonCode=wire.failure?.code??context.failure?.code??'request-failed';}abort.abort();throw Error(PROJECT_TASK_MODEL_ERROR);}finally{busy=false;}
   },
   snapshot:()=>Object.freeze({stopped:stopped||!!wire.failure||!!context.failure,reasonCode:reasonCode==='ready'?(wire.failure?.code??context.failure?.code??'ready'):reasonCode,stage,providerCallsSent,attemptedRequests:wire.snapshot().attemptedRequests,totalRequestBytes:wire.snapshot().totalRequestBytes,reservedRunTokens:context.snapshot().reservedRunTokens,publicationAuthorized:false as const,wholeAppCompleted:false as const}),
   stop:()=>{stopped=true;if(reasonCode==='ready')reasonCode='host-stopped';abort.abort();},
  });
 }catch{throw Error(PROJECT_TASK_MODEL_ERROR);}
}
