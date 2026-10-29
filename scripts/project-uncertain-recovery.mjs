import {constants,openSync,fstatSync,readFileSync,closeSync,mkdtempSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
import {prepareProjectUncertainRecoveryHost,runProjectUncertainRecoveryHost} from '../orchestration/projectUncertainRecoveryHost.js';
function read(path,max){let fd;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const s=fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.size>max)throw Error('Unverified host file');return readFileSync(fd,'utf8');}finally{if(fd!==undefined)closeSync(fd);}}
/** Expected digest must be an independent reviewed workflow literal, never a
 * hash computed from event data or from the same untrusted file. */
export async function recoverUncertainProject(environment){
 const env={...environment};if(!/^[a-f0-9]{64}$/.test(env.EXPECTED_RECOVERY_HOST_SHA256??''))throw Error('Independent recovery scope pin is missing');
 const cap=prepareProjectUncertainRecoveryHost(read('.factory/recovery-host.json',8192),env.EXPECTED_RECOVERY_HOST_SHA256,read('.factory/runtime-project-manifest.json',65536),read('.factory/recovery-preflight.json',8192));
 return runProjectUncertainRecoveryHost(cap,env,mkdtempSync(join(tmpdir(),'factory-native-uncertain-recovery-')));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log(JSON.stringify(await recoverUncertainProject(process.env)));}catch{console.error('Uncertain recovery stopped. Preserve the latest state refs, ciphertext and charged reservations. No replay or extension retry is authorized.');process.exitCode=1;}}
