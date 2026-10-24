// Diagnostic only. This never changes the acceptance harness or its verdict.
import {readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';
const manifest=JSON.parse(readFileSync('/manifest.json','utf8')),tests=[];
for(const path of manifest.paths.filter(p=>p.startsWith('test/')&&p.endsWith('.mjs')).slice(0,3)){
 const r=spawnSync('/usr/local/bin/node',['--disable-sigusr1','--permission','--allow-fs-read=/app','/app/'+path],{encoding:'utf8',timeout:4000,maxBuffer:16384,env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',NODE_OPTIONS:''}});
 if(r.status===0&&!r.error&&!r.signal)continue;
 const output=(r.stdout??'')+'\n'+(r.stderr??'');
 const codes=[...new Set(output.match(/\b(?:ERR_MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED|ERR_ASSERTION|ERR_ACCESS_DENIED|ReferenceError|SyntaxError|TypeError)\b/g)??[])].slice(0,4);
 for(const [pattern,category] of [[/Invalid regular expression flags/i,'syntax_invalid_regex_flags'],[/Invalid regular expression:/i,'syntax_invalid_regex'],[/Invalid or unexpected token/i,'syntax_invalid_token'],[/Unexpected token/i,'syntax_unexpected_token'],[/Unexpected end of input/i,'syntax_unexpected_end'],[/missing \) after argument list/i,'syntax_missing_parenthesis']])if(pattern.test(output)&&codes.length<4)codes.push(category);
 const missing=[];for(const m of output.matchAll(/Cannot find (?:module|package) ['"]([^'"\r\n]{1,160})['"]/g))if(/^[a-zA-Z0-9_@./:-]+$/.test(m[1]))missing.push(m[1]);
 const operators=[...new Set([...output.matchAll(/operator:\s*['"]?(strictEqual|deepStrictEqual|equal|match|ok)\b/g)].map(m=>m[1]))].slice(0,3);
 const locations=[];const lines=output.split('\n');
 for(let i=0;i<lines.length;i++){const match=lines[i].match(/^(?:file:\/\/)?(\/app\/(?:test|src)\/[a-zA-Z0-9_./-]+):(\d+)(?::(\d+))?$/);if(match){const caret=lines[i+2]?.indexOf('^')??-1;const column=match[3]??(caret>=0?String(caret+1):undefined);locations.push(match[1]+':'+match[2]+(column?':'+column:''));}}
 for(const location of output.match(/\/app\/(?:test|src)\/[a-zA-Z0-9_./-]+:\d+(?::\d+)?/g)??[])if(!locations.includes(location))locations.push(location);
 locations.splice(3);
 tests.push({path,exitCode:Number.isInteger(r.status)?r.status:null,timedOut:!!r.error||!!r.signal,codes,missingModules:[...new Set(missing)].slice(0,3),operators,locations});
}
process.stdout.write(JSON.stringify({version:1,tests}));
