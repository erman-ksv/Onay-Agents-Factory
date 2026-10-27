import {createHash} from 'node:crypto';
import {isAuthorizedProjectBudgetController,projectBudgetApprovalDigest,type AuthorizedProjectBudgetController,type ProjectOwnerDecision} from './projectBudgetAuthorization.js';
const refuse=():never=>{throw Error('Uncertain-attempt OWNER approval is unverified. No original replay, task execution or budget change is authorized.');};
type Binding=Readonly<{taskId:string;archiveHead:string;archiveSequence:number;budgetStateSha256:string;originalRequestSha256:string}>;
type Options=Readonly<{controller:AuthorizedProjectBudgetController;binding:Binding;decision:ProjectOwnerDecision;token:string}>;
declare const brand:unique symbol;
export type ProjectUncertainRecoveryApproval=Readonly<{[brand]:true}>;
const records=new WeakMap<object,{controller:AuthorizedProjectBudgetController;binding:Binding;native:boolean;used:boolean;current:()=>Promise<void>;recoveryExecutionId:string}>();
const sha=(v:unknown,n:number)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
function policy(o:Options){
 const c=o.controller,b=o.binding;
 if(!isAuthorizedProjectBudgetController(c)||c.operationMode!=='development'||!c.targetProfileSha256||!b||Object.keys(b).sort().join(',')!=='archiveHead,archiveSequence,budgetStateSha256,originalRequestSha256,taskId'||!c.identity.taskIds.includes(b.taskId)||!sha(b.archiveHead,40)||b.archiveSequence!==2||!sha(b.budgetStateSha256,64)||!sha(b.originalRequestSha256,64))return refuse();
 const originalExecutionId='project-run-'+createHash('sha256').update(JSON.stringify([c.identity.planFingerprint,b.taskId])).digest('hex').slice(0,32),recoveryExecutionId='project-run-'+createHash('sha256').update(JSON.stringify([c.identity.planFingerprint,b.taskId,'uncertain-1'])).digest('hex').slice(0,32);
 return {version:1,kind:'authorize-uncertain-task-recovery',projectKey:c.projectKey,planFingerprint:c.identity.planFingerprint,targetProfileSha256:c.targetProfileSha256,...b,originalExecutionId,recoveryExecutionId,originalOutcome:'unverified',replayOriginal:false,maxNewRequests:4,legalEnabled:false};
}
/** Proposal DATA only. A signed recovery decision is separate from budget
 * approval and does not change a ledger or recreate the original task ticket. */
export function proposeProjectUncertainRecoveryApproval(o:Options,expiresAt:string){return Object.freeze({...policy(o),expiresAt});}
export function authorizeProjectUncertainRecovery(o:Options){
 if(Object.keys(o).some(k=>!['controller','binding','decision','token'].includes(k)))return Promise.reject(Error('Unverified recovery options'));
 return authorize(o,fetch,true);
}
export function authorizeProjectUncertainRecoveryForTests(o:Options,transport:typeof fetch){return authorize(o,transport,false);}
async function authorize(o:Options,transport:typeof fetch,native:boolean):Promise<ProjectUncertainRecoveryApproval>{try{
 const expected=policy(o),binding=Object.freeze({...o.binding}),decision=Object.freeze({...o.decision}),controller=o.controller,token=o.token;
 if(!token||decision.issueNumber!==75||!Number.isSafeInteger(decision.commentId)||decision.commentId<1||!sha(decision.bodySha256,64))return refuse();
 let original:string|undefined,stopped=false,lastTime=Date.now();
 const current=async()=>{try{
  if(stopped)return refuse();await controller.assertAuthorized();
  const r=await transport('https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/comments/'+decision.commentId,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token}});
  if(r.status!==200||!r.body){void r.body?.cancel().catch(()=>{});return refuse();}
  const reader=r.body.getReader(),parts:Uint8Array[]=[];let bytes=0;try{for(;;){const p=await reader.read();if(p.done)break;bytes+=p.value.length;if(bytes>32768){await reader.cancel();return refuse();}parts.push(p.value);}}finally{reader.releaseLock();}
  const c=JSON.parse(Buffer.concat(parts).toString('utf8')),base='https://github.com/erman-ksv/Onay-Agents-Factory/';
  if(c.id!==decision.commentId||c.user?.login!=='erman-ksv'||c.user?.type!=='User'||c.author_association!=='OWNER'||c.issue_url!=='https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/75'||![base+'pull/75#issuecomment-'+decision.commentId,base+'issues/75#issuecomment-'+decision.commentId].includes(c.html_url)||typeof c.body!=='string'||Buffer.byteLength(c.body)>16000||typeof c.created_at!=='string'||c.created_at!==c.updated_at)return refuse();
  const v=JSON.parse(c.body),now=Math.max(lastTime,Date.now()),created=Date.parse(c.created_at),expires=Date.parse(v.expiresAt);lastTime=now;
  if(typeof v.expiresAt!=='string'||!Number.isFinite(now)||!Number.isFinite(created)||created>now+300000||!Number.isFinite(expires)||expires<=now||expires>now+7*86400000||expires>created+7*86400000||projectBudgetApprovalDigest(v)!==decision.bodySha256)return refuse();
  const wanted={...expected,expiresAt:v.expiresAt};if(projectBudgetApprovalDigest(v)!==projectBudgetApprovalDigest(wanted))return refuse();
  const digest=projectBudgetApprovalDigest(v);if(original!==undefined&&digest!==original)return refuse();original=digest;
 }catch{stopped=true;return refuse();}};
 await current();const cap=Object.freeze({}) as ProjectUncertainRecoveryApproval;records.set(cap,{controller,binding,native,used:false,current,recoveryExecutionId:expected.recoveryExecutionId});return cap;
}catch{return refuse();}}
/** HOST ONLY handoff to the future durable recovery-claim gate. Consuming
 * approval alone never admits a model request or makes a task replay safe. */
export async function consumeProjectUncertainRecoveryApproval(cap:ProjectUncertainRecoveryApproval,controller:AuthorizedProjectBudgetController,binding:Binding,mode:'native'|'simulated'){
 const r=records.get(cap);if(!r||r.used||r.controller!==controller||mode==='native'&&!r.native||projectBudgetApprovalDigest(binding)!==projectBudgetApprovalDigest(r.binding))return refuse();r.used=true;await r.current();
 return Object.freeze({recoveryExecutionId:r.recoveryExecutionId,assertAuthorized:r.current,executionAuthorized:false as const,budgetChangeAuthorized:false as const,replayOriginal:false as const});
}
