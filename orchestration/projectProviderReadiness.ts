/** Provider metadata only. This report does not authorize a task, alter a
 * budget or attest free-tier eligibility, quota or successful generation. */
type Options=Readonly<{model:string;apiKey:string}>;
type Reason='model-listed'|'model-missing'|'model-inactive'|'http-rejected'|'transport-failed'|'metadata-unverified';
type Report=Readonly<{version:1;provider:'groq';model:string;status:'available'|'unavailable'|'unverified';reason:Reason;providerHttpStatus:number|null;modelListed:boolean;modelActive:boolean|null;provenance:'native-provider'|'simulated';modelGenerationRequests:0;executionAuthorized:false}>;
const refuse=():never=>{throw Error('Provider readiness scope is unverified. No generation, fallback or budget change is authorized.');};
export function inspectProjectGroqReadiness(options:Options){
 if(!options||Object.keys(options).sort().join(',')!=='apiKey,model')return Promise.reject(Error('Unverified readiness options'));
 return inspect(options,fetch,'native-provider');
}
export function inspectProjectGroqReadinessForTests(options:Options,transport:typeof fetch){return inspect(options,transport,'simulated');}
async function inspect(options:Options,transport:typeof fetch,provenance:Report['provenance']):Promise<Report>{
 const {model,apiKey}=options;if(typeof model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,119}$/.test(model)||typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>1024||model.includes(apiKey)||typeof transport!=='function')return refuse();
 let providerHttpStatus:number|null=null,reason:Reason='transport-failed';
 const report=(status:Report['status'],why:Reason,modelListed=false,modelActive:boolean|null=null):Report=>Object.freeze({version:1,provider:'groq',model,status,reason:why,providerHttpStatus,modelListed,modelActive,provenance,modelGenerationRequests:0,executionAuthorized:false});
 try{
  const response=await transport('https://api.groq.com/openai/v1/models',{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+apiKey,Accept:'application/json'}});
  if(Number.isInteger(response.status)&&response.status>=100&&response.status<=599)providerHttpStatus=response.status;
  if(response.status!==200||!response.body){void response.body?.cancel().catch(()=>{});return report('unverified','http-rejected');}
  reason='metadata-unverified';const reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;
  try{for(;;){const p=await reader.read();if(p.done)break;bytes+=p.value.byteLength;if(bytes>65536){await reader.cancel();return report('unverified',reason);}parts.push(p.value);}}finally{reader.releaseLock();}
  const value=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!value||!Array.isArray(value.data)||value.data.length>512)return report('unverified',reason);
  const matches=value.data.filter((v:any)=>v?.id===model);if(matches.length>1)return report('unverified',reason);const found=matches[0];if(!found)return report('unavailable','model-missing');
  if(found.active!==undefined&&typeof found.active!=='boolean')return report('unverified',reason);
  if(found.active===false)return report('unavailable','model-inactive',true,false);
  return report('available','model-listed',true,found.active??null);
 }catch{return report('unverified',reason);}
}
