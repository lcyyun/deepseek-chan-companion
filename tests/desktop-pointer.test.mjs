import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import net from 'node:net';
const run=promisify(execFile),require=createRequire(import.meta.url);
test('production pet pointer IPC restores shape, preserves activation after show/drag, and matches physical releases',{skip:process.platform!=='win32',timeout:45000},async t=>{
  try{await access(resolve('dist/index.html'));}catch{t.skip('Build the UI before the desktop IPC integration test');return;}
  const directory=await mkdtemp(join(tmpdir(),'l2d-pointer-ipc-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(join(directory,'desktop.json'),JSON.stringify({modelRoot:join(directory,'no-model'),mouseTracking:false}));
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const env={...process.env,COMPANION_PORT:String(port)};delete env.ELECTRON_RUN_AS_NODE;
  try{await run(require('electron'),[resolve('tests/desktop-pointer-fixture.cjs'),directory],{cwd:resolve('.'),windowsHide:true,timeout:40000,env,maxBuffer:1024*1024});}
  catch(error){let detail;try{detail=JSON.parse(await readFile(join(directory,'pointer-result.json'),'utf8')).error;}catch{}throw new Error(detail||error.message,{cause:error});}
  const result=JSON.parse(await readFile(join(directory,'pointer-result.json'),'utf8'));
  assert.equal(result.ok,true);assert.equal(result.windowsHidden,true);assert.equal(result.nativeReleaseCount,1);
  assert.deepEqual(result.screenCoordinates,{x:-321,y:444});
  assert.deepEqual(result.focusStates,[true,true,true,true,true]);
});
