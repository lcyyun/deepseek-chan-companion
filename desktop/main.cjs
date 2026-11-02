const { app, BrowserWindow, ipcMain, globalShortcut, screen, Tray, Menu, nativeImage, safeStorage, dialog, shell, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const zlib = require('node:zlib');
const { buildInputShape, computePetZoom, createPetPlacement, restorePetPlacement, constrainPosition, referenceBody, transformRegion, clipRegion, constrainToolBounds, layoutToolBounds, createToolAnchor, petTopmostForFocus, validRect } = require('./pet-input.cjs');
const { startMouseInput } = require('./mouse-input.cjs');
const { createToggleDragSession } = require('./toggle-drag.cjs');
const { createPetPointerSession } = require('./pet-pointer-session.cjs');
const dshConnect = require('./dsh-connect.cjs');
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_MODEL = process.env.L2D_MODEL_ROOT || path.join(ROOT, 'models', 'DeepSeek');
app.setName('大肥鱼 · DeepSeek-chan');
// Portable builds use an ASCII LocalAppData profile. Electron's process
// singleton lock can fail with access-denied in the older non-ASCII Roaming path.
const legacyProfile = path.join(app.getPath('appData'), '大肥鱼 · DeepSeek-chan');
const packagedProfile = path.join(path.dirname(path.dirname(process.execPath)), 'DeepSeek-chan-data');
if (app.isPackaged) {
  app.setPath('userData', packagedProfile);
  require('./profile-migration.cjs').migrateProfile(legacyProfile, packagedProfile);
}
// A custom userData path (tests/portable hosts) must never read the real profile.
const defaultProfile = app.isPackaged ? packagedProfile : legacyProfile;
if (!app.isPackaged && path.resolve(app.getPath('userData')) === path.resolve(defaultProfile)) {
  require('./profile-migration.cjs').migrateProfile(path.join(app.getPath('appData'), '小鲸 · DeepSeek-chan'), defaultProfile);
}
let service, pet, toggle, chat, tray, quitting = false, dragMode = false, petTopmost = false, petPinned = false;
let config = {}, dataDir, configFile, failures = [], lastSaved = 0, setupRequired = false;
let sanitizeModelTuning;
const roles = new Map();
let inputRegions = [], pointerLocked = false, shapeKey = '';
let resizingPet = false, scaleSaveTimer;
let placingChat = false, autoChatBounds = null, chatSaveTimer;
let toggleGesture=null,lastToggleDrag=null,toggleShapeTimer,toggleDragSequence=0;
const validPoint=point=>point&&['x','y'].every(key=>Number.isFinite(point[key])&&Math.abs(point[key])<=10000000);
let placementRevision = 0, geometrySeen = false, bodyRegion = null, fullBodyRegion = null, petWorkArea;
const toolAnchor=createToolAnchor();
let mouseInput, trackingTimer, leftDown=false, trackingBlocked=false, trackingStarted=0, trackingSent=false, previousCursor=null, mouseInputError='';
const petPointer=createPetPointerSession({
  onChange:state=>{pointerLocked=state.locked;updateInputShape({duringToggle:true});},
  onRelease:({id})=>{
    if(!pet||pet.isDestroyed())return;
    try{const point=screen.getCursorScreenPoint();pet.webContents.send('desktop-event',{type:'pet-pointer-release',id,x:point.x,y:point.y});}
    catch{pet.webContents.send('desktop-event',{type:'input-cancel'});}
  },
});
function sendTracking(active, extra={}) {
  if (pet && !pet.isDestroyed()) pet.webContents.send('desktop-event',{type:'pointer-tracking',active,...extra});
  trackingSent=active;
}
function suppressTracking() {trackingBlocked=leftDown;previousCursor=null;sendTracking(false);}
function updateTracking() {
  const active=leftDown&&!trackingBlocked&&!toggleGesture&&config.mouseTracking!==false&&!dragMode&&pet&&!pet.isDestroyed()&&pet.isVisible()&&Date.now()-trackingStarted>=120;
  if(!active){if(trackingSent)sendTracking(false);previousCursor=null;return;}
  const point=screen.getCursorScreenPoint(),bounds=pet.getBounds(),now=Date.now();
  const speed=previousCursor?Math.min(1,Math.hypot(point.x-previousCursor.x,point.y-previousCursor.y)/Math.max(16,now-previousCursor.at)/1.2):0;
  previousCursor={...point,at:now};
  // Screen/canvas positions are DIP throughout; no remote service receives them.
  sendTracking(true,{x:point.x-bounds.x,y:point.y-bounds.y,speed});
}
function initializeMouseTracking() {
  mouseInput=startMouseInput({cacheDir:path.join(dataDir,'native'),onButton:down=>{
    if(down&&!leftDown)trackingStarted=Date.now();
    leftDown=down;
    if(!down){trackingBlocked=false;previousCursor=null;sendTracking(false);}
  },onSample:sample=>petPointer.sample(sample),onUnavailable:error=>{mouseInputError=String(error?.message||error);leftDown=false;suppressTracking();petPointer.clear();pet?.webContents.send('desktop-event',{type:'input-cancel'});pet?.webContents.send('desktop-event',{type:'mouse-input-unavailable',message:mouseInputError});}});
  trackingTimer=setInterval(updateTracking,32);
}
function raiseTools() {
  // Reassert the native topmost style after setShape, then keep controls above
  // the protected pet surface without focusing them during every drag/resize.
  for (const win of [chat, toggle]) if (win && !win.isDestroyed() && win.isVisible()) {
    if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(true,'screen-saver');
    win.moveTop();
  }
}
function scheduleToggleShape() {
  if(toggleShapeTimer)return;
  toggleShapeTimer=setTimeout(()=>{toggleShapeTimer=undefined;updateInputShape({duringToggle:true});},48);
  toggleShapeTimer.unref?.();
}
function setPetTopmost(next) {
  if (!pet || pet.isDestroyed()) return;
  const value = next === true;
  if (petTopmost === value) return;
  petTopmost = value;
  pet.setAlwaysOnTop(value, 'screen-saver');
  if (value) pet.moveTop();
}
function syncPetTopmost() {
  if (!pet || pet.isDestroyed()) return;
  const focused = BrowserWindow.getFocusedWindow();
  const role = focused ? roles.get(focused.webContents.id) : null;
  setPetTopmost(petTopmostForFocus(role, petPinned));
}

function updateInputShape(options) {
  if(toggleGesture&&!options?.duringToggle){scheduleToggleShape();return;}
  if (!pet || pet.isDestroyed()) return;
  const passthrough = config.clickThrough === true && !dragMode && !pointerLocked;
  const [width,height] = pet.getContentSize();
  const origin=pet.getContentBounds();
  const exclusions=[toggle,chat].filter(win=>win&&!win.isDestroyed()&&win.isVisible()).map(win=>{
    const bounds=win.getBounds();return{x:bounds.x-origin.x,y:bounds.y-origin.y,width:bounds.width,height:bounds.height};
  });
  const regions=fullBodyRegion?[fullBodyRegion,...inputRegions.slice(0,7)]:inputRegions;
  const rects=buildInputShape({regions,width,height,fullWindow:pointerLocked,exclusions,padding:18*Math.max(1,config.petScale||1),fallbackRegions:geometrySeen?[]:[referenceBody(petScaleState())]});
  // [] means "remove the native shape", not an empty hit area. If controls
  // cover the whole pet, ignore input instead of accidentally protecting them.
  pet.setIgnoreMouseEvents(passthrough || rects.length===0, {forward:true});
  const key=JSON.stringify(rects);
  const changed=key!==shapeKey;
  if (changed) { try { pet.setShape(rects); shapeKey=key; if(petTopmost) pet.setAlwaysOnTop(true,'screen-saver'); } catch { /* Topmost controls remain accessible if native shape is unavailable. */ } }
  if(!toggleGesture||changed)raiseTools();
}

function saveConfig() {
  if (pet && !pet.isDestroyed()) {
    config.petBounds = pet.getBounds();
    if(validRect(fullBodyRegion)&&config.petPosition)config.petFootprint={...fullBodyRegion,x:fullBodyRegion.x+config.petBounds.x-config.petPosition.x,y:fullBodyRegion.y+config.petBounds.y-config.petPosition.y,scale:config.petScale,modelRoot:config.modelRoot||null};
  }
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
}
function petScaleState() {
  const state=createPetPlacement({area:pet&&!pet.isDestroyed()?pet.getBounds():petWorkArea,scale:config.petScale||1,position:config.petPosition});
  return {...state,revision:placementRevision,placement:{...state.placement,revision:placementRevision}};
}
function broadcastScale() {
  const state=petScaleState();
  for(const win of [pet,toggle,chat])if(win&&!win.isDestroyed())win.webContents.send('desktop-event',{type:'pet-scale',...state});
  return state;
}
function togglePlacement() {return {manual:!!validPoint(config.togglePosition),bounds:toggle&&!toggle.isDestroyed()?toggle.getBounds():null};}
function broadcastTogglePlacement() {
  const placement=togglePlacement();
  for(const win of [toggle,chat])if(win&&!win.isDestroyed())win.webContents.send('desktop-event',{type:'toggle-placement',...placement});
  return placement;
}
function finishToggleDrag(reason='end',id) {
  if(!toggleGesture||id&&toggleGesture.id!==id){
    if(lastToggleDrag&&(!id||lastToggleDrag.id===id))return lastToggleDrag;
    return {...togglePlacement(),id,moved:false,cancelled:true};
  }
  const gesture=toggleGesture,result=gesture.session.stop(reason);
  toggleGesture=null;suppressTracking();clearTimeout(toggleShapeTimer);toggleShapeTimer=undefined;
  layoutTools();
  if(result.moved){const bounds=toggle.getBounds();config.togglePosition={x:bounds.x,y:bounds.y};saveConfig();}
  lastToggleDrag={...broadcastTogglePlacement(),id:gesture.id,moved:result.moved,cancelled:!['end','released'].includes(reason)};
  if(toggle&&!toggle.isDestroyed())toggle.webContents.send('desktop-event',{type:'toggle-drag-end',id:gesture.id,moved:result.moved,cancelled:lastToggleDrag.cancelled});
  return lastToggleDrag;
}
function followToggle() {if(toggleGesture)finishToggleDrag('cancel');delete config.togglePosition;layoutTools();saveConfig();return broadcastTogglePlacement();}
function showToggleMenu() {
  if (!toggle || toggle.isDestroyed() || quitting) return;
  // A native menu can extend beyond the small transparent ball window.
  // Cancel capture before opening so closing a menu cannot complete an old tap.
  if (toggleGesture) finishToggleDrag('cancel');
  petPointer.clear(); suppressTracking();
  pet?.webContents.send('desktop-event', { type: 'input-cancel' });
  const visible = pet && !pet.isDestroyed() && pet.isVisible();
  Menu.buildFromTemplate([
    { label: '打开聊天', click: () => { if(!chat || chat.isDestroyed())return; if(!chat.isVisible())showChat(); else {raiseTools();chat.focus();} } },
    { label: visible ? '暂时隐藏桌宠' : '显示桌宠', click: () => { if (visible) hidePet(); else showPet(); } },
    { type: 'separator' },
    { label: '退出大肥鱼', click: () => app.quit() },
  ]).popup({ window: toggle });
}
function dragToggle(data) {
  if(!data||!['start','move','end'].includes(data.phase))throw new Error('悬浮球拖动阶段无效');
  if(data.id!==undefined&&(typeof data.id!=='string'||data.id.length>100))throw new Error('悬浮球拖动标识无效');
  if(data.phase==='end')return finishToggleDrag(data.cancelled?'cancel':'end',data.id);
  if(!validPoint(data))throw new Error('悬浮球坐标无效');
  if(data.phase==='start'){
    if(toggleGesture)finishToggleDrag('superseded');
    const id=data.id||`legacy-${++toggleDragSequence}`;
    const gesture={id,session:null};toggleGesture=gesture;
    gesture.session=createToggleDragSession({start:{x:data.x,y:data.y},bounds:toggle.getBounds(),
      getCursor:()=>screen.getCursorScreenPoint(),isPressed:()=>leftDown,
      onMove:(next,state)=>{
        if(toggleGesture!==gesture||toggle.isDestroyed())return;
        const bounds=constrainToolBounds(next,screen.getAllDisplays().map(display=>display.workArea));
        config.togglePosition={x:bounds.x,y:bounds.y};
        const previous=toggle.getBounds();
        if(previous.x!==bounds.x||previous.y!==bounds.y)toggle.setBounds(bounds);
        if(!gesture.announced){gesture.announced=true;toggle.webContents.send('desktop-event',{type:'toggle-drag-state',id,moved:true,native:state.native});}
        scheduleToggleShape();
      },onRelease:()=>finishToggleDrag('released',id),onError:()=>finishToggleDrag('cancel',id)});
    suppressTracking();return togglePlacement();
  }
  if(!toggleGesture){if(data.id&&lastToggleDrag?.id===data.id)return lastToggleDrag;throw new Error('悬浮球尚未开始拖动');}
  if(data.id&&toggleGesture.id!==data.id)return {...togglePlacement(),id:data.id,cancelled:true};
  const state=toggleGesture.session.move(data);
  return {...togglePlacement(),...state};
}
function resizePet(data) {
  const current=petScaleState();
  const scale=typeof data==='number'?data:typeof data?.factor==='number'?current.scale*Math.max(.5,Math.min(2,data.factor)):data?.scale;
  if(!Number.isFinite(scale)||typeof data?.factor==='number'&&(!Number.isFinite(data.factor)||data.factor<=0))throw new Error('缩放比例无效');
  const next=computePetZoom({bounds:current.bounds,area:petWorkArea,scale,currentScale:current.scale,position:current.position,anchor:data?.anchor,fullBody:fullBodyRegion});
  return commitPlacement(next);
}
function commitPlacement(next) {
  const before=petScaleState(),oldRegions=inputRegions;
  const oldBody=fullBodyRegion||referenceBody(before);
  config.petScale=next.scale;config.petPosition=next.position;config.petLayoutVersion=2;delete config.petView;
  placementRevision++;
  resizingPet=true;
  try {if(JSON.stringify(pet.getBounds())!==JSON.stringify(next.bounds))pet.setBounds(next.bounds);}finally{resizingPet=false;}
  const after=petScaleState();
  toolAnchor.predict(before,after);
  fullBodyRegion=transformRegion(oldBody,before,after);
  bodyRegion=clipRegion(fullBodyRegion,after.bounds.width,after.bounds.height);
  // The unclipped old body includes limbs/head outside the screen at 4x. Its
  // affine prediction prevents the previous small native shape cutting the
  // first resized frame. The next renderer revision replaces this prediction.
  inputRegions=oldRegions.map(rect=>transformRegion(rect,before,after)).slice(0,8);
  geometrySeen=false;
  layoutTools();
  clearTimeout(scaleSaveTimer);scaleSaveTimer=setTimeout(saveConfig,200);scaleSaveTimer.unref?.();
  return broadcastScale();
}
function placeChat(bounds) {
  placingChat=true;
  try {
    if(JSON.stringify(chat.getBounds())!==JSON.stringify(bounds))chat.setBounds(bounds);
    // Read back native DIP rounding, so an asynchronous move notification from
    // this placement cannot be mistaken for a user dragging the window.
    autoChatBounds=chat.getBounds();
  } finally { placingChat=false; }
}
function rememberChatPlacement() {
  if(placingChat||quitting||!chat||chat.isDestroyed())return;
  const bounds=chat.getBounds();
  if(JSON.stringify(bounds)===JSON.stringify(autoChatBounds))return;
  config.chatBounds=bounds;
  clearTimeout(chatSaveTimer);chatSaveTimer=setTimeout(saveConfig,200);chatSaveTimer.unref?.();
}
function layoutTools({recoverChat=false}={}) {
  if (!pet || pet.isDestroyed()) return;
  if(toggleGesture){scheduleToggleShape();return;}
  const p = pet.getBounds(),state=petScaleState();
  const local=toolAnchor.body||bodyRegion||clipRegion(referenceBody(state),p.width,p.height)||{x:p.width-100,y:p.height-100,width:70,height:70};
  const tools=layoutToolBounds({...local,x:local.x+p.x,y:local.y+p.y},petWorkArea);
  if (toggle && !toggle.isDestroyed()) {
    if(!toggleGesture){
      const bounds=validPoint(config.togglePosition)?constrainToolBounds({...tools.toggle,x:config.togglePosition.x,y:config.togglePosition.y},screen.getAllDisplays().map(display=>display.workArea)):tools.toggle;
      if(validPoint(config.togglePosition))config.togglePosition={x:bounds.x,y:bounds.y};
      toggle.setBounds(bounds);
    }
    if(validPoint(config.togglePosition)){
      const bounds=toggle.getBounds(),area=screen.getDisplayMatching(bounds).workArea;
      tools.chat=layoutToolBounds(bounds,area).chat;
    }
  }
  if (chat && !chat.isDestroyed()) {
    // Focusing the pet (e.g. touching its head) blurs chat. Visibility, not
    // keyboard focus, owns its placement: animation/input updates never move an
    // already open conversation over the character. Only monitor recovery may
    // constrain a visible window, and it preserves any in-bounds placement.
    if(!chat.isVisible()){
      placeChat(validRect(config.chatBounds)?constrainToolBounds(config.chatBounds,screen.getAllDisplays().map(display=>display.workArea)):tools.chat);
      if(validRect(config.chatBounds))config.chatBounds=chat.getBounds();
    }else if(recoverChat){
      placeChat(constrainToolBounds(chat.getBounds(),screen.getAllDisplays().map(display=>display.workArea)));
      if(validRect(config.chatBounds))config.chatBounds=chat.getBounds();
    }
  }
  updateInputShape();
}
function showChat() { if(chat.isVisible()){chat.hide();return;} layoutTools();chat.show();raiseTools();chat.focus();chat.webContents.send('desktop-event',{type:'focus-input'}); }
function showPet() {
  if (!pet || pet.isDestroyed()) return;
  // A hidden transparent window can retain an old native hit shape. Reassert it
  // after showing so the pet never leaves a full-window input blocker over DSH.
  pointerLocked = false;
  if (!pet.isVisible()) pet.showInactive();
  shapeKey = '';
  updateInputShape();
  syncPetTopmost();
}
function hidePet() {
  if (!pet || pet.isDestroyed()) return;
  pointerLocked = false;
  pet.hide();
  shapeKey = '';
}
function makeWindow(role, options) {
  const win = new BrowserWindow({show:false,frame:false,backgroundColor:'#00000000',hasShadow:false, ...options,
    icon:path.join(ROOT,'dist','icons','app.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,autoplayPolicy:'no-user-gesture-required',backgroundThrottling:role!=='pet'}});
  roles.set(win.webContents.id,role);
  const windowTitle=role==='pet'?'大肥鱼 · 桌宠':role==='toggle'?'大肥鱼 · 聊天开关':'大肥鱼 · 便携聊天';
  win.setTitle(windowTitle);win.on('page-title-updated',event=>event.preventDefault());
  win.webContents.setWindowOpenHandler(({url})=>{openSafe(url);return{action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(service.url+'/')){event.preventDefault();openSafe(url);}});
  win.webContents.on('console-message',event=>{if(process.env.COMPANION_DEBUG) console.log(`[${role}] ${event.message}`);});
  win.webContents.on('render-process-gone',(_event,details)=>console.error(`${role} renderer stopped: ${details.reason}`));
  win.loadURL(`${service.url}/?view=${role}`);
  return win;
}
function openSafe(url) { try{ const u=new URL(String(url)); if(['https:','http:'].includes(u.protocol))shell.openExternal(u.href); }catch{} }
function icon() {
  const portrait=nativeImage.createFromPath(path.join(ROOT,'dist','icons','app-avatar.png'));
  if(!portrait.isEmpty())return portrait.resize({width:32,height:32});
  const size=32, raw=Buffer.alloc((size*4+1)*size);
  for(let y=0;y<size;y++){for(let x=0;x<size;x++){const p=y*(size*4+1)+1+x*4;const inside=(x-15.5)**2+(y-15.5)**2<225;raw[p]=53;raw[p+1]=130;raw[p+2]=246;raw[p+3]=inside?255:0;if(inside&&((x>7&&x<12&&y>8&&y<23)||(x>10&&x<23&&(y===9||y===10||y===21||y===22))||(x>20&&x<24&&y>10&&y<22))){raw[p]=239;raw[p+1]=248;raw[p+2]=255;}}}
  function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);let c=0xffffffff;for(const b of Buffer.concat([t,data])){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}crc.writeUInt32BE((c^0xffffffff)>>>0);return Buffer.concat([len,t,data,crc]);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
  return nativeImage.createFromBuffer(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
function setDragMode(enabled) {dragMode=enabled;suppressTracking();petPointer.clear();pointerLocked=false;updateInputShape();pet.webContents.send('desktop-event',{type:'drag-mode',enabled});}
function resetPosition(){const display=screen.getPrimaryDisplay();petWorkArea={...display.workArea};config.petDisplayId=display.id;commitPlacement(restorePetPlacement({},petWorkArea));layoutTools({recoverChat:true});saveConfig();}
function registerKeys(){
  const bindings=[
    ['CommandOrControl+Alt+Space',()=>showChat()],
    ['CommandOrControl+Alt+Backspace',()=>service.dispatch({type:'stop'})],
    ['CommandOrControl+Alt+1',()=>service.dispatch({type:'perform',intent:'agree',emotion:'happy',intensity:.85,durationMs:3600})],
    ['CommandOrControl+Alt+2',()=>service.dispatch({type:'perform',intent:'explain',gesture:'pointer',emotion:'happy',intensity:.85,durationMs:6500})],
    ['CommandOrControl+Alt+3',()=>service.dispatch({type:'perform',intent:'shy',emotion:'shy',intensity:.85,durationMs:5500})],
    ['CommandOrControl+Alt+4',()=>service.dispatch({type:'perform',intent:'think',emotion:'puzzled',gesture:'pointer',intensity:.65,durationMs:6000})],
    ['CommandOrControl+Alt+5',()=>service.dispatch({type:'perform',intent:'cuddle',emotion:'happy',intensity:.65,durationMs:4200})],
    ['CommandOrControl+Alt+6',()=>service.dispatch({type:'perform',intent:'idea',emotion:'happy',gesture:'pointer',intensity:.7,durationMs:1800})],
    ['CommandOrControl+Alt+0',()=>service.dispatch({type:'reset'})],
  ];
  for(const [key,fn] of bindings)if(!globalShortcut.register(key,fn))failures.push(key);
}

async function connectDsh(payload = {}) {
  const mode = payload.mode === 'existing' ? 'existing' : 'new';
  const info = await dshConnect.detectDsh(config);
  if (!info.cli) throw new Error('没有找到 DSH。请先安装 DeepSeek Harness，或在设置中填写 DSH CLI 路径。');
  if (!info.homeExists) throw new Error(`没有找到 DSH_HOME：${info.home}。请先运行一次 DSH，或填写正确的 DSH_HOME。`);
  const bridgeConnected = service.getState().dsh?.connected === true;
  if (bridgeConnected) return { ok: true, connected: true, alreadyConnected: true, port: config.dshPort || info.open[0] || dshConnect.DEFAULT_PORT };
  // Never terminate DSH from the companion. It may be in the middle of a task;
  // the user must stop it manually before a patched instance can be started.
  if (info.running) return { ok: false, requiresManualStop: true, port: config.dshPort || info.open[0] || dshConnect.DEFAULT_PORT, openPorts: info.open };
  const port = Number(config.dshPort) || dshConnect.DEFAULT_PORT;
  // DSH's first boot needs profiles/web. Create it from the app process before
  // spawning so a transient child-process permission failure cannot hide the
  // real setup problem behind a 30-second startup timeout.
  try { fs.mkdirSync(path.join(info.home, 'profiles', 'web'), { recursive: true }); }
  catch (error) { throw new Error(`无法创建 DSH profile 目录：${error.message}\n请先手动启动一次 DSH，确认它能在 ${info.home} 正常初始化。`); }
  const patch = dshConnect.writePatch({
    root: ROOT, dataDir, serviceUrl: service.url, token: service.token,
    mode, sessionId: payload.sessionId, sessionFile: dshConnect.sessionFile(dataDir), port,
  });
  dshConnect.writeLauncher({ dataDir, cli: info.cli, home: info.home, patch, port });
  dshConnect.startDsh({ cli: info.cli, home: info.home, patch, port, logFile: path.join(dataDir, 'logs', 'dsh.log') });
  config.dshPort = port;
  config.dshMode = mode;
  if (mode === 'existing') config.dshSessionId = String(payload.sessionId || '');
  else delete config.dshSessionId;
  saveConfig();
  try {
    await dshConnect.waitForPort(port, 30000);
    await dshConnect.waitForBridge(service, 45000);
  } catch (error) {
    throw new Error(`${error.message}\n日志：${path.join(dataDir, 'logs', 'dsh.log')}`);
  }
  return { ok: true, connected: true, mode, port, patch, log: path.join(dataDir, 'logs', 'dsh.log') };
}

function bridgePrompt(payload = {}) {
  const mode = payload.mode === 'existing' ? 'existing' : 'new';
  const sessionId = String(payload.sessionId || '').trim();
  const home = dshConnect.resolveHome(config);
  const cli = dshConnect.resolveCli(config);
  const port = Number(config.dshPort) || dshConnect.DEFAULT_PORT;
  if (!cli) throw new Error('没有找到 DSH CLI，无法生成接入提示词。请先安装 DeepSeek Harness。');
  if (!fs.existsSync(home)) throw new Error(`没有找到 DSH_HOME：${home}`);
  const patch = dshConnect.writePatch({
    root: ROOT, dataDir, serviceUrl: service.url, token: service.token,
    mode, sessionId, sessionFile: dshConnect.sessionFile(dataDir), port,
  });
  config.dshMode = mode;
  if (mode === 'existing') config.dshSessionId = sessionId;
  else delete config.dshSessionId;
  config.dshPort = port;
  saveConfig();
  const bridge = path.join(ROOT, 'integrations', 'dsh', 'live2d-bridge.mjs');
  const tokenFile = path.join(dataDir, 'bridge-token');
  const sessionFile = dshConnect.sessionFile(dataDir);
  const modeText = mode === 'existing'
    ? `A · 接到已有会话\n目标会话 ID：${sessionId}\n不要新建独立会话，不要写 sessionFile。`
    : `B · 新建独立桌宠会话\n使用 sessionFile：${sessionFile}\n不要设置 chatSessionId，首次会创建新会话并保存，后续复用。`;
  const prompt = [
    '请在这台 Windows 电脑上，把大肥鱼（DeepSeek-chan）接入当前 DeepSeek Harness。',
    '这是一次本地桥接配置，不要新建独立 DSH 实例，不要删除用户数据。',
    '',
    `接入模式：${modeText}`,
    '',
    '已有本地信息：',
    `- 大肥鱼服务：${service.url}`,
    `- MCP 地址：${service.url.replace(/\/$/, '')}/mcp`,
    `- 桥插件：${bridge}`,
    `- 已生成的 patch：${patch}`,
    `- token 文件：${tokenFile}（不要读取后发到聊天里）`,
    `- DSH_HOME：${home}`,
    `- 端口：${port}`,
    '',
    '请执行：',
    '1. 先备份 DSH profile，不要删除用户原有会话。',
    '2. 检查 patch 中的 MCP 客户端、桥插件路径、tokenFile 和当前 A/B 模式是否正确。',
    `3. 使用现有 web profile 启动 DSH，并加上：--patch "${patch}" --port ${port} --no-open`,
    '4. 如果 DSH 正在运行：不要杀进程；先让用户完成任务并手动退出，再用上述参数启动。',
    '5. 启动后验证 MCP 和大肥鱼聊天桥；不要改用户的其他 DSH 配置。',
    '',
    '如果你不能执行终端命令，请把 patch 路径和启动命令原样交给用户手动执行。',
    '完成后告诉用户：回到大肥鱼点“刷新状态”，不需要再点自动连接。',
  ].join('\n');
  return { mode, prompt, patch, tokenFile, sessionFile, home, cli, port };
}

if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{if(chat){layoutTools();chat.show();chat.focus();}});
  app.whenReady().then(async()=>{
    dataDir=app.getPath('userData');fs.mkdirSync(dataDir,{recursive:true});configFile=path.join(dataDir,'desktop.json');
    let hadConfig=true;
    try{config=JSON.parse(fs.readFileSync(configFile,'utf8'));}catch{config={};hadConfig=false;}
    if(!hadConfig)config.firstRun=true;
    setupRequired=config.setupCompleted!==true&&(hadConfig===false||config.firstRun===true);
    ({sanitizeModelTuning}=await import(pathToFileURL(path.join(ROOT,'src/shared/model-tuning.mjs')).href));
    config.modelTuning=sanitizeModelTuning(config.modelTuning);
    petPinned=config.petPinned===true;
    const {createService}=await import(pathToFileURL(path.join(ROOT,'server/index.mjs')).href);
    service=await createService({port:Number(process.env.COMPANION_PORT)||39181,modelRoot:config.modelRoot||DEFAULT_MODEL,dataDir,staticRoot:path.join(ROOT,'dist'),
      encrypt:value=>{if(!safeStorage.isEncryptionAvailable())throw new Error('Windows凭据加密不可用，暂时无法保存密钥');return safeStorage.encryptString(value);},
      decrypt:value=>safeStorage.decryptString(value)});
    const display=screen.getAllDisplays().find(item=>item.id===config.petDisplayId)||screen.getPrimaryDisplay();
    petWorkArea={...display.workArea};config.petDisplayId=display.id;
    const initialZoom=restorePetPlacement(config,petWorkArea);
    config.petScale=initialZoom.scale;config.petPosition=initialZoom.position;config.petLayoutVersion=2;delete config.petView;
    // Windows/Chromium can discard mouse-down on an inactive non-focusable
    // TYPE_WINDOW. Show without activating; let an actual pet click activate it.
    pet=makeWindow('pet',{...initialZoom.bounds,transparent:true,alwaysOnTop:false,skipTaskbar:true,resizable:false,focusable:true});
    toggle=makeWindow('toggle',{width:58,height:58,transparent:true,alwaysOnTop:true,skipTaskbar:true,resizable:false,focusable:false});
    chat=makeWindow('chat',{width:420,height:560,transparent:false,backgroundColor:'#f7f9fc',alwaysOnTop:true,skipTaskbar:true,resizable:false});
    updateInputShape();
    pet.webContents.on('did-start-loading',()=>{suppressTracking();petPointer.clear();inputRegions=[];bodyRegion=null;fullBodyRegion=null;toolAnchor.clear();geometrySeen=false;pointerLocked=false;updateInputShape();});
    pet.webContents.on('render-process-gone',()=>{petPointer.clear();pointerLocked=false;updateInputShape();});
    pet.on('resize',()=>{shapeKey='';if(!resizingPet)layoutTools();});
    pet.on('hide',()=>{suppressTracking();petPointer.clear();pointerLocked=false;updateInputShape();pet.webContents.send('desktop-event',{type:'input-cancel'});});
    pet.once('ready-to-show',()=>{showPet();layoutTools();broadcastScale();});
    pet.webContents.once('did-finish-load',()=>{if(pet&&!pet.isDestroyed()&&!pet.isVisible())showPet();});
    setTimeout(()=>{if(pet&&!pet.isDestroyed()&&!pet.isVisible())showPet();},1200).unref?.();
    toggle.once('ready-to-show',()=>{layoutTools();toggle.showInactive();toggle.setAlwaysOnTop(true,'screen-saver');});
    toggle.webContents.on('did-start-loading',()=>{if(toggleGesture)finishToggleDrag('cancel');});
    toggle.webContents.on('render-process-gone',()=>{if(toggleGesture)finishToggleDrag('cancel');});
    toggle.on('hide',()=>{if(toggleGesture)finishToggleDrag('cancel');});
    for(const win of [toggle,chat]){
      win.once('ready-to-show',()=>{win.setAlwaysOnTop(true,'screen-saver');updateInputShape();});
      for(const name of ['show','hide','move','resize'])win.on(name,updateInputShape);
    }
    pet.on('show',()=>{
      syncPetTopmost();shapeKey='';updateInputShape();
    });
    for(const win of [pet,chat,toggle]){
      win.on('focus',syncPetTopmost);
      win.on('blur',syncPetTopmost);
    }
    app.on('browser-window-focus',syncPetTopmost);
    app.on('browser-window-blur',syncPetTopmost);
    const topmostTimer=setInterval(syncPetTopmost,500);
    topmostTimer.unref?.();
    chat.on('close',event=>{if(!quitting){event.preventDefault();chat.hide();}});
    chat.on('blur',()=>{if(!quitting)updateInputShape();});
    chat.on('move',rememberChatPlacement);
    pet.on('move',()=>{layoutTools();if(!resizingPet&&Date.now()-lastSaved>500){lastSaved=Date.now();saveConfig();}});
    pet.on('close',event=>{if(!quitting){event.preventDefault();pet.hide();}});
    const refreshDisplay=()=>{const display=screen.getAllDisplays().find(item=>item.id===config.petDisplayId)||screen.getPrimaryDisplay();petWorkArea={...display.workArea};config.petDisplayId=display.id;commitPlacement(restorePetPlacement(config,petWorkArea));layoutTools({recoverChat:true});saveConfig();};
    screen.on('display-metrics-changed',refreshDisplay);screen.on('display-removed',refreshDisplay);
    tray=new Tray(icon());tray.setToolTip('大肥鱼 · DeepSeek-chan');
    tray.setContextMenu(Menu.buildFromTemplate([{label:'打开聊天   Ctrl+Alt+Space',click:showChat},{label:'显示桌宠',click:showPet},{label:'移动桌宠',click:()=>setDragMode(!dragMode)},{label:'恢复位置',click:resetPosition},{label:'悬浮球跟随桌宠',click:followToggle},{label:'停止说话和动作',click:()=>service.dispatch({type:'stop'})},{type:'separator'},{label:'退出大肥鱼',click:()=>app.quit()}]));
    tray.on('double-click',showChat);registerKeys();
    initializeMouseTracking();
    if(process.env.COMPANION_SHOW_CHAT==='1'||setupRequired)chat.once('ready-to-show',()=>chat.show());
  }).catch(error=>{console.error(error);dialog.showErrorBox('大肥鱼启动失败',String(error.message||error));app.quit();});
}
ipcMain.handle('bootstrap',event=>{const role=roles.get(event.sender.id);if(!role)throw new Error('未知窗口');return{url:service.url,token:service.token,role,petScale:petScaleState(),togglePlacement:togglePlacement(),basinEnabled:config.basinEnabled===true,glassesEnabled:config.glassesEnabled===true,glassesStyle:config.glassesStyle==='monocle'?'monocle':'black',smallFormEnabled:config.smallFormEnabled===true,petPinned:config.petPinned===true,setupRequired,modelTuning:config.modelTuning};});
ipcMain.handle('window-control',async(event,action,data)=>{
  if(!roles.has(event.sender.id))throw new Error('未知窗口');
  switch(action){
    case 'toggle-chat':showChat();break;
    case 'toggle-menu':if(roles.get(event.sender.id)!=='toggle')throw new Error('仅悬浮球可以打开自身菜单');showToggleMenu();break;
    case 'toggle-drag':if(roles.get(event.sender.id)!=='toggle')throw new Error('仅悬浮球可以移动自身');return dragToggle(data);
    case 'toggle-follow':return followToggle();
    case 'hide-chat':case 'minimize':chat.hide();break;
    case 'hide-pet':pet.hide();break;
    case 'show-pet':showPet();break;
    case 'drag-mode':setDragMode(typeof data==='boolean'?data:!dragMode);return dragMode;
    case 'pet-hit-regions':{
      if(roles.get(event.sender.id)!=='pet')throw new Error('仅桌宠可以更新命中区域');
      const legacy=Array.isArray(data);if(!legacy&&data?.revision!==placementRevision)return{accepted:false,revision:placementRevision};
      inputRegions=(legacy?data:Array.isArray(data?.regions)?data.regions:[]).filter(validRect).slice(0,8);
      const body=legacy?inputRegions[0]:data.body;
      fullBodyRegion=validRect(data?.fullBody)?data.fullBody:validRect(body)?body:null;
      const bounds=pet.getBounds();bodyRegion=validRect(body)?clipRegion(body,bounds.width,bounds.height):null;geometrySeen=true;
      toolAnchor.update(bodyRegion,placementRevision);
      layoutTools();return{accepted:true,revision:placementRevision};
    }
    case 'pet-pointer-lock':if(roles.get(event.sender.id)!=='pet')throw new Error('仅桌宠可以捕获指针');return petPointer.control(data);
    case 'pet-input-mode':petPointer.clear();config.clickThrough=data===true;saveConfig();updateInputShape();pet.webContents.send('desktop-event',{type:'input-mode',clickThrough:config.clickThrough});return config.clickThrough;
    case 'pet-runtime-error':if(roles.get(event.sender.id)==='pet')chat.webContents.send('desktop-event',{type:'runtime-error',message:String(data).slice(0,600)});break;
    case 'mouse-tracking':config.mouseTracking=data!==false;saveConfig();suppressTracking();return config.mouseTracking;
    case 'basin-enabled':config.basinEnabled=data===true;saveConfig();for(const win of [pet,chat])if(win&&!win.isDestroyed())win.webContents.send('desktop-event',{type:'basin-enabled',enabled:config.basinEnabled});return config.basinEnabled;
    case 'pet-pin':{
      const next = data === true;
      // Show once when pinning turns on; a later manual hide must stay hidden.
      if (next && !petPinned) showPet();
      petPinned = next;config.petPinned = next;saveConfig();syncPetTopmost();
      for (const win of [pet, chat]) if (win && !win.isDestroyed()) win.webContents.send('desktop-event', { type: 'pet-pin', enabled: petPinned });
      return petPinned;
    }
    case 'glasses-enabled':config.glassesEnabled=data===true;saveConfig();for(const win of [pet,chat])if(win&&!win.isDestroyed())win.webContents.send('desktop-event',{type:'glasses',enabled:config.glassesEnabled,style:config.glassesStyle==='monocle'?'monocle':'black'});return {enabled:config.glassesEnabled,style:config.glassesStyle==='monocle'?'monocle':'black'};
    case 'glasses-style':config.glassesStyle=data==='monocle'?'monocle':'black';saveConfig();for(const win of [pet,chat])if(win&&!win.isDestroyed())win.webContents.send('desktop-event',{type:'glasses',enabled:config.glassesEnabled===true,style:config.glassesStyle});return config.glassesStyle;
    case 'small-form-enabled':config.smallFormEnabled=data===true;saveConfig();for(const win of [pet,chat])if(win&&!win.isDestroyed())win.webContents.send('desktop-event',{type:'small-form',enabled:config.smallFormEnabled});return config.smallFormEnabled;
    case 'model-tuning':config.modelTuning=sanitizeModelTuning(data,config.modelTuning);saveConfig();for(const win of [pet,chat,toggle])if(win&&!win.isDestroyed())win.webContents.send('desktop-event',{type:'model-tuning',tuning:config.modelTuning});return config.modelTuning;
    case 'chest-reaction':if(![1,2,3,4].includes(data))throw new Error('点击反应不存在');if(pet&&!pet.isDestroyed())pet.webContents.send('desktop-event',{type:'chest-preview',stage:data});return true;
    case 'suspend-tracking':if(roles.get(event.sender.id)==='pet')suppressTracking();break;
    case 'move-pet':{if(data&&Number.isFinite(data.dx)&&Number.isFinite(data.dy)){const current=petScaleState();const footprint=fullBodyRegion?{...fullBodyRegion,x:fullBodyRegion.x+current.bounds.x-current.position.x,y:fullBodyRegion.y+current.bounds.y-current.position.y}:undefined;const position=constrainPosition({x:current.position.x+Math.max(-2000,Math.min(2000,data.dx)),y:current.position.y+Math.max(-2000,Math.min(2000,data.dy))},petWorkArea,current.scale,footprint);return commitPlacement(createPetPlacement({area:petWorkArea,scale:current.scale,position}));}break;}
    case 'resize-pet':{if(data&&typeof data==='object'&&'factor'in data){if(roles.get(event.sender.id)!=='pet')throw new Error('仅桌宠可以使用滚轮缩放');if(!dragMode)return petScaleState();}return resizePet(data);}
    case 'choose-model':{const result=await dialog.showOpenDialog(chat,{title:'选择包含 .model3.json 的模型文件夹',properties:['openDirectory']});if(result.canceled)return null;const folder=result.filePaths[0];if(!fs.readdirSync(folder).some(f=>f.endsWith('.model3.json')))throw new Error('这个文件夹中没有 .model3.json');config.modelRoot=folder;fullBodyRegion=null;delete config.petFootprint;saveConfig();if(service.setModelRoot)await service.setModelRoot(folder);else {app.relaunch();app.quit();}pet.webContents.reload();return folder;}
    case 'open-extension':await shell.openPath(path.join(ROOT,'extension'));break;
    case 'open-url':openSafe(data);break;
    case 'copy-pairing':clipboard.writeText(service.token);return true;
    case 'copy-text':clipboard.writeText(String(data||''));return true;
    case 'setup-complete':config.setupCompleted=true;config.firstRun=false;setupRequired=false;saveConfig();return true;
    case 'dsh-status':{const info=await dshConnect.detectDsh(config);const launcher=path.join(dataDir,'dsh','start-dsh.cmd');return{...info,bridgeConnected:info.running&&service.getState().dsh?.connected===true,chatAvailable:info.running&&service.getState().dsh?.chatAvailable===true,sessions:dshConnect.listSessions(info.home),patchPath:path.join(dataDir,'dsh','live2d.patch.yml'),launcherPath:fs.existsSync(launcher)?launcher:'',logPath:path.join(dataDir,'logs','dsh.log'),mode:config.dshMode||'',savedSessionId:config.dshSessionId||''};}
    case 'dsh-sessions':{const info=await dshConnect.detectDsh(config);return dshConnect.listSessions(info.home);}
    case 'dsh-prompt':return bridgePrompt(data||{});
    case 'dsh-connect':return await connectDsh(data||{});
    case 'dsh-open':{const port=Number(config.dshPort)||dshConnect.DEFAULT_PORT;await shell.openExternal(`http://127.0.0.1:${port}/`);return true;}
    case 'dsh-open-launcher':{const launcher=path.join(dataDir,'dsh','start-dsh.cmd');if(!fs.existsSync(launcher))throw new Error('还没有生成手动启动脚本，请先点一次“连接 DSH”。');shell.showItemInFolder(launcher);return launcher;}
    case 'reset-position':resetPosition();break;
    case 'diagnostics':return {dataDir,hotkeyConflicts:failures,modelRoot:config.modelRoot||DEFAULT_MODEL,clickThrough:config.clickThrough===true,dragMode,pointerSession:petPointer.state(),petScale:petScaleState(),togglePlacement:togglePlacement(),basinEnabled:config.basinEnabled===true,glassesEnabled:config.glassesEnabled===true,glassesStyle:config.glassesStyle==='monocle'?'monocle':'black',smallFormEnabled:config.smallFormEnabled===true,petPinned:petPinned===true,modelTuning:config.modelTuning,mouseTracking:config.mouseTracking!==false,mouseInputError};
    case 'quit':app.quit();break;
    default:throw new Error('不支持的操作');
  }
  return true;
});
app.on('before-quit',()=>{quitting=true;petPointer.clear();toggleGesture?.session.stop('quit');toggleGesture=null;clearTimeout(toggleShapeTimer);clearTimeout(scaleSaveTimer);clearTimeout(chatSaveTimer);clearInterval(trackingTimer);mouseInput?.stop();try{saveConfig();}catch{};globalShortcut.unregisterAll();service?.close();});
app.on('window-all-closed',()=>{if(quitting)app.quit();});
