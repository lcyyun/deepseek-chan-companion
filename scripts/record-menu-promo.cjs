// Isolated production ball/native menu capture fixture. No real user profile.
// Run with Electron, then capture only this fixture's menu via computer-use.
const { app, BrowserWindow, dialog, screen, Menu } = require('electron');
const fs = require('node:fs'), path = require('node:path'), net = require('node:net');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'output/video014/menu-ui');
fs.mkdirSync(output, { recursive: true });
const profile = path.join(output, 'isolated-profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
fs.writeFileSync(path.join(profile, 'desktop.json'), JSON.stringify({ modelRoot:path.join(profile,'no-model'), mouseTracking:false }));
const verifyOnly=process.argv.includes('--verify-only'),menus=[];
const roles = new Map(), report = { menuLabels:[], errors:[], ownProfile:profile, quit:false };
let panel, started=false, timer;
require('../desktop/mouse-input.cjs').startMouseInput=({onButton})=>{onButton(false);return{ready:Promise.resolve(true),stop:()=>{report.helperStopped=true;}};};
const popup = Menu.prototype.popup;
Menu.prototype.popup = function(options) {
  menus.push(this);
  report.menuLabels.push(this.items.map(item=>item.label).filter(Boolean));
  fs.writeFileSync(path.join(output,'state.json'),JSON.stringify(report,null,2));
  if(verifyOnly)return;
  const bounds=panel.getBounds();
  return popup.call(this,{...options,x:bounds.x+440,y:bounds.y+185});
};
dialog.showErrorBox=(_title,message)=>{report.errors.push(message);fs.writeFileSync(path.join(output,'state.json'),JSON.stringify(report,null,2));app.exit(1);};
app.on('quit',()=>{report.quit=true;report.allWindowsDestroyed=[...roles.values()].every(win=>win.isDestroyed());fs.writeFileSync(path.join(output,'state.json'),JSON.stringify(report,null,2));});
app.on('browser-window-created',(_event,win)=>{
  if(started)return;
  const hide=win.hide.bind(win);
  win.show=()=>{};win.showInactive=()=>{};
  win.webContents.on('did-finish-load',async()=>{
    try{
      const role=await win.webContents.executeJavaScript('window.companion.bootstrap().then(x=>x.role)');
      roles.set(role,win);
      if(roles.size===3&&!started){started=true;await prepare();}
    }catch(error){report.errors.push(String(error));}
  });
});
async function prepare(){
  const area=screen.getPrimaryDisplay().workArea;
  const width=Math.min(960,area.width-80),height=Math.round(width*9/16),x=area.x+Math.round((area.width-width)/2),y=area.y+Math.round((area.height-height)/2);
  const pet=roles.get('pet'),ball=roles.get('toggle'),chat=roles.get('chat');
  pet.showInactive=()=>BrowserWindow.prototype.showInactive.call(pet);
  // Pet remains an actual visible app window underneath the clean capture panel,
  // so production menu correctly offers Hide. No user app is hidden or closed.
  BrowserWindow.prototype.showInactive.call(pet);
  panel=new BrowserWindow({x,y,width,height,frame:false,show:false,backgroundColor:'#f4f8f6',alwaysOnTop:true,skipTaskbar:true,webPreferences:{sandbox:true,contextIsolation:true}});
  panel.setTitle('大肥鱼 · 仅用于视频的菜单展示');
  await panel.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><html><body style="margin:0;background:#f4f8f6;height:100vh;display:grid;place-items:center;font-family:Microsoft YaHei"><div style="position:absolute;left:50px;top:44px;color:#5b7b9a;font-size:20px">悬浮球 · 快捷功能</div><div style="position:absolute;left:50px;bottom:32px;color:#8fa0af;font-size:15px">轻点聊天　·　右键打开快捷功能</div></body></html>'));
  panel.setAlwaysOnTop(true,'screen-saver');panel.show();panel.moveTop();
  const forced={x:x+330,y:y+200,width:58,height:58};
  const realBounds=ball.setBounds.bind(ball);
  ball.setBounds=()=>realBounds(forced);realBounds(forced);
  ball.setTitle('大肥鱼 · 视频菜单悬浮球');ball.setAlwaysOnTop(true,'screen-saver');
  BrowserWindow.prototype.showInactive.call(ball);ball.moveTop();
  report.panelBounds=panel.getBounds();report.ballBounds=ball.getBounds();
  report.windows=[...roles].map(([role,win])=>({role,title:win.getTitle()}));
  await new Promise(resolve=>setTimeout(resolve,400));
  await fs.promises.writeFile(path.join(output,'ball.png'),(await ball.webContents.capturePage()).toPNG());
  await fs.promises.writeFile(path.join(output,'clean-panel.png'),(await panel.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(output,'state.json'),JSON.stringify(report,null,2));
  await ball.webContents.executeJavaScript('document.querySelector(".orbit-switch").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,button:2}));void 0;');
  if(verifyOnly){
    const wait=async n=>{for(let i=0;i<60&&menus.length<n;i++)await new Promise(r=>setTimeout(r,25));if(menus.length<n)throw Error('Menu did not arrive');};
    await wait(1);menus.at(-1).items.find(item=>item.label==='暂时隐藏桌宠').click();
    report.hideCallback=!pet.isVisible();
    await ball.webContents.executeJavaScript('document.querySelector(".orbit-switch").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,button:2}));void 0;');
    await wait(2);menus.at(-1).items.find(item=>item.label==='显示桌宠').click();
    report.showCallback=pet.isVisible();
    report.exitCallback=true;
    menus.at(-1).items.find(item=>item.label==='退出大肥鱼').click();
    return;
  }
  timer=setTimeout(()=>app.quit(),300000);timer.unref();
}
const listener=net.createServer();listener.listen(0,'127.0.0.1',()=>{process.env.COMPANION_PORT=String(listener.address().port);listener.close(()=>require('../desktop/main.cjs'));});
