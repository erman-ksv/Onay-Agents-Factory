import {scanForSecrets} from '../github/secretScanner.js';
/** Treat child output as untrusted diagnostic data. No messages/source/stacks or credentials. */
export function calculatorTestDiagnosticFailures(raw:string,approvedPaths:readonly string[]):readonly string[]{
 try{
  if(Buffer.byteLength(raw)>32768)return [];
  const data=JSON.parse(raw);if(!data||Object.keys(data).sort().join(',')!=='tests,version'||data.version!==1||!Array.isArray(data.tests)||data.tests.length>3)return [];
  const out:string[]=[];const code=/^(ERR_MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED|ERR_ASSERTION|ERR_ACCESS_DENIED|ReferenceError|SyntaxError|TypeError|syntax_invalid_regex_flags|syntax_invalid_regex|syntax_invalid_token|syntax_unexpected_token|syntax_unexpected_end|syntax_missing_parenthesis)$/;
  for(const row of data.tests){
   if(!row||Object.keys(row).sort().join(',')!=='codes,exitCode,locations,missingModules,operators,path,timedOut'||!approvedPaths.includes(row.path)||!row.path.startsWith('test/')||!row.path.endsWith('.mjs')||typeof row.timedOut!=='boolean'||(row.exitCode!==null&&(!Number.isSafeInteger(row.exitCode)||row.exitCode===0)))return [];
   if(!Array.isArray(row.codes)||row.codes.length>4||row.codes.some((v:unknown)=>typeof v!=='string'||!code.test(v))||!Array.isArray(row.missingModules)||row.missingModules.length>3||row.missingModules.some((v:unknown)=>typeof v!=='string'||v.length>160||!v.length||!/^[-a-zA-Z0-9_@./:]+$/.test(v))||!Array.isArray(row.operators)||row.operators.length>3||row.operators.some((v:unknown)=>!['strictEqual','deepStrictEqual','equal','match','ok'].includes(String(v)))||!Array.isArray(row.locations)||row.locations.length>3||row.locations.some((v:unknown)=>typeof v!=='string'||v.length>200||!/^\/app\/(?:test|src)\/[-a-zA-Z0-9_./]+:\d+(?::\d+)?$/.test(v)))return [];
   const message='Untrusted project-test diagnostic: '+row.path+'; '+[...row.codes,...row.missingModules.map((p:string)=>'missing='+p),...row.operators.map((p:string)=>'operator='+p),...row.locations].join('; ');
   if(message.length<=400&&!scanForSecrets(message).length&&!/(?:gsk_|gh[pousr]_)[A-Za-z0-9_-]{20,}/.test(message))out.push(message);
  }
  return Object.freeze(out.slice(0,3));
 }catch{return [];}
}
