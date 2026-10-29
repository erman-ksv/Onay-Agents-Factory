// Trusted supervisor outside /app. Candidate code only runs in permissioned
// children. Their output is data: it never replaces this supervisor's verdict.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
const manifest=JSON.parse(readFileSync('/manifest.json','utf8')),failures=[];
function run(args,input=''){
 const r=spawnSync('/usr/local/bin/node',args,{input,encoding:'utf8',timeout:3000,maxBuffer:16384,env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',NODE_OPTIONS:''}});
 return {ok:r.status===0&&!r.error&&r.signal===null,stdout:r.stdout??''};
}
for(const path of manifest.paths.filter(p=>/\.(mjs|js)$/.test(p)))if(!run(['--check','/app/'+path]).ok)failures.push('syntax:'+path);
const child=String.raw`
 import {readFileSync} from 'node:fs';
 const write=process.stdout.write.bind(process.stdout);
 const input=JSON.parse(readFileSync(0,'utf8'));
 const fn=(await import('file:///app/'+input.path))[input.exportName];
 if(typeof fn!=='function')process.exit(2);
 const value=await fn(...input.args);
 write(JSON.stringify({value}));
`;
for(const check of manifest.checks){
 const result=run(['--disable-sigusr1','--permission','--allow-fs-read=/app','--input-type=module','-e',child],JSON.stringify({path:check.path,exportName:check.exportName,args:check.args}));
 let actual;try{actual=JSON.parse(result.stdout);}catch{/* Invalid child output cannot prove success. */}
 if(!result.ok||!actual||Object.keys(actual).length!==1||!Object.hasOwn(actual,'value')||!isDeepStrictEqual(actual.value,check.expected))failures.push('contract:'+check.id);
}
process.stdout.write(JSON.stringify({version:1,status:failures.length?'failed':'passed',checks:['syntax',...manifest.checks.map(c=>c.id)],failures}));
process.exitCode=failures.length?1:0;
