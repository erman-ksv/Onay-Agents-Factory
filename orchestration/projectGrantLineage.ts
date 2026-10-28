import {createProjectModelBudgetGitHubExtensionStore,createProjectModelBudgetGitHubLineageReader} from '../github/projectModelBudgetStore.js';
import {verifyProjectStateProtection,type ProjectStateProtection} from '../github/projectStateProtection.js';
import {createHash} from 'node:crypto';
import {isAuthorizedProjectBudgetController,type AuthorizedProjectBudgetController} from './projectBudgetAuthorization.js';
import {authorizeProjectDevelopmentBudgetExtension,inspectProjectDevelopmentBudgetExtension} from './projectBudgetExtensionAuthorization.js';
import {parseProjectModelBudgetState,type ProjectModelBudgetState,type ProjectModelCharge} from './projectModelBudget.js';
const refuse=():never=>{throw Error('Acknowledged grant lineage is unverified. No recovery, replay, reset or new allowance is authorized.');};
type Store=ReturnType<typeof createProjectModelBudgetGitHubExtensionStore>;
type Options={previous:AuthorizedProjectBudgetController;next:AuthorizedProjectBudgetController;expectedRevision:string;state:ProjectModelBudgetState;parentLineage?:ProjectGrantLineage};
declare const brand:unique symbol;
export type ProjectGrantLineage=Readonly<{[brand]:true}>;
type FloorGrant={controller:AuthorizedProjectBudgetController;beforeUsed:ProjectModelCharge};
type Entry={grants:readonly FloorGrant[];next:AuthorizedProjectBudgetController;beforeUsed:ProjectModelCharge;native:boolean};
const entries=new WeakMap<object,Entry>();
type RestoreOptions={previous:AuthorizedProjectBudgetController;next:AuthorizedProjectBudgetController;beforeHead:string;afterHead:string;stateProtection:ProjectStateProtection};
type Snapshot=Readonly<{revision:string;data:ProjectModelBudgetState}>;
type Transition=Readonly<{before:Snapshot;after:Snapshot;current?:Snapshot}>;
type Reader={readTransition:(beforeHead:string,afterHead:string)=>Promise<Transition>};
type AcknowledgedReader={readAcknowledgedTransition:(beforeHead:string,afterHead:string)=>Promise<Transition&{current:Snapshot}>};
/** Cold recovery reads the actual committed transition; it never repeats an
 * extension write, initializes a ledger or starts a task. Both OWNER decisions
 * must still be valid and the protected state ref must still name this head. */
export function restoreGitHubProjectDevelopmentGrantLineage(options:RestoreOptions&{token:string}){
 if(Object.keys(options).some(k=>!['previous','next','beforeHead','afterHead','stateProtection','token'].includes(k)))return Promise.reject(Error('Unverified lineage options'));
 return restore(options,createProjectModelBudgetGitHubLineageReader({projectKey:options.previous.projectKey,token:options.token}),true);
}
export function restoreProjectDevelopmentGrantLineageForTests(options:RestoreOptions,reader:Reader){return restore(options,reader,false);}
/** Separate cold path for an acknowledged transition followed by at most eight
 * verified append-only reservation commits. It never reruns an extension. */
export function restoreGitHubAcknowledgedDevelopmentGrantLineage(options:RestoreOptions&{token:string}){
 if(Object.keys(options).some(k=>!['previous','next','beforeHead','afterHead','stateProtection','token'].includes(k)))return Promise.reject(Error('Unverified lineage options'));
 const reader=createProjectModelBudgetGitHubLineageReader({projectKey:options.previous.projectKey,token:options.token});return restore(options,{readTransition:reader.readAcknowledgedTransition},true,true);
}
export function restoreAcknowledgedDevelopmentGrantLineageForTests(options:RestoreOptions,reader:AcknowledgedReader){return restore(options,{readTransition:reader.readAcknowledgedTransition},false,true);}
async function restore(o:RestoreOptions,reader:Reader,native:boolean,withReservations=false):Promise<ProjectGrantLineage>{try{
 if(!isAuthorizedProjectBudgetController(o.previous)||!isAuthorizedProjectBudgetController(o.next)||!/^[a-f0-9]{40}$/.test(o.beforeHead)||!/^[a-f0-9]{40}$/.test(o.afterHead)||o.beforeHead===o.afterHead)return refuse();
 const guard=()=>verifyProjectStateProtection(o.stateProtection,o.next,native?'native':'simulated');await guard();
 const transition=await reader.readTransition(o.beforeHead,o.afterHead),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
 if(transition.before.revision!==hash(o.beforeHead)||transition.after.revision!==hash(o.afterHead))return refuse();
 const before=parseProjectModelBudgetState(transition.before.data),after=parseProjectModelBudgetState(transition.after.data),inspection=inspectProjectDevelopmentBudgetExtension(o.previous,before,o.next.grant);
 // Reuse the exact two-controller identity/history/profile/approval policy.
 // The permit is intentionally discarded; no store receives it.
 await authorizeProjectDevelopmentBudgetExtension(o.previous,o.next,transition.before.revision,before);
 if(JSON.stringify(after)!==JSON.stringify(inspection.newState)||o.next.grantSha256!==inspection.grantSha256)return refuse();
 const live=await o.next.inspect();let expectedUsed=inspection.used;
 if(withReservations){
  if(!transition.current||!/^[a-f0-9]{64}$/.test(transition.current.revision))return refuse();const current=parseProjectModelBudgetState(transition.current.data);
  if(current.grantSha256!==after.grantSha256||current.reservations.length<after.reservations.length||current.reservations.length>after.reservations.length+8||JSON.stringify(current.reservations.slice(0,after.reservations.length))!==JSON.stringify(after.reservations))return refuse();
  const total={...o.next.grant.historical};for(const r of current.reservations){total.requests++;total.requestBytes+=r.requestBytes;total.reservedTokens+=r.reservedTokens;}expectedUsed=total;
 }
 if(live.grantSha256!==inspection.grantSha256||JSON.stringify(live.used)!==JSON.stringify(expectedUsed))return refuse();
 await o.previous.assertAuthorized();await o.next.assertAuthorized();await guard();
 const again=await reader.readTransition(o.beforeHead,o.afterHead);if(JSON.stringify(again)!==JSON.stringify(transition))return refuse();
 const cap=Object.freeze({}) as ProjectGrantLineage;entries.set(cap,{grants:[{controller:o.previous,beforeUsed:inspection.used}],next:o.next,beforeUsed:inspection.used,native});return cap;
}catch{return refuse();}}
/** Actual native CAS acknowledgement followed by an independent read. No
 * capability is returned after an unknown write or mismatching readback. */
export function extendGitHubProjectDevelopmentBudgetWithLineage(options:Options&{token:string}){
 if(Object.keys(options).some(k=>!['previous','next','expectedRevision','state','parentLineage','token'].includes(k)))return Promise.reject(Error('Unverified lineage options'));
 return extend(options,createProjectModelBudgetGitHubExtensionStore({projectKey:options.previous.projectKey,token:options.token}),true);
}
export function extendProjectDevelopmentBudgetWithLineageForTests(options:Options,store:Store){return extend(options,store,false);}
async function extend(o:Options,store:Store,native:boolean):Promise<ProjectGrantLineage>{try{
 if(!isAuthorizedProjectBudgetController(o.previous)||!isAuthorizedProjectBudgetController(o.next))return refuse();
 const state=parseProjectModelBudgetState(o.state),inspection=inspectProjectDevelopmentBudgetExtension(o.previous,state,o.next.grant),current=await store.read();
 if(!current||current.revision!==o.expectedRevision||JSON.stringify(current.data)!==JSON.stringify(state))return refuse();
 const inherited:FloorGrant[]=[];
 if(o.parentLineage){const parent=entries.get(o.parentLineage);if(!parent||parent.next!==o.previous||native&&!parent.native||parent.grants.length>=8)return refuse();
  for(const g of parent.grants)await g.controller.assertAuthorized();await o.previous.assertAuthorized();const live=await o.previous.inspect();if(live.grantSha256!==o.previous.grantSha256||(['requests','requestBytes','reservedTokens'] as const).some(k=>live.used[k]<parent.beforeUsed[k]))return refuse();inherited.push(...parent.grants);
 }
 const grants=[...inherited,{controller:o.previous,beforeUsed:inspection.used}];if(new Set(grants.map(g=>g.controller.grantSha256)).size!==grants.length)return refuse();
 const permit=await authorizeProjectDevelopmentBudgetExtension(o.previous,o.next,o.expectedRevision,state),ack=await store.extend(permit),after=await store.read();
 if(!ack||!after||after.revision!==ack.revision||JSON.stringify(after.data)!==JSON.stringify(inspection.newState)||JSON.stringify(ack.data)!==JSON.stringify(after.data))return refuse();
 await o.previous.assertAuthorized();await o.next.assertAuthorized();const ledger=await o.next.inspect();
 if(JSON.stringify(ledger.used)!==JSON.stringify(inspection.used)||ledger.grantSha256!==inspection.grantSha256)return refuse();
 const cap=Object.freeze({}) as ProjectGrantLineage;entries.set(cap,{grants,next:o.next,beforeUsed:inspection.used,native});return cap;
}catch{return refuse();}}
/** A sealed old checkpoint is accepted only under the exact acknowledged
 * transition. JSON cannot recreate this capability; it grants no task start. */
export async function assertProjectGrantLineageFloor(cap:ProjectGrantLineage,controller:AuthorizedProjectBudgetController,floor:unknown,mode:'native'|'simulated'){
 const e=entries.get(cap),v=floor as {projectKey?:unknown;grantSha256?:unknown;used?:Record<string,unknown>};
 if(!e||e.next!==controller||mode==='native'&&!e.native||!v||v.projectKey!==controller.projectKey||!v.used||Object.keys(v.used).sort().join(',')!=='requestBytes,requests,reservedTokens')return refuse();
 const grant=e.grants.find(g=>g.controller.grantSha256===v.grantSha256);if(!grant)return refuse();
 for(const k of ['requests','requestBytes','reservedTokens'] as const){const n=v.used[k];if(typeof n!=='number'||!Number.isSafeInteger(n)||n<grant.controller.grant.historical[k]||n>grant.beforeUsed[k])return refuse();}
 for(const g of e.grants)await g.controller.assertAuthorized();await controller.assertAuthorized();const live=await controller.inspect();
 if(live.grantSha256!==controller.grantSha256||(['requests','requestBytes','reservedTokens'] as const).some(k=>live.used[k]<e.beforeUsed[k]))return refuse();
}
