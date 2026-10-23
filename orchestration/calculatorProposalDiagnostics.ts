import {createHash} from 'node:crypto';import {calculatorSources,type CalculatorSnapshot} from '../github/calculatorSnapshot.js';
export type CalculatorProposalDiagnostic=Readonly<{code:string;path?:string;editIndex?:number;occurrences?:number;expectedSourceSha256?:string}>;
/** Source-free failure hints only. The original validators remain authoritative. */
export function calculatorProposalDiagnostics(raw:unknown,snapshot:CalculatorSnapshot):readonly CalculatorProposalDiagnostic[]{
 const result:CalculatorProposalDiagnostic[]=[],sources=calculatorSources(snapshot);
 const add=(v:CalculatorProposalDiagnostic)=>{if(result.length<6)result.push(Object.freeze(v));};
 if(!raw||typeof raw!=='object'||!Array.isArray((raw as {changes?:unknown}).changes))return [{code:'invalid_proposal_schema'}];
 const changes=(raw as {changes:unknown[]}).changes;if(!changes.length||changes.length>3)return [{code:'invalid_change_count'}];
 for(const item of changes){
  if(!item||typeof item!=='object'){add({code:'invalid_change_schema'});continue;}const c=item as Record<string,unknown>;
  if(typeof c.path!=='string'||!snapshot.changePaths.includes(c.path)){add({code:'path_not_allowed',path:'unapproved'});continue;}const path=c.path,source=sources.get(path);
  if(c.operation==='create'){if(source!==undefined)add({code:'create_target_exists',path});continue;}
  if(c.operation!=='patch'){add({code:'invalid_operation',path});continue;}
  if(source===undefined){add({code:'patch_target_absent',path});continue;}
  const expectedSourceSha256=createHash('sha256').update(source).digest('hex');if(c.sourceSha256!==expectedSourceSha256)add({code:'stale_source_sha256',path,expectedSourceSha256});
  if(!Array.isArray(c.edits)||!c.edits.length||c.edits.length>8){add({code:'invalid_edit_count',path});continue;}
  for(let editIndex=0;editIndex<c.edits.length;editIndex++){
   const e=c.edits[editIndex];if(!e||typeof e!=='object'||typeof e.before!=='string'||!e.before||typeof e.after!=='string'){add({code:'invalid_edit',path,editIndex});continue;}
   if(e.before.length+e.after.length>12000){add({code:'edit_budget_exceeded',path,editIndex});continue;}
   if(e.before===e.after)add({code:'unchanged_edit',path,editIndex});
   let occurrences=0,start=0;for(;;){const next=source.indexOf(e.before,start);if(next<0)break;occurrences++;start=next+1;}
   if(occurrences!==1)add({code:occurrences?'ambiguous_anchor':'missing_anchor',path,editIndex,occurrences});
  }
 }
 return Object.freeze(result);
}
