import {createHash} from 'node:crypto';
import {assertValidBranchRef} from '../github/githubClient.js';
import {scanForSecrets} from '../github/secretScanner.js';

export const PROJECT_TARGET_ERROR='Project target is not host-approved or its scope is invalid. No execution is authorized.';
const refuse=():never=>{throw Error(PROJECT_TARGET_ERROR);};
const actors=['security','reviewer','tester'] as const;
export type ProjectTargetDefinition=Readonly<{
 version:1;id:string;repository:string;writablePaths:readonly string[];branchPrefix:string;
 requiredCiNames:readonly string[];requiredCiSteps:readonly string[];requiredActors:readonly string[];
 maxFiles:number;maxSourceBytes:number;maxNewFileBytes:number;maxChangedCharacters:number;maxReviewBytes:number;
 legalEnabled:false;mergesEnabled:false;
}>;
export type ProjectTargetProfile=ProjectTargetDefinition&Readonly<{sha256:string}>;
declare const targetBrand:unique symbol;
export type ApprovedProjectTarget=Readonly<{[targetBrand]:true}>;
const targets=new WeakMap<ApprovedProjectTarget,ProjectTargetProfile>();
const keys=['version','id','repository','writablePaths','branchPrefix','requiredCiNames','requiredCiSteps','requiredActors','maxFiles','maxSourceBytes','maxNewFileBytes','maxChangedCharacters','maxReviewBytes','legalEnabled','mergesEnabled'];
function plain(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)??{},'value'));}
function strings(v:unknown,max:number,valid:(s:string)=>boolean):v is string[]{if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||v.length<1||v.length>max||Reflect.ownKeys(v).length!==v.length+1)return false;const seen=new Set<string>();for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='string'||!valid(d.value)||seen.has(d.value))return false;seen.add(d.value);}return true;}
function path(s:string){return s.length<=240&&/^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(s)&&s.split('/').every(p=>p.length>0&&p!=='.'&&p!=='..'&&!p.startsWith('.')&&!/^(?:node_modules|AGENTS\.md|package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock)$/i.test(p))&&/\.(?:mjs|js|ts|tsx|jsx|json|html|css|md)$/.test(s);}
function definition(input:unknown):ProjectTargetProfile{
 if(!plain(input)||input.version!==1||typeof input.id!=='string'||!/^[a-z][a-z0-9-]{1,47}$/.test(input.id)||typeof input.repository!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(input.repository)||input.repository.endsWith('.git')||typeof input.branchPrefix!=='string'||!/^feat\/[a-z0-9][a-z0-9-]{1,63}\/$/.test(input.branchPrefix)||input.legalEnabled!==false||input.mergesEnabled!==false)return refuse();
 const label=(s:string)=>/^[A-Za-z0-9][A-Za-z0-9 ._:/()-]{0,79}$/.test(s);
 if(!strings(input.writablePaths,64,path)||!strings(input.requiredCiNames,16,label)||!strings(input.requiredCiSteps,16,label)||!strings(input.requiredActors,3,s=>actors.includes(s as typeof actors[number]))||input.requiredActors.length!==3)return refuse();
 for(const [k,limit] of [['maxFiles',16],['maxSourceBytes',262144],['maxNewFileBytes',16384],['maxChangedCharacters',12000],['maxReviewBytes',24000]] as const)if(typeof input[k]!=='number'||!Number.isSafeInteger(input[k])||input[k]<1||input[k]>limit)return refuse();
 if(input.repository.toLowerCase()==='erman-ksv/onay-agents-factory'||(input.maxFiles as number)>input.writablePaths.length||(input.maxNewFileBytes as number)>(input.maxSourceBytes as number)||scanForSecrets(JSON.stringify(input)).length)return refuse();
 const d:ProjectTargetDefinition=Object.freeze({version:1,id:input.id,repository:input.repository,writablePaths:Object.freeze([...input.writablePaths].sort()),branchPrefix:input.branchPrefix,requiredCiNames:Object.freeze([...input.requiredCiNames].sort()),requiredCiSteps:Object.freeze([...input.requiredCiSteps].sort()),requiredActors:Object.freeze([...actors]),maxFiles:input.maxFiles as number,maxSourceBytes:input.maxSourceBytes as number,maxNewFileBytes:input.maxNewFileBytes as number,maxChangedCharacters:input.maxChangedCharacters as number,maxReviewBytes:input.maxReviewBytes as number,legalEnabled:false,mergesEnabled:false});
 return Object.freeze({...d,sha256:createHash('sha256').update(JSON.stringify(d)).digest('hex')});
}
/** HOST ONLY: import from trusted composition code, never expose as a Commander
 * tool or load definitions from model output/environment. Registration is not
 * owner approval, budget initialization, model permission or publication. */
export function createProjectTargetRegistry(definitions:readonly unknown[]){
 try{
  if(!Array.isArray(definitions)||Object.getPrototypeOf(definitions)!==Array.prototype||definitions.length<1||definitions.length>16||Reflect.ownKeys(definitions).length!==definitions.length+1||Array.from({length:definitions.length},(_,i)=>Object.getOwnPropertyDescriptor(definitions,String(i))).some(d=>!d||!Object.hasOwn(d,'value')))return refuse();
  const profiles=definitions.map(d=>definition(d));if(new Set(profiles.map(p=>p.id)).size!==profiles.length||new Set(profiles.map(p=>p.repository.toLowerCase())).size!==profiles.length)return refuse();
  const entries=new Map<string,ApprovedProjectTarget>();for(const p of profiles){const capability=Object.freeze({}) as ApprovedProjectTarget;targets.set(capability,p);entries.set(p.id,capability);}
  return Object.freeze({select(id:string){const t=entries.get(id);if(!t)return refuse();return t;},list:()=>Object.freeze([...profiles])});
 }catch{return refuse();}
}
export function projectTargetProfile(target:unknown,repository:string):ProjectTargetProfile{
 const profile=targets.get(target as ApprovedProjectTarget);if(!profile||profile.repository!==repository)return refuse();return profile;
}
/** Authorization DATA for tools after budget/native owner gates. The capability
 * remains in host memory; its JSON representation confers no authority. */
export function assertProjectTargetScope(target:unknown,input:Readonly<{repository:string;branch:string;changePaths:readonly string[]}>){
 try{const p=projectTargetProfile(target,input.repository);if(typeof input.branch!=='string'||!input.branch.startsWith(p.branchPrefix)||input.branch.length===p.branchPrefix.length||!strings(input.changePaths,p.maxFiles,s=>p.writablePaths.includes(s)))return refuse();assertValidBranchRef(input.branch);return p;}catch{return refuse();}
}
