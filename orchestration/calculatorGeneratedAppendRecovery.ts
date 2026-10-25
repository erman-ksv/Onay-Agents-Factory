/** Recover only an explicit generated append, never apply an invalid anchor.
 * Existing file bytes and generated suffix bytes remain separately immutable. */
import {createHash} from 'node:crypto';
import {calculatorSources,type CalculatorSnapshot} from '../github/calculatorSnapshot.js';
import {calculatorProposalDiagnostics} from './calculatorProposalDiagnostics.js';
import {prepareCalculatorRoleChanges} from '../commander/calculatorTeam.js';
import {assertCalculatorExecutableTestChange} from './calculatorSavedPatchMetadata.js';
import {isCalculatorIntegrationTask} from './calculatorAssessmentEvidence.js';
import type {CalculatorPlanTask} from './calculatorPlan.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function recoverCalculatorGeneratedAppend(task:CalculatorPlanTask,raw:unknown,snapshot:CalculatorSnapshot,expectedRawSha256:string){
 const refuse=():never=>{throw Error('Generated append refused; preserve rejected source and do not guess anchors');};
 const r=raw as any;if(!isCalculatorIntegrationTask(task)||!/^[a-f0-9]{64}$/.test(expectedRawSha256)||hash(JSON.stringify(raw))!==expectedRawSha256||!r||Object.keys(r).sort().join(',')!=='changes,summary'||!Array.isArray(r.changes)||r.changes.length!==1)return refuse();
 const c=r.changes[0],diagnostics=calculatorProposalDiagnostics(raw,snapshot);
 if(!c||Object.keys(c).sort().join(',')!=='edits,message,operation,path,sourceSha256'||c.operation!=='patch'||c.path!=='test/ui.test.mjs'||!Array.isArray(c.edits)||c.edits.length!==1||diagnostics.length!==1||diagnostics[0]?.code!=='missing_anchor'||diagnostics[0].editIndex!==0)return refuse();
 const edit=c.edits[0];if(!edit||Object.keys(edit).sort().join(',')!=='after,before'||typeof edit.before!=='string'||!edit.before||typeof edit.after!=='string'||!edit.after.startsWith(edit.before))return refuse();
 const suffix=edit.after.slice(edit.before.length),source=calculatorSources(snapshot).get(c.path);if(!suffix||source===undefined||suffix.includes(source)||suffix.includes(JSON.stringify(source).slice(1,-1)))return refuse();
 let anchor:string|undefined;for(const n of [64,96,128,192,256]){if(n>=source.length)break;const candidate=source.slice(-n);if(source.indexOf(candidate)===source.length-n){anchor=candidate;break;}}
 if(!anchor)return refuse();
 const changes=prepareCalculatorRoleChanges('frontend',{summary:r.summary,changes:[{operation:'patch',path:c.path,sourceSha256:c.sourceSha256,edits:[{before:anchor,after:anchor+suffix}],message:c.message}]},snapshot);
 if(changes.files.length!==1||changes.files[0]?.content!==source+suffix)return refuse();
 assertCalculatorExecutableTestChange(task,snapshot,changes);
 return Object.freeze({changes,sourceRawSha256:expectedRawSha256,generatedSuffixSha256:hash(suffix),generatedSuffixBytes:Buffer.byteLength(suffix),originalSourceSha256:hash(source),originalFilePreserved:true as const,generatedSuffixPreserved:true as const,sourceProposalStillRejected:true as const,sourceDiagnostics:diagnostics,authorCalls:0 as const});
}
