import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

const filename=fileURLToPath(new URL('../desktop/main.cjs',import.meta.url));
const source=fs.readFileSync(filename,'utf8'),require=createRequire(filename);
const area={x:0,y:0,width:1280,height:720};
const plain=value=>JSON.parse(JSON.stringify(value));

// Execute the production main functions with native windows replaced by counters.
// No Electron, process, filesystem write, mouse input or private profile is used.
function fixture() {
  const counts={toggleBounds:0,chatBounds:0,ignoreMouse:0,shape:0,moveTop:0,reloads:0};
  const handlers=new Map(),writes=[],commands=[],copied=[];
  let nextId=1,focused=null;
  class Window extends EventEmitter {
    constructor(options={}) {
      super();this.options=options;this.bounds={x:0,y:0,width:58,height:58,...options};
      this.visible=true;this.topmost=true;this.events=[];this.opacity=1;
      this.webContents=new EventEmitter();this.webContents.id=nextId++;
      this.webContents.send=(channel,event)=>this.events.push({channel,...event});
      this.webContents.setWindowOpenHandler=()=>{};
      this.webContents.reload=()=>{counts.reloads++;};
    }
    isDestroyed(){return false;}
    isVisible(){return this.visible;}
    isAlwaysOnTop(){return this.topmost;}
    getBounds(){const {x,y,width,height}=this.bounds;return{x,y,width,height};}
    getContentBounds(){return this.getBounds();}
    getContentSize(){return[this.bounds.width,this.bounds.height];}
    setBounds(bounds){if(this.role==='toggle')counts.toggleBounds++;if(this.role==='chat')counts.chatBounds++;this.bounds={...bounds,width:bounds.width+(this.roundWidth||0)};}
    setIgnoreMouseEvents(ignored){counts.ignoreMouse++;this.ignored=ignored;}
    setShape(shape){counts.shape++;this.shape=shape;}
    moveTop(){counts.moveTop++;}
    setAlwaysOnTop(topmost){this.topmost=topmost;}
    setOpacity(value){this.opacity=value;}
    setTitle(){}
    loadURL(){}
    hide(){this.visible=false;this.emit('hide');}
    showInactive(){this.visible=true;this.emit('show');}
    static getFocusedWindow(){return focused;}
  }
  const windows={pet:new Window(area),toggle:new Window({x:100,y:100,width:58,height:58}),chat:new Window({x:0,y:0,width:420,height:560})};
  for(const [role,window]of Object.entries(windows))window.role=role;
  const fakeApp=new EventEmitter();Object.assign(fakeApp,{isPackaged:false,setName(){},getPath:key=>'Z:/companion-vm-fixture/'+key,requestSingleInstanceLock:()=>false,quit(){}});
  const electron={app:fakeApp,BrowserWindow:Window,ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},clipboard:{writeText:value=>copied.push(value)},
    screen:{getAllDisplays:()=>[{workArea:area}],getDisplayMatching:()=>({workArea:area})}};
  const model={windows,area,profile:mode=>({mode,effective:mode==='auto'?'balanced':mode,label:mode,maxFps:45}),commands};
  const context=vm.createContext({require:name=>name==='electron'?electron:name==='node:os'?{totalmem:()=>16*1024**3}:name==='node:fs'?{...fs,writeFileSync:(file,data)=>writes.push({file,data})}:require(name),
    __dirname:path.dirname(filename),process:{platform:'win32',env:{},execPath:process.execPath},URL,Buffer,console,setInterval,clearInterval,setTimeout,clearTimeout,model});
  vm.runInContext(source+`
    pet=model.windows.pet;toggle=model.windows.toggle;chat=model.windows.chat;petWorkArea=model.area;
    config={petScale:1,petPosition:{x:1000,y:430}};configFile='Z:/companion-vm-fixture/desktop.json';
    geometrySeen=true;bodyRegion={x:800,y:100,width:350,height:580};fullBodyRegion=bodyRegion;inputRegions=[bodyRegion];
    toolAnchor.update(bodyRegion,0);for(const [role,win]of Object.entries(model.windows))roles.set(win.webContents.id,role);
    normalizeRenderMode=value=>['auto','quality','balanced','economy'].includes(value)?value:'auto';
    resolveRenderQuality=value=>model.profile(normalizeRenderMode(value));
    service={url:'http://127.0.0.1:1',token:'fixture-token',dispatch:c=>model.commands.push(c)};
    pet.on('show',onPetShow);pet.on('hide',onPetHide);
    globalThis.api={layoutTools,updateInputShape,showPet,hidePet,setPetTopmost,makeWindow,setWindowBoundsIfChanged,
      setPassthrough:value=>{config.clickThrough=value;},
      setCapture:value=>{pointerLocked=value;},
      setFullBody:value=>{fullBodyRegion=value;inputRegions=[value];},
      requested:()=>petVisibleRequested};
  `,context,{timeout:5000});
  return{...model,counts,writes,commands,copied,api:context.api,handlers,
    invoke:(role,action,data)=>handlers.get('window-control')({sender:windows[role].webContents},action,data),
    bootstrap:role=>handlers.get('bootstrap')({sender:windows[role].webContents}),
    focus:role=>{focused=role?windows[role]:null;}};
}

test('repeated identical geometry does not repeatedly write native bounds, input or z-order',()=>{
  const f=fixture();for(let n=0;n<100;n++)f.api.layoutTools();
  assert.deepEqual(f.counts,{toggleBounds:1,chatBounds:0,ignoreMouse:1,shape:1,moveTop:2,reloads:0});
  f.api.setFullBody({x:790,y:100,width:360,height:580});f.api.layoutTools();
  assert.equal(f.counts.shape,2,'a real protection change still reaches the native window');
  assert.equal(f.counts.moveTop,4,'shape changes reassert the controls above the pet');
  assert.equal(f.counts.ignoreMouse,1,'a new shape does not redundantly change passthrough');
  assert.equal(f.counts.toggleBounds,1,'animation geometry does not move the frozen tool anchor');
});

test('hidden tools and HiDPI native rounding do not continually reposition identical windows',()=>{
  const f=fixture();f.windows.chat.visible=false;f.windows.toggle.roundWidth=1;f.windows.chat.roundWidth=-1;
  for(let n=0;n<100;n++)f.api.layoutTools();
  assert.equal(f.counts.toggleBounds,1);assert.equal(f.counts.chatBounds,1);
  assert.equal(f.windows.toggle.bounds.width,59);
  f.windows.toggle.bounds.x-=20;f.api.layoutTools();assert.equal(f.counts.toggleBounds,2,'external movement invalidates the observed-bounds cache');
  const before=f.windows.toggle.getBounds();
  f.api.setWindowBoundsIfChanged(f.windows.toggle,{...before,x:before.x-10});assert.equal(f.counts.toggleBounds,3,'a changed request still moves the window');
});

test('control movement, capture and passthrough preserve input protection after deduplication',()=>{
  const f=fixture();f.api.layoutTools();
  f.windows.toggle.setBounds({x:840,y:300,width:58,height:58});f.api.updateInputShape();
  const covered=(x,y)=>f.windows.pet.shape.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);
  assert.equal(covered(860,320),false,'the moved ball retains its input hole');
  f.api.setCapture(true);f.api.updateInputShape();assert.equal(covered(860,320),false);assert.equal(covered(700,600),true);
  f.api.setPassthrough(true);f.api.updateInputShape();assert.equal(f.windows.pet.ignored,false,'held pointer owns its gesture');
  f.api.setCapture(false);f.api.updateInputShape();assert.equal(f.windows.pet.ignored,true);
  const writes=f.counts.ignoreMouse;f.api.updateInputShape();assert.equal(f.counts.ignoreMouse,writes);
  f.api.setPassthrough(false);f.api.updateInputShape();assert.equal(f.windows.pet.ignored,false);
});

test('show reasserts native input, signals actual rendering visibility, and restores control order',()=>{
  const f=fixture();f.api.layoutTools();const before={...f.counts};
  f.api.hidePet();assert.equal(f.api.requested(),false);assert.equal(f.bootstrap('pet').renderActive,false);
  assert.ok(f.windows.pet.events.some(e=>e.type==='render-active'&&e.active===false));
  f.api.showPet();assert.equal(f.api.requested(),true);assert.equal(f.bootstrap('pet').renderActive,true);
  assert.ok(f.windows.pet.events.some(e=>e.type==='render-active'&&e.active===true));
  assert.ok(f.counts.ignoreMouse>before.ignoreMouse);assert.ok(f.counts.shape>before.shape);assert.ok(f.counts.moveTop>before.moveTop);
  f.api.setPetTopmost(true);const pinned=f.counts.moveTop;f.api.setPetTopmost(true);assert.equal(f.counts.moveTop,pinned);
  const win=f.api.makeWindow('pet',{transparent:true,focusable:true});
  assert.equal(win.options.webPreferences.backgroundThrottling,false);
  assert.equal(win.options.focusable,true);assert.equal(win.opacity,254/255);
});

test('only chat may change render quality; saved mode is exposed before a controlled reload',async()=>{
  const f=fixture();assert.equal(f.bootstrap('pet').renderQuality.effective,'balanced');
  await assert.rejects(f.invoke('pet','render-quality','balanced'),/仅聊天/);
  for(const value of ['unsafe',{},null,1])await assert.rejects(f.invoke('chat','render-quality',value),/无效/);
  assert.equal(f.writes.length,0);assert.equal(f.counts.reloads,0);
  f.api.hidePet();const profile=await f.invoke('chat','render-quality','balanced');
  assert.equal(profile.mode,'balanced');assert.equal(f.counts.reloads,1);assert.equal(f.writes.length,1);
  assert.equal(JSON.parse(f.writes[0].data).renderQuality,'balanced');assert.deepEqual(plain(f.commands),[{type:'stop'}]);
  assert.equal(f.windows.pet.visible,false,'quality reload does not itself unhide a pet');
  assert.ok(f.windows.chat.events.some(e=>e.type==='render-quality'&&e.profile.mode==='balanced'));
  const diagnostics=await f.invoke('chat','diagnostics');assert.equal(diagnostics.renderActive,false);assert.equal(diagnostics.renderQuality.mode,'balanced');
  await f.invoke('chat','render-quality','balanced');assert.equal(f.counts.reloads,1,'saving the same explicit mode is idempotent');
});

test('performance samples are pet-only and copied diagnostics exclude pairing and private profile fields',async()=>{
  const f=fixture(),packet={session:'renderer',renderGeneration:0,sampledAtMs:1000,frames:30,state:'thinking',renderActive:true,gpuRenderer:'ANGLE (NVIDIA)',token:'do-not-copy',modelRoot:'private-model'};
  await assert.rejects(f.invoke('chat','render-sample',packet),/仅桌宠/);
  assert.equal(await f.invoke('pet','render-sample',packet),true);
  await assert.rejects(f.invoke('pet','copy-performance'),/设置/);
  const result=await f.invoke('chat','copy-performance');assert.equal(result.available,true);
  assert.equal(result.gpuRenderer,'ANGLE (NVIDIA)');assert.equal(f.copied.length,1);
  assert.doesNotMatch(f.copied[0],/do-not-copy|private-model|fixture-token|modelRoot|dataDir/);
  assert.equal(JSON.parse(f.copied[0]).samples.length,1);assert.equal(f.writes.length,0);
});

test('owned canvas state is default, compatibility snapshots are explicit and late samples are rejected',async()=>{
  const f=fixture();assert.equal(f.bootstrap('pet').renderQuality.preserveGlState,false);
  await assert.rejects(f.invoke('pet','render-state-snapshots',true),/仅聊天/);
  await assert.rejects(f.invoke('chat','render-state-snapshots',1),/无效/);
  assert.equal(await f.invoke('pet','render-sample',{session:'late',renderGeneration:999,sampledAtMs:1000,frames:1}),false);
  f.api.hidePet();const profile=await f.invoke('chat','render-state-snapshots',true);
  assert.equal(profile.preserveGlState,true);assert.equal(f.counts.reloads,1);assert.equal(f.api.requested(),false);
  assert.equal((await f.invoke('chat','render-quality','quality')).preserveGlState,true);
  const restored=await f.invoke('chat','render-state-snapshots',false);
  assert.equal(restored.preserveGlState,false);assert.equal(restored.mode,'quality');
});

test('GPU buffer reuse can be compared with legacy rendering without changing quality or hidden intent',async()=>{
  const f=fixture();assert.equal(f.bootstrap('pet').renderQuality.cacheMeshBuffers,false);
  await assert.rejects(f.invoke('pet','render-buffer-cache',false),/仅聊天/);
  await assert.rejects(f.invoke('chat','render-buffer-cache','false'),/无效/);
  f.api.hidePet();const old=await f.invoke('chat','render-buffer-cache',true);
  assert.equal(old.cacheMeshBuffers,true);assert.equal(f.counts.reloads,1);
  assert.equal(f.windows.pet.visible,false);assert.equal(f.api.requested(),false);
  await f.invoke('chat','render-buffer-cache',true);assert.equal(f.counts.reloads,1);
  const quality=await f.invoke('chat','render-quality','quality');assert.equal(quality.cacheMeshBuffers,true);
  const next=await f.invoke('chat','render-buffer-cache',false);assert.equal(next.mode,'quality');assert.equal(next.cacheMeshBuffers,false);
  assert.equal(f.counts.reloads,3);assert.equal(JSON.parse(f.writes.at(-1).data).cacheMeshBuffers,false);
});
