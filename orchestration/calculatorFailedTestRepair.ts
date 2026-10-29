/** A failed real host check is repair data, never an approval or execution permit. */
import type {PreparedCalculatorChanges} from '../commander/calculatorChanges.js';
import type {CalculatorPlanTask} from './calculatorPlan.js';
import {calculatorProposalDigest,validateCalculatorProposalTests,type CalculatorProposalTests} from './calculatorExecutionEvidence.js';
export type CalculatorFailedTestEvidence=Readonly<{kind:'failed-host-calculator-tests'}>;
const evidence=new WeakMap<CalculatorFailedTestEvidence,{taskId:string;changes:PreparedCalculatorChanges;tests:CalculatorProposalTests;used:boolean}>();
const refuse=():never=>{throw Error('Failed test repair evidence refused; exact executed failure required.');};
export async function collectCalculatorFailedTestEvidence(task:CalculatorPlanTask,changes:PreparedCalculatorChanges,
 check:(input:{task:CalculatorPlanTask;changes:PreparedCalculatorChanges;proposalDigest:string})=>Promise<CalculatorProposalTests>):Promise<CalculatorFailedTestEvidence>{
 const tests=validateCalculatorProposalTests(await check({task,changes,proposalDigest:calculatorProposalDigest(changes)}),task.id,changes);
 if(tests.status!=='failed'||!tests.testsExecuted)return refuse();
 const token=Object.freeze({kind:'failed-host-calculator-tests' as const});evidence.set(token,{taskId:task.id,changes,tests,used:false});return token;
}
export function consumeCalculatorFailedTestEvidence(token:CalculatorFailedTestEvidence,taskId:string,changes:PreparedCalculatorChanges):CalculatorProposalTests{
 const saved=evidence.get(token);if(!saved||saved.used||saved.taskId!==taskId||saved.changes!==changes)return refuse();saved.used=true;return saved.tests;
}
