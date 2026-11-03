// Real main/preload geometry and IPC with virtual visibility/focus only. Every
// native window stays hidden; no physical input or user's profile is touched.
const {app,dialog,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=process.argv[2],mode=process.argv[3];
if(!directory||!['update','reload'].includes(mode))throw Error('Missing fixture arguments');
app.setPath('userData',directory);app.disableHardwareAcceleration();
let area={x:0,y:0,width:1280,height:720};
const windows=new Map(),nativeVisibility=new Map();let running=false,timer;
app.on('ready',()=>{
  const original=screen.getPrimaryDisplay();
  const display=()=>({...original,workArea:{...area},bounds:{...area}});
  screen.getPrimaryDisplay=display;screen.getAllDisplays=()=>[display()];screen.getDisplayMatching=display;
});
require('../desktop/mouse-input.cjs').startMouseInput=({onButton})=>{onButton(false);return{ready:Promise.resolve(true),stop:()=>{}};};
const output=path.join(directory,`chat-${mode}.json`);
function fail(error){fs.writeFileSync(output,JSON.stringify({ok:false,error:String(error?.stack||error)}));app.exit(1);}
dialog.showErrorBox=(_title,message)=>fail(Error(message));
process.stdout?.on('error',()=>{});process.stderr?.on('error',()=>{});
app.on('browser-window-created',(_event,win)=>{
  nativeVisibility.set(win,win.isVisible.bind(win));
  win.__visible=false;win.__focused=false;
  win.show=()=>{win.__visible=true;win.emit('show');};
  win.showInactive=()=>{win.__visible=true;win.emit('show');};
  win.hide=()=>{win.__visible=false;win.__focused=false;win.emit('hide');};
  win.isVisible=()=>win.__visible;win.isFocused=()=>win.__focused;
  win.focus=()=>{win.__focused=true;};
  win.__moveTopCalls=0;win.__shapeCalls=0;
  win.moveTop=()=>{win.__moveTopCalls++;};
  const shape=win.setShape.bind(win);win.setShape=rects=>{win.__shapeCalls++;win.__shape=rects;return shape(rects);};
  win.webContents.on('did-finish-load',async()=>{try{
    const role=await win.webContents.executeJavaScript('window.companion.bootstrap().then(value=>value.role)');
    windows.set(role,win);if(windows.size===3&&!running){running=true;await verify();}
  }catch(error){fail(error);}});
});
const invoke=(role,action,payload)=>windows.get(role).webContents.executeJavaScript(`window.companion.control(${JSON.stringify(action)},${JSON.stringify(payload)})`);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verify(){
  const chat=windows.get('chat'),pet=windows.get('pet');
  await delay(80);
  const expectedFile=path.join(directory,'expected-chat.json');
  if(mode==='reload'){
    const expected=JSON.parse(fs.readFileSync(expectedFile,'utf8'));
    await invoke('toggle','toggle-chat');
    assert.deepEqual(chat.getBounds(),expected,'relaunch must restore the manually placed conversation');
    assert.ok([...nativeVisibility.values()].every(visible=>!visible()));
    fs.writeFileSync(output,JSON.stringify({ok:true,mode,restored:expected}));clearTimeout(timer);app.quit();return;
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'desktop.json'),'utf8')).chatBounds,undefined,'automatic anchor is not a manual placement');
  await invoke('toggle','toggle-chat');
  chat.setBounds({x:24,y:38,width:420,height:560});chat.emit('move');
  const manual=chat.getBounds();await delay(240);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'desktop.json'),'utf8')).chatBounds,manual);
  // Touching the pet makes chat lose focus; the old layout guard then snapped
  // the conversation back beside the model (usually over its enlarged head).
  chat.__focused=false;chat.emit('blur');
  assert.deepEqual(chat.getBounds(),manual,'focus loss must not re-anchor chat');
  const diag=await invoke('pet','diagnostics');
  const protectedAt=(x,y)=>pet.__shape.some(rect=>x>=rect.x&&x<rect.x+rect.width&&y>=rect.y&&y<rect.y+rect.height);
  const geometry=async(body,extras=[])=>invoke('pet','pet-hit-regions',{revision:diag.petScale.revision,regions:[body,...extras],body,fullBody:body});
  const stableBody={x:600,y:120,width:300,height:400};await geometry(stableBody);
  const initialShapeCalls=pet.__shapeCalls,initialOrderCalls=chat.__moveTopCalls+windows.get('toggle').__moveTopCalls;
  for(let index=0;index<20;index++)await geometry({...stableBody,x:600+Math.sin(index)*3,y:120+Math.cos(index)*3});
  assert.equal(pet.__shapeCalls,initialShapeCalls,'small pose changes reuse the real native clip envelope');
  assert.equal(chat.__moveTopCalls+windows.get('toggle').__moveTopCalls,initialOrderCalls,'pose updates do not continually raise tool windows');
  const extended={x:450,y:120,width:650,height:400};await geometry(extended);
  assert.equal(protectedAt(1116,200),true,'a fast extension immediately includes its full original safety margin');
  await geometry(stableBody);assert.equal(protectedAt(1100,200),false,'finished wide gesture releases distant input protection');
  const caption={x:500,y:20,width:200,height:55};await geometry(stableBody,[caption]);
  assert.equal(protectedAt(550,35),true,'caption above the body remains protected');
  await geometry(stableBody);assert.equal(protectedAt(550,35),false,'removed caption does not leave a stale native blocker');
  for(let index=0;index<12;index++){
    const body={x:600-index*3,y:120-index,width:380+index*5,height:580};
    await invoke('pet','pet-hit-regions',{revision:diag.petScale.revision,regions:[body],body,fullBody:body});
  }
  assert.deepEqual(chat.getBounds(),manual,'dynamic model bounds must not re-anchor visible chat');
  await invoke('pet','pet-pointer-lock',{locked:true,id:'petting'});
  assert.deepEqual(chat.getBounds(),manual,'captured petting must preserve chat position');
  const origin=pet.getContentBounds(),center={x:manual.x+manual.width/2-origin.x,y:manual.y+manual.height/2-origin.y};
  assert.ok(!pet.__shape.some(rect=>center.x>=rect.x&&center.x<rect.x+rect.width&&center.y>=rect.y&&center.y<rect.y+rect.height),'the preserved chat keeps its hole in the pet input shield');
  await invoke('pet','pet-pointer-lock',{locked:false,id:'petting'});
  await invoke('pet','move-pet',{dx:-100,dy:-30});
  await invoke('chat','resize-pet',1.4);
  assert.deepEqual(chat.getBounds(),manual,'explicit model move/resize must preserve an open conversation');
  await invoke('chat','hide-chat');await invoke('toggle','toggle-chat');
  assert.deepEqual(chat.getBounds(),manual,'hide/show must preserve manual placement');
  // An unplugged/smaller display is the only automatic recovery of visible chat.
  chat.setBounds({x:800,y:130,width:420,height:560});chat.emit('move');
  area={x:0,y:0,width:1024,height:640};screen.emit('display-metrics-changed');
  const recovered=chat.getBounds();
  assert.ok(recovered.x>=0&&recovered.y>=0&&recovered.x+recovered.width<=1024&&recovered.y+recovered.height<=640);
  assert.equal(recovered.width,420);assert.equal(recovered.height,560);
  chat.__focused=false;chat.emit('blur');assert.deepEqual(chat.getBounds(),recovered);
  fs.writeFileSync(expectedFile,JSON.stringify(recovered));
  assert.ok([...nativeVisibility.values()].every(visible=>!visible()));
  fs.writeFileSync(output,JSON.stringify({ok:true,mode,manual,recovered,windowsHidden:true,stableGeometry:true,immediateExpansion:true,captionProtection:true}));
  clearTimeout(timer);app.quit();
}
timer=setTimeout(()=>fail(Error('Chat placement fixture timed out')),30000);
require('../desktop/main.cjs');
