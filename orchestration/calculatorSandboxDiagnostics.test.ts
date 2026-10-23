import test from 'node:test';import assert from 'node:assert/strict';
import {createCalculatorSandbox,type CalculatorSandboxProcess} from './calculatorSandbox.js';import {calculatorProposalDigest} from './calculatorExecutionEvidence.js';import type {PreparedCalculatorChanges} from '../commander/calculatorChanges.js';
import type {CalculatorPlanTask} from './calculatorPlan.js';
const image='node@sha256:'+'a'.repeat(64),baseSha='b'.repeat(40),path='test/calculator.test.mjs';
const task={id:'fixture-task',role:'coder',paths:['src/calculator.mjs',path]} as CalculatorPlanTask;
const changes:PreparedCalculatorChanges={repository:'erman-ksv/Onay-Factory-Calculator',baseRef:'feat/calculator-agent/fixture',baseSha,summary:'Fixture',reviewEvidence:'{}',gates:{secretScan:'passed',policyReview:'passed',independentReview:'required',tests:'required',publicationAuthorized:false},files:[{path:'src/calculator.mjs',content:'export const calculate = () => 1;',message:'Core'},{path,content:'import "./missing.mjs";',message:'Tests'}]};
test('opt-in isolated diagnostics retain failed verdict and container restrictions; unavailable diagnostics cannot authorize success',async()=>{
 for(const mode of ['off','details','unavailable']){
 let diagnostics=0;
 const runner:CalculatorSandboxProcess=async(args)=>{
  const answer=(code:number,stdout:string)=>({code,stdout,stderr:''});
  if(args.includes('info'))return answer(0,'28.0.0');if(args.includes('inspect'))return answer(0,JSON.stringify([image]));if(args.includes('--version'))return answer(0,'v24.0.0');if(args.includes('rm'))return answer(0,'');
  for(const flag of ['--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges'])assert.ok(args.includes(flag));
  if(args.includes('/diagnose.mjs')){diagnostics++;if(mode==='unavailable')return answer(1,'');return answer(0,JSON.stringify({version:1,tests:[{path,exitCode:1,timedOut:false,codes:['ERR_MODULE_NOT_FOUND'],missingModules:['/app/test/missing.mjs'],operators:[],locations:[]}]}));}
  assert.ok(args.includes('/harness.mjs'));return answer(1,JSON.stringify({version:1,status:'failed',checks:['syntax','fixed-arithmetic','project-tests'],failures:['project-tests']}));
 };
 const sandbox=createCalculatorSandbox({image,baseSha,baseSources:new Map(),includeFailureDetails:mode!=='off'},process.env,runner);
 const result=await sandbox.checkProposal({task,changes,proposalDigest:calculatorProposalDigest(changes)});
 assert.equal(result.status,'failed');assert.equal(result.testsExecuted,true);assert.equal(result.failures[0],'Trusted isolated task check failed: project-tests.');assert.equal(diagnostics,mode==='off'?0:1);assert.equal(result.failures.length,mode==='details'?2:1);
 }
});
