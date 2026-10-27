/** Fixed synthetic Git Data API for host archive tests; never a production
 * transport. Ref writes enforce creation-only/non-force single-parent CAS. */
import {createHash} from 'node:crypto';
const gitHash=(kind:string,b:Buffer)=>createHash('sha1').update(Buffer.concat([Buffer.from(kind+' '+b.length+'\0'),b])).digest('hex');
export function createProjectCheckpointArchiveFixtureForTests(projectKey:string){
 const branch='state/project-checkpoints/'+projectKey,ref='refs/heads/'+branch,blobs=new Map<string,string>(),trees=new Map<string,any>(),commits=new Map<string,any>(),requests:Array<{path:string;method:string;body?:any}>=[],state={head:undefined as string|undefined,lostAck:false,truncated:false,wrongBlob:false};let nonce=0;
 const transport=(async(input:unknown,init?:RequestInit)=>{const u=new URL(String(input));if(u.origin!=='https://api.github.com'||!u.pathname.startsWith('/repos/erman-ksv/Onay-Agents-Factory/'))throw Error('Unexpected archive fixture endpoint');const p=decodeURIComponent(u.pathname.slice('/repos/erman-ksv/Onay-Agents-Factory'.length)),method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):undefined;requests.push({path:p,method,body});let result:any,status=200;
  if(p==='/git/ref/heads/'+branch&&method==='GET'){if(!state.head)return Response.json({}, {status:404});result={ref,object:{type:'commit',sha:state.head}};}
  else if(p==='/git/blobs'&&method==='POST'){const sha=gitHash('blob',Buffer.from(body.content));blobs.set(sha,body.content);result={sha};status=201;}
  else if(p.startsWith('/git/blobs/')&&method==='GET'){const sha=p.slice(11),s=blobs.get(sha);if(s===undefined)throw Error('Missing fixture blob');result={sha,encoding:'base64',content:Buffer.from(state.wrongBlob?'corrupt':s).toString('base64')};}
  else if(p==='/git/trees'&&method==='POST'){const e=body.tree[0],sha=gitHash('tree',Buffer.concat([Buffer.from('100644 '+e.path+'\0'),Buffer.from(e.sha,'hex')]));result={sha,truncated:false,tree:body.tree};trees.set(sha,result);status=201;}
  else if(p.startsWith('/git/trees/')&&method==='GET'){result={...trees.get(p.slice(11)),truncated:state.truncated};}
  else if(p==='/git/commits'&&method==='POST'){const sha=createHash('sha1').update(JSON.stringify(body)+nonce++).digest('hex');result={sha,tree:{sha:body.tree},message:body.message,parents:body.parents.map((sha:string)=>({sha}))};commits.set(sha,result);status=201;}
  else if(p.startsWith('/git/commits/')&&method==='GET')result=commits.get(p.slice(13));
  else if(p==='/git/refs'&&method==='POST'){if(state.head||body.ref!==ref)return Response.json({}, {status:422});state.head=body.sha;result={ref,object:{type:'commit',sha:state.head}};status=201;if(state.lostAck)throw Error('Lost fixture creation acknowledgement');}
  else if(p==='/git/refs/heads/'+branch&&method==='PATCH'){if(body.force!==false||commits.get(body.sha)?.parents[0]?.sha!==state.head)return Response.json({}, {status:422});state.head=body.sha;result={ref,object:{type:'commit',sha:state.head}};if(state.lostAck)throw Error('Lost fixture append acknowledgement');}
  else throw Error('Unexpected archive fixture operation');return Response.json(result,{status});}) as typeof fetch;
 return{transport,requests,state,commits};
}
