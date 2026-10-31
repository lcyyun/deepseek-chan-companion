// Actual production main/preload with isolated hidden windows. Input events here
// exercise Chromium/React; they are not evidence of OS-native pointer routing.
const {app,dialog,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=process.argv[2],mode=process.argv[3];
if(!directory||!['update','reload'].includes(mode))throw Error('Missing fixture arguments');
app.setPath('userData',directory);
app.disableHardwareAcceleration();
const windows=new Map(),shown=new Map();let running=false,timer;
// Inject only the physical input source. Main IPC/window movement and the
// production renderer stay real; this does not claim OS-native mouse routing.
let injectedCursor=null,reportButton=()=>{};
app.on('ready',()=>{
  const realCursor=screen.getCursorScreenPoint.bind(screen);
  screen.getCursorScreenPoint=()=>injectedCursor||realCursor();
});
require('../desktop/mouse-input.cjs').startMouseInput=({onButton})=>{
  reportButton=onButton;onButton(false);return{ready:Promise.resolve(true),stop:()=>onButton(false)};
};
const output=path.join(directory,`toggle-${mode}.json`);
function fail(error){fs.writeFileSync(output,JSON.stringify({ok:false,error:String(error?.stack||error)}));app.exit(1);}
dialog.showErrorBox=(_title,message)=>fail(new Error(message));
process.stdout?.on('error',()=>{});process.stderr?.on('error',()=>{});
app.on('browser-window-created',(_event,win)=>{
  win.show=()=>{shown.set(win.id,(shown.get(win.id)||0)+1);};win.showInactive=()=>{};
  win.webContents.on('did-finish-load',async()=>{try{
    const role=await win.webContents.executeJavaScript('window.companion.bootstrap().then(value=>value.role)');
    windows.set(role,win);if(windows.size===3&&!running){running=true;await verify();}
  }catch(error){fail(error);}});
});
const invoke=(role,action,payload)=>windows.get(role).webContents.executeJavaScript(`window.companion.control(${JSON.stringify(action)},${JSON.stringify(payload)})`);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<60;i++){if(await check())return;await delay(25);}throw Error('Expected desktop state did not arrive');}
async function verify(){
  const ball=windows.get('toggle'),chat=windows.get('chat');
  await until(()=>ball.webContents.executeJavaScript('!!document.querySelector(".orbit-switch")'));
  const boot=await ball.webContents.executeJavaScript('window.companion.bootstrap().then(({togglePlacement})=>togglePlacement)');
  if(mode==='reload'){
    const saved=JSON.parse(fs.readFileSync(path.join(directory,'expected-toggle.json'),'utf8'));
    assert.equal(boot.manual,true);await until(()=>JSON.stringify(ball.getBounds())===JSON.stringify(saved));
    assert.deepEqual((await invoke('chat','diagnostics')).togglePlacement.bounds,saved);
    const followed=await invoke('chat','toggle-follow');assert.equal(followed.manual,false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'desktop.json'),'utf8')).togglePosition,undefined);
    fs.writeFileSync(output,JSON.stringify({ok:true,mode,restored:saved,followed:followed.bounds}));clearTimeout(timer);app.quit();return;
  }
  assert.equal(boot.manual,false);
  await assert.rejects(invoke('chat','toggle-drag',{phase:'start',x:100,y:100}),/仅悬浮球/);
  await assert.rejects(invoke('pet','toggle-drag',{phase:'move',x:100,y:100}),/仅悬浮球/);
  for(const x of ['NaN','Infinity','"100"'])await assert.rejects(ball.webContents.executeJavaScript(`window.companion.control('toggle-drag',{phase:'start',x:${x},y:0})`),/坐标无效/);
  await assert.rejects(invoke('toggle','toggle-drag',{phase:'move',x:100,y:100}),/尚未开始/);
  const before=ball.getBounds();
  await invoke('toggle','toggle-drag',{phase:'start',x:100,y:100});
  await invoke('toggle','toggle-drag',{phase:'move',x:103,y:102});
  assert.deepEqual(ball.getBounds(),before);
  assert.equal((await invoke('toggle','toggle-drag',{phase:'end'})).manual,false);
  const area=screen.getPrimaryDisplay().workArea,target={x:area.x+90,y:area.y+100};
  await invoke('toggle','toggle-drag',{phase:'start',x:before.x+29,y:before.y+29});
  await invoke('toggle','toggle-drag',{phase:'move',x:target.x+29,y:target.y+29});
  const placed=await invoke('toggle','toggle-drag',{phase:'end'});
  assert.equal(placed.manual,true);assert.equal(placed.bounds.x,target.x);assert.equal(placed.bounds.y,target.y);
  assert.ok(Math.abs(placed.bounds.width-58)<=1&&Math.abs(placed.bounds.height-58)<=1,'native HiDPI rounding remains within one DIP');
  await invoke('pet','move-pet',{dx:-80,dy:-60});await invoke('chat','resize-pet',.8);
  assert.deepEqual(ball.getBounds(),placed.bounds,'model move/zoom must preserve the manually placed ball');
  const baseline=shown.get(chat.id)||0;
  await ball.webContents.executeJavaScript(`window.__pointerLog=[];for(const name of ['pointerdown','pointermove','pointerup','lostpointercapture'])document.addEventListener(name,e=>window.__pointerLog.push({type:name,buttons:e.buttons,screenX:e.screenX,screenY:e.screenY,clientX:e.clientX,clientY:e.clientY}),true);void 0;`);
  const input=(type,x,y)=>{const bounds=ball.getBounds();ball.webContents.sendInputEvent({type,x,y,globalX:bounds.x+x,globalY:bounds.y+y,button:'left',clickCount:1,...(type==='mouseMove'?{modifiers:['leftButtonDown']}:{})});};
  input('mouseDown',29,29);
  await until(()=>ball.webContents.executeJavaScript('document.querySelector(".orbit-switch").hasPointerCapture(1)'));
  input('mouseUp',29,29);
  await until(()=>(shown.get(chat.id)||0)===baseline+1);
  const dragBefore=ball.getBounds(),clicks=shown.get(chat.id);
  input('mouseDown',29,29);
  await delay(30);input('mouseMove',45,40);
  try{await until(()=>ball.getBounds().x!==dragBefore.x);}catch(error){throw Error(error.message+' '+JSON.stringify(await ball.webContents.executeJavaScript('({events:window.__pointerLog,title:document.querySelector(".orbit-switch").title})')));}
  // The window has followed the cursor, so the pointer is local to the ball again.
  input('mouseUp',29,29);
  await until(()=>ball.webContents.executeJavaScript('!document.querySelector(".orbit-switch").hasPointerCapture(1)'));
  await delay(60);assert.equal(shown.get(chat.id),clicks,'dragging must not toggle the chat');
  // Native polling must keep moving after Chromium has sent no pointermoves.
  const nativeBefore=ball.getBounds(),nativeId='fixture-native-drag';
  injectedCursor={x:nativeBefore.x+20,y:nativeBefore.y+25};reportButton(true);
  await invoke('toggle','toggle-drag',{phase:'start',id:nativeId,...injectedCursor});
  await delay(25);
  const nativeTarget={x:area.x+180,y:area.y+180};
  injectedCursor={x:nativeTarget.x+20,y:nativeTarget.y+25};
  await until(()=>ball.getBounds().x===nativeTarget.x&&ball.getBounds().y===nativeTarget.y);
  await invoke('toggle','toggle-drag',{phase:'move',id:nativeId,x:nativeBefore.x+30,y:nativeBefore.y+30});
  assert.equal(ball.getBounds().x,nativeTarget.x,'stale renderer move must not reverse native motion');
  injectedCursor={x:nativeTarget.x+55,y:nativeTarget.y+40};reportButton(false);
  await until(()=>Math.abs(ball.getBounds().x-(nativeTarget.x+35))<=1);
  await delay(30);
  const nativeEnd=await invoke('toggle','toggle-drag',{phase:'end',id:nativeId});
  assert.equal(nativeEnd.moved,true);assert.equal(nativeEnd.cancelled,false);
  await invoke('toggle','toggle-drag',{phase:'move',id:nativeId,x:1,y:1});
  assert.ok(Math.abs(ball.getBounds().x-(nativeTarget.x+35))<=1,'release position keeps the grab offset within native HiDPI rounding');
  assert.equal(shown.get(chat.id),clicks,'native drag release must not open chat');
  injectedCursor=null;
  const secondId='fixture-short-tap';
  await invoke('toggle','toggle-drag',{phase:'start',id:secondId,x:100,y:100});
  const secondEnd=await invoke('toggle','toggle-drag',{phase:'end',id:secondId});
  assert.equal(secondEnd.moved,false,'a new short tap must not inherit the previous drag result');
  // A dropped Chromium pointerup must not leave React's held/capture state set.
  const missingUpBefore=ball.getBounds();
  injectedCursor={x:missingUpBefore.x+29,y:missingUpBefore.y+29};reportButton(true);
  input('mouseDown',29,29);
  await until(()=>ball.webContents.executeJavaScript('document.querySelector(".orbit-switch").hasPointerCapture(1)'));
  await delay(35);
  injectedCursor={x:missingUpBefore.x+69,y:missingUpBefore.y+59};
  await until(()=>ball.getBounds().x>=missingUpBefore.x+39);
  reportButton(false); // No sendInputEvent mouseUp or mouseMove follows.
  await until(()=>ball.webContents.executeJavaScript('!document.querySelector(".orbit-switch").hasPointerCapture(1)&&!document.querySelector(".orbit-dragging")'));
  assert.equal(shown.get(chat.id),clicks,'native-only drag release must not open chat');
  injectedCursor=null;
  input('mouseDown',29,29);
  await until(()=>ball.webContents.executeJavaScript('document.querySelector(".orbit-switch").hasPointerCapture(1)'));
  // A stale finished session notification must not cancel the new capture.
  ball.webContents.send('desktop-event',{type:'toggle-drag-end',id:nativeId,moved:true,cancelled:false});
  await delay(25);assert.equal(await ball.webContents.executeJavaScript('document.querySelector(".orbit-switch").hasPointerCapture(1)'),true);
  input('mouseUp',29,29);
  await until(()=>(shown.get(chat.id)||0)===clicks+1);
  const saved=ball.getBounds();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'desktop.json'),'utf8')).togglePosition,{x:saved.x,y:saved.y});
  fs.writeFileSync(path.join(directory,'expected-toggle.json'),JSON.stringify(saved));
  assert.ok([...windows.values()].every(win=>!win.isVisible()));
  fs.writeFileSync(output,JSON.stringify({ok:true,mode,clicked:true,dragged:true,nativeSampling:true,windowsHidden:true,bounds:saved}));clearTimeout(timer);app.quit();
}
timer=setTimeout(()=>fail(new Error('Toggle IPC fixture timed out')),30000);
require('../desktop/main.cjs');
