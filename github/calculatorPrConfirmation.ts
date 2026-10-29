import {CALCULATOR_PROFILE} from '../config/calculatorProfile.js';
import type {TeamTaskPublication} from '../orchestration/teamTaskStore.js';
export const CALCULATOR_PR_CONFIRMATION_ERROR='Calculator Draft PR confirmation is unverified; preserve the acknowledged publication and do not republish.';
const refuse=():never=>{throw Error(CALCULATOR_PR_CONFIRMATION_ERROR);};
const SHA=/^[a-f0-9]{40}$/;
export type CalculatorPrScope=Readonly<{repository:string;branch:string;baseRef:string;baseSha:string}>;
function scopeValid(s:CalculatorPrScope){
 return s?.repository===CALCULATOR_PROFILE.repository&&SHA.test(s.baseSha)&&[s.branch,s.baseRef].every(ref=>typeof ref==='string'&&ref.startsWith('feat/')&&!/[\u0000-\u0020\u007f\\?#&]/.test(ref))&&s.branch!==s.baseRef;
}
/** Normalized metadata only, never publication authority or proof of CI. */
export function calculatorDraftPublication(scope:CalculatorPrScope,value:unknown,headSha:string,number?:number):TeamTaskPublication{
 const pr=value as {number:number;html_url:string;state:string;draft:boolean;merged?:boolean;
  head?:{ref:string;sha:string;repo?:{full_name:string}};base?:{ref:string;sha:string;repo?:{full_name:string}}};
 if(!scopeValid(scope)||!SHA.test(headSha)||!pr||!Number.isSafeInteger(pr.number)||pr.number<1||(number!==undefined&&pr.number!==number)||
 pr.html_url!=='https://github.com/'+scope.repository+'/pull/'+pr.number||pr.state!=='open'||pr.draft!==true||pr.merged===true||
 pr.head?.repo?.full_name!==scope.repository||pr.base?.repo?.full_name!==scope.repository||pr.head?.ref!==scope.branch||pr.head?.sha!==headSha||pr.base?.ref!==scope.baseRef||pr.base?.sha!==scope.baseSha)return refuse();
 return Object.freeze({branch:scope.branch,headSha,number:pr.number,url:pr.html_url});
}
/** Only an explicitly recognized old head may receive another GET. The same
 * already-pushed candidate must remain authoritative throughout. No writes,
 * model calls, retry of failed HTTP, new candidate or replacement PR. */
export async function confirmCalculatorDraftPublication(scope:CalculatorPrScope,candidate:string,previous:string,number:number,host:Readonly<{
 readDetail:()=>Promise<unknown>;assertCurrent:()=>Promise<void>;wait?:(ms:number)=>Promise<void>;
}>):Promise<TeamTaskPublication>{
 if(!scopeValid(scope)||!SHA.test(candidate)||!SHA.test(previous)||candidate===previous||!Number.isSafeInteger(number)||number<1)return refuse();
 const delays=[250,750,1500] as const;
 for(let attempt=0;attempt<4;attempt++){
  await host.assertCurrent();const value=await host.readDetail();await host.assertCurrent();
  const observed=(value as {head?:{sha?:unknown}})?.head?.sha;
  if(observed===candidate)return calculatorDraftPublication(scope,value,candidate,number);
  // Validate every other field BEFORE waiting. Unknown/foreign SHA and unsafe
  // metadata fail immediately; an HTTP or parsing failure propagates unchanged.
  if(observed!==previous)return refuse();calculatorDraftPublication(scope,value,previous,number);
  if(attempt===3)return refuse();
  await (host.wait??(ms=>new Promise<void>(resolve=>setTimeout(resolve,ms))))(delays[attempt]!);
 }
 return refuse();
}
