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
async function availablePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
test('production toggle IPC and renderer separate tap/drag, persist independent placement and restore follow',{skip:process.platform!=='win32',timeout:90000},async t=>{
  try{await access(resolve('dist/index.html'));}catch{t.skip('Build the UI before the desktop IPC integration test');return;}
  const directory=await mkdtemp(join(tmpdir(),'l2d-toggle-ipc-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(join(directory,'desktop.json'),JSON.stringify({modelRoot:join(directory,'no-model'),mouseTracking:false}));
  for(const mode of ['update','reload']){
    const env={...process.env,COMPANION_PORT:String(await availablePort())};delete env.ELECTRON_RUN_AS_NODE;
    try{await run(require('electron'),[resolve('tests/desktop-toggle-fixture.cjs'),directory,mode],{cwd:resolve('.'),windowsHide:true,timeout:40000,env,maxBuffer:1024*1024});}
    catch(error){let detail;try{detail=JSON.parse(await readFile(join(directory,`toggle-${mode}.json`),'utf8')).error;}catch{}throw new Error(detail||error.message,{cause:error});}
    const result=JSON.parse(await readFile(join(directory,`toggle-${mode}.json`),'utf8'));
    assert.equal(result.ok,true);if(mode==='update'){assert.equal(result.windowsHidden,true);assert.equal(result.clicked,true);assert.equal(result.dragged,true);assert.equal(result.nativeSampling,true);}
  }
});
