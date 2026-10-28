import assert from 'node:assert/strict';
import {constants,openSync,fstatSync,readFileSync,closeSync} from 'node:fs';import {pathToFileURL} from 'node:url';
import {prepareProjectRecoveryPreflight,runProjectRecoveryPreflight} from '../orchestration/projectRecoveryPreflight.js';
export const PREFLIGHT_SHA256='a1db5810a723d018c52d2160213f534dc8b521a1caee55a75f03d97d93555ecd';
function read(path,max){let fd;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const s=fstatSync(fd);assert.ok(s.isFile()&&s.nlink===1&&s.size<=max);return readFileSync(fd,'utf8');}finally{if(fd!==undefined)closeSync(fd);}}
export async function inspectRecoveryPreflight(environment){
 const env={...environment};assert.equal(env.GITHUB_REPOSITORY,'erman-ksv/Onay-Agents-Factory');assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
 for(const k of ['GROQ_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY','OPENROUTER_API_KEY','CLOUDFLARE_API_KEY'])assert.equal(env[k],undefined);
 const cap=prepareProjectRecoveryPreflight(read('.factory/recovery-preflight.json',8192),PREFLIGHT_SHA256,read('.factory/runtime-project-manifest.json',65536));
 const transport=globalThis.fetch,started=performance.now();let requests=0;
 globalThis.fetch=async(input,init)=>{const u=new URL(String(input));assert.equal(u.origin,'https://api.github.com');assert.ok(['/repos/erman-ksv/Onay-Agents-Factory/','/repos/erman-ksv/Onay-Factory-Calculator/'].some(p=>u.pathname.startsWith(p)));assert.equal(init?.method,'GET');assert.equal(init?.body,undefined);assert.equal(init?.redirect,'error');assert.ok(++requests<=400&&performance.now()-started<=240000);return transport(input,init);};
 try{const result=await runProjectRecoveryPreflight(cap,env);console.error(JSON.stringify({version:1,status:'native-readonly-preflight-finished',requests,providerCalls:0,budgetWrites:0,archiveWrites:0}));return result;}
 catch{console.error(JSON.stringify({version:1,status:'native-readonly-preflight-blocked',requests,providerCalls:0,budgetWrites:0,archiveWrites:0}));throw Error('Read-only recovery preflight blocked');}
 finally{globalThis.fetch=transport;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log(JSON.stringify(await inspectRecoveryPreflight(process.env)));}catch{console.error('Recovery preflight refused; preserve every charge and claim.');process.exitCode=1;}}
