import {createHash,randomBytes} from 'node:crypto';
import {chmodSync,chownSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {projectPlanTarget,type PreparedProjectPlan} from './projectPlan.js';
import {projectTargetProfile} from './projectTargetRegistry.js';
import {assertProjectSnapshotIdentity,projectSnapshotSources,verifyProjectSnapshot,projectSourceContainsSecrets,type ProjectSourceSnapshot} from '../github/projectSourceSnapshot.js';
import {assertProjectChangesSnapshot,projectChangesFiles,verifyProjectChanges,type PreparedProjectChanges} from '../commander/projectChanges.js';
import {runCalculatorSandboxProcess,type CalculatorSandboxProcess} from './calculatorSandbox.js';

export const PROJECT_NODE_TEST_ERROR='Project host test evidence is missing, simulated, stale, failed or bound to another proposal. No test approval or publication is authorized.';
const refuse=():never=>{throw Error(PROJECT_NODE_TEST_ERROR);};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
type Check={id:string;path:string;exportName:string;args:unknown[];expected:unknown;acceptanceIds:string[]};
export type ProjectNodeTestPolicy=Readonly<{planFingerprint:string;taskId:string;sha256:string;image:string;checkIds:readonly string[];acceptanceIds:readonly string[]}>;
const policies=new WeakMap<ProjectNodeTestPolicy,{plan:PreparedProjectPlan;taskId:string;checks:Check[]}>();
function exact(v:any,keys:string[]){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
function clone(v:unknown,depth=0,state={nodes:1024}):any{
 if(depth>10||--state.nodes<0||typeof v==='string'&&v.length>4096)return refuse();if(v===null||typeof v==='boolean'||typeof v==='string'||(typeof v==='number'&&Number.isFinite(v)))return v;
 if(!v||typeof v!=='object')return refuse();const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(v).some(k=>typeof k!=='string'||!Object.hasOwn(ds[k]!,'value')))return refuse();
 if(Array.isArray(v)){if(Object.getPrototypeOf(v)!==Array.prototype||v.length>32||Reflect.ownKeys(v).length!==v.length+1)return refuse();return Array.from({length:v.length},(_,i)=>{if(!Object.hasOwn(ds,String(i)))return refuse();return clone(ds[String(i)]!.value,depth+1,state);});}
 if(Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==Object.keys(v).length||Object.keys(v).length>32)return refuse();return Object.fromEntries(Object.keys(v).sort().map(k=>[k,clone(ds[k]!.value,depth+1,state)]));
}
/** HOST ONLY contract policy. Never register model-provided expected answers,
 * images or commands. No arbitrary command or test callback is accepted. */
export function prepareProjectNodeTestPolicy(plan:PreparedProjectPlan,taskId:string,input:unknown):ProjectNodeTestPolicy{
 try{
  projectTargetProfile(projectPlanTarget(plan),plan.repository);const task=plan.tasks.find(t=>t.id===taskId);if(!task)return refuse();const v=clone(input),encoded=JSON.stringify(v);
  if(Buffer.byteLength(encoded)>12000||projectSourceContainsSecrets(encoded)||!exact(v,['image','checks'])||typeof v.image!=='string'||!/^(?:docker\.io\/library\/)?node(?::[A-Za-z0-9_.-]+)?@sha256:[a-f0-9]{64}$/.test(v.image)||!Array.isArray(v.checks)||!v.checks.length||v.checks.length>8)return refuse();
  const ids=new Set<string>(),covered=new Set<string>();for(const c of v.checks){if(!exact(c,['id','path','exportName','args','expected','acceptanceIds'])||typeof c.id!=='string'||!/^contract-[a-z0-9-]{1,40}$/.test(c.id)||ids.has(c.id)||typeof c.path!=='string'||!task.paths.includes(c.path)&&!plan.request.requiredPaths.includes(c.path)||!/\.(?:mjs|js)$/.test(c.path)||typeof c.exportName!=='string'||!/^[A-Za-z_$][A-Za-z0-9_$]{0,79}$/.test(c.exportName)||!Array.isArray(c.args)||c.args.length>8||!Array.isArray(c.acceptanceIds)||!c.acceptanceIds.length||new Set(c.acceptanceIds).size!==c.acceptanceIds.length||c.acceptanceIds.some((id:unknown)=>typeof id!=='string'||!task.acceptanceIds.includes(id)))return refuse();ids.add(c.id);for(const id of c.acceptanceIds)covered.add(id);}
  if(task.acceptanceIds.some(id=>!covered.has(id)))return refuse();const policy=Object.freeze({planFingerprint:plan.fingerprint,taskId,sha256:hash(encoded),image:v.image,checkIds:Object.freeze(['syntax',...v.checks.map((c:Check)=>c.id)]),acceptanceIds:Object.freeze([...covered].sort())});policies.set(policy,{plan,taskId,checks:v.checks});return policy;
 }catch{return refuse();}
}
export type ProjectNodeTestReceipt=Readonly<{repository:string;planFingerprint:string;taskId:string;baseSha:string;proposalDigest:string;policySha256:string;fileSetSha256:string;status:'passed'|'failed'|'unverified';testsExecuted:boolean;provenance:'native-docker'|'simulated';checks:readonly string[];failures:readonly string[];acceptanceIds:readonly string[];coverage:'host-selected-node-contracts-only';unverifiedAreas:readonly string[];publicationAuthorized:false;wholeAppCompleted:false}>;
const receipts=new WeakMap<ProjectNodeTestReceipt,{policy:ProjectNodeTestPolicy;snapshot:ProjectSourceSnapshot;changes:PreparedProjectChanges;failed:boolean}>();
const prefix=['--host=unix:///var/run/docker.sock'];
const limits=['--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=32','--memory=256m','--memory-swap=256m','--cpus=1','--tmpfs=/tmp:rw,noexec,nosuid,size=16m,mode=1777',...['HTTP_PROXY','HTTPS_PROXY','FTP_PROXY','NO_PROXY','ALL_PROXY','http_proxy','https_proxy','ftp_proxy','no_proxy','all_proxy','NODE_OPTIONS','NODE_EXTRA_CA_CERTS'].map(k=>'--env='+k+'='),'--env=HOME=/tmp'];
const processOptions=Object.freeze({env:Object.freeze({PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}),timeoutMs:30000,maxOutputBytes:32768});
/** Production has no process injection, env forwarding, pull or fallback. */
export function createProjectNodeSandbox(policy:ProjectNodeTestPolicy){return sandbox(policy,runCalculatorSandboxProcess,'native-docker');}
/** Test-only runner cannot mint a native receipt, even with perfect fake output. */
export function createProjectNodeSandboxForTests(policy:ProjectNodeTestPolicy,runner:CalculatorSandboxProcess){return sandbox(policy,runner,'simulated');}
function sandbox(policy:ProjectNodeTestPolicy,runner:CalculatorSandboxProcess,provenance:ProjectNodeTestReceipt['provenance']){
 const p=policies.get(policy);if(!p||typeof runner!=='function')return refuse();let used=false;
 return Object.freeze({async run(snapshot:ProjectSourceSnapshot,changes:PreparedProjectChanges):Promise<ProjectNodeTestReceipt>{
  if(used)return refuse();used=true;let directory:string|undefined,name:string|undefined,fileSetSha256='';
  try{assertProjectSnapshotIdentity(snapshot,p.plan,p.taskId);assertProjectChangesSnapshot(changes,snapshot);if(changes.taskId!==p.taskId||changes.planFingerprint!==p.plan.fingerprint)return refuse();}catch{return refuse();}
  const answer=(status:ProjectNodeTestReceipt['status'],testsExecuted:boolean,failures:readonly string[])=>{const receipt:ProjectNodeTestReceipt=Object.freeze({repository:p.plan.repository,planFingerprint:p.plan.fingerprint,taskId:p.taskId,baseSha:snapshot.baseSha,proposalDigest:changes.digest,policySha256:policy.sha256,fileSetSha256,status,testsExecuted,provenance,checks:policy.checkIds,failures:Object.freeze([...failures]),acceptanceIds:policy.acceptanceIds,coverage:'host-selected-node-contracts-only',unverifiedAreas:Object.freeze(['Browser/device behavior and scenarios outside the host-selected Node contracts','Independent specialist assessments, exact-candidate CI and publication']),publicationAuthorized:false,wholeAppCompleted:false});receipts.set(receipt,{policy,snapshot,changes,failed:false});return receipt;};
  try{
   assertProjectSnapshotIdentity(snapshot,p.plan,p.taskId);assertProjectChangesSnapshot(changes,snapshot);if(changes.taskId!==p.taskId||changes.planFingerprint!==p.plan.fingerprint)return refuse();await verifyProjectSnapshot(snapshot);await verifyProjectChanges(changes);
   const sources=projectSnapshotSources(snapshot);for(const f of projectChangesFiles(changes))sources.set(f.path,f.content);if(p.checks.some(c=>!sources.has(c.path)))return answer('unverified',false,['required-source-missing']);
   const profile=projectTargetProfile(projectPlanTarget(p.plan),p.plan.repository);if([...sources.values()].reduce((n,s)=>n+Buffer.byteLength(s),0)>profile.maxSourceBytes)return refuse();
   const paths=[...sources.keys()].sort();fileSetSha256=hash(JSON.stringify(paths.map(path=>({path,sha256:hash(sources.get(path)!),bytes:Buffer.byteLength(sources.get(path)!)}))));
   const info=await runner([...prefix,'info','--format={{.ServerVersion}}'],processOptions);if(info.code!==0||info.timedOut||!/^\d+\.\d+/.test(info.stdout.trim()))return answer('unverified',false,['docker-unavailable']);
   const image=await runner([...prefix,'image','inspect','--format={{json .RepoDigests}}',policy.image],processOptions);if(image.code!==0||image.timedOut||!Array.isArray(JSON.parse(image.stdout))||!JSON.parse(image.stdout).some((s:unknown)=>typeof s==='string'&&s.replace(/:.*@/,'@')===policy.image.replace(/:.*@/,'@')))return answer('unverified',false,['image-unverified']);
   const version=await runner([...prefix,'run','--rm',...limits,'--user=65534:65534','--entrypoint=/usr/local/bin/node',policy.image,'--disable-sigusr1','--version'],processOptions),match=/^v(\d+)\.(\d+)\.\d+\s*$/.exec(version.stdout);if(version.code!==0||version.timedOut||!match||Number(match[1])<22||Number(match[1])===22&&Number(match[2])<13)return answer('unverified',false,['runtime-unverified']);
   await verifyProjectChanges(changes);const harness=readFileSync(new URL('../config/project-node-harness/check.mjs',import.meta.url),'utf8');
   directory=mkdtempSync(join(tmpdir(),'onay-project-node-'));chmodSync(directory,0o700);const root=join(directory,'app');mkdirSync(root,{mode:0o700});const dirs=new Set([directory,root]),files:string[]=[];
   for(const path of paths){const dest=join(root,path);mkdirSync(dirname(dest),{recursive:true,mode:0o700});for(let d=dirname(dest);d.startsWith(root)&&d!==root;d=dirname(d))dirs.add(d);writeFileSync(dest,sources.get(path)!,{mode:0o600,flag:'wx'});files.push(dest);}
   const harnessPath=join(directory,'harness.mjs'),manifestPath=join(directory,'manifest.json');writeFileSync(harnessPath,harness,{mode:0o600,flag:'wx'});writeFileSync(manifestPath,JSON.stringify({paths,checks:p.checks}),{mode:0o600,flag:'wx'});files.push(harnessPath,manifestPath);
   const uid=process.getuid?.()??-1,gid=process.getgid?.()??-1;if(uid<0||gid<0)return answer('unverified',false,['runtime-unverified']);const user=uid===0?65534:uid,group=uid===0?65534:gid;if(uid===0)for(const path of [...dirs,...files])chownSync(path,user,group);
   name='onay-project-node-'+randomBytes(10).toString('hex');const result=await runner([...prefix,'run','--rm','--name='+name,...limits,'--user='+user+':'+group,'--mount=type=bind,src='+root+',dst=/app,readonly','--mount=type=bind,src='+harnessPath+',dst=/harness.mjs,readonly','--mount=type=bind,src='+manifestPath+',dst=/manifest.json,readonly','--workdir=/app','--entrypoint=/usr/local/bin/node',policy.image,'--disable-sigusr1','/harness.mjs'],processOptions);
   await verifyProjectChanges(changes);if(result.timedOut||![0,1].includes(result.code??-1)||Buffer.byteLength(result.stdout)>32768)return answer('unverified',false,['execution-unverified']);const v=JSON.parse(result.stdout),allowed=new Set([...paths.filter(p=>/\.(mjs|js)$/.test(p)).map(p=>'syntax:'+p),...p.checks.map(c=>'contract:'+c.id)]);
   if(!exact(v,['version','status','checks','failures'])||v.version!==1||!Array.isArray(v.checks)||JSON.stringify(v.checks)!==JSON.stringify(policy.checkIds)||!Array.isArray(v.failures)||v.failures.some((s:unknown)=>!allowed.has(s as string))||new Set(v.failures).size!==v.failures.length||result.code===0&&(v.status!=='passed'||v.failures.length!==0)||result.code===1&&(v.status!=='failed'||!v.failures.length))return answer('unverified',false,['execution-unverified']);
   return answer(result.code===0?'passed':'failed',true,v.failures);
  }catch{return answer('unverified',false,['execution-unverified']);}
  finally{if(name)try{await runner([...prefix,'rm','--force',name],processOptions);}catch{/* Cleanup cannot authorize success. */}if(directory)rmSync(directory,{recursive:true,force:true});}
 }});
}
/** A copied/modeled receipt or a simulated runner can never approve tests. */
export async function verifyProjectNodeTestReceipt(receipt:ProjectNodeTestReceipt,plan:PreparedProjectPlan,taskId:string,snapshot:ProjectSourceSnapshot,changes:PreparedProjectChanges,policy:ProjectNodeTestPolicy){
 return verifyReceipt(receipt,plan,taskId,snapshot,changes,policy,'passed');
}
/** Executed failure is repair evidence only; never a passed-test grant. */
export async function verifyFailedProjectNodeTestReceipt(receipt:ProjectNodeTestReceipt,plan:PreparedProjectPlan,taskId:string,snapshot:ProjectSourceSnapshot,changes:PreparedProjectChanges,policy:ProjectNodeTestPolicy){return verifyReceipt(receipt,plan,taskId,snapshot,changes,policy,'failed');}
/** Test-only evidence never satisfies the production native verifier. */
export async function verifySimulatedProjectNodeTestReceipt(receipt:ProjectNodeTestReceipt,plan:PreparedProjectPlan,taskId:string,snapshot:ProjectSourceSnapshot,changes:PreparedProjectChanges,policy:ProjectNodeTestPolicy){const r=receipts.get(receipt);if(!r||r.failed||r.policy!==policy||r.snapshot!==snapshot||r.changes!==changes||policies.get(policy)?.plan!==plan||policy.taskId!==taskId||receipt.provenance!=='simulated'||receipt.status!=='passed'||!receipt.testsExecuted||receipt.failures.length)return refuse();assertProjectSnapshotIdentity(snapshot,plan,taskId);await verifyProjectChanges(changes);return receipt;}
/** HOST ONLY: contract IDs are mapped through the genuine immutable policy,
 * never guessed from the first changed file or supplied model diagnostics. */
export function projectNodeFailureIssues(receipt:ProjectNodeTestReceipt){const r=receipts.get(receipt),p=r&&policies.get(r.policy);if(!r||r.failed||!p||receipt.provenance!=='native-docker'||receipt.status!=='failed'||!receipt.testsExecuted)return refuse();return Object.freeze(receipt.failures.map(code=>{const path=code.startsWith('syntax:')?code.slice(7):p.checks.find(c=>'contract:'+c.id===code)?.path;if(!path)return refuse();return Object.freeze({path,detail:code});}));}
async function verifyReceipt(receipt:ProjectNodeTestReceipt,plan:PreparedProjectPlan,taskId:string,snapshot:ProjectSourceSnapshot,changes:PreparedProjectChanges,policy:ProjectNodeTestPolicy,status:'passed'|'failed'){
 const r=receipts.get(receipt);try{if(!r||r.failed||r.policy!==policy||r.snapshot!==snapshot||r.changes!==changes||policies.get(policy)?.plan!==plan||policy.taskId!==taskId||receipt.provenance!=='native-docker'||receipt.status!==status||!receipt.testsExecuted||(status==='passed'?receipt.failures.length!==0:receipt.failures.length===0))return refuse();assertProjectSnapshotIdentity(snapshot,plan,taskId);assertProjectChangesSnapshot(changes,snapshot);await verifyProjectChanges(changes);return receipt;}catch{if(r)r.failed=true;return refuse();}
}
