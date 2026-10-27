import {createHash} from 'node:crypto';
import {isAuthorizedProjectBudgetController,type AuthorizedProjectBudgetController} from '../orchestration/projectBudgetAuthorization.js';

export const PROJECT_STATE_PROTECTION_ERROR='Project state ref protection is missing, bypassable, changed or unverified. No runtime activation, model request, state write or budget reset is authorized.';
const refuse=():never=>{throw Error(PROJECT_STATE_PROTECTION_ERROR);};
const repository='erman-ksv/Onay-Agents-Factory';
type Options=Readonly<{controller:AuthorizedProjectBudgetController;token:string}>;
export type ProjectStateProtection=Readonly<{repository:string;projectKey:string;branches:readonly string[];rulesetIds:readonly number[];sha256:string;provenance:'native-github'|'simulated';forcePushBlocked:true;deletionBlocked:true;executionAuthorized:false}>;
const records=new WeakMap<ProjectStateProtection,{controller:AuthorizedProjectBudgetController;current:()=>Promise<void>}>();
export function assertProjectStateProtection(value:unknown,controller:AuthorizedProjectBudgetController,mode:'native'|'simulated'){const r=records.get(value as ProjectStateProtection);if(!r||r.controller!==controller||mode==='native'&&(value as ProjectStateProtection).provenance!=='native-github')return refuse();return r;}
export async function verifyProjectStateProtection(value:unknown,controller:AuthorizedProjectBudgetController,mode:'native'|'simulated'){await assertProjectStateProtection(value,controller,mode).current();}
/** Read-only native effective-branch rules + ruleset details. Neither model
 * output nor a caller declaration can attest that a state ref is protected. */
export function prepareProjectStateProtection(options:Options){if(Object.keys(options).some(k=>!['controller','token'].includes(k)))return Promise.reject(Error(PROJECT_STATE_PROTECTION_ERROR));return prepare(options,fetch,'native-github');}
export function prepareProjectStateProtectionForTests(options:Options,transport:typeof fetch){return prepare(options,transport,'simulated');}
async function prepare(options:Options,transport:typeof fetch,provenance:ProjectStateProtection['provenance']):Promise<ProjectStateProtection>{try{
 const {controller,token}=options;if(!isAuthorizedProjectBudgetController(controller)||controller.operationMode!=='development'||!/^[a-f0-9]{64}$/.test(controller.projectKey)||!token||typeof transport!=='function')return refuse();
 const branches=Object.freeze(['state/project-checkpoints/','state/project-model-budget/'].map(prefix=>prefix+controller.projectKey));let stopped=false;
 async function collect(){
  if(stopped)return refuse();await controller.assertAuthorized();const started=performance.now();let requests=0;
  async function get(path:string):Promise<any>{if(++requests>18||performance.now()-started>30000)return refuse();const response=await transport('https://api.github.com/repos/'+repository+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'}});if(response.status!==200||!response.body||response.headers.get('link')){void response.body?.cancel().catch(()=>{});return refuse();}const stream=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;try{for(;;){const c=await stream.read();if(c.done)break;bytes+=c.value.length;if(bytes>65536){await stream.cancel();return refuse();}parts.push(c.value);}}finally{stream.releaseLock();}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
  const details=new Map<number,any>(),evidence:Array<{branch:string;rules:Array<{type:string;rulesetId:number}>}>=[];
  for(const branch of branches){
   const effective=await get('/rules/branches/'+encodeURIComponent(branch));if(!Array.isArray(effective)||effective.length>64)return refuse();const rules:Array<{type:string;rulesetId:number}>=[];
   for(const type of ['deletion','non_fast_forward']){
    const applicable=effective.filter(r=>r?.type===type);if(!applicable.length)return refuse();let protectedByRule=false;
    for(const rule of applicable){const id=rule.ruleset_id;if(!Number.isSafeInteger(id)||id<1||rule.ruleset_source_type!=='Repository'||rule.ruleset_source!==repository)return refuse();let d=details.get(id);if(!d){if(details.size>=8)return refuse();d=await get('/rulesets/'+id+'?includes_parents=false');details.set(id,d);}
     if(d?.id!==id||d.source_type!=='Repository'||d.source!==repository||d.target!=='branch'||d.enforcement!=='active'||!Array.isArray(d.bypass_actors)||d.bypass_actors.length!==0||!Array.isArray(d.rules)||!d.rules.some((r:any)=>r?.type===type))return refuse();protectedByRule=true;rules.push({type,rulesetId:id});
    }
    if(!protectedByRule)return refuse();
   }
   evidence.push({branch,rules:rules.sort((a,b)=>a.type.localeCompare(b.type)||a.rulesetId-b.rulesetId)});
  }
  await controller.assertAuthorized();if(performance.now()-started>30000)return refuse();const ids=[...details.keys()].sort((a,b)=>a-b),sha256=createHash('sha256').update(JSON.stringify({evidence,details:ids.map(id=>details.get(id))})).digest('hex');return{ids,sha256};
 }
 const initial=await collect(),value:ProjectStateProtection=Object.freeze({repository,projectKey:controller.projectKey,branches,rulesetIds:Object.freeze(initial.ids),sha256:initial.sha256,provenance,forcePushBlocked:true,deletionBlocked:true,executionAuthorized:false});records.set(value,{controller,current:async()=>{try{const now=await collect();if(now.sha256!==initial.sha256)return refuse();}catch{stopped=true;return refuse();}}});return value;
}catch{return refuse();}}
