import {createHash} from 'node:crypto';
import {assertValidBranchRef} from '../github/githubClient.js';
import {scanForSecrets} from '../github/secretScanner.js';
import {projectTargetProfile,registeredProjectTargetProfile,assertProjectTargetScope,type ApprovedProjectTarget} from './projectTargetRegistry.js';
import type {ProjectBudgetIdentity} from './projectBudgetAuthorization.js';

export const PROJECT_PLAN_ERROR='Project plan is unverified or outside the host-approved scope. No execution is authorized.';
const refuse=():never=>{throw Error(PROJECT_PLAN_ERROR);};
function canonical(v:unknown,depth=0,state={remaining:2048}):string{
 if(depth>16||--state.remaining<0)return refuse();if(typeof v==='string'&&v.length>24576)return refuse();if(v===null||typeof v==='boolean'||typeof v==='string')return JSON.stringify(v);if(typeof v==='number'&&Number.isSafeInteger(v))return JSON.stringify(v);
 if(!v||typeof v!=='object')return refuse();const descriptors=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(v).some(k=>typeof k!=='string'||!Object.hasOwn(descriptors[k]!,'value')))return refuse();
 if(Array.isArray(v)){if(v.length>128||Object.getPrototypeOf(v)!==Array.prototype||Reflect.ownKeys(v).length!==v.length+1||Object.keys(v).length!==v.length)return refuse();return '['+Array.from({length:v.length},(_,i)=>{if(!Object.hasOwn(descriptors,String(i)))return refuse();return canonical(descriptors[String(i)]!.value,depth+1,state);}).join(',')+']';}
 if(Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).length>32||Reflect.ownKeys(v).length!==Object.keys(v).length)return refuse();return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(descriptors[k]!.value,depth+1,state)).join(',')+'}';
}
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
function data(v:unknown,max:number):any{const s=canonical(v);if(Buffer.byteLength(s)>max||scanForSecrets(s).length)return refuse();return JSON.parse(s);}
function exact(v:any,keys:string[]){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
function text(v:unknown,min:number,max:number):v is string{return typeof v==='string'&&v===v.trim()&&v.length>=min&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v)&&!v.includes('```');}
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-z][a-z0-9-]{1,47}$/.test(v);
function list(v:any,max:number,valid:(s:any)=>boolean){return Array.isArray(v)&&v.length<=max&&v.every(valid)&&new Set(v).size===v.length;}
export type ProjectGoal=Readonly<{version:1;id:string;goal:string;baseRef:string;baseSha:string;provider:'groq';acceptance:readonly Readonly<{id:string;scenario:string}>[];requiredPaths:readonly string[];readOnlyPaths?:readonly string[]}>;
export type ProjectPlanTask=Readonly<{id:string;role:'coder'|'frontend';goal:string;acceptanceIds:readonly string[];paths:readonly string[];dependsOn:readonly string[]}>;
export type PreparedProjectPlan=Readonly<{version:1;request:ProjectGoal;repository:string;targetProfileSha256:string;requirementsSha256:string;ownerFingerprint:string;fingerprint:string;branch:string;tasks:readonly ProjectPlanTask[];blockers:readonly string[];unverifiedAreas:readonly string[];status:'planned'|'blocked';executionAuthorized:false;publicationAuthorized:false;wholeAppCompleted:false}>;
const goals=new WeakMap<object,ApprovedProjectTarget>(),plans=new WeakMap<PreparedProjectPlan,ApprovedProjectTarget>();
/** Owner goal/criteria and target come from trusted host composition. A model
 * supplies only tasks, blockers and uncertainty; never repository/criteria/IDs. */
export function prepareProjectGoal(target:ApprovedProjectTarget,input:unknown){
 try{
  const r=data(input,16384);if(!exact(r,['version','id','goal','baseRef','baseSha','provider','acceptance','requiredPaths',...(Object.hasOwn(r,'readOnlyPaths')?['readOnlyPaths']:[])])||r.version!==1||!id(r.id)||!text(r.goal,12,4000)||!text(r.baseRef,1,120)||typeof r.baseSha!=='string'||!/^[a-f0-9]{40}$/.test(r.baseSha)||r.provider!=='groq')return refuse();
  // Repository is obtained from the host registry, not from owner/model JSON.
  const p=registeredProjectTargetProfile(target);assertValidBranchRef(r.baseRef);assertValidBranchRef(p.branchPrefix+r.id);
  if(!Array.isArray(r.acceptance)||r.acceptance.length<1||r.acceptance.length>32||r.acceptance.some((a:any)=>!exact(a,['id','scenario'])||!id(a.id)||!text(a.scenario,8,240))||new Set(r.acceptance.map((a:any)=>a.id)).size!==r.acceptance.length||!list(r.requiredPaths,64,(s:any)=>typeof s==='string'&&p.writablePaths.includes(s))||!r.requiredPaths.length)return refuse();
  if(Object.hasOwn(r,'readOnlyPaths')&&(!list(r.readOnlyPaths,64,(s:any)=>typeof s==='string'&&(p.readOnlyPaths??[]).includes(s))||!r.readOnlyPaths.length))return refuse();
  const request:ProjectGoal=Object.freeze({...r,acceptance:Object.freeze(r.acceptance.map((a:any)=>Object.freeze({...a}))),requiredPaths:Object.freeze([...r.requiredPaths]),...(Object.hasOwn(r,'readOnlyPaths')?{readOnlyPaths:Object.freeze([...r.readOnlyPaths])}:{})});
  const requirementsSha256=digest({acceptance:request.acceptance,requiredPaths:request.requiredPaths}),ownerFingerprint=digest({request,repository:p.repository,targetProfileSha256:p.sha256,requirementsSha256});
  const goal=Object.freeze({request,repository:p.repository,targetProfileSha256:p.sha256,requirementsSha256,ownerFingerprint,branch:p.branchPrefix+request.id});goals.set(goal,target);return goal;
 }catch{return refuse();}
}
// The registry capability carries no enumerable data. Resolve it through the
// host-only registry API rather than trusting an independently supplied repo.
export function projectPlanTaskId(goal:ReturnType<typeof prepareProjectGoal>,index:number){if(!goals.has(goal)||!Number.isInteger(index)||index<1||index>8)return refuse();return goal.request.id.slice(0,30)+'-'+goal.ownerFingerprint.slice(0,6)+'-t'+String(index).padStart(2,'0');}
export function createProjectPlan(goal:ReturnType<typeof prepareProjectGoal>,proposal:unknown):PreparedProjectPlan{
 try{
  const target=goals.get(goal);if(!target)return refuse();const p=projectTargetProfile(target,goal.repository),r=data(proposal,24576);
  if(!exact(r,['tasks','blockers','unverifiedAreas'])||!Array.isArray(r.tasks)||r.tasks.length>8||!list(r.blockers,16,(s:any)=>text(s,8,240))||!list(r.unverifiedAreas,16,(s:any)=>text(s,8,240)))return refuse();
  const ids=r.tasks.map((_:unknown,i:number)=>projectPlanTaskId(goal,i+1)),criteria=new Set(goal.request.acceptance.map(a=>a.id));
  const tasks:ProjectPlanTask[]=r.tasks.map((t:any,i:number)=>{
   if(!exact(t,['id','role','goal','acceptanceIds','paths','dependsOn'])||t.id!==ids[i]||!['coder','frontend'].includes(t.role)||!text(t.goal,12,800)||!list(t.acceptanceIds,32,(s:any)=>criteria.has(s))||!t.acceptanceIds.length||!list(t.paths,p.maxFiles,(s:any)=>p.writablePaths.includes(s))||!t.paths.length||!list(t.dependsOn,7,(s:any)=>ids.includes(s))||t.dependsOn.includes(t.id))return refuse();
   assertProjectTargetScope(target,{repository:p.repository,branch:goal.branch,changePaths:t.paths});return Object.freeze({...t,acceptanceIds:Object.freeze([...t.acceptanceIds]),paths:Object.freeze([...t.paths]),dependsOn:Object.freeze([...t.dependsOn])});
  });
  const byId=new Map(tasks.map(t=>[t.id,t])),active=new Set<string>(),done=new Set<string>();
  function visit(id:string){if(active.has(id))return refuse();if(done.has(id))return;active.add(id);for(const d of byId.get(id)!.dependsOn)visit(d);active.delete(id);done.add(id);}tasks.forEach(t=>visit(t.id));
  const depends=(a:ProjectPlanTask,b:string):boolean=>a.dependsOn.includes(b)||a.dependsOn.some(id=>depends(byId.get(id)!,b));
  for(const a of tasks)for(const b of tasks)if(a.id!==b.id&&a.paths.some(s=>b.paths.includes(s))&&!depends(a,b.id)&&!depends(b,a.id))return refuse();
  const blockers=[...r.blockers];for(const c of goal.request.acceptance)if(!tasks.some(t=>t.acceptanceIds.includes(c.id)))blockers.push('Missing acceptance coverage: '+c.id+'.');for(const path of goal.request.requiredPaths)if(!tasks.some(t=>t.paths.includes(path)))blockers.push('Missing required path coverage: '+path+'.');
  const plan:PreparedProjectPlan=Object.freeze({version:1,...goal,fingerprint:digest({request:goal.request,repository:p.repository,targetProfileSha256:p.sha256,proposal:r}),tasks:Object.freeze(tasks),blockers:Object.freeze([...new Set<string>(blockers)]),unverifiedAreas:Object.freeze(['Source inspection, dependencies, model reviews, host tests, candidate CI and delivery are unverified.',...r.unverifiedAreas]),status:blockers.length?'blocked':'planned',executionAuthorized:false,publicationAuthorized:false,wholeAppCompleted:false});plans.set(plan,target);return plan;
 }catch{return refuse();}
}
export function projectPlanTarget(plan:PreparedProjectPlan){const target=plans.get(plan);if(!target)return refuse();return target;}
export function projectPlanBudgetIdentity(plan:PreparedProjectPlan):ProjectBudgetIdentity{projectPlanTarget(plan);return Object.freeze({projectId:plan.request.id,repository:plan.repository,planFingerprint:plan.fingerprint,ownerFingerprint:plan.ownerFingerprint,taskIds:Object.freeze(plan.tasks.map(t=>t.id))});}
export function buildProjectPlanningContext(goal:ReturnType<typeof prepareProjectGoal>){if(!goals.has(goal))return refuse();const p=projectTargetProfile(goals.get(goal),goal.repository);const context=JSON.stringify({ownerGoal:goal.request.goal,repository:goal.repository,baseSha:goal.request.baseSha,profileSha256:p.sha256,fixedAcceptance:goal.request.acceptance,requiredPaths:goal.request.requiredPaths,...(goal.request.readOnlyPaths?{readOnlyPaths:goal.request.readOnlyPaths}:{}),writablePaths:p.writablePaths,maxFilesPerTask:p.maxFiles,exactTaskIds:Array.from({length:8},(_,i)=>projectPlanTaskId(goal,i+1)),instruction:'Propose tasks, blockers and unverifiedAreas only. Do not claim inspected sources or completed execution. Overlapping paths need ordered dependencies.'});if(Buffer.byteLength(context)>16000)return refuse();return context;}
