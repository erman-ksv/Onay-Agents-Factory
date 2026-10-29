// Host-only exact GitHub artifacts. No provider calls or writes to repositories.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync,readFileSync,lstatSync,readdirSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const pins=[
 {folder:'historical',id:12431481505,run:39790544926,event:'08aa2ecc163d7db5cf4c816b03e35c7b6a09156b',workflow:'.github/workflows/calculator-clear-zero-qualification.yml',name:'calculator-clear-zero-qualification-evidence-39790544926',size:330101,digest:'6c62eb1a42182975101d5de306cf716249887f98fb117f7bb477ef69810abbb6'},
 {folder:'audit',id:12437994649,run:39808880793,event:'7dd8648e10451b420b1b0a65bbfbb2341c93cf50',workflow:'.github/workflows/calculator-publication-reconcile-v3-audit.yml',name:'calculator-publication-reconcile-audit-result',size:1804,digest:'8622ac2b30d98572446450f6bd27f4cd2d9d1a03854f411bb5876759e33cb2ad'},
];
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function loadHistoricalArchives(destination,token){
 assert.ok(token);const api='https://api.github.com/repos/erman-ksv/Onay-Agents-Factory';
 const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json'};
 async function get(path){const r=await fetch(api+path,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);const b=await r.text();assert.ok(Buffer.byteLength(b)<1048576);return JSON.parse(b);}
 mkdirSync(destination,{mode:0o700});
 for(const pin of pins){
  const run=await get('/actions/runs/'+pin.run);assert.equal(run.head_sha,pin.event);assert.equal(run.path,pin.workflow);assert.equal(run.run_attempt,1);assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');assert.equal(run.repository.full_name,'erman-ksv/Onay-Agents-Factory');
  const artifact=await get('/actions/artifacts/'+pin.id);assert.equal(artifact.workflow_run.id,pin.run);assert.equal(artifact.workflow_run.head_sha,pin.event);assert.equal(artifact.name,pin.name);assert.equal(artifact.expired,false);assert.equal(artifact.size_in_bytes,pin.size);assert.equal(artifact.digest,'sha256:'+pin.digest);
  let response=await fetch(api+'/actions/artifacts/'+pin.id+'/zip',{headers,redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(response.status===302){const url=new URL(response.headers.get('location'));assert.equal(url.protocol,'https:');assert.ok(url.hostname.endsWith('.blob.core.windows.net')||url.hostname.endsWith('.actions.githubusercontent.com'));response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});}
  assert.equal(response.status,200);let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;assert.ok(size<=1048576);chunks.push(chunk);}const bytes=Buffer.concat(chunks);assert.equal(bytes.length,pin.size);assert.equal(sha(bytes),pin.digest);
  const zip=join(destination,pin.folder+'.zip'),root=join(destination,pin.folder);writeFileSync(zip,bytes,{mode:0o600,flag:'wx'});
  const result=spawnSync('python3',['-c',String.raw`
import sys,pathlib,zipfile,re,stat
root=pathlib.Path(sys.argv[2]);root.mkdir(mode=0o700);total=0;names=set()
with zipfile.ZipFile(sys.argv[1]) as archive:
 assert len(archive.infolist())<=1024
 for info in archive.infolist():
  parts=info.filename.rstrip('/').split('/');assert len(parts)<=24 and all(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,199}',p) and '..' not in p for p in parts)
  assert info.filename not in names;names.add(info.filename)
  assert ((info.external_attr>>16)&0o170000) in (0,stat.S_IFREG,stat.S_IFDIR)
  p=root.joinpath(*parts)
  if info.is_dir():p.mkdir(parents=True,exist_ok=True,mode=0o700);continue
  assert not info.flag_bits&1 and info.file_size<=524288;total+=info.file_size;assert total<4*1024*1024
  p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with p.open('xb') as out:out.write(archive.read(info))
  p.chmod(0o600)
`,zip,root],{timeout:15000,maxBuffer:1000,env:{PATH:process.env.PATH}});assert.equal(result.status,0);
 }
 const root=join(destination,'historical'),b=readFileSync(join(root,'qualified-manifest.json'));
 assert.equal(sha(b),'68f3854c9df47e48219e206df977dc0f68d2cfe4cdcfeaaa0b5380fc013ce71c');
 const manifest=JSON.parse(b);assert.equal(manifest.fileCount,255);assert.equal(manifest.totalBytes,1413026);assert.equal(manifest.files.length,255);assert.equal(sha(JSON.stringify(manifest.files)),manifest.treeSha256);
 const files=new Map();let total=0;
 for(const f of manifest.files){assert.ok(f.path.split('/').every(n=>/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(n)&&!n.includes('..')));assert.ok(!files.has(f.path));const p=join(root,f.path),s=lstatSync(p);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.size<524288);const b=readFileSync(p);assert.equal(b.length,f.bytes);assert.equal(sha(b),f.sha256);files.set(f.path,b);total+=b.length;}
 let seen=0;function walk(dir,prefix=''){for(const name of readdirSync(dir)){const p=join(dir,name),path=prefix?prefix+'/'+name:name,s=lstatSync(p);assert.ok(!s.isSymbolicLink());if(s.isDirectory())walk(p,path);else{assert.ok(path==='qualified-manifest.json'||files.has(path));seen++;}}}walk(root);assert.equal(seen,256);assert.equal(total,1413026);
 const audit=JSON.parse(readFileSync(join(destination,'audit/publication-reconcile-report.json'),'utf8'));
 audit.auditRunId=39808880793;audit.auditEventSha='7dd8648e10451b420b1b0a65bbfbb2341c93cf50';
 return {root,files,audit};
}
