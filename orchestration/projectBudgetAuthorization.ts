import {createProjectModelBudgetGitHubStore} from '../github/projectModelBudgetStore.js';
import {createHash} from 'node:crypto';
import {projectTargetProfile,type ApprovedProjectTarget} from './projectTargetRegistry.js';
import {openProjectModelBudget,parseProjectModelGrant,type ProjectModelBudget,type ProjectModelBudgetStore,type ProjectModelCharge} from './projectModelBudget.js';
export const PROJECT_AUTHORIZATION_ERROR='Project owner approval, complete history or task scope is unverified. No model call or budget reset is authorized.';
const refuse=():never=>{throw Error(PROJECT_AUTHORIZATION_ERROR);};
const SHA=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const hash=(b:string)=>createHash('sha256').update(b).digest('hex');
function plain(x:unknown):x is Record<string,unknown>{return !!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;}
function exact(x:Record<string,unknown>,keys:string[]){return Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));}
function safeId(x:unknown):x is string{return typeof x==='string'&&ID.test(x)&&!/(?:gsk_|gh[pousr]_)[A-Za-z0-9_-]{20,}/.test(x);}
function canonical(value:unknown,depth=0):string{
 if(depth>20)return refuse();if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'){if(!Number.isSafeInteger(value))return refuse();return JSON.stringify(value);}
 if(Array.isArray(value))return '['+value.map(x=>canonical(x,depth+1)).join(',')+']';if(!plain(value))return refuse();
 const keys=Object.keys(value).sort(),d=Object.getOwnPropertyDescriptors(value);if(keys.some(k=>!Object.hasOwn(d[k]!,'value')))return refuse();
 return '{'+keys.map(k=>JSON.stringify(k)+':'+canonical(d[k]!.value,depth+1)).join(',')+'}';
}
export type ProjectBudgetIdentity=Readonly<{projectId:string;repository:string;planFingerprint:string;ownerFingerprint:string;taskIds:readonly string[]}>;
export type ProjectHistoryObservation=Readonly<{scopeId:string;kind:'cumulative-scope-total';charge:ProjectModelCharge;evidenceSha256:string}>;
export type ProjectBudgetHistory=Readonly<{version:1;projectId:string;repository:string;planFingerprint:string;observations:readonly ProjectHistoryObservation[]}>;
/** Raw phase counters must first be reconciled by an authenticated audit. These
 * observations are cumulative totals for each scope, not independent phases.
 * The native owner approval binds their digest; missing coverage never means 0. */
export function reconcileProjectBudgetHistory(input:unknown,identity:ProjectBudgetIdentity){
 if(!plain(input)||!exact(input,['version','projectId','repository','planFingerprint','observations'])||input.version!==1||input.projectId!==identity.projectId||input.repository!==identity.repository||input.planFingerprint!==identity.planFingerprint||!Array.isArray(input.observations)||input.observations.length>512)return refuse();
 const required=['planning',...identity.taskIds],totals=new Map<string,ProjectModelCharge>();if(new Set(required).size!==required.length)return refuse();
 for(const o of input.observations){if(!plain(o)||!exact(o,['scopeId','kind','charge','evidenceSha256'])||typeof o.scopeId!=='string'||!required.includes(o.scopeId)||o.kind!=='cumulative-scope-total'||typeof o.evidenceSha256!=='string'||!SHA.test(o.evidenceSha256)||!plain(o.charge)||!exact(o.charge,['requests','requestBytes','reservedTokens'])||Object.values(o.charge).some(v=>typeof v!=='number'||!Number.isSafeInteger(v)||v<0))return refuse();
  const c=o.charge as ProjectModelCharge,previous=totals.get(o.scopeId);totals.set(o.scopeId,Object.freeze({requests:Math.max(c.requests,previous?.requests??0),requestBytes:Math.max(c.requestBytes,previous?.requestBytes??0),reservedTokens:Math.max(c.reservedTokens,previous?.reservedTokens??0)}));
 }
 if(required.some(id=>!totals.has(id)))return refuse();const charge={requests:0,requestBytes:0,reservedTokens:0};for(const c of totals.values())for(const k of ['requests','requestBytes','reservedTokens'] as const){charge[k]+=c[k];if(!Number.isSafeInteger(charge[k]))return refuse();}
 const text=canonical(input);if(Buffer.byteLength(text)>262144)return refuse();return Object.freeze({digest:hash(text),charge:Object.freeze(charge),coveredScopes:Object.freeze(required)});
}
export function projectBudgetApprovalDigest(input:unknown):string{return hash(canonical(input));}
export type ProjectOwnerDecision=Readonly<{issueNumber:number;commentId:number;bodySha256:string}>;
declare const scopeBrand:unique symbol;
export type AuthorizedProjectTaskScope=Readonly<{[scopeBrand]:true}>;
type RecordScope={identity:ProjectBudgetIdentity;taskId:string;executionId:string;ledger:ProjectModelBudget;assertAuthorized:()=>Promise<void>;assertCurrentTime:()=>void;operationMode:'development'|'read-only-review';targetProfile?:ApprovedProjectTarget;used:boolean};
const scopes=new WeakMap<AuthorizedProjectTaskScope,RecordScope>();
const controllers=new WeakSet<object>();
/** Host-only, not an SDK tool. JSON cloning and reuse cannot recreate a scope. */
export function consumeAuthorizedProjectTaskScope(scope:unknown,expected:Readonly<{projectId:string;repository:string;ownerFingerprint:string}>){
 const value=scopes.get(scope as AuthorizedProjectTaskScope);if(!value||value.used||value.identity.projectId!==expected.projectId||value.identity.repository!==expected.repository||value.identity.ownerFingerprint!==expected.ownerFingerprint)return refuse();value.assertCurrentTime();value.used=true;
 return Object.freeze({planFingerprint:value.identity.planFingerprint,taskId:value.taskId,operationMode:value.operationMode,...(value.targetProfile?{targetProfile:value.targetProfile}:{}),projectBudget:Object.freeze({ledger:value.ledger,taskId:value.taskId,executionId:value.executionId,provider:'groq' as const}),assertAuthorized:value.assertAuthorized,assertCurrentTime:value.assertCurrentTime});
}
function targetBinding(options:Readonly<{identity:ProjectBudgetIdentity;targetProfile?:ApprovedProjectTarget}>){
 if(Object.hasOwn(options,'targetProfile'))return projectTargetProfile(options.targetProfile,options.identity.repository);
 if(options.identity.repository!=='erman-ksv/Onay-Factory-Calculator')return refuse();return undefined;
}
// A profile revision changes approved scope, never the project's spent ledger.
function storageKey(identity:ProjectBudgetIdentity){return hash(canonical({projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,ownerFingerprint:identity.ownerFingerprint}));}
/** Only a native authenticated OWNER comment on Factory may authorize a grant.
 * Caller pins its ID and exact body digest; arbitrary JSON/env is not approval.
 * Approval never bypasses source/task/live-mode/role/CI authorization. */
export async function authorizeProjectBudget(options:Readonly<{identity:ProjectBudgetIdentity;history:ProjectBudgetHistory;decision:ProjectOwnerDecision;token:string;store:ProjectModelBudgetStore;transport?:typeof fetch;now?:()=>number;targetProfile?:ApprovedProjectTarget}>){
 try{
  const identity=Object.freeze({...options.identity,taskIds:Object.freeze([...options.identity.taskIds])}),decision=Object.freeze({...options.decision}),transport=options.transport??fetch,clock=options.now??Date.now,token=options.token;
  const profile=targetBinding({...options,identity}),target=profile?options.targetProfile:undefined;
  if(!safeId(identity.projectId)||!SHA.test(identity.planFingerprint)||!SHA.test(identity.ownerFingerprint)||identity.taskIds.length<1||identity.taskIds.length>64||identity.taskIds.some(id=>!safeId(id))||new Set(identity.taskIds).size!==identity.taskIds.length||!Number.isSafeInteger(decision.issueNumber)||decision.issueNumber<1||!Number.isSafeInteger(decision.commentId)||decision.commentId<1||!SHA.test(decision.bodySha256)||!token)return refuse();
  const history=reconcileProjectBudgetHistory(options.history,identity);let lastTime=clock();if(!Number.isFinite(lastTime))return refuse();let expectedDocument:string|undefined;let operationMode:'development'|'read-only-review'|undefined;let expiresAt:number|undefined;let revoked=false;
  function touchClock(){lastTime=Math.max(lastTime,clock());if(!Number.isFinite(lastTime))return refuse();return lastTime;}
  async function readApproval(){
   touchClock();
   const r=await transport('https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/comments/'+decision.commentId,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'}});
   if(r.status!==200||!r.body){void r.body?.cancel().catch(()=>undefined);return refuse();}const reader=r.body.getReader(),parts:Uint8Array[]=[];let size=0;try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>32768){await reader.cancel();return refuse();}parts.push(p.value);}}finally{reader.releaseLock();}
   const c=JSON.parse(Buffer.concat(parts).toString('utf8')),base='https://github.com/erman-ksv/Onay-Agents-Factory/';
   if(c.id!==decision.commentId||c.user?.login!=='erman-ksv'||c.user?.type!=='User'||c.author_association!=='OWNER'||c.issue_url!=='https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/'+decision.issueNumber||![base+'issues/'+decision.issueNumber+'#issuecomment-'+decision.commentId,base+'pull/'+decision.issueNumber+'#issuecomment-'+decision.commentId].includes(c.html_url)||typeof c.created_at!=='string'||c.created_at!==c.updated_at||!Number.isFinite(Date.parse(c.created_at))||Date.parse(c.created_at)>lastTime+300000||typeof c.body!=='string'||Buffer.byteLength(c.body)>16000)return refuse();
   touchClock();const document:unknown=JSON.parse(c.body);if(!plain(document)||!exact(document,['version','kind','mode','grant','expiresAt',...(profile?['targetProfileSha256']:[])])||(profile&&document.targetProfileSha256!==profile.sha256)||document.version!==1||document.kind!=='authorize-project-model-budget'||typeof document.mode!=='string'||!['development','read-only-review'].includes(document.mode)||typeof document.expiresAt!=='string'||!Number.isFinite(Date.parse(document.expiresAt))||Date.parse(document.expiresAt)<=lastTime||Date.parse(document.expiresAt)>lastTime+7*86400000||Date.parse(document.expiresAt)>Date.parse(c.created_at)+7*86400000||projectBudgetApprovalDigest(document)!==decision.bodySha256)return refuse();
   const text=canonical(document);if(expectedDocument!==undefined&&text!==expectedDocument)return refuse();expectedDocument=text;operationMode=document.mode as 'development'|'read-only-review';expiresAt=Date.parse(document.expiresAt);
   const grant=parseProjectModelGrant(document.grant);if(grant.projectId!==identity.projectId||grant.repository!==identity.repository||grant.planFingerprint!==identity.planFingerprint||grant.historicalEvidenceSha256!==history.digest||canonical(grant.historical)!==canonical(history.charge))return refuse();return grant;
  }
  const grant=await readApproval(),ledger=openProjectModelBudget(grant,options.store),issued=new Set<string>();
  const assertCurrentTime=()=>{if(revoked||expiresAt===undefined||touchClock()>=expiresAt){revoked=true;return refuse();}};const assertAuthorized=async()=>{if(revoked)return refuse();try{await readApproval();}catch{revoked=true;return refuse();}};
  const controller=Object.freeze({
   identity,assertAuthorized,grant,grantSha256:hash(JSON.stringify(grant)),approvalBodySha256:decision.bodySha256,operationMode:operationMode!,...(profile?{targetProfile:target,targetProfileSha256:profile.sha256}:{}),
   projectKey:storageKey(identity),
   historyDigest:history.digest,historicalCharge:history.charge,
   async initialize(){await assertAuthorized();await ledger.initialize();},
   inspect:ledger.inspect,
   async taskScope(taskId:string,executionId:string):Promise<AuthorizedProjectTaskScope>{
    if(!['planning',...identity.taskIds].includes(taskId)||!safeId(executionId)||executionId.length>96||issued.has(executionId))return refuse();await assertAuthorized();issued.add(executionId);
    const scope=Object.freeze({}) as AuthorizedProjectTaskScope;scopes.set(scope,{identity,taskId,executionId,ledger,assertAuthorized,assertCurrentTime,operationMode:operationMode!,...(profile?{targetProfile:target}:{}),used:false});return scope;
   },
  });controllers.add(controller);return controller;
 }catch{return refuse();}
}

/** Production entry: one stable remote namespace, independent of approval ID or
 * execution. Storage injection exists only in the host/test constructor above. */
export async function authorizeGitHubProjectBudget(options:Omit<Parameters<typeof authorizeProjectBudget>[0],'store'>){
 try{
 if(Object.hasOwn(options,'store'))return refuse();
 const i=options.identity;targetBinding(options);const key=storageKey(i);
 return authorizeProjectBudget({...options,store:createProjectModelBudgetGitHubStore({projectKey:key,token:options.token,...(options.transport?{transport:options.transport}:{})})});
 }catch{return refuse();}
}

export type AuthorizedProjectBudgetController=Awaited<ReturnType<typeof authorizeProjectBudget>>;
export function isAuthorizedProjectBudgetController(value:unknown):value is AuthorizedProjectBudgetController{return !!value&&typeof value==='object'&&controllers.has(value);}
