// Read-only QA of the production React pet page in an independent hidden window.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'vendor', 'production-smoke');
const serviceUrl = 'http://127.0.0.1:39181';
app.setPath('userData', path.join(output, 'profile'));
app.commandLine.appendSwitch('disable-background-timer-throttling');
let win;
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const token=(await fs.readFile(path.join(process.env.APPDATA,'大肥鱼 · DeepSeek-chan','bridge-token'),'utf8')).trim();
  const preload=path.join(output,'preload.cjs');
  await fs.writeFile(preload,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('companion',{bootstrap:()=>ipcRenderer.invoke('qa-bootstrap'),control:async()=>{},onEvent:()=>()=>{}});`);
  ipcMain.handle('qa-bootstrap',()=>({url:serviceUrl,token,role:'pet'}));
  await app.whenReady();
  // Avoid subscribing to user's events or issuing writes to the live service.
  session.defaultSession.webRequest.onBeforeRequest({urls:[serviceUrl+'/*','ws://127.0.0.1:39181/*']},(details,callback)=>callback({cancel:details.method!=='GET'||details.url.startsWith('ws:')}));
  win=new BrowserWindow({width:370,height:600,show:false,transparent:true,frame:false,backgroundColor:'#00000000',
    webPreferences:{preload,offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true,autoplayPolicy:'no-user-gesture-required'}});
  const logs=[];win.webContents.on('console-message',event=>logs.push({level:event.level,message:event.message}));
  await win.loadURL(serviceUrl+'/?view=pet');
  const result=await win.webContents.executeJavaScript(`(async()=>{
    const start=Date.now();while(Date.now()-start<25000){if(document.querySelector('canvas')&&!document.querySelector('.model-status'))break;await new Promise(r=>setTimeout(r,200));}
    await new Promise(r=>setTimeout(r,1200));
    const selectors=['html','body','#root','.pet-stage','.avatar-canvas'];
    const layout=selectors.map(selector=>{const el=document.querySelector(selector);if(!el)return {selector,missing:true};const cs=getComputedStyle(el),rect=el.getBoundingClientRect();return{selector,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},display:cs.display,position:cs.position,width:cs.width,height:cs.height,opacity:cs.opacity,background:cs.backgroundColor,zIndex:cs.zIndex};});
    const canvas=document.querySelector('canvas');
    const pixels=canvas?await new Promise(resolve=>requestAnimationFrame(()=>{const gl=canvas.getContext('webgl');if(!gl){resolve({noGl:true});return;}const data=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);let nontransparent=0,colored=0;for(let i=0;i<data.length;i+=4){if(data[i+3]>20)nontransparent++;if(data[i+3]>20&&(Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2]))>20)colored++;}resolve({bufferWidth:canvas.width,bufferHeight:canvas.height,nontransparent,colored,glError:gl.getError(),contextLost:gl.isContextLost()});})):null;
    return{layout,pixels,bodyText:document.body.innerText,status:document.querySelector('.model-status')?.textContent,notice:document.querySelector('.pet-notice')?.textContent};
  })()`);
  const screenshot=await win.webContents.capturePage();await fs.writeFile(path.join(output,'production-pet.png'),screenshot.toPNG());
  const bitmap=screenshot.toBitmap();let snapshotAlpha=0,colored=0;for(let i=0;i<bitmap.length;i+=4){if(bitmap[i+3]>20)snapshotAlpha++;if(bitmap[i+3]>20&&Math.max(bitmap[i],bitmap[i+1],bitmap[i+2])-Math.min(bitmap[i],bitmap[i+1],bitmap[i+2])>20)colored++;}
  Object.assign(result,{snapshot:{size:screenshot.getSize(),nontransparent:snapshotAlpha,colored},logs});
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));win.destroy();app.exit(0);
})().catch(error=>{console.error(error);win?.destroy();app.exit(1);});
