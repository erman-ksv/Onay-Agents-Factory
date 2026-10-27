// Trusted host harness. Runs INSIDE the networkless container; never installs
// packages, reads credentials, accepts commands or executes test-supplied JS.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const input=JSON.parse(readFileSync('/manifest.json','utf8'));
const caseBytes=readFileSync('/cases.json'),cases=JSON.parse(caseBytes),caseSha256=createHash('sha256').update(caseBytes).digest('hex');
const failures=[],caseIds=[];
let applicationChecksStarted=false;
let child,server,sequence=0,buffer=Buffer.alloc(0),session,errors=0,blocked=0;
const pending=new Map();
const rpc=(method,params={},target=session)=>new Promise((resolve,reject)=>{
 const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('cdp_timeout'));},5000);
 pending.set(id,{resolve,reject,timer});
 child.stdio[3].write(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})})+'\0');
});
function message(m){
 if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error('cdp_error')):p.resolve(m.result);return;}
 if(m.method==='Runtime.exceptionThrown')errors++;
 if(m.method==='Network.webSocketCreated')blocked++;
 if(m.method==='Fetch.requestPaused'){
  const p=m.params,url=p.request.url;
  const okay=server&&url.startsWith(origin+'/')&&allowed.has(new URL(url).pathname);
  if(!okay)blocked++;
  void rpc(okay?'Fetch.continueRequest':'Fetch.failRequest',{requestId:p.requestId,...(okay?{}:{errorReason:'BlockedByClient'})},m.sessionId).catch(()=>{errors++;});
 }
}
let origin='',world;
const allowed=new Map([['/index.html','text/html'],['/styles.css','text/css'],['/src/app.mjs','text/javascript'],['/src/calculator.mjs','text/javascript'],['/favicon.ico','image/x-icon']]);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function evaluate(expression){const r=await rpc('Runtime.evaluate',{expression,contextId:world,returnByValue:true,awaitPromise:true});assert.equal(r.exceptionDetails,undefined);return r.result.value;}
async function isolatedWorld(){const f=await rpc('Page.getFrameTree');const r=await rpc('Page.createIsolatedWorld',{frameId:f.frameTree.frame.id,worldName:'factory-verifier'});world=r.executionContextId;}
async function run(){
 assert.ok(process.getuid()>0);assert.equal(input.version,1);assert.ok(['preflight','check'].includes(input.mode));assert.equal(input.suite,'input-normalization-v1');assert.equal(input.caseSha256,caseSha256);
 for(const key of ['GROQ_API_KEY','GEMINI_API_KEY','GITHUB_TOKEN','CALCULATOR_GITHUB_TOKEN','FACTORY_READ_TOKEN'])assert.equal(process.env[key],undefined);
 const dirs=readdirSync('/ms-playwright').filter(n=>/^chromium-[0-9]+$/.test(n));assert.equal(dirs.length,1);
 const binary=['chrome-linux64/chrome','chrome-linux/chrome'].map(p=>join('/ms-playwright',dirs[0],p)).find(existsSync);assert.ok(binary);
 child=spawn(binary,['--headless=new','--remote-debugging-pipe','--user-data-dir=/tmp/chrome-profile','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-extensions','--disable-sync','--metrics-recording-only','about:blank'],{
  env:{PATH:'/usr/bin:/bin',HOME:'/tmp',LANG:'C.UTF-8'},stdio:['ignore','ignore','pipe','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>{if(stderr.length<4000)stderr+=b.toString();});
 child.on('error',()=>{for(const p of pending.values())p.reject(Error('browser_unavailable'));});
 child.stdio[3].on('error',()=>{for(const p of pending.values())p.reject(Error('browser_pipe_unavailable'));});
 child.on('exit',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(/namespace|sandbox|Operation not permitted/i.test(stderr)?'browser_sandbox_unavailable':'browser_exited'));}pending.clear();});
 child.stdio[4].on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);if(buffer.length>1048576){child.kill('SIGKILL');return;}let end;while((end=buffer.indexOf(0))>=0){const item=buffer.subarray(0,end);buffer=buffer.subarray(end+1);try{message(JSON.parse(item.toString()));}catch{errors++;}}});
 const version=await rpc('Browser.getVersion',{},undefined);assert.match(version.product,/^(Headless)?Chrome\/[0-9.]+$/);
 const target=await rpc('Target.createTarget',{url:'about:blank'},undefined);
 session=(await rpc('Target.attachToTarget',{targetId:target.targetId,flatten:true},undefined)).sessionId;
 await rpc('Page.enable');await rpc('Runtime.enable');
 await rpc('Page.navigate',{url:'chrome://sandbox'});
 let sandbox='';for(let i=0;i<40;i++){try{await isolatedWorld();sandbox=await evaluate('document.body?.innerText||""');}catch{}if(/Seccomp-BPF sandbox\s+Yes/i.test(sandbox))break;await pause(100);}
 const namespaces=/Namespace sandbox\s+Yes/i.test(sandbox)||(/PID namespaces\s+Yes/i.test(sandbox)&&/Network namespaces\s+Yes/i.test(sandbox));
 if(!namespaces||!/Seccomp-BPF sandbox\s+Yes/i.test(sandbox))throw Error('browser_sandbox_unavailable');
 const security={ready:true,sandboxDisabled:false,networkIsolated:true,credentialsExcluded:true};
 if(input.mode==='preflight')return {version:1,mode:'preflight',...security,browser:version.product.replace(/^HeadlessChrome\//,'Chrome/')};
 server=createServer((req,res)=>{let path;try{path=new URL(req.url,'http://localhost').pathname;}catch{res.writeHead(400).end();return;}
  if(path==='/favicon.ico'){res.writeHead(204).end();return;}if(!allowed.has(path)){blocked++;res.writeHead(404).end();return;}
  res.setHeader('Content-Type',allowed.get(path));res.setHeader('Cache-Control','no-store');res.end(readFileSync('/app'+path));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 errors=0;await rpc('Network.enable');await rpc('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 await rpc('Emulation.setDeviceMetricsOverride',{width:360,height:740,deviceScaleFactor:1,mobile:false});
 await rpc('Page.navigate',{url:origin+'/index.html'});
 let ready=false;for(let i=0;i<50;i++){try{await isolatedWorld();ready=await evaluate('document.readyState==="complete"&&document.querySelectorAll("button").length>0');}catch{}if(ready)break;await pause(100);}assert.equal(ready,true);
 const display=()=>evaluate('(()=>{const e=document.querySelector("output")||document.getElementById("display")||document.getElementById("result")||document.querySelector("input[readonly]")||document.querySelector("[role=status]");return e?String("value" in e?e.value:e.textContent).trim():null})()');
 const click=async key=>{assert.ok(['0','1','2','3','4','5','6','7','8','9','.','+','-','*','/','=','clear','backspace'].includes(key));
  assert.equal(await evaluate(`(()=>{const k=${JSON.stringify(key)};const b=Array.from(document.querySelectorAll('button')).find(b=>[b.textContent||'',b.getAttribute('aria-label')||''].map(t=>t.trim()).some(t=>k==='clear'?/^(C|AC|Clear|Очистить)$/i.test(t):k==='backspace'?/backspace|delete|удал|⌫|←|⌦|back/i.test(t):t.replace('×','*').replace('÷','/').replace('−','-')===k));if(!b)return false;b.click();return true})()`),true);await pause(25);
 };
 applicationChecksStarted=true;
 const press=async k=>{const key=k==='='?'Enter':k,code=/^[0-9]$/.test(k)?'Digit'+k:k==='='?'Enter':k==='+'?'Equal':k==='-'?'Minus':k==='*'?'Digit8':'Slash',keyCode=k==='='?13:/^[0-9]$/.test(k)?k.charCodeAt(0):k==='+'?187:k==='-'?189:k==='*'?56:191;
  await rpc('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode,...(key!=='Enter'?{text:key}:{})});await rpc('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode});await pause(25);
 };
 for(const c of cases)for(const mode of c.keyboard?['buttons','keyboard']:['buttons']){
  const id=c.id+':'+mode;caseIds.push(id);
  try{await click('clear');for(const key of c.keys)await(mode==='buttons'?click(key):press(key));assert.equal(await display(),c.expected);}catch{failures.push(id);}
 }
 caseIds.push('narrow-layout');try{assert.equal(await evaluate('window.innerWidth'),360);assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true);}catch{failures.push('narrow-layout');}
 assert.equal(errors,0);assert.equal(blocked,0);
 return {version:1,mode:'check',status:failures.length?'failed':'passed',testsExecuted:true,browser:version.product.replace(/^HeadlessChrome\//,'Chrome/'),sandboxDisabled:false,pageErrors:errors,blockedRequests:blocked,caseSha256,caseIds,failures};
}
try{const result=await run();console.log(JSON.stringify(result));if(result.status==='failed')process.exitCode=1;}catch(error){console.log(JSON.stringify({version:1,status:'unverified',reason:error?.message==='browser_sandbox_unavailable'?'browser_sandbox_unavailable':applicationChecksStarted?'browser_checks_failed':'browser_checks_unverified'}));process.exitCode=1;}
finally{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('closed'));}pending.clear();child?.kill('SIGKILL');server?.close();}
