import {createHash} from 'node:crypto';
import {projectPlanTarget,type PreparedProjectPlan} from '../orchestration/projectPlan.js';
import {projectTargetProfile,assertProjectTargetScope} from '../orchestration/projectTargetRegistry.js';
import {assertProjectSnapshotIdentity,projectSnapshotSources,verifyProjectSnapshot,projectSourceContainsSecrets,type ProjectSourceSnapshot} from '../github/projectSourceSnapshot.js';
import {applyBoundedPatches,BOUNDED_PATCH_LIMITS,type BoundedPatch} from './boundedPatch.js';
import {inspectProposedChanges} from '../agents/security/agent.js';
import {reviewChangeSet} from '../agents/reviewer/agent.js';

export const PROJECT_CHANGES_ERROR='Project changes are unverified, unsafe, stale or outside the task scope. No write or publication is authorized.';
const refuse=():never=>{throw Error(PROJECT_CHANGES_ERROR);};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function clone(v:unknown,depth=0,state={nodes:2048}):any{
 if(depth>12||--state.nodes<0)return refuse();if(typeof v==='string'){if(v.length>32768)return refuse();return v;}if(v===null||typeof v==='boolean'||(typeof v==='number'&&Number.isSafeInteger(v)))return v;
 if(!v||typeof v!=='object')return refuse();const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(v).some(k=>typeof k!=='string'||!Object.hasOwn(ds[k]!,'value')))return refuse();
 if(Array.isArray(v)){if(v.length>64||Object.getPrototypeOf(v)!==Array.prototype||Reflect.ownKeys(v).length!==v.length+1)return refuse();return Array.from({length:v.length},(_,i)=>{if(!Object.hasOwn(ds,String(i)))return refuse();return clone(ds[String(i)]!.value,depth+1,state);});}
 if(Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==Object.keys(v).length||Object.keys(v).length>16)return refuse();return Object.fromEntries(Object.keys(v).map(k=>[k,clone(ds[k]!.value,depth+1,state)]));
}
function exact(v:any,keys:string[]){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
function text(v:unknown,max:number):v is string{return typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)&&!projectSourceContainsSecrets(v);}
type File=Readonly<{path:string;content:string;message:string}>;
export type PreparedProjectChanges=Readonly<{repository:string;planFingerprint:string;targetProfileSha256:string;taskId:string;baseRef:string;baseSha:string;branch:string;summarySha256:string;digest:string;files:readonly Readonly<{path:string;operation:'create'|'patch';sourceSha256?:string;contentSha256:string;bytes:number}>[];gates:Readonly<{secretScan:'passed';policyReview:'passed';independentReview:'required';tests:'required';ci:'required';publicationAuthorized:false}>;unverifiedAreas:readonly string[]}>;
const prepared=new WeakMap<PreparedProjectChanges,{snapshot:ProjectSourceSnapshot;files:readonly File[];summary:string}>();
/** Pure preparation plus fresh read-only source checks. No file, branch, model
 * or receipt is written. Static policy checks never substitute live reviews. */
export async function prepareProjectChanges(plan:PreparedProjectPlan,taskId:string,snapshot:ProjectSourceSnapshot,input:unknown):Promise<PreparedProjectChanges>{
 try{
  assertProjectSnapshotIdentity(snapshot,plan,taskId);const target=projectPlanTarget(plan),profile=projectTargetProfile(target,plan.repository),r=clone(input);if(Buffer.byteLength(JSON.stringify(r))>32768||!exact(r,['summary','changes'])||!text(r.summary,800)||!Array.isArray(r.changes)||!r.changes.length||r.changes.length>Math.min(profile.maxFiles,BOUNDED_PATCH_LIMITS.files))return refuse();
  await verifyProjectSnapshot(snapshot);const sources=projectSnapshotSources(snapshot),files:File[]=[],metadata:Array<PreparedProjectChanges['files'][number]>=[];const seen=new Set<string>();let changed=0,totalBytes=[...sources.values()].reduce((n,s)=>n+Buffer.byteLength(s),0);
  for(const c of r.changes){
   if(!c||typeof c.path!=='string'||!snapshot.changePaths.includes(c.path)||seen.has(c.path)||!text(c.message,200))return refuse();seen.add(c.path);assertProjectTargetScope(target,{repository:plan.repository,branch:plan.branch,changePaths:[c.path]});let file:File;
   if(c.operation==='create'){
    if(!exact(c,['operation','path','content','message'])||sources.has(c.path)||!snapshot.files.some(f=>f.path===c.path&&f.exists===false)||!text(c.content,profile.maxChangedCharacters)||Buffer.byteLength(c.content)>profile.maxNewFileBytes)return refuse();changed+=c.content.length;file={path:c.path,content:c.content,message:c.message};
   }else if(c.operation==='patch'){
    if(!exact(c,['operation','path','sourceSha256','edits','message'])||!sources.has(c.path)||!Array.isArray(c.edits)||!c.edits.length||c.edits.some((e:any)=>!exact(e,['before','after'])||typeof e.before!=='string'||typeof e.after!=='string'))return refuse();
    for(const e of c.edits)changed+=e.before.length+e.after.length;const [result]=applyBoundedPatches([c as BoundedPatch],sources,snapshot.changePaths);file=Object.freeze({...result!});
   }else return refuse();
   if(changed>profile.maxChangedCharacters||Buffer.byteLength(file.content)>profile.maxSourceBytes||Buffer.from(file.content).toString('utf8')!==file.content||projectSourceContainsSecrets(file.content))return refuse();totalBytes+=Buffer.byteLength(file.content)-Buffer.byteLength(sources.get(file.path)??'');if(totalBytes>profile.maxSourceBytes)return refuse();
   files.push(Object.freeze(file));metadata.push(Object.freeze({path:file.path,operation:c.operation,...(sources.has(file.path)?{sourceSha256:hash(sources.get(file.path)!)}:{}),contentSha256:hash(file.content),bytes:Buffer.byteLength(file.content)}));
  }
  if(inspectProposedChanges(files).status!=='clean'||!reviewChangeSet({goal:r.summary,files,allowWorkflowChanges:false,allowBuildConfigChanges:false}).ready)return refuse();
  const data={repository:plan.repository,planFingerprint:plan.fingerprint,targetProfileSha256:profile.sha256,taskId,baseRef:snapshot.baseRef,baseSha:snapshot.baseSha,branch:plan.branch,summarySha256:hash(r.summary),files:Object.freeze(metadata)};
  await verifyProjectSnapshot(snapshot);const result:PreparedProjectChanges=Object.freeze({...data,digest:hash(JSON.stringify(data)),gates:Object.freeze({secretScan:'passed',policyReview:'passed',independentReview:'required',tests:'required',ci:'required',publicationAuthorized:false}),unverifiedAreas:Object.freeze(['Unshown unchanged source','Independent Security Reviewer Tester assessments','Runtime/browser acceptance and exact-candidate CI','Publication and product completion'])});prepared.set(result,{snapshot,files:Object.freeze(files),summary:r.summary});return result;
 }catch{return refuse();}
}
function record(changes:PreparedProjectChanges){const r=prepared.get(changes);if(!r)return refuse();return r;}
/** HOST ONLY. Default serialization of PreparedProjectChanges is metadata only. */
export function projectChangesFiles(changes:PreparedProjectChanges){try{const r=record(changes);projectSnapshotSources(r.snapshot);return Object.freeze(r.files.map(f=>Object.freeze({...f})));}catch{return refuse();}}
export async function verifyProjectChanges(changes:PreparedProjectChanges){try{await verifyProjectSnapshot(record(changes).snapshot);}catch{return refuse();}}
