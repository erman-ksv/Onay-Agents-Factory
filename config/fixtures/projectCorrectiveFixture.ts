/** Offline authority fixture only. No real OWNER comment is created. */
import {createHash} from 'node:crypto';
import {proposeProjectCorrectiveAuthorization,authorizeProjectCorrectiveLoopForTests,prepareProjectCorrectiveTaskPermit} from '../../orchestration/projectCorrectiveAuthorization.js';
import {projectBudgetApprovalDigest,type AuthorizedProjectBudgetController} from '../../orchestration/projectBudgetAuthorization.js';
import type {PreparedProjectPlan} from '../../orchestration/projectPlan.js';
import type {PreparedProjectCorrection} from '../../orchestration/projectModelContext.js';
export async function correctiveAuthorityForTests(plan:PreparedProjectPlan,controller:AuthorizedProjectBudgetController){
 const created=new Date().toISOString(),options={plan,controller,decision:{issueNumber:75,commentId:9001,bodySha256:''},firstExecutions:plan.tasks.map(t=>({taskId:t.id,executionId:'project-run-'+createHash('sha256').update(JSON.stringify([plan.fingerprint,t.id])).digest('hex').slice(0,32)})),model:'openai/gpt-oss-120b' as const,token:'offline-corrective-owner'},document=proposeProjectCorrectiveAuthorization(options,new Date(Date.now()+86400000).toISOString());
 options.decision.bodySha256=projectBudgetApprovalDigest(document);const state={owner:true,edited:false};
 const authorization=await authorizeProjectCorrectiveLoopForTests(options,async()=>Response.json({id:9001,user:{login:'erman-ksv',type:'User'},author_association:state.owner?'OWNER':'NONE',issue_url:'https://api.github.com/repos/erman-ksv/Onay-Agents-Factory/issues/75',html_url:'https://github.com/erman-ksv/Onay-Agents-Factory/pull/75#issuecomment-9001',created_at:created,updated_at:state.edited?new Date(Date.now()+1000).toISOString():created,body:JSON.stringify(document)}));
 return {authorization,state,document,permit:(ticket:PreparedProjectCorrection)=>prepareProjectCorrectiveTaskPermit(authorization,plan,controller,ticket,'simulated')};
}
