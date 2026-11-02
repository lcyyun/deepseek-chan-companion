// Isolated real React panel with deterministic IPC responses. No DSH process,
// account, pairing token, user configuration or model request is involved.
const {app,BrowserWindow}=require('electron');
const {createServer}=require('node:http');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {build}=require('esbuild');
const root=path.resolve(__dirname,'..'),directory=process.argv[2];
if(!directory)throw Error('Missing fixture directory');
const output=path.join(root,'output/dsh-connection-ui'),report={ok:false,errors:[],externalRequests:0};
app.setPath('userData',path.join(directory,'profile'));
app.commandLine.appendSwitch('force-device-scale-factor','1');app.disableHardwareAcceleration();
let server,win;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const importFile=file=>JSON.stringify(path.join(root,file).replaceAll('\\','/'));
  const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{DshConnectPanel}from${importFile('src/renderer/setup-panel.tsx')};import${importFile('src/renderer/style.css')};import${importFile('src/renderer/setup.css')};
    window.calls=[];window.fixtureStatus={connectionState:'ready',message:'当前连接可用。',cli:'fixture/dsh.cmd',home:'fixture/home',homeExists:true,running:true,hostVerified:true,bridgeConnected:true,chatAvailable:true,toolsReady:true,nativeToolsReady:true,mcpReachable:true,recoverySupported:true,canReconnect:true,canStartConfigured:false,requiresSetup:false,installationValid:true,mode:'new',savedSessionId:'',port:63616,sessions:[{id:'session-original'}]};
    window.pendingConnect=null;window.connectError='';
    window.companion={control:async(action,data)=>{window.calls.push({action,data});
      if(action==='dsh-status')return structuredClone(window.fixtureStatus);
      if(action==='dsh-connect'){if(window.connectError)throw Error(window.connectError);return await new Promise(resolve=>window.pendingConnect=()=>resolve({...window.fixtureStatus,ok:true}));}
      if(action==='dsh-prompt'){window.fixtureStatus={...window.fixtureStatus,mode:data.mode,savedSessionId:data.sessionId,installationValid:true};return {prompt:'仅用于首次接入的测试提示词'};}
      return {};},onEvent:()=>()=>{}};
    const interval=window.setInterval.bind(window);window.setInterval=(callback,ms,...rest)=>interval(callback,ms===5000?60:ms,...rest);
    createRoot(document.getElementById('root')).render(<main className="fixture"><DshConnectPanel/></main>);`;
  await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',format:'esm',outfile:path.join(directory,'fixture.js')});
  server=createServer(async(req,res)=>{
    if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"><style>body{background:#f8fafd}.fixture{padding:16px;height:100vh;overflow:auto;box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');return;}
    if(!['/fixture.js','/fixture.css'].includes(req.url)){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(await fs.readFile(path.join(directory,req.url.slice(1))));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  await app.whenReady();
  win=new BrowserWindow({width:460,height:780,useContentSize:true,frame:false,show:false,webPreferences:{contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
  win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)report.errors.push(event.message);});
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{const external=/^https?:/.test(details.url)&&!details.url.startsWith(origin+'/');if(external)report.externalRequests++;callback({cancel:external});});
  await win.loadURL(origin+'/');
  const js=code=>win.webContents.executeJavaScript(code);
  const until=async code=>{for(let i=0;i<150;i++){if(await js(code))return;await delay(20);}throw Error('Condition not reached: '+code);};
  const action=async name=>{await js(`document.querySelector('[data-dsh-action="${name}"]').click()`);await delay(35);};
  const count=action=>js(`window.calls.filter(call=>call.action===${JSON.stringify(action)}).length`);
  const update=async patch=>{await js(`window.fixtureStatus={...window.fixtureStatus,...${JSON.stringify(patch)}}`);await delay(150);};
  const shot=async name=>fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
  await until('document.querySelector(".dsh-panel")?.dataset.connectionState==="ready"');
  assert.equal(await js('document.querySelector("[data-dsh-setup]")'),null);
  assert.equal(await count('dsh-prompt'),0);assert.equal(await count('dsh-connect'),0);
  await shot('ready');
  await js(`document.querySelector('[data-dsh-action="connect"]').click();document.querySelector('[data-dsh-action="connect"]').click();`);
  await until('typeof window.pendingConnect==="function"');
  assert.equal(await count('dsh-connect'),1);assert.deepEqual(await js('window.calls.find(c=>c.action==="dsh-connect").data'),{start:false});
  report.reconnectDoesNotLaunch=true;report.duplicateActionBlocked=true;
  await js('window.pendingConnect();window.pendingConnect=null');await until('!document.querySelector("[data-dsh-action=connect]").disabled');

  await action('setup');await until('!!document.querySelector("[data-dsh-setup]")');
  await js('document.querySelector("input[value=existing]").click()');await until('!!document.querySelector("[data-dsh-session]")');
  await js(`(()=>{const input=document.querySelector('[data-dsh-session]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'session-user-draft');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await update({mode:'new',savedSessionId:'session-server-change'});
  assert.equal(await js('document.querySelector("input[value=existing]").checked'),true);
  assert.equal(await js('document.querySelector("[data-dsh-session]").value'),'session-user-draft');report.draftSurvivesPolling=true;
  assert.equal(await count('dsh-prompt'),0);
  await action('generate');await until('!!document.querySelector(".dsh-prompt textarea")');
  assert.equal(await count('dsh-prompt'),1);assert.deepEqual(await js('window.calls.find(c=>c.action==="dsh-prompt").data'),{mode:'existing',sessionId:'session-user-draft'});report.promptOnlyExplicit=true;
  await shot('setup-draft');await action('setup');

  await update({connectionState:'start_available',message:'已登记的 DSH 尚未运行。',running:false,hostVerified:false,bridgeConnected:false,chatAvailable:false,toolsReady:null,nativeToolsReady:null,mcpReachable:false,canReconnect:false,canStartConfigured:true});
  assert.equal(await js('document.querySelector("[data-dsh-action=connect]").disabled'),true);
  assert.equal(await count('dsh-connect'),1,'poll never starts a host');await shot('start-available');
  await action('start');await until('typeof window.pendingConnect==="function"');
  assert.deepEqual(await js('window.calls.filter(c=>c.action==="dsh-connect").at(-1).data'),{start:true});
  await js('window.pendingConnect();window.pendingConnect=null');await until('!document.querySelector("[data-dsh-action=start]").disabled');report.explicitStartOnly=true;

  await update({connectionState:'occupied',message:'端口已占用，但尚未确认属于所选 DSH。',canStartConfigured:false,canReconnect:true,running:false,occupiedPorts:[63616]});
  assert.equal(await js('!!document.querySelector("[data-dsh-action=start]")'),false);assert.match(await js('document.querySelector("[data-dsh-status=host]").textContent'),/未确认/);report.occupiedBlocked=true;
  await action('diagnostics');await shot('occupied');
  await update({connectionState:'upgrade_required',message:'聊天已连接，首次升级需重新加载桥插件。',bridgeConnected:true,chatAvailable:true,toolsReady:null,nativeToolsReady:null,recoverySupported:false,recoveryStatus:'upgrade-required',canStartConfigured:false,occupiedPorts:[]});
  assert.match(await js('document.querySelector("[data-dsh-status=chat]").textContent'),/已连接/);
  assert.match(await js('document.querySelector("[data-dsh-status=tools]").textContent'),/待确认/);report.legacyChatPreserved=true;report.unknownToolsNotFailure=true;await shot('legacy');
  await js('window.connectError="测试连接失败：请查看诊断。"');await action('connect');await until('!!document.querySelector(".dsh-error")');await delay(180);
  assert.match(await js('document.querySelector(".dsh-error").textContent'),/测试连接失败/);report.errorsSurvivePolling=true;
  assert.equal(await count('dsh-prompt'),1);assert.equal(report.externalRequests,0);assert.deepEqual(report.errors,[]);report.ok=true;
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
  win.destroy();await new Promise(resolve=>server.close(resolve));app.exit(0);
})().catch(async error=>{report.error=String(error.stack||error);await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(report,null,2)).catch(()=>{});await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));win?.destroy();server?.close();app.exit(1);});
