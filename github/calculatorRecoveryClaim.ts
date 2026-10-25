import {createHash} from 'node:crypto';
import {scanForSecrets} from './secretScanner.js';
import type {CalculatorRuntimeRecoveryHost} from '../orchestration/calculatorRuntimeRecovery.js';
type Binding=Parameters<CalculatorRuntimeRecoveryHost['claimRecovery']>[0];
const REPO='erman-ksv/Onay-Agents-Factory',BASE='https://api.github.com/repos/'+REPO;
export const CALCULATOR_RECOVERY_CLAIM_ERROR='Remote correction claim refused or uncertain. Preserve the reference and charges; no retry or replay.';
const refuse=():never=>{throw Error(CALCULATOR_RECOVERY_CLAIM_ERROR);};
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const git=(kind:string,b:Buffer)=>createHash('sha1').update(Buffer.concat([Buffer.from(kind+' '+b.length+'\0'),b])).digest('hex');
function binding(v:Binding):Binding{
 const keys=['checkpointSha256','receiptSha256','taskId','baseSha','executionId'];
 if(!v||typeof v!=='object'||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)return refuse();
 const d=Object.getOwnPropertyDescriptors(v);if(keys.some(k=>!d[k]||!Object.hasOwn(d[k],'value')||typeof d[k]!.value!=='string'))return refuse();
 if(!/^[a-f0-9]{64}$/.test(v.checkpointSha256)||!/^[a-f0-9]{64}$/.test(v.receiptSha256)||!/^[a-f0-9]{40}$/.test(v.baseSha)||!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(v.taskId)||!/^rejected-[a-f0-9]{64}$/.test(v.executionId))return refuse();
 return Object.freeze({checkpointSha256:v.checkpointSha256,receiptSha256:v.receiptSha256,taskId:v.taskId,baseSha:v.baseSha,executionId:v.executionId});
}
/** Native fixed-repository compare/create, metadata only. This implements the
 * recovery CLAIM callbacks, not authentication/download of private artifacts,
 * owner authorization, a model grant or source-publication permission. */
export function createCalculatorRecoveryGitHubClaim(input:Readonly<{planFingerprint:string;runtimeSha:string;sourceCiRunId:number;binding:Binding}>,
 env:NodeJS.ProcessEnv,transport:typeof fetch=fetch){
 if(!input||!/^[a-f0-9]{64}$/.test(input.planFingerprint)||!/^[a-f0-9]{40}$/.test(input.runtimeSha)||!Number.isSafeInteger(input.sourceCiRunId)||input.sourceCiRunId<1||
  env.GITHUB_REPOSITORY!==REPO||env.GITHUB_RUN_ATTEMPT!=='1'||env.AGENT_FACTORY_LEGAL_ENABLED!=='false'||!env.FACTORY_STATE_TOKEN||typeof transport!=='function')return refuse();
 const pin=Object.freeze({planFingerprint:input.planFingerprint,runtimeSha:input.runtimeSha,sourceCiRunId:input.sourceCiRunId,binding:binding(input.binding)}),token=env.FACTORY_STATE_TOKEN;
 // Neither a new worker/runtime nor altered archive serialization may widen
 // the event key for the same stable correction execution identity.
 const key=hash(JSON.stringify({repository:'erman-ksv/Onay-Factory-Calculator',planFingerprint:pin.planFingerprint,taskId:pin.binding.taskId,baseSha:pin.binding.baseSha,executionId:pin.binding.executionId}));
 const ref='refs/heads/state/calculator-recovery/'+key,path='/git/ref/heads/'+encodeURIComponent(ref.slice(11)),file='calculator-recovery-claim.json';
 const marker=JSON.stringify({version:1,repository:REPO,planFingerprint:pin.planFingerprint,runtimeSha:pin.runtimeSha,sourceCiRunId:pin.sourceCiRunId,...pin.binding})+'\n';
 if(scanForSecrets(marker).length||/(?:gsk_|gh[pousr]_)[A-Za-z0-9_-]{20,}/.test(marker))return refuse();
 const blobSha=git('blob',Buffer.from(marker)),treeSha=git('tree',Buffer.concat([Buffer.from('100644 '+file+'\0'),Buffer.from(blobSha,'hex')]));
 const message='Record one bounded calculator correction claim';let attempted=false,admitted=false,stopped=false,commitSha:string|undefined;
 async function api(endpoint:string,method='GET',body?:unknown,absent=false):Promise<any>{
  const r=await transport(BASE+endpoint,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(absent&&r.status===404){void r.body?.cancel().catch(()=>undefined);return undefined;}
  if(r.status!==(method==='POST'?201:200)||!r.body){void r.body?.cancel().catch(()=>undefined);return refuse();}
  const reader=r.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>524288){await reader.cancel();return refuse();}parts.push(p.value);}}finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
 }
 function same(b:Binding){if(JSON.stringify(binding(b))!==JSON.stringify(pin.binding))return refuse();}
 async function sourceCi(){
  const r=await api('/actions/runs/'+pin.sourceCiRunId);
  if(r.id!==pin.sourceCiRunId||r.name!=='Agent Factory CI'||r.head_sha!==pin.runtimeSha||r.path!=='.github/workflows/ci.yml'||r.run_attempt!==1||r.status!=='completed'||r.conclusion!=='success'||r.repository?.full_name!==REPO)return refuse();
  const result=await api('/actions/runs/'+pin.sourceCiRunId+'/jobs?per_page=100');
  if(result.total_count!==1||!Array.isArray(result.jobs)||result.jobs.length!==1)return refuse();let job=result.jobs[0];
  if(Array.isArray(job.steps)&&job.steps.length===0){if(!Number.isSafeInteger(job.id)||job.id<1||job.run_id!==pin.sourceCiRunId)return refuse();const full=await api('/actions/jobs/'+job.id);if(full.id!==job.id||full.run_id!==pin.sourceCiRunId||full.head_sha!==job.head_sha||full.run_attempt!==1)return refuse();job=full;}
  if(job.run_id!==pin.sourceCiRunId||(job.run_attempt!==undefined&&job.run_attempt!==1)||job.head_sha!==pin.runtimeSha||job.status!=='completed'||job.conclusion!=='success'||['Typecheck','Test'].some(name=>job.steps?.filter((s:any)=>s.name===name&&s.status==='completed'&&s.conclusion==='success').length!==1))return refuse();
 }
 async function readback(){
  const r=await api(path);if(!commitSha||r.ref!==ref||r.object?.type!=='commit'||r.object.sha!==commitSha)return refuse();
  const c=await api('/git/commits/'+commitSha);if(c.sha!==commitSha||c.tree?.sha!==treeSha||c.message!==message||!Array.isArray(c.parents)||c.parents.length)return refuse();
  const tree=await api('/git/trees/'+treeSha),entry=tree.tree?.[0];if(tree.sha!==treeSha||tree.truncated!==false||tree.tree?.length!==1||entry.path!==file||entry.mode!=='100644'||entry.type!=='blob'||entry.sha!==blobSha)return refuse();
  const blob=await api('/git/blobs/'+blobSha);if(blob.sha!==blobSha||blob.encoding!=='base64'||typeof blob.content!=='string')return refuse();const encoded=blob.content.replace(/\s/g,''),bytes=Buffer.from(encoded,'base64');if(bytes.toString('base64')!==encoded||git('blob',bytes)!==blobSha||bytes.toString('utf8')!==marker)return refuse();
 }
 return Object.freeze({ref,
  async inspectAbsent(){if(stopped||attempted)return refuse();try{return await api(path,'GET',undefined,true)===undefined;}catch{stopped=true;return refuse();}},
  async claimRecovery(b:Binding){
   if(stopped||attempted)return refuse();attempted=true;
   try{same(b);await sourceCi();if(await api(path,'GET',undefined,true)!==undefined)return refuse();
    if((await api('/git/blobs','POST',{content:marker,encoding:'utf-8'})).sha!==blobSha)return refuse();
    if((await api('/git/trees','POST',{tree:[{path:file,mode:'100644',type:'blob',sha:blobSha}]})).sha!==treeSha)return refuse();
    const c=await api('/git/commits','POST',{message,tree:treeSha,parents:[]});if(!/^[a-f0-9]{40}$/.test(c.sha)||c.tree?.sha!==treeSha||c.message!==message||!Array.isArray(c.parents)||c.parents.length)return refuse();commitSha=c.sha;
    const r=await api('/git/refs','POST',{ref,sha:commitSha});if(r.ref!==ref||r.object?.type!=='commit'||r.object.sha!==commitSha)return refuse();await readback();admitted=true;
   }catch{stopped=true;return refuse();}
  },
  async assertRecovery(b:Binding){if(stopped||!admitted)return refuse();try{same(b);await sourceCi();await readback();}catch{stopped=true;return refuse();}},
 });
}
