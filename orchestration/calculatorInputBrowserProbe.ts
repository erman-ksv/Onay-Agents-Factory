/** Separate host-owned input regression probe. It cannot mint publication
 * approval or replace any existing calculator/browser acceptance scenario. */
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,chownSync} from 'node:fs';
import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {tmpdir} from 'node:os';
import {projectSourceContainsSecrets} from '../github/projectSourceSnapshot.js';
import {runCalculatorSandboxProcess,type CalculatorSandboxProcess} from './calculatorSandbox.js';
export const CALCULATOR_INPUT_BROWSER_ERROR='Input browser probe is unverified. Preserve the source SHA and failures; no weaker sandbox, application write, publication or model retry is authorized.';
const refuse=():never=>{throw Error(CALCULATOR_INPUT_BROWSER_ERROR);};
const paths=['index.html','styles.css','src/app.mjs','src/calculator.mjs'],prefix=['--host=unix:///var/run/docker.sock'];
const digest=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const casesBytes=()=>readFileSync(new URL('../config/calculator-input-browser/cases.json',import.meta.url));
export function calculatorInputBrowserContract(){const bytes=casesBytes(),cases=JSON.parse(bytes.toString());return Object.freeze({sha256:digest(bytes),caseIds:Object.freeze([...cases.flatMap((c:any)=>c.keyboard?[c.id+':buttons',c.id+':keyboard']:[c.id+':buttons']),'narrow-layout']) as readonly string[]});}
type Input=Readonly<{candidateSha:string;sources:ReadonlyMap<string,string>}>;
/** Production fixed native process; provider credentials are never forwarded. */
export function createCalculatorInputBrowserProbe(image:string){return probe(image,runCalculatorSandboxProcess,'native-docker');}
export function createCalculatorInputBrowserProbeForTests(image:string,runner:CalculatorSandboxProcess){return probe(image,runner,'simulated');}
function probe(image:string,runner:CalculatorSandboxProcess,provenance:'native-docker'|'simulated'){
 if(typeof image!=='string'||!/^mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}$/.test(image)||typeof runner!=='function')return refuse();
 const options=Object.freeze({env:Object.freeze({PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}),timeoutMs:45000,maxOutputBytes:16384}),contract=calculatorInputBrowserContract();let used=false;
 const harness=readFileSync(new URL('../config/calculator-input-browser/check.mjs',import.meta.url),'utf8'),policy=fileURLToPath(new URL('../config/calculator-browser/seccomp.json',import.meta.url));if(JSON.parse(readFileSync(policy,'utf8')).defaultAction!=='SCMP_ACT_ERRNO')return refuse();
 return Object.freeze({async run(input:Input){if(used)return refuse();used=true;const sources=new Map(input.sources);if(!/^[a-f0-9]{40}$/.test(input.candidateSha)||sources.size!==4||paths.some(p=>typeof sources.get(p)!=='string')||[...sources].some(([p,s])=>!paths.includes(p)||Buffer.byteLength(s)>131072||projectSourceContainsSecrets(s))||[...sources.values()].reduce((n,s)=>n+Buffer.byteLength(s),0)>131072)return refuse();
  const sourceSetSha256=digest(JSON.stringify(paths.map(path=>({path,sha256:digest(sources.get(path)!),bytes:Buffer.byteLength(sources.get(path)!)}))));
  async function execute(mode:'preflight'|'check'){
   let directory:string|undefined,name:string|undefined;try{
    const inspect=await runner([...prefix,'image','inspect','--format={{json .RepoDigests}}',image],options),digests=inspect.code===0?JSON.parse(inspect.stdout):undefined;if(inspect.code!==0||inspect.timedOut||!Array.isArray(digests)||!digests.includes(image))return refuse();
    const uid=process.getuid?.()??-1,gid=process.getgid?.()??-1;if(uid<0||gid<0)return refuse();const user=uid===0?1000:uid,group=uid===0?1000:gid;
    directory=mkdtempSync(join(tmpdir(),'factory-input-browser-'));const app=join(directory,'app');mkdirSync(app,{mode:0o700});mkdirSync(join(app,'src'),{mode:0o700});const owned=[directory,app,join(app,'src')];
    if(mode==='check')for(const [path,content]of sources){const file=join(app,path);writeFileSync(file,content,{mode:0o600,flag:'wx'});owned.push(file);}
    const driver=join(directory,'harness.mjs'),manifest=join(directory,'manifest.json'),cases=join(directory,'cases.json');
    for(const [file,content]of [[driver,harness],[manifest,JSON.stringify({version:1,mode,suite:'input-normalization-v1',caseSha256:contract.sha256})],[cases,casesBytes()]] as const){writeFileSync(file,content,{mode:0o600,flag:'wx'});owned.push(file);}
    if(uid===0)for(const file of owned)chownSync(file,user,group);name='factory-input-browser-'+randomBytes(10).toString('hex');
    const args=[...prefix,'run','--rm','--name='+name,'--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--security-opt=seccomp='+policy,'--user='+user+':'+group,'--pids-limit=128','--memory=1g','--memory-swap=1g','--cpus=1','--shm-size=256m','--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=128m,mode=1777','--env=HOME=/tmp','--env=PATH=/usr/bin:/bin',...['NODE_OPTIONS','NODE_EXTRA_CA_CERTS','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','FTP_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','ftp_proxy'].map(k=>'--env='+k+'='),'--mount=type=bind,src='+driver+',dst=/harness.mjs,readonly','--mount=type=bind,src='+manifest+',dst=/manifest.json,readonly','--mount=type=bind,src='+cases+',dst=/cases.json,readonly','--mount=type=bind,src='+app+',dst=/app,readonly','--entrypoint=/usr/bin/node',image,'/harness.mjs'];
    const result=await runner(args,options);if(result.timedOut||![0,1].includes(result.code??-1)||Buffer.byteLength(result.stdout)>16384)return refuse();const proof=JSON.parse(result.stdout);
    if(proof.version!==1||proof.mode!==mode||proof.sandboxDisabled!==false||!/^Chrome\/[0-9.]+$/.test(proof.browser))return refuse();
    if(mode==='preflight'){if(result.code!==0||proof.ready!==true||proof.networkIsolated!==true||proof.credentialsExcluded!==true)return refuse();return proof;}
    if(proof.testsExecuted!==true||proof.pageErrors!==0||proof.blockedRequests!==0||proof.caseSha256!==contract.sha256||JSON.stringify(proof.caseIds)!==JSON.stringify(contract.caseIds)||!Array.isArray(proof.failures)||new Set(proof.failures).size!==proof.failures.length||proof.failures.some((id:unknown)=>!contract.caseIds.includes(id as string))||result.code===0&&(proof.status!=='passed'||proof.failures.length)||result.code===1&&(proof.status!=='failed'||!proof.failures.length))return refuse();
    return proof;
   }catch{return refuse();}finally{if(name)try{await runner([...prefix,'rm','--force',name],options);}catch{}if(directory)rmSync(directory,{recursive:true,force:true});}
  }
  await execute('preflight');const result=await execute('check');return Object.freeze({version:1,candidateSha:input.candidateSha,sourceSetSha256,contractSha256:contract.sha256,status:result.status as 'passed'|'failed',testsExecuted:true as const,caseIds:contract.caseIds,failures:Object.freeze([...result.failures]) as readonly string[],browser:result.browser as string,sandboxDisabled:false as const,networkIsolated:true as const,credentialsExcluded:true as const,provenance,executionAuthorized:false as const,publicationAuthorized:false as const,wholeAppCompleted:false as const});
 }});
}
