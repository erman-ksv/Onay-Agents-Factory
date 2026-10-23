// Diagnostic only. This never changes the acceptance harness or its verdict.
import {readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';
const manifest=JSON.parse(readFileSync('/manifest.json','utf8')),tests=[];
for(const path of manifest.paths.filter(p=>p.startsWith('test/')&&p.endsWith('.mjs')).slice(0,3)){
 const r=spawnSync('/usr/local/bin/node',['--disable-sigusr1','--permission','--allow-fs-read=/app','/app/'+path],{encoding:'utf8',timeout:4000,maxBuffer:16384,env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',NODE_OPTIONS:''}});
 if(r.status===0&&!r.error&&!r.signal)continue;
 const output=(r.stdout??'')+'\n'+(r.stderr??'');
 const codes=[...new Set(output.match(/\b(?:ERR_MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED|ERR_ASSERTION|ERR_ACCESS_DENIED|ReferenceError|SyntaxError|TypeError)\b/g)??[])].slice(0,4);
 const missing=[];for(const m of output.matchAll(/Cannot find (?:module|package) ['"]([^'"\r\n]{1,160})['"]/g))if(/^[a-zA-Z0-9_@./:-]+$/.test(m[1]))missing.push(m[1]);
 const operators=[...new Set([...output.matchAll(/operator:\s*['"]?(strictEqual|deepStrictEqual|equal|match|ok)\b/g)].map(m=>m[1]))].slice(0,3);
 const locations=[...new Set(output.match(/\/app\/(?:test|src)\/[a-zA-Z0-9_./-]+:\d+:\d+/g)??[])].slice(0,3);
 tests.push({path,exitCode:Number.isInteger(r.status)?r.status:null,timedOut:!!r.error||!!r.signal,codes,missingModules:[...new Set(missing)].slice(0,3),operators,locations});
}
process.stdout.write(JSON.stringify({version:1,tests}));
