// Isolated QA harness for the REAL desktop/main.cjs and its shipped renderer.
// Only Sky/native OS clicks are used to validate routing. No sendInputEvent.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const output=path.resolve(__dirname,'../output/native-controls-qa');
const run=path.join(output,String(Date.now()));
fs.mkdirSync(run,{recursive:true});
app.setPath('userData',path.join(run,'profile'));
fs.mkdirSync(app.getPath('userData'),{recursive:true});
fs.writeFileSync(path.join(app.getPath('userData'),'desktop.json'),JSON.stringify({modelRoot:path.join(run,'no-model-needed'),mouseTracking:false,petBounds:{x:100,y:80,width:370,height:680}}));
process.env.COMPANION_PORT='39188';
process.stdout?.on('error',()=>{});process.stderr?.on('error',()=>{});
const state={pid:process.pid,run,status:'starting',phase:'normal',windows:{},phases:{},controls:[],errors:[],note:'Real desktop main/preload and built UI. Model intentionally absent; buffer region supplied through real IPC. Pointerlocked phase latches the main flag, without an active DOM capture. Native clicks only; trusted alone is not proof.'};
const windows=new Map();let latestRequest='',polling=false,timer,exitTimer;
const save=()=>{fs.writeFileSync(path.join(run,'result.json'),JSON.stringify(state,null,2));fs.writeFileSync(path.join(output,'latest.json'),JSON.stringify({pid:process.pid,run,status:state.status,phase:state.phase}));};
const originalHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>originalHandle(channel,async(event,...args)=>{
  const chatVisibleBefore=windows.get('chat')?.isVisible()===true;
  const result=await handler(event,...args);
  if(channel==='window-control'&&args[0]==='toggle-chat'){
    const record={at:Date.now(),phase:state.phase,action:args[0],chatVisibleBefore,chatVisible:windows.get('chat')?.isVisible()===true};
    state.controls.push(record);save();
  }
  return result;
});
function recordWindow(win,role){
  const shape=win.__qaShape;
  state.windows[role]={id:win.id,title:win.getTitle(),bounds:win.getBounds(),visible:win.isVisible(),alwaysOnTop:win.isAlwaysOnTop(),shape,ignore:win.__qaIgnore};
}
app.on('browser-window-created',(_event,win)=>{
  const setShape=win.setShape.bind(win);win.setShape=rects=>{win.__qaShape=rects;return setShape(rects);};
  const ignore=win.setIgnoreMouseEvents.bind(win);win.setIgnoreMouseEvents=(enabled,options)=>{win.__qaIgnore=enabled;return ignore(enabled,options);};
  win.webContents.on('did-finish-load',async()=>{
    try{
      const role=await win.webContents.executeJavaScript('window.companion.bootstrap().then(value=>value.role)');
      windows.set(role,win);win.setTitle(`L2D CONTROLS QA - ${role}`);
      await win.webContents.executeJavaScript(`window.__qaNative=[];for(const type of ['pointerdown','pointerup','click'])window.addEventListener(type,e=>window.__qaNative.push({type,trusted:e.isTrusted,x:e.clientX,y:e.clientY,at:Date.now()}),true);`);
      recordWindow(win,role);save();
    }catch(error){state.errors.push(String(error));save();}
  });
});
async function command(role,action,value){return windows.get(role).webContents.executeJavaScript(`window.companion.control(${JSON.stringify(action)},${JSON.stringify(value)})`);}
async function setPhase(phase){
  if(!['normal','drag','pointerlocked'].includes(phase))throw Error('Unknown QA phase');
  const pet=windows.get('pet'),chat=windows.get('chat');
  if(chat.isVisible())await command('chat','hide-chat',null);
  await command('pet','drag-mode',phase==='drag');
  await command('pet','pet-pointer-lock',phase==='pointerlocked');
  const [width,height]=pet.getContentSize();
  await command('pet','pet-hit-regions',[{x:40,y:80,width:width-50,height:height-90}]);
  state.phase=phase;state.status='awaiting-native-click';state.phases[phase]={preparedAt:Date.now(),preparedWindowShape:pet.__qaShape};
  for(const [role,win]of windows){await win.webContents.executeJavaScript('window.__qaNative=[]');recordWindow(win,role);}
  save();
}
async function poll(){
  if(polling||windows.size!==3)return;polling=true;
  try{
    if(state.status==='starting')await setPhase('normal');
    const file=path.join(run,'request.json');
    if(fs.existsSync(file)){
      const text=fs.readFileSync(file,'utf8');
      if(text!==latestRequest){latestRequest=text;const request=JSON.parse(text);if(request.quit){app.quit();return;}await setPhase(request.phase);}
    }
    for(const [role,win]of windows){
      if(win.isDestroyed())continue;
      recordWindow(win,role);
      const events=await win.webContents.executeJavaScript('window.__qaNative||[]');
      const page=await win.webContents.executeJavaScript('({url:location.href,role:document.body.dataset.view,text:document.body.innerText.slice(0,300),buttons:[...document.querySelectorAll("button")].map(b=>b.getAttribute("aria-label")||b.innerText).slice(0,12)})');
      state.phases[state.phase][role]={events,page};
    }
    save();
  }catch(error){state.errors.push(String(error));save();}finally{polling=false;}
}
app.on('before-quit',()=>{clearInterval(timer);clearTimeout(exitTimer);state.status='closed';save();});
require('../desktop/main.cjs');
timer=setInterval(poll,250);
exitTimer=setTimeout(()=>app.quit(),480000);
save();
