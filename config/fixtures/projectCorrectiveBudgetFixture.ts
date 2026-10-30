/** Offline OWNER and ledger fixture. No network or production state is used. */
import {readFileSync} from 'node:fs';
import {authorizeProjectBudget,reconcileProjectBudgetHistory,projectBudgetApprovalDigest,type ProjectBudgetIdentity} from '../../orchestration/projectBudgetAuthorization.js';
import {createProjectTargetRegistry,registeredProjectTargetProfile} from '../../orchestration/projectTargetRegistry.js';
import {projectBudgetStateDigest} from '../../orchestration/projectBudgetExtensionAuthorization.js';
import {prepareProjectStateProtectionForTests} from '../../github/projectStateProtection.js';
import type {ProjectModelBudgetState,ProjectModelGrant} from '../../orchestration/projectModelBudget.js';
export async function projectCorrectiveBudgetFixture(options:{projectId?:string;taskIds?:string[];changedProfile?:boolean}={}){
 const runtime=JSON.parse(readFileSync(new URL('../../.factory/runtime-project-manifest.json',import.meta.url),'utf8'));
 const profile={...runtime.profile,...(options.changedProfile?{maxReviewBytes:11999}:{})},target=createProjectTargetRegistry([profile]).select(profile.id);
 const identity:ProjectBudgetIdentity={projectId:options.projectId??runtime.goal.id,repository:runtime.profile.repository,planFingerprint:'02b1e1662ef8ef4d7483db9e9ea65bed67e73cce15fcab1db42b284f1f2b6110',ownerFingerprint:'b'.repeat(64),taskIds:options.taskIds??runtime.proposal.tasks.map((t:{id:string})=>t.id)};
 const history={version:1 as const,projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,observations:['planning',...identity.taskIds].map(scopeId=>({scopeId,kind:'cumulative-scope-total' as const,charge:{requests:0,requestBytes:0,reservedTokens:0},evidenceSha256:'c'.repeat(64)}))};
 const h=reconcileProjectBudgetHistory(history,identity),grant:ProjectModelGrant={version:1,projectId:identity.projectId,repository:identity.repository,planFingerprint:identity.planFingerprint,grantId:'offline-before-corrective',maxRequests:8,maxRequestBytes:12000,maxTotalRequestBytes:96000,maxReservedTokens:48000,historical:h.charge,historicalEvidenceSha256:h.digest,provider:'groq',freeTierConfirmed:true,legalEnabled:false};
 let saved:{revision:string;data:ProjectModelBudgetState}|undefined,writes=0,revoked=false;
 async function controller(g:ProjectModelGrant,id:number){const document={version:1,kind:'authorize-project-model-budget',mode:'development',grant:g,expiresAt:'2026-10-31T12:00:00Z',targetProfileSha256:registeredProjectTargetProfile(target).sha256};
  return authorizeProjectBudget({identity,history,targetProfile:target,decision:{issueNumber:75,commentId:id,bodySha256:projectBudgetApprovalDigest(document)},token:'offline-only',now:()=>Date.parse('2026-10-30T12:00:00Z'),store:{read:async()=>saved,compareAndSwap:async()=>{writes++;throw Error('No direct write allowed');}},transport:async()=>Response.json({id,user:{login:revoked?'revoked':'erman-ksv',type:'User'},author_association:'OWNER',issue_url:'https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/75',html_url:'https://github.com/erman-ksv/Onay-Agents-Factory/pull/75#issuecomment-'+id,created_at:'2026-10-30T11:00:00Z',updated_at:'2026-10-30T11:00:00Z',body:JSON.stringify(document)})});
 }
 const previous=await controller(grant,101),state:ProjectModelBudgetState={version:1,grantSha256:previous.grantSha256,reservations:[{reservationId:'before:r1',taskId:identity.taskIds[0]!,requestSha256:'d'.repeat(64),requestBytes:4668,reservedTokens:3012}]};
 saved={revision:'e'.repeat(64),data:state};
 const proposed:ProjectModelGrant={...grant,grantId:'development-corrective-'+projectBudgetStateDigest(state),maxRequests:17,maxTotalRequestBytes:196668,maxReservedTokens:99012};
 const next=await controller(proposed,102);
 async function protection(){const source='erman-ksv/Onay-Agents-Factory',rules=[{type:'deletion'},{type:'non_fast_forward'}];return prepareProjectStateProtectionForTests({controller:next,token:'offline'},async url=>Response.json(String(url).includes('/rulesets/')?{id:1,source_type:'Repository',source,target:'branch',enforcement:'active',bypass_actors:[],rules}:rules.map(r=>({...r,ruleset_id:1,ruleset_source_type:'Repository',ruleset_source:source}))));}
 return {identity,previous,next,state,proposed,controller,protection,read:async()=>saved,save:(data:ProjectModelBudgetState,revision:string)=>{saved={data,revision};},writes:()=>writes,revoke:()=>{revoked=true;}};
}
