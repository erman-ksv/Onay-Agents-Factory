import type {createCalculatorModelTeam} from './calculatorModelTeam.js';
import {createHash} from 'node:crypto';
import {createCalculatorPlan,type CalculatorPlan} from './calculatorPlan.js';
import {isAuthorizedProjectBudgetController,consumeAuthorizedProjectTaskScope,type AuthorizedProjectBudgetController} from './projectBudgetAuthorization.js';
import {createCalculatorProjectRuntimeTeam} from './calculatorProjectRuntimeTeam.js';
import {collectCalculatorAssessmentEvidence,isCalculatorIntegrationTask} from './calculatorAssessmentEvidence.js';
import {calculatorProposalDigest} from './calculatorExecutionEvidence.js';
import type {CalculatorSnapshot} from '../github/calculatorSnapshot.js';
import type {PreparedCalculatorChanges} from '../commander/calculatorChanges.js';
export const CALCULATOR_PUBLISHED_PROJECT_REVIEW_ERROR='Published candidate project review stopped. Preserve ledger and checkpoints; no replay, generation, publication or allowance initialization.';
const refuse=():never=>{throw Error(CALCULATOR_PUBLISHED_PROJECT_REVIEW_ERROR);};
const reviewFailures=new WeakMap<Error,Readonly<{stage:string;roles:readonly Readonly<{role:string;ready:boolean}>[];runtime:ReturnType<Awaited<ReturnType<typeof createCalculatorProjectRuntimeTeam>>['diagnostic']>|null}>>();
export function publishedProjectReviewDiagnostic(error:unknown){return error instanceof Error?reviewFailures.get(error):undefined;}
type Team=Awaited<ReturnType<typeof createCalculatorProjectRuntimeTeam>>;
type Assessment=Awaited<ReturnType<Team['assess']>>;
export type PublishedReviewCheckpoint=Readonly<{stage:string;status:'running'|'passed'|'blocked';httpInFlight:boolean;modelState:ReturnType<Team['checkpointCharge']>;assessments:readonly Assessment[]}>;
type Options=Readonly<{plan:CalculatorPlan;taskId:string;candidateSha:string;original:CalculatorSnapshot;dependencies:CalculatorSnapshot;changes:PreparedCalculatorChanges;
 controller:AuthorizedProjectBudgetController;env:NodeJS.ProcessEnv;assertPublished:()=>Promise<void>;
 runners:Parameters<typeof collectCalculatorAssessmentEvidence>[3];checkpoint:(event:PublishedReviewCheckpoint)=>void|Promise<void>;
 transport?:typeof fetch;timing?:Parameters<typeof createCalculatorModelTeam>[3]}>;
/** Fixed three-review READ-ONLY phase. Authority comes from the native owner
 * controller, real host evidence and the required shared router, never receipts
 * or environment JSON. No initializer, publisher, generator or repair is called. */
export async function runPublishedCalculatorProjectReview(options:Options){
 let team:Team|undefined,stage='admission';const assessments:Assessment[]=[];
 try{
  if(!isAuthorizedProjectBudgetController(options.controller)||typeof options.assertPublished!=='function'||typeof options.checkpoint!=='function'||typeof options.runners?.checkProposal!=='function'||typeof options.runners?.checkBrowser!=='function'||!/^[a-f0-9]{40}$/.test(options.candidateSha))return refuse();
  const {controller,original,dependencies,assertPublished,checkpoint,runners,candidateSha}=options,env={...options.env},plan=createCalculatorPlan(options.plan.request,options.plan.proposal),task=plan.tasks.find(t=>t.id===options.taskId);
  if(!task||!isCalculatorIntegrationTask(task)||plan.fingerprint!==options.plan.fingerprint||controller.identity.planFingerprint!==plan.fingerprint||controller.identity.ownerFingerprint!==plan.owner.ownerFingerprint)return refuse();
  const executionId='published-review-'+createHash('sha256').update(JSON.stringify([plan.fingerprint,task.id,candidateSha,controller.grantSha256])).digest('hex').slice(0,24);
  const scope=consumeAuthorizedProjectTaskScope(await controller.taskScope(task.id,'probe-'+executionId),{projectId:plan.owner.id,repository:plan.owner.repository,ownerFingerprint:plan.owner.ownerFingerprint});
  if(scope.operationMode!=='read-only-review')return refuse();
  const before=await controller.inspect(),h=controller.historicalCharge;
  if(before.used.requests<h.requests||before.used.requestBytes<h.requestBytes||before.used.reservedTokens<h.reservedTokens||before.remaining.requests!==3||before.remaining.requestBytes>72000||before.remaining.reservedTokens>18000)return refuse();
  await assertPublished();let evidence:Awaited<ReturnType<typeof collectCalculatorAssessmentEvidence>>|undefined,restored:PreparedCalculatorChanges|undefined;
  const save=async(status:PublishedReviewCheckpoint['status'],httpInFlight=false)=>checkpoint(Object.freeze({stage,status,httpInFlight,modelState:team!.checkpointCharge(),assessments:Object.freeze([...assessments])}));
  team=await createCalculatorProjectRuntimeTeam(plan.request,plan,env,{controller,executionId},{preset:'calculator-published-three-reviews',...(options.timing?{timing:options.timing}:{}),transport:options.transport,
   checkpoints:{beforeRequest:async()=>{await assertPublished();await controller.assertAuthorized();await save('running',true);}},
   evidence:async(t,c)=>{if(!evidence||t.id!==task.id||c!==restored)return refuse();return evidence;}});
  stage='restore_published_proposal';restored=team.restoreProposal(plan,task.id,original,options.changes,calculatorProposalDigest(options.changes),[]);
  stage='real_host_checks';evidence=await collectCalculatorAssessmentEvidence(task,restored,dependencies,runners);await assertPublished();await save('passed');
  for(const role of ['security','reviewer','tester'] as const){stage=role+'_1';await controller.assertAuthorized();await assertPublished();await save('running');
   const assessment=await team.assess(role,plan,task.id,restored);assessments.push(assessment);await save(assessment.ready?'passed':'blocked');if(!assessment.ready)return refuse();
  }
  await assertPublished();await controller.assertAuthorized();const after=await controller.inspect();
  if(after.used.requests-before.used.requests!==3||team.checkpointCharge().attemptedRequests!==3)return refuse();stage='read_only_review_complete';await save('passed');
  return Object.freeze({status:'published-candidate-project-reviews-passed' as const,candidateSha,taskId:task.id,executionId,modelCalls:3,projectBudgetRequired:true as const,
   newReservations:after.used.requests-before.used.requests,used:after.used,remaining:after.remaining,roles:Object.freeze(assessments.map(a=>Object.freeze({role:a.role,ready:a.ready}))),publicationAuthorized:false as const,applicationChanged:false as const,wholeAppCompleted:false as const});
 }catch{if(team)try{await options.checkpoint({stage,status:'blocked',httpInFlight:true,modelState:team.checkpointCharge(),assessments:Object.freeze([...assessments])});}catch{/* Preserve existing state; no retry. */}const error=new Error(CALCULATOR_PUBLISHED_PROJECT_REVIEW_ERROR);reviewFailures.set(error,Object.freeze({stage,roles:Object.freeze(assessments.map(a=>Object.freeze({role:a.role,ready:a.ready}))),runtime:team?.diagnostic()??null}));throw error;}
}

export function preparePublishedProjectReviewRequest(value:unknown){
 const bad=()=>{throw Error(CALCULATOR_PUBLISHED_PROJECT_REVIEW_ERROR);};
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)return bad();const d=Object.getOwnPropertyDescriptors(value),keys=['version','operation','candidateSha','ownerDecision'];
 if(Reflect.ownKeys(value).length!==keys.length||keys.some(k=>!d[k]||!Object.hasOwn(d[k],'value')))return bad();const r=value as Record<string,unknown>;
 if(r.version!==1||typeof r.operation!=='string'||!['inspect','review'].includes(r.operation)||r.candidateSha!=='558993981c9bbb7c6100c8335860ac5668768314')return bad();
 if(r.operation==='inspect'){if(r.ownerDecision!==null)return bad();return Object.freeze({version:1 as const,operation:'inspect' as const,candidateSha:r.candidateSha as string,ownerDecision:null});}
 const v=r.ownerDecision;if(!v||typeof v!=='object'||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==3)return bad();const p=Object.getOwnPropertyDescriptors(v);if(['issueNumber','commentId','bodySha256'].some(k=>!p[k]||!Object.hasOwn(p[k],'value')))return bad();
 if(p.issueNumber!.value!==75||!Number.isSafeInteger(p.commentId!.value)||p.commentId!.value<1||typeof p.bodySha256!.value!=='string'||!/^[a-f0-9]{64}$/.test(p.bodySha256!.value))return bad();
 return Object.freeze({version:1 as const,operation:'review' as const,candidateSha:r.candidateSha as string,ownerDecision:Object.freeze({issueNumber:75,commentId:p.commentId!.value as number,bodySha256:p.bodySha256!.value as string})});
}
