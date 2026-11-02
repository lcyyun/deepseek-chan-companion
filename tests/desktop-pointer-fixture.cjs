// Real main/preload IPC with an injected observer source. No OS mouse input,
// GPU model or user's profile is touched by this test.
const {app,dialog,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=process.argv[2];if(!directory)throw Error('Missing fixture directory');
app.setPath('userData',directory);app.disableHardwareAcceleration();
const windows=new Map(),released=[],canceled=[];let handlers,running=false,timer,sequence=0,button=false;
const cursor={x:-321,y:444};
app.on('ready',()=>{screen.getCursorScreenPoint=()=>({...cursor});});
require('../desktop/mouse-input.cjs').startMouseInput=options=>{
  handlers=options;options.onButton(false);options.onSample({down:false,seq:sequence++});
  return{ready:Promise.resolve(true),stop:()=>options.onButton(false)};
};
function sample(down){if(button!==down){button=down;handlers.onButton(down);}handlers.onSample({down,seq:sequence++});}
const output=path.join(directory,'pointer-result.json');
function fail(error){fs.writeFileSync(output,JSON.stringify({ok:false,error:String(error?.stack||error)}));app.exit(1);}
dialog.showErrorBox=(_title,message)=>fail(Error(message));
process.stdout?.on('error',()=>{});process.stderr?.on('error',()=>{});
app.on('browser-window-created',(_event,win)=>{
  // Exercise production show callbacks while keeping the native test windows
  // hidden. Focusability below is read from Electron's real native window.
  win.__activeShows=0;win.__inactiveShows=0;win.__focusCalls=0;
  win.show=()=>{win.__activeShows++;};
  win.showInactive=()=>{win.__inactiveShows++;win.emit('show');};
  win.focus=()=>{win.__focusCalls++;};
  win.webContents.focus=()=>{win.__focusCalls++;};
  const setShape=win.setShape.bind(win);win.setShape=rects=>{win.__shape=rects;return setShape(rects);};
  const send=win.webContents.send.bind(win.webContents);
  win.webContents.send=(channel,event,...args)=>{
    if(channel==='desktop-event'&&event.type==='pet-pointer-release')released.push({...event,shape:win.__shape,size:win.getContentSize()});
    if(channel==='desktop-event'&&event.type==='input-cancel')canceled.push(event);
    return send(channel,event,...args);
  };
  win.webContents.on('did-finish-load',async()=>{try{
    const role=await win.webContents.executeJavaScript('window.companion.bootstrap().then(v=>v.role)');
    windows.set(role,win);if(windows.size===3&&!running){running=true;await verify();}
  }catch(error){fail(error);}});
});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const invoke=(role,action,data)=>windows.get(role).webContents.executeJavaScript(`window.companion.control(${JSON.stringify(action)},${JSON.stringify(data)})`);
const state=async()=>(await invoke('pet','diagnostics',null)).pointerSession;
const lock=id=>invoke('pet','pet-pointer-lock',{locked:true,id});
const unlock=id=>invoke('pet','pet-pointer-lock',{locked:false,id});
async function verify(){
  const pet=windows.get('pet');
  assert.ok(pet.getOpacity()<1&&pet.getOpacity()>=253/255,'Windows pet explicitly declares native translucency to other Chromium apps');
  assert.equal(pet.isFocusable(),true,'ordinary pet clicks must be able to activate the native window');
  assert.equal(windows.get('toggle').isFocusable(),false,'pet input fix does not alter the floating ball');
  const focusStates=[pet.isFocusable()];
  const nativeVisible=pet.isVisible.bind(pet);
  // Model a visible show callback without placing anything on the desktop.
  // This also catches deferred webContents.focus() restoration attempts.
  let simulatedVisible=true;
  pet.isVisible=()=>simulatedVisible;
  await invoke('chat','hide-pet',null);pet.emit('hide');
  simulatedVisible=false;
  const inactiveBefore=pet.__inactiveShows;
  await invoke('chat','show-pet',null);await delay(20);
  assert.equal(pet.__inactiveShows,inactiveBefore+1);
  focusStates.push(pet.isFocusable());
  assert.equal(pet.__activeShows,0,'show-pet must use showInactive');
  assert.equal(pet.__focusCalls,0,'show-pet must not proactively focus the native window or its webContents');
  pet.isVisible=nativeVisible;
  await assert.rejects(invoke('chat','pet-pointer-lock',{locked:true,id:'forbidden'}),/仅桌宠/);
  await assert.rejects(invoke('pet','pet-pointer-lock',{locked:true,id:42}),/会话无效/);
  const diag=await invoke('pet','diagnostics',null);
  const body={x:200,y:150,width:180,height:300};
  await invoke('pet','pet-hit-regions',{regions:[body],body,fullBody:body,revision:diag.petScale.revision});
  sample(true);await lock('first');sample(false);
  assert.equal((await state()).locked,true,'cached prior press cannot complete the new session');
  await delay(80);sample(true);assert.equal((await state()).nativeConfirmed,true);
  sample(false);await delay(20);
  assert.deepEqual(await state(),{locked:false,id:null,nativeConfirmed:false});
  assert.equal(released.length,1);assert.equal(released[0].id,'first');
  assert.equal(released[0].x,cursor.x);assert.equal(released[0].y,cursor.y);
  const r=released[0];assert.ok(r.shape.every(rect=>rect.width<r.size[0]||rect.height<r.size[1]),'shape was restored before native completion reached the renderer');
  await unlock('first');assert.equal(released.length,1,'DOM up after native release is idempotent');
  await lock('old');await lock('new');await unlock('old');await invoke('pet','pet-pointer-lock',false);
  assert.equal((await state()).id,'new');assert.equal((await state()).locked,true);
  sample(false);assert.equal(released.length,1);
  pet.emit('hide');assert.equal((await state()).locked,false);assert.ok(canceled.length>0);
  await lock('failure');await delay(80);sample(true);
  handlers.onButton(false);handlers.onUnavailable(Error('injected observer failure'));
  assert.equal((await state()).locked,false);assert.equal(released.length,1,'observer failure is cancel, never a completed tap');
  await lock('dom-only');await unlock('dom-only');assert.equal((await state()).locked,false);
  await invoke('pet','pet-pointer-lock',true);assert.equal((await state()).locked,true);
  await invoke('pet','pet-pointer-lock',false);assert.equal((await state()).locked,false);
  await lock('drag-cancel');await invoke('chat','drag-mode',true);assert.equal((await state()).locked,false);
  focusStates.push(pet.isFocusable());
  await invoke('chat','drag-mode',false);
  focusStates.push(pet.isFocusable());
  await invoke('chat','hide-pet',null);pet.emit('hide');
  await invoke('chat','show-pet',null);await delay(20);
  focusStates.push(pet.isFocusable());
  assert.deepEqual(focusStates,[true,true,true,true,true],'startup, restore and leaving drag mode preserve pet focusability');
  assert.ok(pet.getOpacity()<1&&pet.getOpacity()>=253/255,'native translucency survives shape/capture/hide/show and drag mode changes');
  assert.equal(pet.__activeShows,0);assert.equal(pet.__focusCalls,0);
  await lock('input-cancel');await invoke('chat','pet-input-mode',true);assert.equal((await state()).locked,false);
  await invoke('chat','pet-input-mode',false);
  assert.ok([...windows.values()].every(win=>!win.isVisible()));
  fs.writeFileSync(output,JSON.stringify({ok:true,windowsHidden:true,nativeReleaseCount:released.length,cancelCount:canceled.length,screenCoordinates:cursor,focusStates}));
  clearTimeout(timer);app.quit();
}
timer=setTimeout(()=>fail(Error('Pointer fixture timed out')),30000);
require('../desktop/main.cjs');
