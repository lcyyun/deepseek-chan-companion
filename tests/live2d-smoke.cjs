/* Run with: electron tests/live2d-smoke.cjs [absolute model directory]
 * Opens a hidden offscreen window and verifies the actual SDK/model rendering. */
const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'vendor', 'runtime-smoke');
const extended = process.argv.includes('--extended');
const modelRoot = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || process.env.L2D_MODEL_ROOT || path.join(root, 'models', 'DeepSeek'));
app.setPath('userData', path.join(output, 'electron-profile'));
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
let server, window;
const token = 'local-live2d-smoke';
const mime = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.html': 'text/html' };

(async () => {
  await fs.mkdir(output, { recursive: true });
  await build({ entryPoints: [path.join(root, 'src/renderer/live2d.ts')], outfile: path.join(output, 'live2d.js'), bundle: true, format: 'esm', platform: 'browser' });
  const actualIndex = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const cspMeta = actualIndex.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i)?.[0];
  if (!cspMeta) throw new Error('Actual index.html does not declare its CSP.');
  let realWav;
  if (extended) {
    const { systemSpeech } = await import(pathToFileURL(path.join(root, 'server/adapters.mjs')).href);
    const speech = await systemSpeech({ text: '你好，我是大肥鱼。这是一段测试语音。现在，说完了。' });
    realWav = speech.buffer;
    await fs.writeFile(path.join(output, 'speech.wav'), realWav);
    const source = `export {SpeechPlayer} from ${JSON.stringify(path.join(root,'src/renderer/audio.ts').replaceAll('\\','/'))};
      export {initialize} from ${JSON.stringify(path.join(root,'src/renderer/api.ts').replaceAll('\\','/'))};
      export {BehaviorController} from ${JSON.stringify(path.join(root,'src/shared/behavior.mjs').replaceAll('\\','/'))};`;
    await build({ stdin: { contents: source, loader: 'ts', resolveDir: root }, outfile: path.join(output, 'audio-harness.js'), bundle: true, format: 'esm', platform: 'browser' });
  }
  const files = await fs.readdir(modelRoot);
  const modelFile = files.find(name => name.endsWith('.model3.json'));
  if (!modelFile) throw new Error('No model3.json found.');
  const scan = async (folder, suffix) => (await fs.readdir(path.join(modelRoot, folder))).filter(file => file.endsWith(suffix))
    .map(file => ({ name: file.slice(0, -suffix.length), file: `${folder}/${file}` }));
  const manifest = { modelUrl: `/model/${encodeURIComponent(modelFile)}`, expressions: await scan('Exp3', '.exp3.json'), motions: await scan('Animation', '.motion3.json') };
  // Start Core from a genuine external page script, not executeJavaScript, so
  // Electron's test injection cannot accidentally bypass the production CSP.
  const entry = `import {createLive2D} from '/live2d.js';
    window.smokeErrors = []; window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective+': '+event.blockedURI));
    window.smokeReady = createLive2D(document.querySelector('canvas'), {
      // Isolate vowel/audio calibration; the production action test covers author IDLE.
      idleMotion: false,
      manifest: ${JSON.stringify(manifest)}, fetcher: url => fetch(url,{headers:{Authorization:'Bearer ${token}'}}),
      onFrame: (dt,elapsed) => { if(window.behavior && window.speaker){const level=window.speaker.level();window.behavior.setAudioLevel(level);window.behavior.update(dt,elapsed);
        if(window.audioSamples){const time=window.speaker.context?.currentTime||0;queueMicrotask(()=>{const p=window.avatar.getParameters();window.audioSamples.push({time,level,mouth:p.find(p=>p.id==='ParamMouthOpenY')?.value,jaw:p.find(p=>p.id==='JawOpen')?.value});});}}
      }, onError: error => window.smokeErrors.push(error.message)
    }).then(avatar => window.avatar=avatar).catch(error => {window.smokeErrors.push(error.message);throw error;});`;
  await fs.writeFile(path.join(output, 'smoke-entry.js'), entry);
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(`<html><head>${cspMeta}</head><body style="margin:0;background:transparent"><canvas style="width:900px;height:900px" id="avatar"></canvas><script type="module" src="/smoke-entry.js"></script></body></html>`); return; }
      if (url.pathname === '/api/tts' && extended) {
        if(request.headers.authorization !== `Bearer ${token}`) {response.writeHead(401).end();return;}
        response.writeHead(200,{'Content-Type':'audio/wav'});response.end(realWav);return;
      }
      if (url.pathname.startsWith('/model/') && request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401).end(); return; }
      let requested, allowedRoot;
      if (['/live2d.js','/smoke-entry.js','/audio-harness.js'].includes(url.pathname)) { requested = path.join(output, url.pathname.slice(1)); allowedRoot = output; }
      else if (url.pathname.startsWith('/vendor/')) { allowedRoot = path.join(root, 'public/vendor'); requested = path.resolve(allowedRoot, decodeURIComponent(url.pathname.slice(8))); }
      else if (url.pathname.startsWith('/model/')) { allowedRoot = modelRoot; requested = path.resolve(allowedRoot, decodeURIComponent(url.pathname.slice(7))); }
      else { response.writeHead(404).end(); return; }
      if (!requested.startsWith(allowedRoot + path.sep)) { response.writeHead(403).end(); return; }
      response.setHeader('Content-Type', mime[path.extname(requested)] || 'application/octet-stream');
      response.end(await fs.readFile(requested));
    } catch (error) { response.writeHead(500).end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await app.whenReady();
  window = new BrowserWindow({ width: 900, height: 900, show: false, transparent: true, frame: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true } });
  window.webContents.setAudioMuted(true);
  const errors = [];
  window.webContents.on('console-message', details => { if (details.level === 'error' || details.level === 3) errors.push(details.message); });
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
  const result = await window.webContents.executeJavaScript(`(async () => {
    await Promise.race([window.smokeReady,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Model startup timed out')),20000))]);
    await new Promise(resolve=>setTimeout(resolve, 1000));
    const parameters = avatar.getParameters();
    avatar.setParameters({AngleX: 15});
    await avatar.setExpression('加载',true);
    await new Promise(resolve=>setTimeout(resolve, 700));
    const key = avatar.getParameters().find(p=>p.id==='key8');
    if (!key || key.value < .9) throw new Error('Expression did not reach key8');
    await avatar.setExpression('加载',false);
    await avatar.playMotion('默认手切举手',{holdLastFrame:true});
    await new Promise(resolve=>setTimeout(resolve, 1700));
    const held = Object.fromEntries(avatar.getParameters().filter(p=>['Movement2','Param56'].includes(p.id)).map(p=>[p.id,p.value]));
    if (held.Movement2 < .99 || held.Param56 < .99) throw new Error('Motion did not retain its final pose: '+JSON.stringify(held));
    avatar.reset();
    await new Promise(resolve=>setTimeout(resolve, 600));
    return {parameterCount: parameters.length, expressionKey: key.value, heldMotionValues: held,
      resetKey: avatar.getParameters().find(p=>p.id==='key8')?.value, errors:window.smokeErrors, cspViolations:window.cspViolations};
  })()`);
  const snapshot = await window.webContents.capturePage();
  await fs.writeFile(path.join(output, 'model.png'), snapshot.toPNG());
  const rgba = snapshot.toBitmap();
  let visiblePixels = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 20) visiblePixels++;
  result.visiblePixels = visiblePixels;
  result.consoleErrors = errors;
  result.csp = cspMeta;
  if (extended) {
    const capturePose = async (name, values) => {
      const parameters = await window.webContents.executeJavaScript(`(async()=>{avatar.reset();avatar.setParameters(${JSON.stringify(values)});await new Promise(r=>setTimeout(r,500));return avatar.getParameters().filter(p=>['ParamA','ParamI','ParamU','ParamE','ParamO','ParamSilence','ParamMouthOpenY','JawOpen'].includes(p.id));})()`);
      const image = await window.webContents.capturePage();
      await fs.writeFile(path.join(output, `${name}.png`), image.toPNG());
      return { image, parameters };
    };
    const diff = (first, second) => {
      const a=first.toBitmap(),b=second.toBitmap(),{width,height}=first.getSize();
      let changed=0,mouthChanged=0,totalDelta=0,maxDelta=0;
      for(let p=0;p<a.length;p+=4){let delta=0;for(let c=0;c<4;c++)delta=Math.max(delta,Math.abs(a[p+c]-b[p+c]));if(delta>3){changed++;const x=(p/4)%width,y=Math.floor((p/4)/width);if(x>width*.43&&x<width*.55&&y>height*.175&&y<height*.235)mouthChanged++;}totalDelta+=delta;maxDelta=Math.max(maxDelta,delta);}
      return {changedPixels:changed,mouthChangedPixels:mouthChanged,meanMaxChannelDelta:totalDelta/(a.length/4),maxDelta};
    };
    const zero = {ParamA:0,ParamI:0,ParamU:0,ParamE:0,ParamO:0,ParamSilence:0,ParamMouthOpenY:0,JawOpen:0};
    const closed = await capturePose('mouth-closed',zero);
    const repeat = await capturePose('mouth-closed-repeat',zero);
    result.vowels = { baselineNoise:diff(closed.image,repeat.image), closed: {}, open: {} };
    for (const name of ['A','I','U','E','O']) {
      const pose=await capturePose(`vowel-${name}`,{...zero,[`Param${name}`]:1});
      result.vowels.closed[name]={...diff(closed.image,pose.image),parameters:pose.parameters};
    }
    const openValues = {...zero,ParamMouthOpenY:.75,JawOpen:.5};
    const open = await capturePose('mouth-open',openValues);
    result.vowels.mouthOpenPositiveControl=diff(closed.image,open.image);
    for (const name of ['A','I','U','E','O']) {
      const pose=await capturePose(`vowel-open-${name}`,{...openValues,[`Param${name}`]:1});
      result.vowels.open[name]={...diff(open.image,pose.image),parameters:pose.parameters};
    }
    result.audio=await window.webContents.executeJavaScript(`(async()=>{
      const {SpeechPlayer,BehaviorController,initialize}=await import('/audio-harness.js');
      sessionStorage.setItem('companion-token','${token}');await initialize();
      avatar.reset();window.behavior=new BehaviorController(avatar);window.speaker=new SpeechPlayer();window.audioSamples=[];
      behavior.setState('speaking');await speaker.speak('fixture audio');
      await new Promise(r=>setTimeout(r,900));
      const data={samples:audioSamples,peakLevel:Math.max(...audioSamples.map(s=>s.level)),peakMouth:Math.max(...audioSamples.map(s=>s.mouth)),finalMouth:audioSamples.at(-1).mouth,finalLevel:audioSamples.at(-1).level};
      speaker.destroy();behavior.destroy();window.speaker=null;window.behavior=null;return data;
    })()`);
    await fs.writeFile(path.join(output,'extended-result.json'),JSON.stringify(result,null,2));
    if(result.audio.peakMouth<.1||result.audio.peakLevel<.1||result.audio.finalMouth>.001||result.audio.finalLevel!==0)throw new Error(`Real WAV lipsync verification failed: ${JSON.stringify({...result.audio,samples:result.audio.samples.length})}`);
  }
  if (result.parameterCount < 10 || visiblePixels < 10000 || result.resetKey !== 0 || result.errors.length || result.cspViolations.length || errors.length) throw new Error(`Runtime verification failed: ${JSON.stringify(result)}`);
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ parameterCount: result.parameterCount, visiblePixels, expressionKey: result.expressionKey, resetKey: result.resetKey, screenshot: path.join(output, 'model.png') }));
  window.destroy(); server.close(); app.exit(0);
})().catch(error => { console.error(error); window?.destroy(); server?.close(); app.exit(1); });
