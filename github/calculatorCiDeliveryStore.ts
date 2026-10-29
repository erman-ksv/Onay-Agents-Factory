/** Create-only orphan metadata refs. Existing events are never moved/deleted.
 * A lost HTTP acknowledgement is uncertain, never permission to retry a write. */
import {createHash} from 'node:crypto';
import {calculatorCiDeliveryKey,parseCalculatorCiDeliveryRecord,type CalculatorCiDeliveryStore} from '../orchestration/calculatorCiDelivery.js';
export function createCalculatorCiDeliveryStore(token:string,transport:typeof fetch=fetch):CalculatorCiDeliveryStore{
 if(!token)throw Error('CI inbox token missing');
 const base='https://api.github.com/repos/erman-ksv/Onay-Agents-Factory',used=new Set<string>();
 const gitHash=(kind:string,b:Buffer)=>createHash('sha1').update(Buffer.concat([Buffer.from(kind+' '+b.length+'\0'),b])).digest('hex');
 const ref=(key:string)=>{if(!/^[a-f0-9]{64}$/.test(key))throw Error('CI inbox key invalid');return 'refs/heads/state/calculator-ci-delivery/'+key;};
 async function api(path:string,method='GET',body?:unknown,absent=false):Promise<any>{
  const r=await transport(base+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(absent&&r.status===404)return undefined;if(r.status!==(method==='POST'?201:200))throw Error('CI inbox HTTP refused');
  if(!r.body)throw Error('CI inbox empty body');const chunks:Uint8Array[]=[];let n=0;const reader=r.body.getReader();try{for(;;){const part=await reader.read();if(part.done)break;const b=part.value;n+=b.length;if(n>65536){await reader.cancel();throw Error('CI inbox response too large');}chunks.push(b);}}finally{reader.releaseLock();}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 return Object.freeze({
  async read(key:string){const name=ref(key),r=await api('/git/ref/heads/'+encodeURIComponent(name.slice(11)),'GET',undefined,true);if(r===undefined)return undefined;
   if(r.ref!==name||r.object?.type!=='commit'||!/^[a-f0-9]{40}$/.test(r.object.sha))throw Error('CI inbox ref invalid');
   const commit=await api('/git/commits/'+r.object.sha);if(commit.sha!==r.object.sha||commit.parents?.length!==0||!/^[a-f0-9]{40}$/.test(commit.tree?.sha))throw Error('CI inbox commit invalid');
   const tree=await api('/git/trees/'+commit.tree.sha);if(tree.sha!==commit.tree.sha||tree.truncated!==false||tree.tree?.length!==1)throw Error('CI inbox tree invalid');const entry=tree.tree[0];
   if(entry.path!=='calculator-ci-delivery.json'||entry.mode!=='100644'||entry.type!=='blob'||!/^[a-f0-9]{40}$/.test(entry.sha))throw Error('CI inbox blob invalid');
   const blob=await api('/git/blobs/'+entry.sha);if(blob.sha!==entry.sha||blob.encoding!=='base64'||typeof blob.content!=='string'||blob.content.length>32768)throw Error('CI inbox bytes invalid');
   const data=Buffer.from(blob.content.replace(/\s/g,''),'base64');if(gitHash('blob',data)!==entry.sha||data.length>12000)throw Error('CI inbox hash invalid');return parseCalculatorCiDeliveryRecord(JSON.parse(data.toString('utf8')));
  },
  async create(key:string,input:unknown){const name=ref(key);if(used.has(key))throw Error('CI inbox write already attempted');used.add(key);const record=parseCalculatorCiDeliveryRecord(input);if(calculatorCiDeliveryKey({version:1,repository:record.repository,planFingerprint:record.planFingerprint,taskId:record.previousTaskId,candidateSha:record.candidateSha,ciRunId:record.ciRunId})!==key)throw Error('CI inbox identity mismatch');const content=JSON.stringify(record)+'\n',bytes=Buffer.from(content),blobSha=gitHash('blob',bytes),treeSha=gitHash('tree',Buffer.concat([Buffer.from('100644 calculator-ci-delivery.json\0'),Buffer.from(blobSha,'hex')]));
   const b=await api('/git/blobs','POST',{content,encoding:'utf-8'});if(b.sha!==blobSha)throw Error('CI inbox blob mismatch');
   const t=await api('/git/trees','POST',{tree:[{path:'calculator-ci-delivery.json',mode:'100644',type:'blob',sha:blobSha}]});if(t.sha!==treeSha)throw Error('CI inbox tree mismatch');
   const c=await api('/git/commits','POST',{message:'Record verified Calculator CI delivery awaiting owner budget',tree:treeSha,parents:[]});if(!/^[a-f0-9]{40}$/.test(c.sha)||c.tree?.sha!==treeSha||c.parents?.length!==0)throw Error('CI inbox commit mismatch');
   const r=await api('/git/refs','POST',{ref:name,sha:c.sha});if(r.ref!==name||r.object?.type!=='commit'||r.object.sha!==c.sha)throw Error('CI inbox create uncertain');
  }
 });
}
