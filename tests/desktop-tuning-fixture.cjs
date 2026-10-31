// Real production main/preload IPC, isolated profile, never shows any window.
const {app,dialog}=require('electron');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const directory=process.argv[2],mode=process.argv[3];
if(!directory||!['update','reload'].includes(mode))throw Error('Missing fixture arguments');
app.setPath('userData',directory);
const windows=new Map();let running=false,timer;
const output=path.join(directory,`result-${mode}.json`);
function fail(error){fs.writeFileSync(output,JSON.stringify({ok:false,error:String(error?.stack||error)}));app.exit(1);}
dialog.showErrorBox=(_title,message)=>fail(new Error(message));
process.stdout?.on('error',()=>{});process.stderr?.on('error',()=>{});
app.on('browser-window-created',(_event,win)=>{
  win.show=()=>{};win.showInactive=()=>{};
  win.webContents.on('did-finish-load',async()=>{
    try{
      const role=await win.webContents.executeJavaScript('window.companion.bootstrap().then(value=>value.role)');
      await win.webContents.executeJavaScript('window.__tuningEvents=[];window.companion.onEvent(event=>{if(event.type==="model-tuning")window.__tuningEvents.push(event);});void 0;');
      windows.set(role,win);if(windows.size===3&&!running){running=true;await verify();}
    }catch(error){fail(error);}
  });
});
const invoke=(role,action,payload)=>windows.get(role).webContents.executeJavaScript(`window.companion.control(${JSON.stringify(action)},${JSON.stringify(payload)})`);
async function verify(){
  const {sanitizeModelTuning}=await import('../src/shared/model-tuning.mjs');
  const original=sanitizeModelTuning({bodyMotion:.8,blushStrength:-1});
  const first=sanitizeModelTuning({chestSoftness:1.75,knockVolume:.2,knockSound:'pipe'},original);
  const second=sanitizeModelTuning({chestSoftness:99,bodyMotion:-10,gazeStrength:'invalid',blushStrength:.25,basinShadow:null,unknown:55},first);
  const expected=mode==='update'?original:second;
  for(const win of windows.values()){
    const boot=await win.webContents.executeJavaScript('window.companion.bootstrap().then(({modelTuning})=>({modelTuning}))');
    assert.deepEqual(boot.modelTuning,expected);
  }
  assert.deepEqual((await invoke('chat','diagnostics',null)).modelTuning,expected);
  if(mode==='update'){
    assert.deepEqual(await invoke('chat','model-tuning',{chestSoftness:1.75,knockVolume:.2,knockSound:'pipe'}),first);
    assert.deepEqual(await invoke('chat','model-tuning',{chestSoftness:99,bodyMotion:-10,gazeStrength:'invalid',blushStrength:.25,basinShadow:null,unknown:55}),second);
    for(const win of windows.values()){
      const events=await win.webContents.executeJavaScript('new Promise((resolve,reject)=>{const deadline=Date.now()+5000;const timer=setInterval(()=>{if(window.__tuningEvents.length===2){clearInterval(timer);resolve(window.__tuningEvents);}else if(Date.now()>deadline){clearInterval(timer);reject(new Error("Missing tuning broadcast"));}},20);})');
      assert.deepEqual(events,[{type:'model-tuning',tuning:first},{type:'model-tuning',tuning:second}]);
    }
    assert.deepEqual((await invoke('pet','diagnostics',null)).modelTuning,second);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'desktop.json'),'utf8')).modelTuning,second);
  }
  assert.ok([...windows.values()].every(win=>!win.isVisible()));
  assert.equal((await invoke('pet','diagnostics',null)).modelTuning.knockSound,'pipe','the sound survives partial edits and restarting main');
  fs.writeFileSync(output,JSON.stringify({ok:true,mode,modelTuning:second,windowsHidden:true}));clearTimeout(timer);app.quit();
}
timer=setTimeout(()=>fail(new Error('Desktop IPC fixture timed out')),30000);
require('../desktop/main.cjs');
