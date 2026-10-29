import {createHash} from 'node:crypto';
import {projectPlanTarget,type PreparedProjectPlan} from './projectPlan.js';
import {projectTargetProfile} from './projectTargetRegistry.js';
import {assertProjectSnapshotIdentity,projectSnapshotSources,verifyProjectSnapshot,type ProjectSourceSnapshot} from '../github/projectSourceSnapshot.js';
import {assertProjectChangesSnapshot,projectChangesFiles,verifyProjectChanges,type PreparedProjectChanges} from '../commander/projectChanges.js';
import {calculatorInputBrowserContract,calculatorInputBrowserProofBinding,createCalculatorInputBrowserProbe,createCalculatorInputBrowserProbeForTests} from './calculatorInputBrowserProbe.js';
import type {CalculatorSandboxProcess} from './calculatorSandbox.js';
import {createCalculatorBrowserSandbox} from './calculatorBrowserSandbox.js';
import {calculatorProposalDigest} from './calculatorExecutionEvidence.js';
import type {CalculatorRepairBrowserRunner} from './calculatorAgentRepairHost.js';
export const PROJECT_BROWSER_TEST_ERROR='Browser acceptance is missing, failed, simulated, stale or bound to another proposal. No UI publication or weaker acceptance is authorized.';
const refuse=():never=>{throw Error(PROJECT_BROWSER_TEST_ERROR);};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),paths=['index.html','styles.css','src/app.mjs','src/calculator.mjs'];
export type ProjectBrowserTestPolicy=Readonly<{planFingerprint:string;taskId:string;sha256:string;image:string;contractSha256:string;coverage:'calculator-input-and-existing-browser-regressions'}>;
export type ProjectBrowserTestReceipt=Readonly<{repository:string;taskId:string;planFingerprint:string;baseSha:string;proposalDigest:string;sourceSetSha256:string;policySha256:string;contractSha256:string;status:'passed'|'failed';testsExecuted:true;provenance:'native-docker'|'simulated';coverage:'calculator-input-and-existing-browser-regressions';legacyBrowserTestsVerified:boolean;failures:readonly string[];publicationAuthorized:false;wholeAppCompleted:false}>;
const policies=new WeakMap<ProjectBrowserTestPolicy,{plan:PreparedProjectPlan;taskId:string}>(),receipts=new WeakMap<ProjectBrowserTestReceipt,{plan:PreparedProjectPlan;taskId:string;policy:ProjectBrowserTestPolicy;snapshot:ProjectSourceSnapshot;changes:PreparedProjectChanges}>();
/** Role labels cannot bypass host UI requirements by calling an app edit a
 * coder task. Other frontend targets also require supported browser coverage. */
export function projectTaskRequiresBrowser(plan:PreparedProjectPlan,taskId:string){projectPlanTarget(plan);const task=plan.tasks.find(t=>t.id===taskId);if(!task)return refuse();return task.role==='frontend'||plan.repository==='erman-ksv/Onay-Factory-Calculator'&&task.paths.some(p=>['index.html','styles.css','src/app.mjs'].includes(p));}
/** Host policy, not a model tool. Unsupported frontend targets fail closed;
 * this fixed Calculator suite is not generic browser/Expo/device acceptance. */
export function prepareProjectBrowserTestPolicy(plan:PreparedProjectPlan,taskId:string,input:Readonly<{image:string}>):ProjectBrowserTestPolicy{try{
 projectTargetProfile(projectPlanTarget(plan),plan.repository);if(plan.repository!=='erman-ksv/Onay-Factory-Calculator'||!projectTaskRequiresBrowser(plan,taskId)||!input||Object.getPrototypeOf(input)!==Object.prototype||Reflect.ownKeys(input).length!==1||!Object.hasOwn(Object.getOwnPropertyDescriptor(input,'image')??{},'value')||!/^mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}$/.test(input.image))return refuse();
 const data={planFingerprint:plan.fingerprint,taskId,image:input.image,contractSha256:calculatorInputBrowserContract().sha256,coverage:'calculator-input-and-existing-browser-regressions' as const},policy=Object.freeze({...data,sha256:hash(JSON.stringify(data))});policies.set(policy,{plan,taskId});return policy;
}catch{return refuse();}}
export function assertProjectBrowserPolicy(policy:ProjectBrowserTestPolicy|undefined,plan:PreparedProjectPlan,taskId:string){const r=policy&&policies.get(policy);if(!r||r.plan!==plan||r.taskId!==taskId||policy!.contractSha256!==calculatorInputBrowserContract().sha256)return refuse();}
function overlay(snapshot:ProjectSourceSnapshot,changes:PreparedProjectChanges){const all=projectSnapshotSources(snapshot);for(const f of projectChangesFiles(changes))all.set(f.path,f.content);if(paths.some(p=>!all.has(p)))return refuse();return new Map(paths.map(p=>[p,all.get(p)!]));}
function sourceHash(sources:ReadonlyMap<string,string>){return hash(JSON.stringify(paths.map(path=>({path,sha256:hash(sources.get(path)!),bytes:Buffer.byteLength(sources.get(path)!)}))));}
export function createProjectBrowserSandbox(policy:ProjectBrowserTestPolicy){return sandbox(policy);}
export function createProjectBrowserSandboxForTests(policy:ProjectBrowserTestPolicy,runner:CalculatorSandboxProcess){return sandbox(policy,runner);}
function sandbox(policy:ProjectBrowserTestPolicy,runner?:CalculatorSandboxProcess){const r=policies.get(policy);if(!r)return refuse();assertProjectBrowserPolicy(policy,r.plan,r.taskId);let used=false;
 return Object.freeze({async run(snapshot:ProjectSourceSnapshot,changes:PreparedProjectChanges):Promise<ProjectBrowserTestReceipt>{try{
  if(used)return refuse();used=true;assertProjectSnapshotIdentity(snapshot,r.plan,r.taskId);assertProjectChangesSnapshot(changes,snapshot);await verifyProjectSnapshot(snapshot);await verifyProjectChanges(changes);const sources=overlay(snapshot,changes),sourceSetSha256=sourceHash(sources);
  const probe=runner?createCalculatorInputBrowserProbeForTests(policy.image,runner):createCalculatorInputBrowserProbe(policy.image),raw=await probe.run({candidateSha:snapshot.baseSha,sources}),proof=calculatorInputBrowserProofBinding(raw);
  if(proof.candidateSha!==snapshot.baseSha||proof.sourceSetSha256!==sourceSetSha256||proof.contractSha256!==policy.contractSha256||!runner&&proof.provenance!=='native-docker')return refuse();
  let legacyBrowserTestsVerified=false;
  if(raw.status==='passed'){
   // The existing narrow suite includes clear/backspace, keyboard equivalence
   // and narrow layout. Run it unchanged on the SAME complete proposed overlay.
   // Legacy structures below are private runner inputs, never approval caps.
   type LegacyInput=Parameters<CalculatorRepairBrowserRunner['check']>[0];
   const task:LegacyInput['task']={id:r.taskId,role:'frontend',goal:'Verify existing browser regressions on the proposed overlay.',acceptanceIds:['narrow-screen'],paths:['index.html','styles.css'],dependsOn:[]};
   const legacyChanges:LegacyInput['changes']={repository:r.plan.repository,baseRef:snapshot.baseRef,baseSha:snapshot.baseSha,summary:'Read-only existing browser regression overlay.',files:['index.html','styles.css'].map(path=>({path,content:sources.get(path)!,message:'Verify the same proposed overlay.'})),reviewEvidence:'{}',gates:{secretScan:'passed',policyReview:'passed',independentReview:'required',tests:'required',publicationAuthorized:false}};
   const legacy=createCalculatorBrowserSandbox({image:policy.image},{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'},runner);await legacy.preflight();await legacy.check({task,changes:legacyChanges,proposalDigest:calculatorProposalDigest(legacyChanges),dependencySha256:hash(sources.get('src/calculator.mjs')!),baseSources:sources});legacyBrowserTestsVerified=true;
  }
  await verifyProjectChanges(changes);await verifyProjectSnapshot(snapshot);assertProjectBrowserPolicy(policy,r.plan,r.taskId);
  const receipt:ProjectBrowserTestReceipt=Object.freeze({repository:r.plan.repository,taskId:r.taskId,planFingerprint:r.plan.fingerprint,baseSha:snapshot.baseSha,proposalDigest:changes.digest,sourceSetSha256,policySha256:policy.sha256,contractSha256:policy.contractSha256,status:raw.status,testsExecuted:true,provenance:proof.provenance,coverage:'calculator-input-and-existing-browser-regressions',legacyBrowserTestsVerified,failures:raw.failures,publicationAuthorized:false,wholeAppCompleted:false});receipts.set(receipt,{...r,policy,snapshot,changes});return receipt;
 }catch{return refuse();}}});
}
export async function verifyProjectBrowserTestReceipt(receipt:ProjectBrowserTestReceipt,plan:PreparedProjectPlan,taskId:string,snapshot:ProjectSourceSnapshot,changes:PreparedProjectChanges,policy:ProjectBrowserTestPolicy,mode:'native'|'simulated'='native'){try{
 const r=receipts.get(receipt);assertProjectBrowserPolicy(policy,plan,taskId);if(!r||r.plan!==plan||r.taskId!==taskId||r.policy!==policy||r.snapshot!==snapshot||r.changes!==changes||receipt.status!=='passed'||!receipt.testsExecuted||!receipt.legacyBrowserTestsVerified||mode==='native'&&receipt.provenance!=='native-docker'||receipt.sourceSetSha256!==sourceHash(overlay(snapshot,changes))||receipt.proposalDigest!==changes.digest)return refuse();
 assertProjectSnapshotIdentity(snapshot,plan,taskId);assertProjectChangesSnapshot(changes,snapshot);await verifyProjectChanges(changes);await verifyProjectSnapshot(snapshot);
}catch{return refuse();}}
