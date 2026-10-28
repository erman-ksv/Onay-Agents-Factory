import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createProjectModelBudgetGitHubLineageReader} from './projectModelBudgetStore.js';
function fixture(kind='ok'){
 const key='a'.repeat(64),beforeHead='1'.repeat(40),afterHead='2'.repeat(40),file='project-model-budget.json',calls:string[]=[];
 const gitHash=(type:string,b:Buffer)=>createHash('sha1').update(Buffer.concat([Buffer.from(type+' '+b.length+'\0'),b])).digest('hex');
 const objects=new Map<string,unknown>();
 for(const [head,grant]of [[beforeHead,'b'.repeat(64)],[afterHead,'c'.repeat(64)]] as const){
  const content=Buffer.from(JSON.stringify({version:1,grantSha256:grant,reservations:[]})),blob=gitHash('blob',content),tree=gitHash('tree',Buffer.concat([Buffer.from('100644 '+file+'\0'),Buffer.from(blob,'hex')]));
  objects.set('/git/commits/'+head,{sha:head,tree:{sha:tree},parents:head===afterHead?(kind==='merge'?[{sha:beforeHead},{sha:'3'.repeat(40)}]:[{sha:kind==='sibling'?'3'.repeat(40):beforeHead}]):[]});
  objects.set('/git/trees/'+tree,{sha:tree,truncated:false,tree:[{path:file,mode:'100644',type:'blob',sha:blob}]});
  objects.set('/git/blobs/'+blob,{sha:blob,encoding:'base64',content:kind==='tamper'&&head===beforeHead?Buffer.from('{}').toString('base64'):content.toString('base64')});
 }
 let refs=0;const transport:typeof fetch=async(url,init)=>{assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(init?.body,undefined);const path=String(url).replace('https://api.github.com/repos/erman-ksv/Onay-Agents-Factory','');calls.push(path);if(path.startsWith('/git/ref/'))return Response.json({ref:'refs/heads/state/project-model-budget/'+(kind==='wrong-ref'?'d'.repeat(64):key),object:{type:'commit',sha:kind==='detached'||kind==='drift'&&++refs===2?'3'.repeat(40):afterHead}});const value=objects.get(path);assert.ok(value,'unexpected path '+path);return Response.json(value);};
 return {reader:createProjectModelBudgetGitHubLineageReader({projectKey:key,token:'offline',transport}),beforeHead,afterHead,calls};
}
test('lineage reader uses only GET and verifies both immutable Git states and live head twice',async()=>{
 const f=fixture(),t=await f.reader.readTransition(f.beforeHead,f.afterHead);assert.equal(t.before.data.grantSha256,'b'.repeat(64));assert.equal(t.after.data.grantSha256,'c'.repeat(64));assert.equal(f.calls.filter(p=>p.startsWith('/git/ref/')).length,2);assert.ok(f.calls.includes('/git/commits/'+f.beforeHead));
});
test('detached, sibling, merge or wrong-ref history cannot attest an extension',async()=>{
 for(const kind of ['detached','sibling','merge','wrong-ref']){const f=fixture(kind);await assert.rejects(()=>f.reader.readTransition(f.beforeHead,f.afterHead));}
});
test('blob tampering and ref advancement during history inspection stop cold recovery',async()=>{
 for(const kind of ['tamper','drift']){const f=fixture(kind);await assert.rejects(()=>f.reader.readTransition(f.beforeHead,f.afterHead));}
});
test('malformed or equal host pins refuse before any network request',async()=>{
 const f=fixture();for(const [a,b]of [['bad',f.afterHead],[f.beforeHead,f.beforeHead]])await assert.rejects(()=>f.reader.readTransition(a!,b!));assert.equal(f.calls.length,0);
});
