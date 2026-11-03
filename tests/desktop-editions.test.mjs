import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
const require=createRequire(import.meta.url),run=promisify(execFile);

for(const edition of ['user','developer'])test(`packaged ${edition} edition enforces its UI and runtime capabilities with a real model`,{
  skip:process.platform!=='win32'||!process.env.L2D_MODEL_ROOT||!process.env[edition==='user'?'L2D_USER_APP_ROOT':'L2D_DEVELOPER_APP_ROOT'],timeout:70000,
},async t=>{
  const appRoot=resolve(process.env[edition==='user'?'L2D_USER_APP_ROOT':'L2D_DEVELOPER_APP_ROOT']);
  await access(join(appRoot,'dist/index.html'));
  const manifest=JSON.parse(await readFile(join(appRoot,'package.json'),'utf8'));assert.equal(manifest.companionEdition,edition);
  const prefix=join(tmpdir(),`l2d-edition-${edition}-`),directory=await mkdtemp(prefix);
  t.after(()=>{assert.ok(resolve(directory).startsWith(resolve(prefix)));return rm(directory,{recursive:true,force:true});});
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const dshHome=join(directory,'empty-dsh-home');await mkdir(dshHome);
  await writeFile(join(directory,'desktop.json'),JSON.stringify({modelRoot:resolve(process.env.L2D_MODEL_ROOT),
    renderQuality:'economy',cacheMeshBuffers:true,preserveGlState:true,mouseTracking:false,setupCompleted:true,
    dshHome,dshPort:port,petScale:1,petLayoutVersion:2,petPosition:{x:850,y:580}}));
  const env={...process.env,COMPANION_PORT:String(port)};delete env.ELECTRON_RUN_AS_NODE;delete env.COMPANION_DEV_HOTKEYS;
  try{await run(require('electron'),[resolve('tests/desktop-editions-fixture.cjs'),appRoot,directory,edition],{cwd:resolve('.'),env,windowsHide:true,timeout:65000,maxBuffer:1024*1024});}
  catch(error){const report=JSON.parse(await readFile(join(directory,'editions-result.json'),'utf8').catch(()=>'{}'));throw Error(report.errors?.join('\n')||error.message,{cause:error});}
  const report=JSON.parse(await readFile(join(directory,'editions-result.json'),'utf8'));
  assert.equal(report.ok,true);assert.equal(report.edition,edition);assert.equal(report.windowsHidden,true);
  assert.equal(report.modelReady,true);assert.equal(report.mcpConnected,true);assert.equal(report.headInteraction,true);
  assert.equal(report.hideRestore,true);assert.equal(report.externalRequests,0);assert.deepEqual(report.errors,[]);
  if(edition==='user'){assert.equal(report.debugControlsAbsent,true);assert.equal(report.renderSamples,0);assert.equal(report.fixedQuality,true);assert.equal(report.deniedDeveloperControls,8);}
  else{assert.equal(report.debugControlsPresent,true);assert.ok(report.renderSamples>0);assert.equal(report.diagnosticsAvailable,true);}
  t.diagnostic(JSON.stringify(report));
});
