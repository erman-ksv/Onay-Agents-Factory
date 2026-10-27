import {projectSnapshotSources,type ProjectSourceSnapshot} from '../github/projectSourceSnapshot.js';
import {assertProjectChangesSnapshot,projectChangesFiles,type PreparedProjectChanges} from '../commander/projectChanges.js';
export type ProjectContextSelection=Readonly<{path:string;version:'base'|'proposed';start:number;end:number}>|Readonly<{path:string;version:'proposed';changedWindow:number}>;
const refuse=():never=>{throw Error('Host excerpt selection is unverified. No model request or wider source disclosure is authorized.');};
/** Host-only dynamic excerpt: a bounded window around the real proposed diff.
 * Uses genuine private snapshot/proposal, never caller/model source strings.
 * Existing context guards still enforce per-file byte caps and full-source ban. */
export function resolveProjectContextSelections(snapshot:ProjectSourceSnapshot,changes:PreparedProjectChanges|undefined,input:readonly ProjectContextSelection[]){
 const base=projectSnapshotSources(snapshot);if(changes)assertProjectChangesSnapshot(changes,snapshot);const proposed=new Map(changes?projectChangesFiles(changes).map(f=>[f.path,f.content] as const):[]);
 return input.map(v=>{
  if(!Object.hasOwn(v,'changedWindow'))return v as Readonly<{path:string;version:'base'|'proposed';start:number;end:number}>;
  const r=v as Readonly<{path:string;version:'proposed';changedWindow:number}>;
  if(Object.getPrototypeOf(r)!==Object.prototype||Reflect.ownKeys(r).length!==3||!['path','version','changedWindow'].every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(r,k)??{},'value'))||r.version!=='proposed'||!Number.isSafeInteger(r.changedWindow)||r.changedWindow<1||r.changedWindow>2048)return refuse();
  const source=proposed.get(r.path),before=base.get(r.path)??'';if(!changes||!source)return refuse();let prefix=0;while(prefix<before.length&&prefix<source.length&&before[prefix]===source[prefix])prefix++;
  const cap=base.has(r.path)?Math.min(r.changedWindow,2048,Math.floor(Buffer.byteLength(before)*0.6)):Math.min(r.changedWindow,2048),start=Math.max(0,prefix-Math.min(48,Math.floor(cap/4))),end=Math.min(source.length,start+cap);if(end<=start)return refuse();return Object.freeze({path:r.path,version:'proposed' as const,start,end});
 });
}
