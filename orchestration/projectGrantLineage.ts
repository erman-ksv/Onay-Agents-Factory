import {createProjectModelBudgetGitHubExtensionStore} from '../github/projectModelBudgetStore.js';
import {isAuthorizedProjectBudgetController,type AuthorizedProjectBudgetController} from './projectBudgetAuthorization.js';
import {authorizeProjectDevelopmentBudgetExtension,inspectProjectDevelopmentBudgetExtension} from './projectBudgetExtensionAuthorization.js';
import {parseProjectModelBudgetState,type ProjectModelBudgetState,type ProjectModelCharge} from './projectModelBudget.js';
const refuse=():never=>{throw Error('Acknowledged grant lineage is unverified. No recovery, replay, reset or new allowance is authorized.');};
type Store=ReturnType<typeof createProjectModelBudgetGitHubExtensionStore>;
type Options={previous:AuthorizedProjectBudgetController;next:AuthorizedProjectBudgetController;expectedRevision:string;state:ProjectModelBudgetState};
declare const brand:unique symbol;
export type ProjectGrantLineage=Readonly<{[brand]:true}>;
type Entry={previous:AuthorizedProjectBudgetController;next:AuthorizedProjectBudgetController;beforeUsed:ProjectModelCharge;native:boolean};
const entries=new WeakMap<object,Entry>();
/** Actual native CAS acknowledgement followed by an independent read. No
 * capability is returned after an unknown write or mismatching readback. */
export function extendGitHubProjectDevelopmentBudgetWithLineage(options:Options&{token:string}){
 if(Object.keys(options).some(k=>!['previous','next','expectedRevision','state','token'].includes(k)))return Promise.reject(Error('Unverified lineage options'));
 return extend(options,createProjectModelBudgetGitHubExtensionStore({projectKey:options.previous.projectKey,token:options.token}),true);
}
export function extendProjectDevelopmentBudgetWithLineageForTests(options:Options,store:Store){return extend(options,store,false);}
async function extend(o:Options,store:Store,native:boolean):Promise<ProjectGrantLineage>{try{
 if(!isAuthorizedProjectBudgetController(o.previous)||!isAuthorizedProjectBudgetController(o.next))return refuse();
 const state=parseProjectModelBudgetState(o.state),inspection=inspectProjectDevelopmentBudgetExtension(o.previous,state,o.next.grant),current=await store.read();
 if(!current||current.revision!==o.expectedRevision||JSON.stringify(current.data)!==JSON.stringify(state))return refuse();
 const permit=await authorizeProjectDevelopmentBudgetExtension(o.previous,o.next,o.expectedRevision,state),ack=await store.extend(permit),after=await store.read();
 if(!ack||!after||after.revision!==ack.revision||JSON.stringify(after.data)!==JSON.stringify(inspection.newState)||JSON.stringify(ack.data)!==JSON.stringify(after.data))return refuse();
 await o.previous.assertAuthorized();await o.next.assertAuthorized();const ledger=await o.next.inspect();
 if(JSON.stringify(ledger.used)!==JSON.stringify(inspection.used)||ledger.grantSha256!==inspection.grantSha256)return refuse();
 const cap=Object.freeze({}) as ProjectGrantLineage;entries.set(cap,{previous:o.previous,next:o.next,beforeUsed:inspection.used,native});return cap;
}catch{return refuse();}}
/** A sealed old checkpoint is accepted only under the exact acknowledged
 * transition. JSON cannot recreate this capability; it grants no task start. */
export async function assertProjectGrantLineageFloor(cap:ProjectGrantLineage,controller:AuthorizedProjectBudgetController,floor:unknown,mode:'native'|'simulated'){
 const e=entries.get(cap),v=floor as {projectKey?:unknown;grantSha256?:unknown;used?:Record<string,unknown>};
 if(!e||e.next!==controller||mode==='native'&&!e.native||!v||v.projectKey!==controller.projectKey||v.grantSha256!==e.previous.grantSha256||!v.used||Object.keys(v.used).sort().join(',')!=='requestBytes,requests,reservedTokens')return refuse();
 for(const k of ['requests','requestBytes','reservedTokens'] as const){const n=v.used[k];if(typeof n!=='number'||!Number.isSafeInteger(n)||n<e.previous.grant.historical[k]||n>e.beforeUsed[k])return refuse();}
 await e.previous.assertAuthorized();await controller.assertAuthorized();const live=await controller.inspect();
 if(live.grantSha256!==controller.grantSha256||(['requests','requestBytes','reservedTokens'] as const).some(k=>live.used[k]<e.beforeUsed[k]))return refuse();
}
