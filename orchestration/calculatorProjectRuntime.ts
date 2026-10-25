import {runCalculatorRuntime,CALCULATOR_RUNTIME_ERROR} from './calculatorRuntime.js';
import {prepareCalculatorProjectRuntimeHost,type CalculatorProjectRuntimeHost} from './calculatorProjectRuntimeTeam.js';
import type {CalculatorRuntimeRecoveryHost} from './calculatorRuntimeRecovery.js';
/** Required production entry. An authenticated host must explicitly migrate
 * history first; this entry never initializes storage, extends a grant or
 * restores consumed receipts. Existing after-CI and private-state gates apply. */
export async function runProjectBudgetedCalculatorRuntime(
 input:Parameters<typeof runCalculatorRuntime>[0],config:Parameters<typeof runCalculatorRuntime>[1],directory:string,
 mode:'inspect'|'preflight'|'run',env:NodeJS.ProcessEnv,host:CalculatorProjectRuntimeHost,
 limits?:Parameters<typeof runCalculatorRuntime>[5],continuation?:Parameters<typeof runCalculatorRuntime>[6],afterCi?:Parameters<typeof runCalculatorRuntime>[7],recovery?:CalculatorRuntimeRecoveryHost){
 if(!prepareCalculatorProjectRuntimeHost(host)||env.AGENT_FACTORY_PROJECT_BUDGET_MODE!==undefined&&env.AGENT_FACTORY_PROJECT_BUDGET_MODE!=='required')throw Error(CALCULATOR_RUNTIME_ERROR);
 return runCalculatorRuntime(input,config,directory,mode,{...env,AGENT_FACTORY_PROJECT_BUDGET_MODE:'required'},limits,continuation,afterCi,host,recovery);
}
