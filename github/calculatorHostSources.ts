/** Read-only complete host inputs through the unchanged three-file guard.
 * Full sources stay in host memory and never become model tool output. */
import {loadCalculatorSnapshot,calculatorSources,type CalculatorSnapshotReader} from './calculatorSnapshot.js';
export async function loadCalculatorHostSources(repository:string,baseRef:string,baseSha:string,reader:CalculatorSnapshotReader){
 const core=await loadCalculatorSnapshot({repository,baseRef,baseSha,changePaths:['src/calculator.mjs','test/calculator.test.mjs']},reader);
 const ui=await loadCalculatorSnapshot({repository,baseRef,baseSha,changePaths:['index.html','styles.css','src/app.mjs']},reader);
 const tests=await loadCalculatorSnapshot({repository,baseRef,baseSha,changePaths:['test/ui.test.mjs']},reader);
 if(await reader.getHead(baseRef)!==baseSha)throw Error('Host source groups became stale');
 return {dependencies:core,sources:new Map([...calculatorSources(core),...calculatorSources(ui),...calculatorSources(tests)])};
}
