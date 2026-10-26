import {constants,closeSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {isCalculatorRecoveryArtifact,type CalculatorRecoveryArtifact} from '../github/calculatorRecoveryArtifact.js';
import {createCalculatorPlan,calculatorPlanDigest,planObject,planKeys} from './calculatorPlan.js';
import {CalculatorPlanStore} from './calculatorPlanStore.js';
import {parseTeamTaskSnapshotBytes} from './teamTaskStore.js';
export const CALCULATOR_RECOVERY_STATE_ERROR='Authenticated recovery state restoration refused; preserve existing state. No execution is authorized.';
const refuse=():never=>{throw Error(CALCULATOR_RECOVERY_STATE_ERROR);};
export type CalculatorRecoveryStateMapping=Readonly<{
 planPath:string;planningReceiptPath:string;taskId:string;
 receipts:readonly Readonly<{taskId:string;path:string}>[];
}>;
/** Restore only authenticated metadata into a NEW private directory. Original
 * bytes and terminal receipts are preserved. This supplies no execution permit,
 * model allowance, dependency verdict or remote replay claim. Failed/partial
 * directories are deliberately retained and cannot be overwritten on retry. */
export async function restoreCalculatorRecoveryState(artifact:CalculatorRecoveryArtifact,mapping:CalculatorRecoveryStateMapping,
 ownerRequest:unknown,directory:string):Promise<Readonly<{directory:string;planFingerprint:string;taskId:string;executionAuthorized:false}>>{
 let parentFd:number|undefined;
 try{
  if(!isCalculatorRecoveryArtifact(artifact))return refuse();
  // Snapshot plain JSON configuration before the first asynchronous boundary.
  const plainData=(v:unknown,keys:string[])=>{if(!planObject(v)||!planKeys(v,keys)||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,'value')))return refuse();};
  plainData(mapping,['planPath','planningReceiptPath','taskId','receipts']);
  if(!Array.isArray(mapping.receipts)||mapping.receipts.length>8)return refuse();
  for(const entry of mapping.receipts)plainData(entry,['taskId','path']);
  const copy=JSON.parse(JSON.stringify(mapping)) as CalculatorRecoveryStateMapping;
  if(!planObject(copy)||!planKeys(copy,['planPath','planningReceiptPath','taskId','receipts'])||!Array.isArray(copy.receipts))return refuse();
  const planBytes=artifact.readPrivateFile(copy.planPath),document:unknown=JSON.parse(planBytes.toString('utf8'));
  if(!planObject(document)||!planKeys(document,['version','request','proposal','fingerprint'])||document.version!==1)return refuse();
  const plan=createCalculatorPlan(ownerRequest,document.proposal),archived=createCalculatorPlan(document.request,document.proposal);
  if(plan.fingerprint!==document.fingerprint||archived.fingerprint!==plan.fingerprint||archived.owner.ownerFingerprint!==plan.owner.ownerFingerprint)return refuse();
  const index=plan.tasks.findIndex(t=>t.id===copy.taskId);if(index<0||copy.receipts.length!==index+1)return refuse();
  const files=new Map<string,Buffer>();
  files.set(plan.owner.id+'.calculator-plan.json',planBytes);
  const markerName='calc-plan-'+plan.owner.id,markerBytes=artifact.readPrivateFile(copy.planningReceiptPath);
  const marker=parseTeamTaskSnapshotBytes(markerBytes,{id:markerName,fingerprint:plan.owner.ownerFingerprint});
  if(marker.status!=='needs-review'||marker.reasonCode!=='plan_saved_not_execution'||marker.publication||marker.stages.length!==3||
   marker.stages.some(s=>s.status!=='passed')||marker.stages[0]?.stage!=='save_plan'||marker.stages[1]?.stage!=='digest_a_'+plan.fingerprint.slice(0,32)||marker.stages[2]?.stage!=='digest_b_'+plan.fingerprint.slice(32))return refuse();
  files.set(markerName+'.json',markerBytes);
  const sourcePaths=[copy.planPath,copy.planningReceiptPath];
  for(const [i,entry] of copy.receipts.entries()){
   if(!planObject(entry)||!planKeys(entry,['taskId','path'])||typeof entry.path!=='string'||entry.taskId!==plan.tasks[i]?.id)return refuse();
   sourcePaths.push(entry.path);const bytes=artifact.readPrivateFile(entry.path);
   const receipt=parseTeamTaskSnapshotBytes(bytes,{id:'calc-'+entry.taskId,fingerprint:calculatorPlanDigest({planFingerprint:plan.fingerprint,taskId:entry.taskId})});
   if(receipt.status==='running')return refuse();
   if(i===index&&(receipt.status!=='blocked'||receipt.reasonCode!=='execution_failed_no_replay'||receipt.publication||!receipt.stages.some(s=>s.stage==='generate_1'&&s.status==='blocked')))return refuse();
   // Earlier receipts remain DATA; runtime independently rechecks their CI,
   // ancestry, exact blobs, Security, Reviewer and actual trusted tests.
   files.set('calc-'+entry.taskId+'.json',bytes);
  }
  if(new Set(sourcePaths).size!==sourcePaths.length||!isAbsolute(directory)||resolve(directory)!==directory)return refuse();
  const parent=dirname(directory);if(realpathSync(parent)!==parent)return refuse();
  const before=lstatSync(parent);if(!before.isDirectory()||before.isSymbolicLink()||(before.mode&0o777)!==0o700||(process.getuid&&before.uid!==process.getuid()))return refuse();
  parentFd=openSync(parent,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  const held=fstatSync(parentFd);if(held.dev!==before.dev||held.ino!==before.ino)return refuse();
  const assertParent=()=>{const now=lstatSync(parent);if(now.dev!==held.dev||now.ino!==held.ino||!now.isDirectory()||(now.mode&0o777)!==0o700)return refuse();};
  await artifact.assertRemote();assertParent();mkdirSync(directory,{mode:0o700});
  const root=lstatSync(directory);
  const assertRoot=()=>{assertParent();const now=lstatSync(directory);if(!now.isDirectory()||now.dev!==root.dev||now.ino!==root.ino||(now.mode&0o777)!==0o700)return refuse();};
  for(const [name,bytes] of files){
   assertParent();const current=lstatSync(directory);if(current.dev!==root.dev||current.ino!==root.ino||!current.isDirectory()||(current.mode&0o777)!==0o700)return refuse();
   const fd=openSync(join(directory,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  }
  const rootFd=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(rootFd);}finally{closeSync(rootFd);}fsyncSync(parentFd);
  if(new CalculatorPlanStore(directory,plan.request).inspect()?.fingerprint!==plan.fingerprint)return refuse();
  const verifyFiles=()=>{assertRoot();for(const [name,bytes] of files){const fd=openSync(join(directory,name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o777)!==0o600||stat.size!==bytes.length||!readFileSync(fd).equals(bytes))return refuse();}finally{closeSync(fd);}}};
  verifyFiles();await artifact.assertRemote();verifyFiles();
  return Object.freeze({directory,planFingerprint:plan.fingerprint,taskId:copy.taskId,executionAuthorized:false as const});
 }catch{return refuse();}finally{if(parentFd!==undefined)closeSync(parentFd);}
}
