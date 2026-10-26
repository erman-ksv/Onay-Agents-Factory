import {createHash} from 'node:crypto';
import {assertValidBranchRef} from './githubClient.js';
import {scanForSecrets} from './secretScanner.js';
import {projectPlanTarget,type PreparedProjectPlan,type ProjectPlanTask} from '../orchestration/projectPlan.js';
import {projectTargetProfile,assertProjectTargetScope,type ApprovedProjectTarget} from '../orchestration/projectTargetRegistry.js';

export const PROJECT_SOURCE_ERROR='Project source evidence is unverified or stale. No absence, execution or publication is authorized.';
const refuse=():never=>{throw Error(PROJECT_SOURCE_ERROR);};
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const path=(s:unknown):s is string=>typeof s==='string'&&s.length>0&&s.length<=240&&!/[\u0000-\u001f\u007f\\]/.test(s)&&s.split('/').every(p=>!!p&&p!=='.'&&p!=='..');
export const projectSourceContainsSecrets=(text:string)=>scanForSecrets(text).length>0||/(?:^|[^A-Za-z0-9_])(?:gsk_[A-Za-z0-9_-]{20,}|gh[opusr]_[A-Za-z0-9_]{20,})/.test(text);
type ProjectTreeEntry={path:string;sha:string;type:string;mode:string;size?:number};
export type ProjectSnapshotReader=Readonly<{
 getHead:(ref:string)=>Promise<string>;
 readCommit:(sha:string)=>Promise<{sha:string;treeSha:string;parents:readonly string[]}>;
 readTree:(sha:string)=>Promise<{sha:string;truncated:boolean;tree:readonly ProjectTreeEntry[]}>;
 readBlob:(sha:string)=>Promise<{sha:string;encoding:string;content:string}>;
}>;
export type ProjectSourceSnapshot=Readonly<{repository:string;planFingerprint:string;targetProfileSha256:string;taskId:string;baseRef:string;baseSha:string;changePaths:readonly string[];sourceBytes:number;files:readonly Readonly<{path:string;exists:boolean;blobSha?:string;sourceSha256?:string;bytes?:number}>[];unverifiedAreas:readonly string[];executionAuthorized:false}>;
type SourceRecord={plan:PreparedProjectPlan;reader:ProjectSnapshotReader;sources:ReadonlyMap<string,string>;stopped:boolean};
const records=new WeakMap<ProjectSourceSnapshot,SourceRecord>();
/** HOST ONLY test/composition entry. Production uses the fixed GitHub adapter
 * below. No model or JSON can supply a reader or recreate snapshot authority. */
export async function loadProjectTaskSnapshot(plan:PreparedProjectPlan,taskId:string,reader:ProjectSnapshotReader,anchor?:Readonly<{ref:string;sha:string}>):Promise<ProjectSourceSnapshot>{
 try{
  const target=projectPlanTarget(plan),profile=projectTargetProfile(target,plan.repository),task=plan.tasks.find(t=>t.id===taskId);if(!task||plan.status!=='planned')return refuse();
  if(anchor&&(Object.getPrototypeOf(anchor)!==Object.prototype||Reflect.ownKeys(anchor).length!==2||!['ref','sha'].every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(anchor,k)??{},'value'))))return refuse();
  const baseRef=anchor?.ref??plan.request.baseRef,baseSha=anchor?.sha??plan.request.baseSha;
  if(!sha(baseSha)||!((baseRef===plan.request.baseRef&&baseSha===plan.request.baseSha)||baseRef===plan.branch))return refuse();assertValidBranchRef(baseRef);
  assertProjectTargetScope(target,{repository:plan.repository,branch:plan.branch,changePaths:task.paths});
  const refs=async()=>{if(await reader.getHead(plan.request.baseRef)!==plan.request.baseSha||await reader.getHead(baseRef)!==baseSha)return refuse();};await refs();
  const commits=new Map<string,Awaited<ReturnType<ProjectSnapshotReader['readCommit']>>>();
  async function commit(id:string){let c=commits.get(id);if(!c){c=await reader.readCommit(id);if(c.sha!==id||!sha(c.treeSha)||!Array.isArray(c.parents)||c.parents.length>2||c.parents.some(p=>!sha(p)||p===id))return refuse();c={sha:c.sha,treeSha:c.treeSha,parents:[...c.parents]};commits.set(id,c);}return c;}
  const current=await commit(baseSha),queue=[baseSha],seen=new Set<string>();let ancestor=false;
  while(queue.length&&seen.size<32){const id=queue.shift()!;if(id===plan.request.baseSha){ancestor=true;break;}if(seen.has(id))continue;seen.add(id);queue.push(...(await commit(id)).parents);}
  if(!ancestor)return refuse();const result=await reader.readTree(current.treeSha);if(result.sha!==current.treeSha||result.truncated!==false||!Array.isArray(result.tree)||result.tree.length>1024)return refuse();
  const tree=new Map<string,ProjectTreeEntry>();
  for(const e of result.tree){if(!e||!path(e.path)||!sha(e.sha)||tree.has(e.path)||!['blob','tree','commit'].includes(e.type)||typeof e.mode!=='string')return refuse();tree.set(e.path,{...e});}
  const sources=new Map<string,string>(),files:Array<ProjectSourceSnapshot['files'][number]>=[];let sourceBytes=0;
  for(const p of [...new Set([...task.paths,...plan.request.requiredPaths])].sort()){
   const parts=p.split('/');for(let i=1;i<parts.length;i++){const parent=parts.slice(0,i).join('/'),e=tree.get(parent);if((e&&(e.type!=='tree'||e.mode!=='040000'))||(!e&&[...tree.keys()].some(k=>k.startsWith(parent+'/'))))return refuse();}
   const e=tree.get(p);if(!e){if([...tree.keys()].some(k=>k.startsWith(p+'/')))return refuse();files.push(Object.freeze({path:p,exists:false}));continue;}
   if(e.type!=='blob'||e.mode!=='100644'||(e.size!==undefined&&(!Number.isSafeInteger(e.size)||e.size<0||e.size>profile.maxSourceBytes)))return refuse();
   const b=await reader.readBlob(e.sha);if(b.sha!==e.sha||b.encoding!=='base64'||typeof b.content!=='string'||b.content.length>profile.maxSourceBytes*2)return refuse();const encoded=b.content.replace(/\r?\n/g,''),bytes=Buffer.from(encoded,'base64'),content=bytes.toString('utf8');
   if(bytes.toString('base64')!==encoded||!Buffer.from(content).equals(bytes)||createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex')!==e.sha||(e.size!==undefined&&e.size!==bytes.length)||projectSourceContainsSecrets(content))return refuse();
   sourceBytes+=bytes.length;if(sourceBytes>profile.maxSourceBytes)return refuse();sources.set(p,content);files.push(Object.freeze({path:p,exists:true,blobSha:e.sha,sourceSha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}));
  }
  await refs();const snapshot:ProjectSourceSnapshot=Object.freeze({repository:plan.repository,planFingerprint:plan.fingerprint,targetProfileSha256:profile.sha256,taskId,baseRef,baseSha,changePaths:Object.freeze([...task.paths]),sourceBytes,files:Object.freeze(files),unverifiedAreas:Object.freeze(['Unselected repository source','Dependency acceptance and runtime behavior','Independent reviews, tests and exact-candidate CI']),executionAuthorized:false});records.set(snapshot,{plan,reader,sources,stopped:false});return snapshot;
 }catch{return refuse();}
}
function record(snapshot:ProjectSourceSnapshot){const r=records.get(snapshot);if(!r||r.stopped)return refuse();return r;}
/** Full code stays in host memory. Never serialize this map into model tools. */
export function projectSnapshotSources(snapshot:ProjectSourceSnapshot){return new Map(record(snapshot).sources);}
export function assertProjectSnapshotIdentity(snapshot:ProjectSourceSnapshot,plan:PreparedProjectPlan,taskId:string){const r=record(snapshot);if(r.plan!==plan||snapshot.taskId!==taskId)return refuse();return snapshot;}
export async function verifyProjectSnapshot(snapshot:ProjectSourceSnapshot){const r=record(snapshot);try{if(await r.reader.getHead(r.plan.request.baseRef)!==r.plan.request.baseSha||await r.reader.getHead(snapshot.baseRef)!==snapshot.baseSha)return refuse();}catch{r.stopped=true;return refuse();}}
/** After an acknowledged feature-ref update, the old anchor is expected to
 * move. The immutable owner root still must match; publisher verifies new head. */
export async function verifyProjectSnapshotRoot(snapshot:ProjectSourceSnapshot){const r=record(snapshot);try{if(await r.reader.getHead(r.plan.request.baseRef)!==r.plan.request.baseSha)return refuse();}catch{r.stopped=true;return refuse();}}
/** Supplies the real source callback required by generic task admission. */
export function createProjectSnapshotSourceGuard(snapshot:ProjectSourceSnapshot){const r=record(snapshot);return async(plan:PreparedProjectPlan,task:ProjectPlanTask)=>{if(plan!==r.plan||plan.tasks.find(t=>t.id===snapshot.taskId)!==task)return refuse();await verifyProjectSnapshot(snapshot);};}

/** Fixed endpoint, target-derived repository, GET only, no redirect or retry. */
export function createProjectSnapshotReader(target:ApprovedProjectTarget,repository:string,token:string,transport:typeof fetch=fetch):ProjectSnapshotReader{
 const profile=projectTargetProfile(target,repository);if(typeof token!=='string'||!token||typeof transport!=='function')return refuse();
 async function read(path:string):Promise<any>{try{const response=await transport('https://api.github.com/repos/'+profile.repository+path,{method:'GET',redirect:'error',headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(15000)});if(response.status!==200||!response.body){void response.body?.cancel().catch(()=>undefined);return refuse();}const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{for(;;){const c=await reader.read();if(c.done)break;size+=c.value.length;if(size>1048576){await reader.cancel();return refuse();}chunks.push(c.value);}}finally{reader.releaseLock();}const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))return refuse();return value;}catch{return refuse();}}
 return Object.freeze({
  async getHead(ref:string){try{assertValidBranchRef(ref);const r=await read('/git/ref/heads/'+encodeURIComponent(ref));if(r.ref!=='refs/heads/'+ref||r.object?.type!=='commit'||!sha(r.object.sha))return refuse();return r.object.sha;}catch{return refuse();}},
  async readCommit(id:string){if(!sha(id))return refuse();const r=await read('/git/commits/'+id);if(r.sha!==id||!sha(r.tree?.sha)||!Array.isArray(r.parents)||r.parents.length>2||r.parents.some((p:any)=>!sha(p?.sha)))return refuse();return {sha:id,treeSha:r.tree.sha,parents:r.parents.map((p:any)=>p.sha)};},
  async readTree(id:string){if(!sha(id))return refuse();const r=await read('/git/trees/'+id+'?recursive=1');if(r.sha!==id||typeof r.truncated!=='boolean'||!Array.isArray(r.tree))return refuse();return {sha:id,truncated:r.truncated,tree:r.tree};},
  async readBlob(id:string){if(!sha(id))return refuse();const r=await read('/git/blobs/'+id);if(r.sha!==id||typeof r.encoding!=='string'||typeof r.content!=='string')return refuse();return {sha:id,encoding:r.encoding,content:r.content};},
 });
}
export async function loadGitHubProjectTaskSnapshot(options:Readonly<{plan:PreparedProjectPlan;taskId:string;token:string;anchor?:Readonly<{ref:string;sha:string}>;transport?:typeof fetch}>){try{if(Object.hasOwn(options,'reader'))return refuse();const target=projectPlanTarget(options.plan),reader=createProjectSnapshotReader(target,options.plan.repository,options.token,options.transport);return await loadProjectTaskSnapshot(options.plan,options.taskId,reader,options.anchor);}catch{return refuse();}}
