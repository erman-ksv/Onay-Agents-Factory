import {createHash,randomUUID} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readFileSync,writeFileSync,fsyncSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {PROJECT_MODEL_BUDGET_ERROR,type ProjectModelBudgetStore,type ProjectModelBudgetState} from './projectModelBudget.js';
const refuse=():never=>{throw Error(PROJECT_MODEL_BUDGET_ERROR);};
/** Dedicated host-owned existing directory on ONE shared filesystem. This is
 * not cross-machine GitHub Actions persistence. Stale crash locks refuse; never
 * delete another worker's lock or silently create a fresh project budget. */
export function createProjectModelBudgetFileStore(directory:string):ProjectModelBudgetStore{
 const flags=constants.O_NOFOLLOW??0,dir=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|flags);try{if(!fstatSync(dir).isDirectory())return refuse();}finally{closeSync(dir);}
 const file=join(directory,'project-model-budget.json'),lock=file+'.lock';
 const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
 function read(){let fd:number;try{fd=openSync(file,constants.O_RDONLY|flags);}catch(error){if((error as NodeJS.ErrnoException)?.code==='ENOENT')return undefined;return refuse();}
  try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>262144)return refuse();const b=readFileSync(fd);if(b.length>262144)return refuse();return {revision:hash(b),data:JSON.parse(b.toString('utf8')) as unknown};}catch{return refuse();}finally{closeSync(fd);}
 }
 return Object.freeze({read:async()=>read(),compareAndSwap:async(expected:string|undefined,data:ProjectModelBudgetState)=>{
  let lockFd:number;try{lockFd=openSync(lock,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|flags,0o600);}catch{return refuse();}
  let temp:string|undefined;
  try{const current=read();if(current?.revision!==expected)return undefined;const bytes=Buffer.from(JSON.stringify(data)+'\n');if(bytes.length>262144)return refuse();
   temp=file+'.'+randomUUID()+'.tmp';const fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|flags,0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
   renameSync(temp,file);temp=undefined;const directoryFd=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|flags);try{fsyncSync(directoryFd);}finally{closeSync(directoryFd);}return {revision:hash(bytes)};
  }catch{return refuse();}finally{if(temp)try{unlinkSync(temp);}catch{/* No replay or cleanup of foreign files. */}closeSync(lockFd);unlinkSync(lock);}
 }});
}
