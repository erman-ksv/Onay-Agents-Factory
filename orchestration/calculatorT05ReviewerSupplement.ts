import {createHash} from 'node:crypto';
import {buildCalculatorRoleInstructions,validateCalculatorAssessment} from '../commander/calculatorTeam.js';
import type {PreparedCalculatorChanges} from '../commander/calculatorChanges.js';
import {calculatorProposalDigest} from './calculatorExecutionEvidence.js';
import {CALCULATOR_ACCEPTANCE,type CalculatorPlanTask} from './calculatorPlan.js';
import {isCalculatorIntegrationTask} from './calculatorAssessmentEvidence.js';
import {scanForSecrets} from '../github/secretScanner.js';
const refuse=():never=>{throw Error('Frozen T05 Reviewer supplement refused. No replay or code change.');};
export const T05_REVIEW_FROZEN=Object.freeze({
 proposalDigest:'f2e8a84624d09752372ccf69ee449919dc4b60e6ff406091d092b4b9fc56706b',
 fileSha256:'5f975b7376a717fb38ad1ccf5e3a98aefc78d2325fac0c9cad3f01dd93f94930',
 baseSha:'eac625e5830612c64fb8dafbd3d239c72adbeafd',bytes:5464,
 prior:Object.freeze({attemptedRequests:10,totalRequestBytes:89244,reservedRunTokens:38023,elapsedMs:349052}),
});
/** The authenticated source capsule is checked separately by queued admission.
 * Canonicalize approvals without dropping findings, unknowns or host disclaimers. */
export function restoreT05UnchangedApproval(role:'security'|'tester',saved:unknown){
 try{
  const a=saved as Record<string,any>;
  if(!a||a.role!==role||a.ready!==true||a.testsExecuted!==false||a.publicationAuthorized!==false||a.overallTaskCompletionVerified!==false||!Array.isArray(a.findings)||!Array.isArray(a.unverifiedAreas))return refuse();
  const refs=['changes@'+T05_REVIEW_FROZEN.baseSha,'host-checks@'+T05_REVIEW_FROZEN.proposalDigest];
  const findings=a.findings.map((f:any)=>({severity:f.severity,message:f.message,evidenceRefs:f.evidenceRefs}));
  const empty={ready:a.ready,summary:a.summary,findings,unverifiedAreas:[]};
  const suffix=validateCalculatorAssessment(role,empty,refs).unverifiedAreas;
  const n=a.unverifiedAreas.length-suffix.length;
  if(n<0||suffix.some((v,i)=>a.unverifiedAreas[n+i]!==v))return refuse();
  const rebuilt=validateCalculatorAssessment(role,{...empty,unverifiedAreas:a.unverifiedAreas.slice(0,n)},refs);
  if(!rebuilt.ready||JSON.stringify(a)!==JSON.stringify(rebuilt))return refuse();
  return rebuilt;
 }catch{return refuse();}
}
export function buildT05ReviewerSupplement(model:string,task:CalculatorPlanTask,changes:PreparedCalculatorChanges,
 hostEvidence:Readonly<{evidenceId:string;proposalDigest:string;baseSha:string}>,syntax:Readonly<{sourceSha256:string;proposalDigest:string;exitCode:number;sourceBytes:number}>,previousReview:unknown){
 if(!isCalculatorIntegrationTask(task)||calculatorProposalDigest(changes)!==T05_REVIEW_FROZEN.proposalDigest||changes.baseSha!==T05_REVIEW_FROZEN.baseSha||changes.files.length!==1||changes.files[0]?.path!=='test/ui.test.mjs'||
 Buffer.byteLength(changes.files[0].content)!==T05_REVIEW_FROZEN.bytes||createHash('sha256').update(changes.files[0].content).digest('hex')!==T05_REVIEW_FROZEN.fileSha256||
 hostEvidence.proposalDigest!==T05_REVIEW_FROZEN.proposalDigest||hostEvidence.baseSha!==changes.baseSha||hostEvidence.evidenceId!=='host-checks@'+T05_REVIEW_FROZEN.proposalDigest||
 syntax.sourceSha256!==T05_REVIEW_FROZEN.fileSha256||syntax.proposalDigest!==T05_REVIEW_FROZEN.proposalDigest||syntax.exitCode!==0||syntax.sourceBytes!==T05_REVIEW_FROZEN.bytes)return refuse();
 const allowedEvidenceRefs=Object.freeze(['changes@'+changes.baseSha,hostEvidence.evidenceId,'node-check@'+syntax.sourceSha256]);
 const packet={repository:changes.repository,baseSha:changes.baseSha,proposalDigest:T05_REVIEW_FROZEN.proposalDigest,
 task:{id:task.id,role:task.role,goal:task.goal,paths:task.paths,acceptanceIds:task.acceptanceIds},
 acceptance:CALCULATOR_ACCEPTANCE.filter(a=>task.acceptanceIds.includes(a.id)),allowedEvidenceRefs,
 completeChangedText:{changes:JSON.parse(changes.reviewEvidence).changes},verifiedHostEvidence:hostEvidence,
 parserEvidence:syntax,previousReview,
 clarification:'Supplement the prior assessment on exactly the same code. The independent Node parser returned exit 0 for the full proposed test module, and actual project tests passed. Adjacent test calls separated by a semicolon do not require a newline. Reassess the previous syntax finding using this evidence. Keep an independent verdict and identify any other concrete blocker. Do not invent failures or treat approval as CI/publication authority.',
 unverifiedAreas:['Unshown unchanged source except host-verified contract and execution evidence','Physical phones, other browsers and viewport widths','Publication and exact-candidate CI have not executed']};
 const body=JSON.stringify({model,reasoning_effort:'low',response_format:{type:'json_object'},max_completion_tokens:1200,
 messages:[{role:'system',content:buildCalculatorRoleInstructions('reviewer')},{role:'user',content:JSON.stringify(packet)}]});
 if(Buffer.byteLength(body)>24000||scanForSecrets(body).length)return refuse();
 return Object.freeze({body,allowedEvidenceRefs,requestBytes:Buffer.byteLength(body)});
}
