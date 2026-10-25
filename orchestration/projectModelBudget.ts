import {createHash} from 'node:crypto';
import {scanForSecrets} from '../github/secretScanner.js';
export const PROJECT_MODEL_BUDGET_ERROR='Project model budget is unverified or exhausted. Stop before HTTP; do not replay or reset charges.';
const refuse=():never=>{throw Error(PROJECT_MODEL_BUDGET_ERROR);};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const id=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(s);
const sha=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const integer=(n:unknown,min=0):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min;
const plain=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x:Record<string,unknown>,keys:string[])=>Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export type ProjectModelCharge=Readonly<{requests:number;requestBytes:number;reservedTokens:number}>;
/** Host-supplied authorization DATA, never model/environment-derived authority.
 * The caller must verify owner approval and historical evidence before opening.
 * No default grant or budget extension is supplied by this module. */
export type ProjectModelGrant=Readonly<{version:1;projectId:string;repository:string;planFingerprint:string;grantId:string;
 maxRequests:number;maxRequestBytes:number;maxTotalRequestBytes:number;maxReservedTokens:number;
 historical:ProjectModelCharge;historicalEvidenceSha256:string;provider:'groq';freeTierConfirmed:true;legalEnabled:false}>;
export type ProjectModelReservation=Readonly<{reservationId:string;taskId:string;requestSha256:string;requestBytes:number;reservedTokens:number}>;
export type ProjectModelBudgetState=Readonly<{version:1;grantSha256:string;reservations:readonly ProjectModelReservation[]}>;
/** CAS must atomically reject a stale expected revision. Lost acknowledgements
 * throw; no storage adapter may retry a write, clear an existing state or refund. */
export type ProjectModelBudgetStore=Readonly<{
 read:()=>Promise<Readonly<{revision:string;data:unknown}>|undefined>;
 compareAndSwap:(expectedRevision:string|undefined,data:ProjectModelBudgetState)=>Promise<Readonly<{revision:string}>|undefined>;
}>;
export function parseProjectModelGrant(input:unknown):ProjectModelGrant{
 if(!plain(input)||!exact(input,['version','projectId','repository','planFingerprint','grantId','maxRequests','maxRequestBytes','maxTotalRequestBytes','maxReservedTokens','historical','historicalEvidenceSha256','provider','freeTierConfirmed','legalEnabled'])||
 input.version!==1||!id(input.projectId)||!id(input.grantId)||typeof input.repository!=='string'||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository)||input.repository.length>180||!sha(input.planFingerprint)||!sha(input.historicalEvidenceSha256)||input.provider!=='groq'||input.freeTierConfirmed!==true||input.legalEnabled!==false)return refuse();
 for(const [key,ceiling]of [['maxRequests',256],['maxRequestBytes',64000],['maxTotalRequestBytes',16000000],['maxReservedTokens',2000000]] as const)if(!integer(input[key],1)||input[key]>ceiling)return refuse();
 const h=input.historical;if(!plain(h)||!exact(h,['requests','requestBytes','reservedTokens'])||Object.values(h).some(n=>!integer(n))||h.requests as number> (input.maxRequests as number)||h.requestBytes as number>(input.maxTotalRequestBytes as number)||h.reservedTokens as number>(input.maxReservedTokens as number))return refuse();
 if(scanForSecrets(JSON.stringify(input)).length)return refuse();
 return Object.freeze({version:1,projectId:input.projectId,repository:input.repository,planFingerprint:input.planFingerprint,grantId:input.grantId,
  maxRequests:input.maxRequests as number,maxRequestBytes:input.maxRequestBytes as number,maxTotalRequestBytes:input.maxTotalRequestBytes as number,maxReservedTokens:input.maxReservedTokens as number,
  historical:Object.freeze({requests:h.requests as number,requestBytes:h.requestBytes as number,reservedTokens:h.reservedTokens as number}),historicalEvidenceSha256:input.historicalEvidenceSha256,provider:'groq',freeTierConfirmed:true,legalEnabled:false});
}
function reservation(input:unknown):ProjectModelReservation{
 if(!plain(input)||!exact(input,['reservationId','taskId','requestSha256','requestBytes','reservedTokens'])||!id(input.reservationId)||!id(input.taskId)||!sha(input.requestSha256)||!integer(input.requestBytes,1)||!integer(input.reservedTokens,1)||scanForSecrets(JSON.stringify(input)).length)return refuse();
 return Object.freeze({reservationId:input.reservationId,taskId:input.taskId,requestSha256:input.requestSha256,requestBytes:input.requestBytes,reservedTokens:input.reservedTokens});
}
/** Source-free storage schema shared by local and remote adapters. This is not
 * owner authorization; concrete grant identity and totals are checked by ledger. */
export function parseProjectModelBudgetState(data:unknown):ProjectModelBudgetState{
 if(!plain(data)||!exact(data,['version','grantSha256','reservations'])||data.version!==1||!sha(data.grantSha256)||!Array.isArray(data.reservations)||data.reservations.length>256||Buffer.byteLength(JSON.stringify(data))>262144)return refuse();
 const entries=data.reservations.map(reservation);if(new Set(entries.map(e=>e.reservationId)).size!==entries.length)return refuse();
 return Object.freeze({version:1,grantSha256:data.grantSha256,reservations:Object.freeze(entries)});
}
const ledgers=new WeakSet<object>();
export type ProjectModelBudget=Readonly<{
 initialize:()=>Promise<void>;reserve:(input:ProjectModelReservation)=>Promise<void>;
 inspect:()=>Promise<Readonly<{grantSha256:string;used:ProjectModelCharge;remaining:ProjectModelCharge}>>;
}>;
export function isProjectModelBudget(value:unknown):value is ProjectModelBudget{return !!value&&typeof value==='object'&&ledgers.has(value);}
export function openProjectModelBudget(input:ProjectModelGrant,store:ProjectModelBudgetStore):ProjectModelBudget{
 const g=parseProjectModelGrant(input),digest=hash(JSON.stringify(g));if(typeof store?.read!=='function'||typeof store?.compareAndSwap!=='function')return refuse();
 let initialized=false;const attempted=new Set<string>();
 function parse(data:unknown):ProjectModelBudgetState{
  const state=parseProjectModelBudgetState(data);if(state.grantSha256!==digest||state.reservations.length>g.maxRequests)return refuse();totals(state);return state;
 }
 function totals(state:ProjectModelBudgetState):ProjectModelCharge{
  const used={...g.historical};for(const e of state.reservations){if(e.requestBytes>g.maxRequestBytes)return refuse();used.requests++;used.requestBytes+=e.requestBytes;used.reservedTokens+=e.reservedTokens;}
  if(used.requests>g.maxRequests||used.requestBytes>g.maxTotalRequestBytes||used.reservedTokens>g.maxReservedTokens)return refuse();return Object.freeze(used);
 }
 async function read(){const saved=await store.read();if(!saved||!sha(saved.revision))return refuse();return {revision:saved.revision,state:parse(saved.data)};}
 const ledger:ProjectModelBudget=Object.freeze({
  async initialize(){
   if(initialized)return refuse();initialized=true;if(await store.read()!==undefined)return refuse();
   const result=await store.compareAndSwap(undefined,{version:1,grantSha256:digest,reservations:[]});if(!result||!sha(result.revision))return refuse();
  },
  async reserve(value:ProjectModelReservation){
   const entry=reservation(value);if(attempted.has(entry.reservationId))return refuse();attempted.add(entry.reservationId);
   try{const current=await read();if(current.state.reservations.some(r=>r.reservationId===entry.reservationId))return refuse();
    const next:ProjectModelBudgetState={...current.state,reservations:[...current.state.reservations,entry]};totals(next);
    const result=await store.compareAndSwap(current.revision,next);if(!result||!sha(result.revision)||result.revision===current.revision)return refuse();
   }catch{return refuse();}
  },
  async inspect(){const current=await read(),used=totals(current.state);return Object.freeze({grantSha256:digest,used,remaining:Object.freeze({requests:g.maxRequests-used.requests,requestBytes:g.maxTotalRequestBytes-used.requestBytes,reservedTokens:g.maxReservedTokens-used.reservedTokens})});},
 });ledgers.add(ledger);return ledger;
}
