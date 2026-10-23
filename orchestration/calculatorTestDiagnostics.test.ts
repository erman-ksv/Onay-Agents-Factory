import test from 'node:test';import assert from 'node:assert/strict';import {calculatorTestDiagnosticFailures as parse} from './calculatorTestDiagnostics.js';
const path='test/ui.test.mjs',row={path,exitCode:1,timedOut:false,codes:['ERR_MODULE_NOT_FOUND'],missingModules:['/app/src/unknown.mjs'],operators:[],locations:[]};
const encode=(r:unknown)=>JSON.stringify({version:1,tests:[r]});
test('bounded diagnostic names exact missing import and remains explicitly untrusted',()=>{const messages=parse(encode(row),[path]);assert.equal(messages.length,1);assert.match(messages[0]!,/Untrusted project-test diagnostic.*ERR_MODULE_NOT_FOUND.*missing=\/app\/src\/unknown.mjs/);});
test('diagnostic cannot grant success, widen paths, inject source/messages or print credentials',()=>{
 for(const changed of [{...row,path:'other.mjs'},{...row,exitCode:0},{...row,codes:['SUCCESS']},{...row,rawSource:'private'},{...row,missingModules:['module\nsecret']},{...row,missingModules:['gsk_'+'a'.repeat(30)]},{...row,locations:['/etc/passwd:1:1']}])assert.deepEqual(parse(encode(changed),[path]),[]);
 assert.deepEqual(parse('not JSON',[path]),[]);assert.deepEqual(parse('a'.repeat(32769),[path]),[]);
});
