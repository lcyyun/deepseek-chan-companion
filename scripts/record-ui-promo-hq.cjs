// Re-record readable, native-pixel user UI and vector menu illustrations.
// Ordinary Electron runtime; no user profile, desktop window, model call or TTS.
'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const arg=(name,fallback)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const out=path.resolve(arg('out',path.join(root,'output/video1080/ui')));
const staticRoot=path.resolve(arg('static-root',path.join(root,'output/build/user')));
const width=1504,height=846,fps=30,frames=335,zoom=2.4;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.setPath('userData',path.join(out,'profile'));
app.commandLine.appendSwitch('force-device-scale-factor','1');
app.disableHardwareAcceleration();
let service,win,menu,encoder,watchdog;
const report={ok:false,width,height,fps,frames,zoom,chatZoom:1.7,edition:'user',mode:'isolated real React UI; no online provider',externalRequests:0,tuningChanges:[],commands:[],errors:[],menuSource:'Official local DeepSeek SVG rendered at final pixel size; explicitly labelled illustrations'};
function fail(error){report.errors.push(String(error?.stack||error));void finish(1);}
async function finish(code){
  clearTimeout(watchdog);encoder?.stdin?.end();
  await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));
  win?.destroy();menu?.destroy();await service?.close();app.exit(code);
}
async function main(){
  await fs.mkdir(out,{recursive:true});
  watchdog=setTimeout(()=>fail(Error('UI capture timed out')),180000);
  const {createService}=await import(pathToFileURL(path.join(root,'server/service.mjs')).href);
  const {DEFAULT_MODEL_TUNING,sanitizeModelTuning}=await import(pathToFileURL(path.join(root,'src/shared/model-tuning.mjs')).href);
  let tuning=sanitizeModelTuning(DEFAULT_MODEL_TUNING);
  service=await createService({port:0,edition:'user',dataDir:path.join(out,'service-data'),modelRoot:path.join(out,'no-model'),staticRoot});
  service.events.on('command',event=>report.commands.push({type:event.command?.type,emotion:event.command?.emotion}));
  const preload=path.join(out,'preload.cjs');
  await fs.writeFile(preload,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('companion',{bootstrap:()=>ipcRenderer.invoke('hq-bootstrap'),control:(action,data)=>ipcRenderer.invoke('hq-control',action,data),onEvent:callback=>{const listener=(_e,event)=>callback(event);ipcRenderer.on('hq-event',listener);return()=>ipcRenderer.removeListener('hq-event',listener);}});`);
  ipcMain.handle('hq-bootstrap',()=>({url:service.url,token:service.token,role:'chat',edition:'user',developerTools:false,hotkeysEnabled:true,modelTuning:tuning,setupRequired:false}));
  ipcMain.handle('hq-control',(_event,action,value)=>{
    if(action==='diagnostics')return{modelTuning:tuning,basinEnabled:false,mouseTracking:true,petScale:{scale:1},hotkeyConflicts:[]};
    if(action==='model-tuning'){
      tuning=sanitizeModelTuning(value,tuning);report.tuningChanges.push(value);
      win.webContents.send('hq-event',{type:'model-tuning',tuning});return{tuning};
    }
    if(action==='hide-chat')return true;
    throw Error('Capture forbids desktop operation: '+action);
  });
  await app.whenReady();
  win=new BrowserWindow({width,height,useContentSize:true,show:false,frame:false,webPreferences:{preload,contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{
    const external=/^https?:/.test(details.url)&&!details.url.startsWith(service.url+'/');
    if(external)report.externalRequests++;
    callback({cancel:external||details.url.startsWith(service.url+'/api/chat')||details.url.startsWith(service.url+'/api/tts')});
  });
  win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)report.errors.push(event.message);});
  win.webContents.setFrameRate(30);
  await win.loadURL(service.url+'/?view=chat');win.webContents.setZoomFactor(1.7);
  const js=code=>win.webContents.executeJavaScript(code);
  for(let i=0;i<100;i++){if(await js('document.querySelectorAll(".tabs button").length===5'))break;if(i===99)throw Error('UI did not initialize');await delay(50);}
  await delay(300);
  const capture=async name=>{const image=await win.webContents.capturePage();const size=image.getSize();if(size.width!==width||size.height!==height)throw Error('Unexpected UI raster size: '+JSON.stringify(size));if(name)await fs.writeFile(path.join(out,name),image.toPNG());return image.toBitmap();};
  await js(`(()=>{const pane=document.querySelector('.conversation'),text=document.querySelector('.empty-state p');pane.scrollTop+=text.getBoundingClientRect().top-pane.getBoundingClientRect().top;window.scrollTo(0,0);})()`);await delay(50);
  await capture('chat.png');
  report.connection=await js('document.querySelector(".channel-status")?.textContent');
  if(!report.connection.includes('未连接'))throw Error('Recording must not fake a connected provider');
  if(process.argv.includes('--chat-only')){report.ok=true;await finish(0);return;}
  win.webContents.setZoomFactor(zoom);await delay(100);
  const tab=async name=>{await js(`Array.from(document.querySelectorAll('.tabs button')).find(x=>x.textContent===${JSON.stringify(name)}).click()`);await delay(50);};
  const scrollTo=async selector=>{
    await js(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing capture control');const parent=node.closest('.panel-scroll');parent.scrollTop+=node.closest('.tuning-control').getBoundingClientRect().top-parent.getBoundingClientRect().top-8;})()`);await delay(25);
  };
  const change=async(selector,value)=>{
    await js(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${value});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  };
  let encoderError='';encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','bgra','-video_size',`${width}x${height}`,'-framerate',String(fps),'-i','pipe:0','-an','-c:v','ffv1','-level','3','-g','1','-pix_fmt','bgr0',path.join(out,'tuning.mkv')],{windowsHide:true});
  encoder.stderr.on('data',data=>encoderError+=data);
  const encoded=new Promise((resolve,reject)=>{encoder.on('error',reject);encoder.on('exit',code=>code===0?resolve():reject(Error('FFV1 '+code+': '+encoderError)));});
  await tab('调节');
  let lastSection='';
  const snapshots=new Set([0,140,185,230,275,310]);
  for(let frame=0;frame<frames;frame++){
    let selector,section,value;
    if(frame<141){section='body';selector='[data-tuning="bodyMotion"]';value=.8+.45*(.5-.5*Math.cos(Math.PI*Math.min(1,frame/120)));}
    else if(frame<186){section='gesture';selector='[data-tuning="gestureFrequency"]';value=.75+.4*(frame-141)/44;}
    else if(frame<230){section='idle';selector='[data-tuning="idleActivity"]';value=.7+.45*(frame-186)/43;}
    else if(frame<265){section='brow';selector='[data-expression-tuning="brow"]';value=.18*(frame-230)/34;}
    else if(frame<300){section='smile';selector='[data-expression-tuning="smile"]';value=.22*(frame-265)/34;}
    else{section='blush';selector='[data-expression-tuning="blush"]';value=.2*(frame-300)/34;}
    if(section!==lastSection){
      if(frame===230){await tab('小表情');await js(`document.querySelector('[data-expression="happy"]').click()`);await delay(350);}
      await scrollTo(selector);lastSection=section;
    }
    await change(selector,Math.round(value*100)/100);
    const bitmap=await capture(snapshots.has(frame)?`tuning-${String(frame).padStart(3,'0')}.png`:null);
    if(!encoder.stdin.write(bitmap))await new Promise(resolve=>encoder.stdin.once('drain',resolve));
  }
  encoder.stdin.end();await encoded;encoder=null;
  if(report.tuningChanges.length<50)throw Error('React slider changes were not observed');
  // Native 960x540 HTML/SVG illustration, not a resized 58-pixel ball capture.
  const svg=(await fs.readFile(path.join(root,'public/icons/deepseek.svg'),'utf8')).replace('#4d6bfe','#ffffff');
  menu=new BrowserWindow({width:960,height:540,useContentSize:true,show:false,frame:false,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true}});
  const menuHtml=(kind)=>{
    const hidden=kind==='menu-hidden',active=kind==='menu-chat'?0:kind==='menu-hidden'||kind==='menu-visible'?1:kind==='menu-exit'?2:-1;
    const labels=['打开聊天',hidden?'显示桌宠':'暂时隐藏桌宠','退出大肥鱼'];
    return `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#f4f8f6;color:#254769;font-family:'Microsoft YaHei';width:960px;height:540px}.title{position:absolute;left:46px;top:35px;font-size:32px;font-weight:700}.sub{position:absolute;left:46px;top:91px;font-size:24px;color:#69869c}.foot{position:absolute;left:46px;bottom:32px;font-size:24px;color:#6b8496}.ball{position:absolute;left:282px;top:227px;width:100px;height:100px;display:grid;place-items:center;background:linear-gradient(145deg,#70b1f3,#3978df);border:4px solid #e5f3ff;border-radius:50%;box-shadow:0 5px 12px #173f6c33}.ball svg{width:72px;height:65px}.dot{position:absolute;right:0;bottom:0;width:19px;height:19px;background:#8cdac3;border:3px solid #f6fbff;border-radius:50%}.menu{position:absolute;left:420px;top:165px;width:420px;background:#fff;border:2px solid #d2dfe6;border-radius:15px;padding:10px;box-shadow:0 5px 0 #d9e3e3}.row{font-size:32px;padding:14px 20px;border-radius:8px;height:73px}.row.active{background:#e4f2fa}.row:last-child{border-top:2px solid #e0e8ed;margin-top:8px}.closed{position:absolute;left:0;right:0;top:211px;text-align:center;font-size:42px;font-weight:700}.closed small{display:block;font-size:26px;font-weight:400;margin-top:24px;color:#69869c}</style><div class="title">悬浮球 · 快捷功能</div><div class="sub">右键打开菜单，按需选择</div><div class="foot">操作示意 · 功能与实际程序一致</div>${kind==='closed-card'?'<div class="closed">大肥鱼已退出<small>角色、悬浮球、聊天窗口一起关闭</small></div>':`<div class="ball">${svg}<i class="dot"></i></div>${kind==='ball-only'?'':`<div class="menu">${labels.map((label,index)=>`<div class="row ${index===active?'active':''}">${label}</div>`).join('')}</div>`}`}`;
  };
  for(const name of ['ball-only','menu-chat','menu-hidden','menu-visible','menu-exit','closed-card']){
    await menu.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(menuHtml(name)));await delay(50);
    const image=await menu.webContents.capturePage();await fs.writeFile(path.join(out,name+'.png'),image.toPNG());
  }
  report.ok=report.errors.length===0&&report.externalRequests===0;
  console.log(JSON.stringify({ok:report.ok,output:out,tuningFrames:frames,tuningChanges:report.tuningChanges.length,errors:report.errors}));
  await finish(report.ok?0:1);
}
main().catch(fail);
