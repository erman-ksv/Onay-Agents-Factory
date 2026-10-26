import {createHash} from 'node:crypto';import {inflateRawSync} from 'node:zlib';
export const CALCULATOR_RECOVERY_ARTIFACT_ERROR='Pinned recovery artifact refused. No extraction, execution, model request or retry is authorized.';
const refuse=():never=>{throw Error(CALCULATOR_RECOVERY_ARTIFACT_ERROR);};
const REPO='erman-ksv/Onay-Agents-Factory',BASE='https://api.github.com/repos/'+REPO,MAX_ZIP=8388608,MAX_FILE=524288;
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const path=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=640&&v.split('/').length<=24&&v.split('/').every(p=>/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(p)&&!p.includes('..'));
const integer=(n:unknown,min:number,max:number):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max;
export type CalculatorRecoveryArtifactPin=Readonly<{runId:number;runAttempt:1;headSha:string;workflowPath:string;conclusion:'success'|'failure';artifactId:number;name:string;size:number;sha256:string;files:readonly Readonly<{path:string;bytes:number;sha256:string}>[]}>;
function prepare(v:CalculatorRecoveryArtifactPin):CalculatorRecoveryArtifactPin{
 try{
  // Data-only copy; no imported manifest can redefine host expectations.
  if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==10||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,'value')))return refuse();
  if(!integer(v.runId,1,Number.MAX_SAFE_INTEGER)||v.runAttempt!==1||!integer(v.artifactId,1,Number.MAX_SAFE_INTEGER)||!/^[a-f0-9]{40}$/.test(v.headSha)||!/^\.github\/workflows\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.yml$/.test(v.workflowPath)||!['success','failure'].includes(v.conclusion)||typeof v.name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(v.name)||!integer(v.size,22,MAX_ZIP)||!sha(v.sha256)||!Array.isArray(v.files)||!v.files.length||v.files.length>16)return refuse();
  const files=v.files.map(f=>{
   if(!f||Object.getPrototypeOf(f)!==Object.prototype||Reflect.ownKeys(f).length!==3||Object.values(Object.getOwnPropertyDescriptors(f)).some(d=>!Object.hasOwn(d,'value'))||!path(f.path)||!integer(f.bytes,0,MAX_FILE)||!sha(f.sha256))return refuse();return Object.freeze({path:f.path,bytes:f.bytes,sha256:f.sha256});
  });
  if(new Set(files.map(f=>f.path)).size!==files.length)return refuse();
  return Object.freeze({runId:v.runId,runAttempt:1,headSha:v.headSha,workflowPath:v.workflowPath,conclusion:v.conclusion,artifactId:v.artifactId,name:v.name,size:v.size,sha256:v.sha256,files:Object.freeze(files)});
 }catch{return refuse();}
}
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(b:Buffer){let n=0xffffffff;for(const v of b)n=crcTable[(n^v)&255]!^(n>>>8);return (n^0xffffffff)>>>0;}
/** Bounded ZIP reader: stored/deflate, UTF-8/ASCII, optional data descriptors.
 * Nothing is written or executed. All names/types/ranges are checked, including
 * unselected entries; only independently pinned files are decompressed. */
function readZip(zip:Buffer,pin:CalculatorRecoveryArtifactPin){
 let end=-1;for(let i=zip.length-22;i>=Math.max(0,zip.length-65557);i--)if(zip.readUInt32LE(i)===0x06054b50&&i+22+zip.readUInt16LE(i+20)===zip.length){end=i;break;}
 if(end<0||zip.readUInt16LE(end+4)||zip.readUInt16LE(end+6))return refuse();const count=zip.readUInt16LE(end+10),directory=zip.readUInt32LE(end+16),directorySize=zip.readUInt32LE(end+12);
 if(!count||count>2048||zip.readUInt16LE(end+8)!==count||directory+directorySize!==end)return refuse();
 const selected=new Map(pin.files.map(f=>[f.path,f])),result=new Map<string,Buffer>(),names=new Map<string,boolean>(),ranges:Array<[number,number]>=[];let cursor=directory,total=0;
 const extra=(start:number,length:number)=>{for(let p=start;p<start+length;){if(p+4>start+length)return refuse();const kind=zip.readUInt16LE(p),size=zip.readUInt16LE(p+2);if(kind===1||p+4+size>start+length)return refuse();p+=4+size;}};
 for(let index=0;index<count;index++){
  if(cursor+46>end||zip.readUInt32LE(cursor)!==0x02014b50)return refuse();
  const flags=zip.readUInt16LE(cursor+8),method=zip.readUInt16LE(cursor+10),checksum=zip.readUInt32LE(cursor+16),compressed=zip.readUInt32LE(cursor+20),size=zip.readUInt32LE(cursor+24),nameLength=zip.readUInt16LE(cursor+28),extraLength=zip.readUInt16LE(cursor+30),commentLength=zip.readUInt16LE(cursor+32),offset=zip.readUInt32LE(cursor+42);
  if(flags&~0x808||![0,8].includes(method)||size>MAX_FILE||compressed>MAX_ZIP||zip.readUInt16LE(cursor+34)||!nameLength||nameLength>640||cursor+46+nameLength+extraLength+commentLength>end)return refuse();
  const rawName=zip.subarray(cursor+46,cursor+46+nameLength),name=new TextDecoder('utf-8',{fatal:true}).decode(rawName),isDirectory=name.endsWith('/'),normalized=isDirectory?name.slice(0,-1):name,type=(zip.readUInt32LE(cursor+38)>>>16)&0xf000;
  if(!path(normalized)||names.has(normalized)||![0,0x8000,0x4000].includes(type)||(type===0x4000&&!isDirectory)||(isDirectory&&(size||compressed||selected.has(normalized))))return refuse();names.set(normalized,isDirectory);
  total+=size;if(total>MAX_ZIP)return refuse();extra(cursor+46+nameLength,extraLength);
  if(offset+30>directory||zip.readUInt32LE(offset)!==0x04034b50||zip.readUInt16LE(offset+6)!==flags||zip.readUInt16LE(offset+8)!==method)return refuse();
  const localName=zip.readUInt16LE(offset+26),localExtra=zip.readUInt16LE(offset+28),start=offset+30+localName+localExtra,dataEnd=start+compressed;
  if(localName!==nameLength||start>directory||dataEnd>directory||!zip.subarray(offset+30,offset+30+localName).equals(rawName))return refuse();extra(offset+30+localName,localExtra);
  for(const [field,expected]of [[14,checksum],[18,compressed],[22,size]]){const actual=zip.readUInt32LE(offset+field!);if(flags&8?actual!==0&&actual!==expected:actual!==expected)return refuse();}
  let rangeEnd=dataEnd;if(flags&8){let p=dataEnd;if(p+4<=directory&&zip.readUInt32LE(p)===0x08074b50)p+=4;if(p+12>directory||zip.readUInt32LE(p)!==checksum||zip.readUInt32LE(p+4)!==compressed||zip.readUInt32LE(p+8)!==size)return refuse();rangeEnd=p+12;}
  ranges.push([offset,rangeEnd]);const expected=selected.get(normalized);
  if(expected){if(isDirectory||expected.bytes!==size)return refuse();const content=method===0?Buffer.from(zip.subarray(start,dataEnd)):inflateRawSync(zip.subarray(start,dataEnd),{maxOutputLength:MAX_FILE});if(content.length!==size||crc(content)!==checksum||hash(content)!==expected.sha256)return refuse();result.set(normalized,content);}
  cursor+=46+nameLength+extraLength+commentLength;
 }
 if(cursor!==end||result.size!==selected.size)return refuse();ranges.sort((a,b)=>a[0]-b[0]);for(let i=1;i<ranges.length;i++)if(ranges[i]![0]<ranges[i-1]![1])return refuse();
 for(const name of names.keys()){const parts=name.split('/');for(let i=1;i<parts.length;i++)if(names.get(parts.slice(0,i).join('/'))===false)return refuse();}
 return {files:result,names};
}
export type CalculatorRecoveryArtifact=Readonly<{metadata:CalculatorRecoveryArtifactPin;readPrivateFile:(path:string)=>Buffer;assertExactFiles:(paths:readonly string[])=>void;assertRemote:()=>Promise<void>}>;
const artifacts=new WeakSet<object>();
export function isCalculatorRecoveryArtifact(v:unknown):v is CalculatorRecoveryArtifact{return !!v&&typeof v==='object'&&artifacts.has(v);}
/** Host pins must be reviewed outside the downloaded archive. Native run and
 * artifact metadata are checked before AND after the actual ZIP digest/files. */
export async function loadCalculatorRecoveryArtifact(input:CalculatorRecoveryArtifactPin,env:NodeJS.ProcessEnv,transport:typeof fetch=fetch):Promise<CalculatorRecoveryArtifact>{
 try{
  const pin=prepare(input),token=env.FACTORY_READ_TOKEN;
  if(!token||env.GITHUB_REPOSITORY!==REPO||typeof transport!=='function')return refuse();let requests=0,stopped=false;
  async function body(r:Response,max:number){if(!r.body)return refuse();const reader=r.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>max){await reader.cancel();return refuse();}chunks.push(p.value);}}finally{reader.releaseLock();}return Buffer.concat(chunks);}
  async function get(path:string,json=true){if(stopped||++requests>64)return refuse();const r=await transport(BASE+path,{method:'GET',redirect:json?'error':'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'}});if(!json)return r;if(r.status!==200){void r.body?.cancel().catch(()=>undefined);return refuse();}return JSON.parse((await body(r,524288)).toString('utf8'));}
  async function assertRemote(){try{
   if(stopped)return refuse();const run=await get('/actions/runs/'+pin.runId);if(run.id!==pin.runId||run.run_attempt!==pin.runAttempt||run.head_sha!==pin.headSha||run.path!==pin.workflowPath||run.status!=='completed'||run.conclusion!==pin.conclusion||run.repository?.full_name!==REPO)return refuse();
   const a=await get('/actions/artifacts/'+pin.artifactId);if(a.id!==pin.artifactId||a.name!==pin.name||a.expired!==false||a.size_in_bytes!==pin.size||a.digest!=='sha256:'+pin.sha256||a.workflow_run?.id!==pin.runId||a.workflow_run?.head_sha!==pin.headSha)return refuse();
  }catch{stopped=true;return refuse();}}
  await assertRemote();let response=await get('/actions/artifacts/'+pin.artifactId+'/zip',false) as Response;
  if(response.status===302){const location=response.headers.get('location');void response.body?.cancel().catch(()=>undefined);if(!location)return refuse();const url=new URL(location);if(url.protocol!=='https:'||url.username||url.password||url.port||!['.blob.core.windows.net','.actions.githubusercontent.com'].some(s=>url.hostname.endsWith(s)))return refuse();if(++requests>64)return refuse();response=await transport(url.toString(),{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});}
  if(response.status!==200){void response.body?.cancel().catch(()=>undefined);return refuse();}const zip=await body(response,MAX_ZIP);if(zip.length!==pin.size||hash(zip)!==pin.sha256)return refuse();const {files,names}=readZip(zip,pin);await assertRemote();
  const assertExactFiles=(expected:readonly string[])=>{
   try{
    if(stopped||!Array.isArray(expected)||expected.length<1||expected.length>16)return refuse();
    const descriptors=Object.getOwnPropertyDescriptors(expected);
    if(Reflect.ownKeys(expected).length!==expected.length+1||Array.from({length:expected.length},(_,i)=>i).some(i=>!Object.hasOwn(descriptors[String(i)]??{},'value')))return refuse();
    const paths=Array.from(expected);if(paths.some(p=>!path(p))||new Set(paths).size!==paths.length||paths.length!==files.size||paths.some(p=>!files.has(p)))return refuse();
    const allowed=new Set(paths);
    for(const [name,isDirectory]of names){if(isDirectory?!paths.some(p=>p.startsWith(name+'/')):!allowed.has(name))return refuse();}
   }catch{return refuse();}
  };
  const cap=Object.freeze({metadata:pin,assertExactFiles,readPrivateFile:(name:string)=>{if(stopped||!files.has(name))return refuse();return Buffer.from(files.get(name)!);},assertRemote});artifacts.add(cap);return cap;
 }catch{return refuse();}
}
