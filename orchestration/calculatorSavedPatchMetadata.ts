import {createRequire} from 'node:module';
import {calculatorSources} from '../github/calculatorSnapshot.js';
/** Host-only description repair. Patch bytes remain entirely agent-authored.
 * Original malformed data stays rejected; the ordinary validator is unchanged. */
import {createHash} from 'node:crypto';
import {prepareCalculatorRoleChanges} from '../commander/calculatorTeam.js';
import type {CalculatorSnapshot} from '../github/calculatorSnapshot.js';
import type {CalculatorPlanTask} from './calculatorPlan.js';
import {isCalculatorIntegrationTask} from './calculatorAssessmentEvidence.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).sort().join(',')===keys.sort().join(',');
export function prepareCalculatorSavedPatchMetadata(task:CalculatorPlanTask,raw:unknown,snapshot:CalculatorSnapshot,expectedRawSha256:string){
 const refuse=():never=>{throw Error('Saved patch metadata refused; no code rewrite or replay is permitted');};
 if(!isCalculatorIntegrationTask(task)||!/^[a-f0-9]{64}$/.test(expectedRawSha256)||hash(raw)!==expectedRawSha256||!plain(raw)||!exact(raw,['summary','changes'])||!Array.isArray(raw.changes)||raw.changes.length!==1)return refuse();
 const c=raw.changes[0];if(!plain(c)||!exact(c,['operation','path','sourceSha256','edits'])||c.operation!=='patch'||c.path!=='test/ui.test.mjs')return refuse();
 const patchSha256=hash(c),copy=JSON.parse(JSON.stringify(c));
 const changes=prepareCalculatorRoleChanges('frontend',{summary:raw.summary,changes:[{...copy,message:'Host description only: saved agent-authored T05 integration patch'}]},snapshot);
 const original=calculatorSources(snapshot).get('test/ui.test.mjs');
 const updated=changes.files.find(file=>file.path==='test/ui.test.mjs')?.content;
 if(original===undefined||updated===undefined)return refuse();
 const parser=createRequire(import.meta.resolve('tsx'))('esbuild');
 const executable=(source:string):string=>parser.transformSync(source,{loader:'js',target:'esnext',legalComments:'none',minifyWhitespace:true,minifySyntax:false,minifyIdentifiers:false}).code;
 if(executable(original)===executable(updated))throw Error('Saved integration patch changes comments or formatting only; no executable tests were added');
 const {message:_,...unchanged}=copy;
 if(hash(unchanged)!==patchSha256)return refuse();
 return Object.freeze({changes,sourceRawSha256:expectedRawSha256,patchSha256,messageOrigin:'host-only-description' as const,modelCodeChanged:false as const});
}
