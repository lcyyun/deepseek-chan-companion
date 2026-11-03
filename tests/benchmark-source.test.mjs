import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const {readBenchmarkRevision,readBenchmarkBaseline,NO_GIT_REVISION}=createRequire(import.meta.url)('../scripts/benchmark-source.cjs');

test('current-source probes work from a development ZIP without executing Git or claiming a parent checkout',()=>{
  const options={root:'fixture',exists:()=>false,run:()=>assert.fail('No Git process should be attempted without this project checkout')};
  assert.equal(readBenchmarkRevision(options),NO_GIT_REVISION);
  assert.throws(()=>readBenchmarkBaseline({...options,baselineRef:'old'}),/Historical baseline comparison requires a Git checkout/);
  assert.throws(()=>readBenchmarkRevision({...options,variant:'baseline',baselineRef:'old'}),/Historical baseline comparison requires a Git checkout/);
});

test('revision metadata failure is optional only for current-source probes',()=>{
  const missing=Object.assign(new Error('Git not installed'),{code:'ENOENT'});
  const options={root:'fixture',exists:()=>true,run:()=>{throw missing;}};
  assert.equal(readBenchmarkRevision(options),NO_GIT_REVISION);
  assert.throws(()=>readBenchmarkRevision({...options,variant:'baseline',baselineRef:'old'}),error=>error.cause===missing&&/Historical baseline/.test(error.message));
  assert.throws(()=>readBenchmarkBaseline({...options,baselineRef:'old'}),error=>error.cause===missing&&/Historical baseline/.test(error.message));
});

test('historical probes select their exact baseline while current-source metadata uses HEAD',()=>{
  const calls=[];
  const options={root:'fixture',exists:()=>true,run:(command,args,settings)=>{calls.push({command,args,settings});return args[0]==='show'?'verbatim baseline source':' abc123\n';}};
  assert.equal(readBenchmarkRevision(options),'abc123');
  assert.equal(readBenchmarkRevision({...options,variant:'baseline',baselineRef:'old-ref'}),'abc123');
  assert.equal(readBenchmarkBaseline({...options,baselineRef:'old-ref'}),'verbatim baseline source');
  assert.deepEqual(calls.map(call=>[call.command,call.args]),[
    ['git',['rev-parse','HEAD']],['git',['rev-parse','old-ref']],['git',['show','old-ref:src/renderer/live2d.ts']],
  ]);
  for(const {settings} of calls){assert.equal(settings.cwd,'fixture');assert.equal(settings.windowsHide,true);assert.deepEqual(settings.stdio,['ignore','pipe','pipe']);}
});
