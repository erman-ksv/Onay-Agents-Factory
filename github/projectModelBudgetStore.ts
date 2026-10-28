import {consumeProjectBudgetExtensionPermit,type ProjectBudgetExtensionPermit} from '../orchestration/projectBudgetExtensionAuthorization.js';
import {createHash,randomUUID} from 'node:crypto';
import {parseProjectModelBudgetState,PROJECT_MODEL_BUDGET_ERROR,type ProjectModelBudgetState,type ProjectModelBudgetStore} from '../orchestration/projectModelBudget.js';
const REPO='erman-ksv/Onay-Agents-Factory',BASE='https://api.github.com/repos/'+REPO,SHA=/^[a-f0-9]{40}$/,KEY=/^[a-f0-9]{64}$/;
const FILE='project-model-budget.json';
const refuse=():never=>{throw Error(PROJECT_MODEL_BUDGET_ERROR);};
const gitHash=(kind:string,b:Buffer)=>createHash('sha1').update(Buffer.concat([Buffer.from(kind+' '+b.length+'\0'),b])).digest('hex');
const revision=(commit:string)=>createHash('sha256').update(commit).digest('hex');
/** Shared metadata only. Atomic non-force ref advancement is the CAS: sibling
 * commits cannot both win. A random commit nonce prevents identical competing
 * reservations from becoming a successful no-op. No write is retried. */
function createNativeBudgetStore(options:Readonly<{projectKey:string;token:string;transport?:typeof fetch}>){
 if(!KEY.test(options?.projectKey)||typeof options.token!=='string'||!options.token)return refuse();
 const {projectKey,token}=options,transport=options.transport??fetch,branch='state/project-model-budget/'+projectKey,ref='refs/heads/'+branch,path='/git/ref/heads/'+encodeURIComponent(branch),writes=new Set<string>();
 if(typeof transport!=='function')return refuse();
 async function api(endpoint:string,method='GET',body?:unknown,allowAbsent=false,allowConflict=false):Promise<any>{
  try{const response=await transport(BASE+endpoint,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body===undefined?{}:{body:JSON.stringify(body)})});
   if((allowAbsent&&response.status===404)||(allowConflict&&[409,422].includes(response.status))){void response.body?.cancel().catch(()=>undefined);return undefined;}
   if(response.status!==(method==='POST'?201:200)||!response.body){void response.body?.cancel().catch(()=>undefined);return refuse();}
   const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
   try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>524288){await reader.cancel();return refuse();}parts.push(part.value);}}finally{reader.releaseLock();}
   return JSON.parse(Buffer.concat(parts).toString('utf8'));
  }catch{return refuse();}
 }
 async function loadCommit(head:string){
  if(!SHA.test(head))return refuse();const commit=await api('/git/commits/'+head);
  if(commit.sha!==head||!SHA.test(commit.tree?.sha)||!Array.isArray(commit.parents)||commit.parents.length>1||commit.parents.some((p:any)=>!SHA.test(p?.sha)||p.sha===head))return refuse();
  const tree=await api('/git/trees/'+commit.tree.sha);if(tree.sha!==commit.tree.sha||tree.truncated!==false||!Array.isArray(tree.tree)||tree.tree.length!==1)return refuse();
  const entry=tree.tree[0];if(entry.path!==FILE||entry.mode!=='100644'||entry.type!=='blob'||!SHA.test(entry.sha))return refuse();
  const expectedTree=gitHash('tree',Buffer.concat([Buffer.from('100644 '+FILE+'\0'),Buffer.from(entry.sha,'hex')]));if(expectedTree!==tree.sha)return refuse();
  const blob=await api('/git/blobs/'+entry.sha);if(blob.sha!==entry.sha||blob.encoding!=='base64'||typeof blob.content!=='string'||blob.content.length>360000)return refuse();
  const encoded=blob.content.replace(/\s/g,''),bytes=Buffer.from(encoded,'base64');if(bytes.length>262144||bytes.toString('base64')!==encoded||gitHash('blob',bytes)!==entry.sha)return refuse();
  return {head,parents:commit.parents.map((p:any)=>p.sha) as string[],revision:revision(head),data:parseProjectModelBudgetState(JSON.parse(bytes.toString('utf8')))};
 }
 async function load(){
  const target=await api(path,'GET',undefined,true);if(target===undefined)return undefined;
  if(target.ref!==ref||target.object?.type!=='commit'||!SHA.test(target.object.sha))return refuse();
  return loadCommit(target.object.sha);
 }
 async function writeState(current:Awaited<ReturnType<typeof load>>,state:ProjectModelBudgetState,beforeAdvance?:()=>Promise<void>){
    const content=JSON.stringify(state)+'\n',bytes=Buffer.from(content),blobSha=gitHash('blob',bytes),treeSha=gitHash('tree',Buffer.concat([Buffer.from('100644 '+FILE+'\0'),Buffer.from(blobSha,'hex')]));
    const blob=await api('/git/blobs','POST',{content,encoding:'utf-8'});if(blob.sha!==blobSha)return refuse();
    const tree=await api('/git/trees','POST',{tree:[{path:FILE,mode:'100644',type:'blob',sha:blobSha}]});if(tree.sha!==treeSha)return refuse();
    const parents=current?[current.head]:[],message='Reserve project model budget metadata '+randomUUID(),commit=await api('/git/commits','POST',{message,tree:treeSha,parents});
    if(!SHA.test(commit.sha)||commit.tree?.sha!==treeSha||commit.message!==message||!Array.isArray(commit.parents)||JSON.stringify(commit.parents.map((p:any)=>p.sha))!==JSON.stringify(parents))return refuse();
    if(beforeAdvance)await beforeAdvance();
    const result=current?await api('/git/refs/heads/'+encodeURIComponent(branch),'PATCH',{sha:commit.sha,force:false},false,true):await api('/git/refs','POST',{ref,sha:commit.sha},false,true);
    if(result===undefined)return undefined;if(result.ref!==ref||result.object?.type!=='commit'||result.object.sha!==commit.sha)return refuse();return Object.freeze({revision:revision(commit.sha)});
 }
 const normal:ProjectModelBudgetStore=Object.freeze({
  async read(){try{const current=await load();return current?Object.freeze({revision:current.revision,data:current.data}):undefined;}catch{return refuse();}},
  async compareAndSwap(expectedRevision:string|undefined,input:ProjectModelBudgetState){
   try{if(expectedRevision!==undefined&&!KEY.test(expectedRevision))return refuse();const state=parseProjectModelBudgetState(input),attempt=expectedRevision??'initial';if(writes.has(attempt))return refuse();writes.add(attempt);
    const current=await load();if(current?.revision!==expectedRevision)return undefined;
    if(!current){if(state.reservations.length!==0)return refuse();}
    else if(state.grantSha256!==current.data.grantSha256||state.reservations.length!==current.data.reservations.length+1||JSON.stringify(state.reservations.slice(0,-1))!==JSON.stringify(current.data.reservations))return refuse();
    return writeState(current,state);
   }catch{return refuse();}
  },
 });
 return Object.freeze({normal,async readTransition(beforeHead:string,afterHead:string){
  try{
   if(!SHA.test(beforeHead)||!SHA.test(afterHead)||beforeHead===afterHead)return refuse();
   const after=await load();if(!after||after.head!==afterHead||after.parents.length!==1||after.parents[0]!==beforeHead)return refuse();
   const before=await loadCommit(beforeHead),again=await load();
   if(!again||again.head!==afterHead||JSON.stringify(again.data)!==JSON.stringify(after.data))return refuse();
   return Object.freeze({before:Object.freeze({revision:before.revision,data:before.data}),after:Object.freeze({revision:after.revision,data:after.data})});
  }catch{return refuse();}
 },async extend(permit:ProjectBudgetExtensionPermit){
  const command=consumeProjectBudgetExtensionPermit(permit,projectKey);
  try{if(writes.has(command.expectedRevision))return refuse();writes.add(command.expectedRevision);await command.assertAuthorized();const current=await load();
   if(!current||current.revision!==command.expectedRevision||JSON.stringify(current.data)!==JSON.stringify(command.before)||JSON.stringify(command.after.reservations)!==JSON.stringify(current.data.reservations)||command.after.grantSha256===current.data.grantSha256)return refuse();
   await command.assertAuthorized();const result=await writeState(current,command.after,command.assertAuthorized);if(!result)return refuse();const after=await load();if(!after||after.revision!==result.revision||JSON.stringify(after.data)!==JSON.stringify(command.after))return refuse();await command.assertAuthorized();return Object.freeze({revision:after.revision,data:after.data});
  }catch{return refuse();}
 }});
}
/** Reservation API remains append-only and cannot replace a grant. */
export function createProjectModelBudgetGitHubStore(options:Readonly<{projectKey:string;token:string;transport?:typeof fetch}>):ProjectModelBudgetStore{return createNativeBudgetStore(options).normal;}
/** Separate one-use extension API; never returned to the model budget ledger. */
export function createProjectModelBudgetGitHubExtensionStore(options:Readonly<{projectKey:string;token:string;transport?:typeof fetch}>){const store=createNativeBudgetStore(options);return Object.freeze({read:store.normal.read,extend:store.extend});}
/** GET-only reader for an exact direct-parent transition at the current head.
 * Historical JSON or a detached sibling commit cannot establish live lineage. */
export function createProjectModelBudgetGitHubLineageReader(options:Readonly<{projectKey:string;token:string;transport?:typeof fetch}>){const store=createNativeBudgetStore(options);return Object.freeze({readTransition:store.readTransition});}
