/** A write-scoped token may be needed to see GitHub ruleset bypass metadata.
 * This host probe transport still permits only bounded GETs to Factory. */
export const FACTORY_READ_ONLY_PROBE_ERROR='Native Factory probe stopped. No write, redirect, foreign repository request or retry is authorized.';
const refuse=():never=>{throw Error(FACTORY_READ_ONLY_PROBE_ERROR);};
export function createFactoryReadOnlyProbe(transport:typeof fetch=fetch){
 let stopped=false,sent=0;const started=performance.now();
 const read=(async(input:unknown,init?:RequestInit)=>{try{
  if(stopped||sent>=64||performance.now()-started>120000||typeof input!=='string'||init?.method!=='GET'||init.redirect!=='error'||init.body!==undefined&&init.body!==null)return refuse();
  const url=new URL(input);if(url.origin!=='https://api.github.com'||url.username||url.password||!url.pathname.startsWith('/repos/erman-ksv/Onay-Agents-Factory/'))return refuse();sent++;return await transport(input,init);
 }catch{stopped=true;return refuse();}}) as typeof fetch;
 return Object.freeze({fetch:read,snapshot:()=>Object.freeze({stopped,requestsSent:sent,methods:Object.freeze(sent?['GET']:[]),nativeWriteRequestsSent:0 as const})});
}
