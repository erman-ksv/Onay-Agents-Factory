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
function reservedFixture(kind='ok',count=1){
 const key='a'.repeat(64),beforeHead='1'.repeat(40),afterHead='2'.repeat(40),head=(n:number)=>n.toString(16).padStart(40,'0'),current=head(count+2),file='project-model-budget.json',objects=new Map<string,unknown>(),calls:string[]=[];
 const gitHash=(type:string,b:Buffer)=>createHash('sha1').update(Buffer.concat([Buffer.from(type+' '+b.length+'\0'),b])).digest('hex'),reservation=(id:string)=>({reservationId:id+':r1',taskId:'t01',requestSha256:'d'.repeat(64),requestBytes:100,reservedTokens:50});
 function add(sha:string,parents:string[],grant:string,reservations:unknown[]){const content=Buffer.from(JSON.stringify({version:1,grantSha256:grant,reservations})),blob=gitHash('blob',content),tree=gitHash('tree',Buffer.concat([Buffer.from('100644 '+file+'\0'),Buffer.from(blob,'hex')]));objects.set('/git/commits/'+sha,{sha,tree:{sha:tree},parents:parents.map(sha=>({sha}))});objects.set('/git/trees/'+tree,{sha:tree,truncated:false,tree:[{path:file,mode:'100644',type:'blob',sha:blob}]});objects.set('/git/blobs/'+blob,{sha:blob,encoding:'base64',content:content.toString('base64')});}
 const original=reservation('old');add(beforeHead,[],'b'.repeat(64),[original]);add(afterHead,[beforeHead],'c'.repeat(64),[original]);
 for(let i=1;i<=count;i++){const parents=kind==='merge'&&i===count?[afterHead,beforeHead]:[i===1?afterHead:head(i+1)];let rs=[original,...Array.from({length:i},(_,n)=>reservation('new-'+n))];if(kind==='rewrite'&&i===count)rs[0]={...original,requestSha256:'e'.repeat(64)};if(kind==='drop'&&i===count)rs=rs.slice(1);if(kind==='bulk'&&i===count)rs.push(reservation('bulk'));add(head(i+2),parents,kind==='grant-change'&&i===count?'e'.repeat(64):'c'.repeat(64),rs);}
 let refs=0;const transport:typeof fetch=async(url,init)=>{assert.equal(init?.method,'GET');assert.equal(init?.body,undefined);const path=String(url).replace('https://api.github.com/repos/erman-ksv/Onay-Agents-Factory','');calls.push(path);if(path.startsWith('/git/ref/'))return Response.json({ref:'refs/heads/state/project-model-budget/'+key,object:{type:'commit',sha:kind==='drift'&&++refs===2?beforeHead:current}});const value=objects.get(path);assert.ok(value,'unexpected history endpoint');return Response.json(value);};
 return {reader:createProjectModelBudgetGitHubLineageReader({projectKey:key,token:'offline',transport}),beforeHead,afterHead,calls};
}
test('acknowledged reader accepts appended charges and keeps strict current-head reader unchanged',async()=>{
 const f=reservedFixture(),proof=await f.reader.readAcknowledgedTransition(f.beforeHead,f.afterHead);assert.equal(proof.before.data.reservations.length,1);assert.equal(proof.after.data.reservations.length,1);assert.equal(proof.current.data.reservations.length,2);assert.deepEqual(proof.current.data.reservations.slice(0,1),proof.after.data.reservations);await assert.rejects(()=>f.reader.readTransition(f.beforeHead,f.afterHead));
});
test('acknowledged reader refuses rewritten or removed charges, extra grant transitions, bulk additions and merge histories',async()=>{
 for(const kind of ['rewrite','drop','grant-change','bulk','merge']){const f=reservedFixture(kind);await assert.rejects(()=>f.reader.readAcknowledgedTransition(f.beforeHead,f.afterHead));}
});
test('acknowledged history read refuses ref races and bounds reservation suffix traversal',async()=>{
 const moving=reservedFixture('drift');await assert.rejects(()=>moving.reader.readAcknowledgedTransition(moving.beforeHead,moving.afterHead));const bound=reservedFixture('ok',9);await assert.rejects(()=>bound.reader.readAcknowledgedTransition(bound.beforeHead,bound.afterHead));assert.ok(bound.calls.length<40);
});
