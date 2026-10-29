import {createHash} from 'node:crypto';import {prepareCalculatorRoleChanges} from '../commander/calculatorTeam.js';import type {CalculatorSnapshot} from '../github/calculatorSnapshot.js';
const refuse=():never=>{throw Error('Saved proposal envelope is unverified; no code or approval is inferred.');};
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).every(k=>typeof k==='string'&&'value' in Object.getOwnPropertyDescriptor(v,k)!);
/** Known transport metadata only. A model checksum is advisory, NEVER source/permission evidence.
 * Original patch SHA and anchors still go through the unchanged strict validator. */
export function prepareChecksummedCalculatorDraft(raw:unknown,snapshot:CalculatorSnapshot){
 if(!plain(raw)||Object.keys(raw).sort().join(',')!=='changes,summary'||!Array.isArray(raw.changes)||raw.changes.length<1||raw.changes.length>3)return refuse();const claims:{path:string;claimIsSha256:boolean;matched:boolean;authoritative:false}[]=[];
 const changes=raw.changes.map(c=>{if(!plain(c))return refuse();if(c.operation!=='create'||!Object.hasOwn(c,'contentSha256'))return c;
 if(Object.keys(c).sort().join(',')!=='content,contentSha256,message,operation,path'||typeof c.content!=='string'||typeof c.path!=='string'||typeof c.contentSha256!=='string'||c.contentSha256.length>128)return refuse();
 const actual=createHash('sha256').update(c.content).digest('hex');claims.push({path:c.path,claimIsSha256:/^[a-f0-9]{64}$/.test(c.contentSha256),matched:c.contentSha256===actual,authoritative:false});return {operation:c.operation,path:c.path,content:c.content,message:c.message};});
 if(!claims.length)return refuse();const proposal=prepareCalculatorRoleChanges('frontend',{summary:raw.summary,changes},snapshot);
 return {proposal,transportMetadata:Object.freeze({modelChecksumClaims:Object.freeze(claims.map(c=>Object.freeze(c))),modelClaimsUsedAsEvidence:false,codeBytesChanged:false,independentReviewsRequired:true})};
}
