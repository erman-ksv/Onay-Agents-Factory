/** Interpret a complete replacement of an unpublished agent-created file.
 * Existing repository-file anchors never receive any decoding or fallback. */
import {createHash} from 'node:crypto';
import {calculatorSources,type CalculatorSnapshot} from '../github/calculatorSnapshot.js';
import {prepareCalculatorRoleChanges} from '../commander/calculatorTeam.js';
import type {PreparedCalculatorChanges} from '../commander/calculatorChanges.js';
import {calculatorProposalDigest} from './calculatorExecutionEvidence.js';
const refuse=():never=>{throw Error('Unpublished correction refused; exact origin, whole-file anchor and original absence are required.');};
function plain(v:unknown):v is Record<string,any>{return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;}
function keys(v:Record<string,any>,names:string[]){return Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));}
function previousInput(p:PreparedCalculatorChanges){
 const evidence=JSON.parse(p.reviewEvidence);
 return {summary:p.summary,changes:evidence.changes.map((c:any)=>c.operation==='create'?{operation:'create',path:c.path,content:c.content,message:p.files.find(f=>f.path===c.path)?.message}:{operation:c.operation,path:c.path,sourceSha256:c.sourceSha256,edits:c.edits,message:p.files.find(f=>f.path===c.path)?.message})};
}
export function prepareUnpublishedCalculatorCorrection(raw:unknown,previous:PreparedCalculatorChanges,snapshot:CalculatorSnapshot):PreparedCalculatorChanges {
 const originals=calculatorSources(snapshot);
 if(previous.repository!==snapshot.repository||previous.baseRef!==snapshot.baseRef||previous.baseSha!==snapshot.baseSha||!plain(raw)||!keys(raw,['summary','changes'])||!Array.isArray(raw.changes)||!raw.changes.length||raw.changes.length>3)return refuse();
 const priorInput=previousInput(previous),verified=prepareCalculatorRoleChanges('frontend',priorInput,snapshot);
 if(calculatorProposalDigest(verified)!==calculatorProposalDigest(previous)||verified.reviewEvidence!==previous.reviewEvidence)return refuse();
 const replacements=new Map<string,any>();
 for(const c of raw.changes){
  if(!plain(c)||!keys(c,['operation','path','sourceSha256','edits','message'])||c.operation!=='patch'||typeof c.path!=='string'||replacements.has(c.path)||originals.has(c.path)||!snapshot.files.some(f=>f.path===c.path&&f.exists===false))return refuse();
  const created=priorInput.changes.find((v:any)=>v.path===c.path&&v.operation==='create'),file=previous.files.find(f=>f.path===c.path);
  if(!created||!file||created.content!==file.content||c.sourceSha256!==createHash('sha256').update(file.content).digest('hex')||!Array.isArray(c.edits)||c.edits.length!==1)return refuse();
  const e=c.edits[0];
  if(!plain(e)||!keys(e,['before','after'])||typeof e.before!=='string'||typeof e.after!=='string'||!e.after.trim()||e.after===file.content)return refuse();
  // Explicit quote/backslash representations only. Never fuzzy/trim/substring match.
  // The exact full-file source SHA remains mandatory; replacement bytes are untouched.
  if(e.before!==file.content&&e.before!==file.content.replace(/\\/g,'\\\\')&&e.before.replace(/\\(["'])/g,'$1')!==file.content)return refuse();
  replacements.set(c.path,{operation:'create',path:c.path,content:e.after,message:c.message});
 }
 const changes=priorInput.changes.map((c:any)=>replacements.get(c.path)??c);
 return prepareCalculatorRoleChanges('frontend',{summary:raw.summary,changes},snapshot);
}
