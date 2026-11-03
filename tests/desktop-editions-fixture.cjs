// Runs a prepared app package with an ordinary Electron executable. Every
// native window remains hidden; the real renderer/model still receives events.
const {app,dialog,clipboard,globalShortcut,ipcMain,screen,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [appRoot,directory,edition]=process.argv.slice(2);
if(!appRoot||!directory||!['user','developer'].includes(edition)||!process.env.L2D_MODEL_ROOT)throw Error('Prepared app, isolated profile, edition and model are required');
const developer=edition==='developer';app.setPath('userData',directory);
app.commandLine.appendSwitch('force-device-scale-factor','1');
const output=path.join(directory,'editions-result.json'),windows=new Map(),nativeVisibility=new Map(),copies=[],errors=[];
const result={ok:false,edition,errors,externalRequests:0,renderSamples:0};
let running=false,timer,lastBody=null,mcpClient,hotkeys=0;
function fail(error){errors.push(String(error?.stack||error));fs.writeFileSync(output,JSON.stringify(result,null,2));app.exit(1);}
dialog.showErrorBox=(_title,message)=>fail(Error(message));clipboard.writeText=text=>copies.push(text);
globalShortcut.register=()=>{hotkeys++;return true;};globalShortcut.unregisterAll=()=>{};
require(path.join(appRoot,'desktop/mouse-input.cjs')).startMouseInput=options=>{options.onButton(false);options.onSample({down:false,seq:0});return{ready:Promise.resolve(true),stop:()=>options.onButton(false)};};
const register=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>register(channel,(event,action,data)=>{
  if(channel==='window-control'&&action==='pet-hit-regions'&&data?.body)lastBody={...data.body};
  const handled=handler(event,action,data);
  if(channel==='window-control'&&action==='render-sample')return Promise.resolve(handled).then(value=>{if(value===true)result.renderSamples++;return value;});
  return handled;
});
process.stdout?.on('error',()=>{});process.stderr?.on('error',()=>{});
app.on('ready',()=>{
  const original=screen.getPrimaryDisplay(),area={x:0,y:0,width:1280,height:900};
  const display=()=>({...original,workArea:area,bounds:area});
  screen.getPrimaryDisplay=display;screen.getAllDisplays=()=>[display()];screen.getDisplayMatching=display;
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
    const url=new URL(details.url);const external=['http:','https:','ws:','wss:'].includes(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname);
    if(external)result.externalRequests++;callback({cancel:external});
  });
});
app.on('browser-window-created',(_event,win)=>{
  nativeVisibility.set(win,win.isVisible.bind(win));win.__visible=false;
  win.isVisible=()=>win.__visible;win.show=win.showInactive=()=>{win.__visible=true;win.emit('show');};
  win.hide=()=>{win.__visible=false;win.emit('hide');};win.focus=win.moveTop=()=>{};win.webContents.focus=()=>{};
  win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)errors.push(event.message);});
  win.webContents.on('did-finish-load',async()=>{try{
    const bootstrap=await win.webContents.executeJavaScript('window.companion.bootstrap()');
    assert.equal(new URL(bootstrap.url).port,process.env.COMPANION_PORT);
    windows.set(bootstrap.role,win);
    if(windows.size===3&&!running){running=true;await verify(bootstrap);}
  }catch(error){fail(error);}});
});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const js=(role,code)=>windows.get(role).webContents.executeJavaScript(code);
const control=(role,action,data)=>js(role,`window.companion.control(${JSON.stringify(action)},${JSON.stringify(data)})`);
async function until(check,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await delay(75);}throw Error('Timed out: '+label);}
async function tab(label){await js('chat',`Array.from(document.querySelectorAll('.tabs button')).find(button=>button.textContent===${JSON.stringify(label)}).click()`);await delay(100);}
async function patHead(){
  const b=lastBody;assert.ok(b,'model geometry reaches native input protection');
  for(const fy of [.08,.15,.22,.28])for(const fx of [.5,.4,.6]){
    const point={x:b.x+b.width*fx,y:b.y+b.height*fy};
    await js('pet',`document.querySelector('.pet-stage').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,buttons:1,isPrimary:true,pointerType:'mouse',pointerId:73,clientX:${point.x},clientY:${point.y},screenX:${point.x},screenY:${point.y}}))`);
    await delay(30);const found=await js('pet',`!!document.querySelector('.pat-feedback')`);
    await js('pet',`document.querySelector('.pet-stage').dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,isPrimary:true,pointerId:73}))`);
    await delay(30);if(found)return true;
  }
  return false;
}
async function verify(bootstrap){
  const request=(route,body)=>fetch(bootstrap.url+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+bootstrap.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const state=async()=>{const response=await request('/api/state');assert.equal(response.status,200);return response.json();};
  assert.equal(bootstrap.edition,edition);assert.equal(bootstrap.developerTools,developer);assert.equal(bootstrap.hotkeysEnabled,!developer);
  assert.equal(await js('chat','document.body.dataset.edition'),edition,'package UI and main edition agree');
  // Electron 39 does not include devTools in getLastWebPreferences(). Test the
  // native behavior in the hidden chat window, never a detached visible tool.
  const web=windows.get('chat').webContents;web.openDevTools({mode:'bottom',activate:false});
  if(developer){await until(()=>web.isDevToolsOpened(),'developer DevTools enabled',4000);web.closeDevTools();await until(()=>!web.isDevToolsOpened(),'developer DevTools closed',4000);}
  else{await delay(200);assert.equal(web.isDevToolsOpened(),false,'user package disallows DevTools');}
  result.devToolsEnabled=developer;
  assert.equal(hotkeys>0,!developer);
  assert.equal(bootstrap.renderQuality.mode,developer?'economy':'quality');
  assert.equal(bootstrap.renderQuality.cacheMeshBuffers,developer);assert.equal(bootstrap.renderQuality.preserveGlState,developer);
  await until(()=>js('pet',`!document.querySelector('.model-status')&&!!document.querySelector('canvas')`),'real model ready');
  result.modelReady=true;await until(()=>lastBody,'model hit regions');
  assert.equal(await patHead(),true);result.headInteraction=true;
  await control('chat','hide-pet');await delay(100);await control('chat','show-pet');await delay(250);
  assert.equal(await patHead(),true);result.hideRestore=true;
  const info=await control('chat','diagnostics');assert.equal(info.edition,edition);
  assert.equal(Object.hasOwn(info,'dataDir'),developer);
  const current=await state();assert.equal(current.edition,edition);assert.equal(current.developerTools,developer);
  assert.equal(typeof current.performance.connected,'boolean');assert.equal(typeof current.dsh.connected,'boolean');
  if(!developer){assert.equal(current.rendering,null);assert.equal((await request('/api/performance')).status,404);result.fixedQuality=true;}
  const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
  const {StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  mcpClient=new Client({name:'edition-fixture',version:'1.0.0'});
  await mcpClient.connect(new StreamableHTTPClientTransport(new URL(bootstrap.url+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+bootstrap.token}}}));
  const tools=await mcpClient.listTools();assert.ok(tools.tools.some(tool=>tool.name==='avatar_state'));
  const avatarState=await mcpClient.callTool({name:'avatar_state',arguments:{}});assert.notEqual(avatarState.isError,true);
  assert.equal((await state()).performance.connected,true);result.mcpConnected=true;
  await tab('设置');
  assert.equal(await js('chat',`!!document.querySelector('[data-dsh-action="setup"]')`),true);
  assert.equal(await js('chat',`!!document.querySelector('[data-developer-performance]')`),developer);
  assert.equal(await js('chat',`!!document.querySelector('[data-dsh-action="diagnostics"]')`),developer);
  await tab('肢体');
  assert.equal(await js('chat',`!!document.querySelector('[data-body-animation="talk"]')`),true);
  assert.equal(await js('chat',`!!document.querySelector('[data-chest-preview]')`),developer);
  assert.equal(await js('chat',`!!document.querySelector('.shortcut-list')`),!developer);
  await js('chat',`document.querySelector('[data-body-animation="talk"]').click()`);
  await until(async()=>(await state()).lastCommand?.type==='body','daily body action stays available');
  await tab('小表情');assert.equal(await js('chat',`!!document.querySelector('.expression-grid')`),true);
  await tab('调节');assert.equal(await js('chat',`!!document.querySelector('[data-tuning="chestSoftness"]')`),true);
  assert.equal(await control('chat','basin-enabled',true),true);assert.equal(await control('chat','basin-enabled',false),false);
  const zoom=await control('chat','resize-pet',1.1);assert.ok(zoom.scale>=1.09&&zoom.scale<=1.11);
  await control('pet','move-pet',{dx:5,dy:0});
  if(!developer){
    let rejected=0;
    for(const [action,data,role]of [['render-quality','economy','chat'],['render-buffer-cache',true,'chat'],['render-state-snapshots',true,'chat'],['render-sample',{},'pet'],['copy-performance',undefined,'chat'],['start-gpu-timing',undefined,'chat'],['gpu-timing-status',{},'pet'],['chest-reaction',1,'chat']]){
      await assert.rejects(control(role,action,data),/开发版/);rejected++;
    }
    await delay(2200);assert.equal(result.renderSamples,0);
    result.deniedDeveloperControls=rejected;result.debugControlsAbsent=true;
  }else{
    const report=await until(async()=>{const response=await request('/api/performance');assert.equal(response.status,200);const value=await response.json();return value.available&&value.sample?.frames>0?value:null;},'developer performance sampler');
    assert.equal(report.sample.maxFps,30);assert.ok(report.sample.rafCallbacks>0);
    assert.equal((await control('chat','copy-performance')).available,true);assert.equal(copies.length,1);
    assert.ok(JSON.parse(copies[0]).sample);result.debugControlsPresent=true;result.diagnosticsAvailable=true;
  }
  await request('/api/stop',{});await mcpClient.close();mcpClient=null;
  result.windowsHidden=[...nativeVisibility.values()].every(visible=>!visible());assert.equal(result.windowsHidden,true);
  assert.deepEqual(errors,[]);result.ok=true;fs.writeFileSync(output,JSON.stringify(result,null,2));clearTimeout(timer);app.quit();
}
timer=setTimeout(()=>fail(Error('Edition fixture timed out')),60000);
require(path.join(appRoot,'desktop/main.cjs'));
