import {createCalculatorModelTeam,CALCULATOR_MODEL_ERROR} from './calculatorModelTeam.js';
import type {AuthorizedProjectTaskScope} from './projectBudgetAuthorization.js';
/** Entry for project-controlled runs. Legacy per-task entry remains explicit;
 * this entry cannot omit the verified scope or opt out through environment. */
export function createProjectBudgetedCalculatorTeam(owner:Parameters<typeof createCalculatorModelTeam>[0],env:NodeJS.ProcessEnv,scope:AuthorizedProjectTaskScope,
 transport:typeof fetch=fetch,timing:Parameters<typeof createCalculatorModelTeam>[3]={},hooks?:Parameters<typeof createCalculatorModelTeam>[5],preset?:Parameters<typeof createCalculatorModelTeam>[6],evidence?:Parameters<typeof createCalculatorModelTeam>[7]){
 if(env.AGENT_FACTORY_PROJECT_BUDGET_MODE!==undefined&&env.AGENT_FACTORY_PROJECT_BUDGET_MODE!=='required')throw Error(CALCULATOR_MODEL_ERROR);
 return createCalculatorModelTeam(owner,{...env,AGENT_FACTORY_PROJECT_BUDGET_MODE:'required'},transport,timing,undefined,hooks,preset,evidence,scope);
}
