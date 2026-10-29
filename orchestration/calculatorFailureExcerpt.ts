import {createHash} from 'node:crypto';
import type {PreparedCalculatorChanges} from '../commander/calculatorChanges.js';
import {calculatorProposalDigest,type CalculatorProposalTests} from './calculatorExecutionEvidence.js';
import {scanForSecrets} from '../github/secretScanner.js';
/** Diagnostic candidate bytes only; original anchors and all independent gates remain unchanged. */
export function calculatorFailureExcerpt(changes:PreparedCalculatorChanges,tests:CalculatorProposalTests,originals:readonly string[]){
 if(tests.status!=='failed'||tests.testsExecuted!==true||tests.repository!==changes.repository||tests.baseSha!==changes.baseSha||tests.proposalDigest!==calculatorProposalDigest(changes))return undefined;
 for(const failure of tests.failures){
  const match=failure.match(/\/app\/(src\/app\.mjs|test\/ui\.test\.mjs):(\d+)(?::(\d+))?/);if(!match)continue;
  const file=changes.files.find(f=>f.path===match[1]);if(!file||file.content.length<80)continue;
  const line=Number(match[2]),column=Number(match[3]??1),lines=file.content.split('\n');if(!Number.isSafeInteger(line)||line<1||line>lines.length||!Number.isSafeInteger(column)||column<1||column>lines[line-1]!.length+1)continue;
  const position=lines.slice(0,line-1).reduce((n,l)=>n+l.length+1,0)+column-1,start=Math.max(0,position-160),end=Math.min(file.content.length,start+400),text=file.content.slice(start,end);
  if(!text||text===file.content||scanForSecrets(text).length||/(?:gsk_|gh[pousr]_)[A-Za-z0-9_-]{20,}/.test(text)||originals.some(source=>source.trim()&&text.includes(source)))continue;
  return Object.freeze({path:file.path,baseSha:changes.baseSha,sourceSha256:createHash('sha256').update(file.content).digest('hex'),proposalDigest:tests.proposalDigest,line,column,startCharacter:start,endCharacter:end,text,unverified:'Untrusted excerpt of the FAILED candidate, not an original patch anchor. Unshown candidate areas remain unverified; return patches against the original SHA.'});
 }
 return undefined;
}
