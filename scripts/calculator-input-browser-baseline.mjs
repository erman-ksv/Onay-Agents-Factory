// Read-only baseline, fixed source SHA. Never execute application JS on host.
import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {constants,openSync,fstatSync,readFileSync,closeSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';import {join} from 'node:path';
import {createCalculatorInputBrowserProbe} from '../orchestration/calculatorInputBrowserProbe.js';
const candidateSha='558993981c9bbb7c6100c8335860ac5668768314',image='mcr.microsoft.com/playwright@sha256:f1e7e01021efd65dd1a2c56064be399f3e4de00fd021ac561325f2bfbb2b837a';
const cwd=join(process.cwd(),'calculator-candidate'),git=args=>execFileSync('/usr/bin/git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-C',cwd,...args],{encoding:'utf8',timeout:10000,maxBuffer:16384}).trim();
try{
 assert.equal(git(['rev-parse','HEAD']),candidateSha);const sources=new Map();
 for(const path of ['index.html','styles.css','src/app.mjs','src/calculator.mjs']){
  const entry=git(['ls-tree','HEAD','--',path]),m=/^100644 blob ([a-f0-9]{40})\t/.exec(entry);assert.ok(m);
  const fd=openSync(join(cwd,path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let bytes;try{const s=fstatSync(fd);assert.ok(s.isFile()&&s.size<=131072);bytes=readFileSync(fd);}finally{closeSync(fd);}
  assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex'),m[1]);const source=bytes.toString('utf8');assert.ok(Buffer.from(source).equals(bytes));sources.set(path,source);
 }
 const proof=await createCalculatorInputBrowserProbe(image).run({candidateSha,sources});
 assert.equal(proof.status,'failed');for(const id of ['repeat-multiply:buttons','repeat-multiply:keyboard','leading-zero-display:buttons','leading-zero-display:keyboard'])assert.ok(proof.failures.includes(id));
 assert.equal(git(['rev-parse','HEAD']),candidateSha);assert.equal(git(['status','--porcelain']), '');
 const result={version:1,status:'browser-baseline-defects-reproduced-not-repaired',proof,modelCalls:0,applicationWrites:0,budgetWrites:0,legalEnabled:false};
 writeFileSync(join(process.env.RUNNER_TEMP,'calculator-input-browser-baseline.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch{console.error('Input browser baseline unverified. No weaker sandbox, repair, provider request or publication is authorized.');process.exitCode=1;}
