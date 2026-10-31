// Native OS routing QA for the real desktop main + preload + built UI.
// Uses a clearly marked proxy body instead of loading another GPU-heavy model.
const {app,BrowserWindow,ipcMain,screen,dialog}=require('electron');
const fs=require('node:fs');const path=require('node:path');
const output=path.resolve(__dirname,'../output/native-workarea-qa'),run=path.join(output,String(Date.now()));
fs.mkdirSync(run,{recursive:true});app.setPath('userData',path.join(run,'profile'));fs.mkdirSync(app.getPath('userData'),{recursive:true});
fs.writeFileSync(path.join(app.getPath('userData'),'desktop.json'),JSON.stringify({modelRoot:path.join(run,'no-model'),mouseTracking:false,petBounds:{x:100,y:80,width:370,height:680}}));
process.env.COMPANION_PORT='39189';process.stdout?.on('error',()=>{});process.stderr?.on('error',()=>{});
let back,creatingBack=false,initialized=false,polling=false,timer,exitTimer,latestRequest='';const windows=new Map();
const state={pid:process.pid,run,status:'starting',mode:'drag',windows:{},controls:[],backgroundEvents:[],errors:[],note:'Native Sky clicks only. Real main/preload/UI; model omitted, proxy body alpha1 + current geometry supplied at IPC boundary. No user release touched.'};
const save=()=>{fs.writeFileSync(path.join(run,'result.json'),JSON.stringify(state,null,2));fs.writeFileSync(path.join(output,'latest.json'),JSON.stringify({pid:process.pid,run,status:state.status}));};
dialog.showErrorBox=(_title,error)=>{state.errors.push(String(error));save();app.quit();};
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,callback)=>handle(channel,async(event,...args)=>{
  if(channel==='window-control'&&args[0]==='pet-hit-regions'&&state.body){
    const input=Array.isArray(args[1])?{regions:args[1]}:args[1];
    args[1]={...input,regions:[state.body,...(input?.regions||[])].slice(0,8),body:state.body,fullBody:state.body};
  }
  const result=await callback(event,...args);
  if(channel==='window-control'&&['toggle-chat','pet-pointer-lock'].includes(args[0]))state.controls.push({at:Date.now(),action:args[0],value:args[1],chatVisible:windows.get('chat')?.isVisible()===true});
  return result;
});
app.on('browser-window-created',(_event,win)=>{
  if(creatingBack)return;
  const shape=win.setShape.bind(win);win.setShape=rects=>{win.__qaShape=rects;return shape(rects);};
  const ignore=win.setIgnoreMouseEvents.bind(win);win.setIgnoreMouseEvents=(enabled,options)=>{win.__qaIgnore=enabled;return ignore(enabled,options);};
  win.webContents.on('did-finish-load',async()=>{
    try{
      const role=await win.webContents.executeJavaScript('window.companion.bootstrap().then(x=>x.role)');windows.set(role,win);win.setTitle(`L2D WORKAREA QA - ${role}`);
      await win.webContents.executeJavaScript(`window.__qaNative=[];for(const type of ['pointerdown','pointerup','click'])window.addEventListener(type,e=>window.__qaNative.push({type,trusted:e.isTrusted,x:e.clientX,y:e.clientY,at:Date.now()}),true);`);
    }catch(error){state.errors.push(String(error));save();}
  });
});
const control=(role,action,value)=>windows.get(role).webContents.executeJavaScript(`window.companion.control(${JSON.stringify(action)},${JSON.stringify(value)})`);
async function createBack(){
  const area=screen.getPrimaryDisplay().workArea;state.area=area;
  state.body={x:Math.min(400,area.width/3),y:Math.min(180,area.height/5),width:Math.min(300,area.width/3),height:Math.min(460,area.height*.6)};
  const preload=path.join(run,'back-preload.cjs');
  fs.writeFileSync(preload,`const{ipcRenderer}=require('electron');window.addEventListener('pointerdown',e=>{if(e.isTrusted)ipcRenderer.send('qa-background',{type:e.type,trusted:e.isTrusted,x:e.clientX,y:e.clientY,at:Date.now()});});`);
  creatingBack=true;back=new BrowserWindow({...area,frame:false,show:false,title:'L2D WORKAREA QA - background',backgroundColor:'#f5f0de',webPreferences:{preload,contextIsolation:true,sandbox:true}});creatingBack=false;
  ipcMain.on('qa-background',(event,data)=>{if(event.sender===back.webContents)state.backgroundEvents.push(data);});
  const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#f5f0de;font:18px Segoe UI;color:#705f3d}.target{position:absolute;left:45px;top:120px;width:140px;height:80px;border:2px solid #a48a5e;text-align:center;padding-top:10px;box-sizing:border-box}h1{font-size:24px;margin:24px}p{margin:24px}</style><h1>独立全屏画布 · 原生点击测试</h1><p>蓝框为宠物代理保护区；其他区域可点击后层。本窗口不修改任何内容。</p><div class="target">OUTSIDE<br>BACK COUNTER</div>`;
  await back.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));back.show();
}
async function prepare(){
  if(initialized||windows.size!==3||!back)return;initialized=true;
  back.show();
  await control('pet','drag-mode',true);
  const style=`position:absolute;left:${state.body.x}px;top:${state.body.y}px;width:${state.body.width}px;height:${state.body.height}px;background:rgba(0,0,0,.004);border:2px dashed #287ee0;color:#1768c0;box-sizing:border-box;padding:18px;font:18px Segoe UI;z-index:20;`;
  await windows.get('pet').webContents.executeJavaScript(`{const guard=document.createElement('div');guard.id='qa-proxy-body';guard.style.cssText=${JSON.stringify(style)};guard.textContent='BODY · native protected';document.querySelector('.pet-stage').appendChild(guard);}`);
  const diag=await control('pet','diagnostics',null);
  await control('pet','pet-hit-regions',{regions:[state.body],body:state.body,fullBody:state.body,revision:diag.petScale.revision});
  state.status='awaiting-native-clicks';state.targets={outside:{x:115,y:160},body:{x:state.body.x+state.body.width/2,y:state.body.y+state.body.height/2}};
}
async function poll(){
  if(polling)return;polling=true;
  try{
    await prepare();
    if(!initialized)return;
    const request=path.join(run,'request.json');if(fs.existsSync(request)){const text=fs.readFileSync(request,'utf8');if(text!==latestRequest){latestRequest=text;if(JSON.parse(text).quit){app.quit();return;}}}
    for(const [role,win]of windows){if(win.isDestroyed())continue;state.windows[role]={bounds:win.getBounds(),visible:win.isVisible(),alwaysOnTop:win.isAlwaysOnTop(),shape:win.__qaShape,ignore:win.__qaIgnore,events:await win.webContents.executeJavaScript('window.__qaNative||[]')};}
    state.windows.background={bounds:back.getBounds(),visible:back.isVisible()};save();
  }catch(error){state.errors.push(String(error));save();}finally{polling=false;}
}
app.on('before-quit',()=>{clearInterval(timer);clearTimeout(exitTimer);state.status='closed';save();});
require('../desktop/main.cjs');
app.whenReady().then(createBack).catch(error=>{state.errors.push(String(error));save();app.quit();});
timer=setInterval(poll,200);exitTimer=setTimeout(()=>app.quit(),360000);save();
