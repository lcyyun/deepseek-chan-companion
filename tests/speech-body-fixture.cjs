// Real React presentation, BehaviorController and both timelines. Only model,
// network and audio devices are replaced. This fixture cannot access a profile,
// make an API/TTS call or display an interactive window.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..'), directory = path.resolve(process.argv[2]);
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration();
let win;
const output = path.join(directory, 'result.json');
const report = { hardwareAcceleration: false, realReactAndBehavior: true, cases: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const stubs = {
  './api': `export const credentials=()=>window.__qa.boot;export const initialize=async()=>credentials();
export const api=async(path,value)=>{window.__qa.requests.push({path,value});return path==='/api/model-manifest'?{}:{voiceEnabled:window.__qa.voiceEnabled};};
export const events=callback=>{window.__qa.service.add(callback);return()=>window.__qa.service.delete(callback);};`,
  './live2d': `export async function createLive2D(canvas,options){
const q=window.__qa;let elapsed=0;
const runtime={setParameters:p=>Object.assign(q.params,p),getParameters:()=>[],
getInteractionRegions:()=>({body:{x:100,y:40,width:400,height:500},fullBody:{x:100,y:40,width:400,height:500},head:{x:200,y:70,width:200,height:140},revision:0}),
setPlacement(){},setView(){},setModelTuning(){},setPoseOverlay(p,w){q.pose={parameters:p,weight:w};},setPupilScale(){},setHandForeground(){},setCuddleHand(){},setImpactOverlay(){},setEarImpulse(){},setFaceOverlay(p){q.face=p;},
playMotion:async(name)=>{q.motions.push(name);},stopMotion(){},setExpression:async()=>{},reset(){},destroy(){}};
q.advance=(frames=1)=>{for(let i=0;i<frames;i++){elapsed+=1/60;options.onFrame?.(1/60,elapsed);}};
q.runtime=runtime;return runtime;}`, 
  './audio': `export class SpeechPlayer {
constructor(){window.__qa.player=this;}
level(){return window.__qa.audioActive?.3:0;}
stop(){const q=window.__qa;q.stops++;q.audioActive=false;if(this.current){this.current.stopped=true;if(!q.deferStops)this.current.resolve();this.current=null;}}
destroy(){this.stop();}
speak(text,start,progress){const q=window.__qa;return new Promise((resolve,reject)=>{const row={text,start,progress,resolve,reject,stopped:false};q.audio.push(row);this.current=row;});}
}`,
  './basin-audio': `export class BasinSound{setVolume(){}setSound(){}stop(){}destroy(){}async play(){}}`,
  './behavior': `import {BehaviorController as Real} from ${JSON.stringify(path.join(root, 'src/shared/behavior.mjs').replaceAll('\\','/'))};
export class BehaviorController extends Real{
constructor(...args){super(...args);window.__qa.behavior=this;}
setSpeechGesture(cue){window.__qa.samples.push(cue&&{...cue});super.setSpeechGesture(cue);}
clearSpeechGesture(){window.__qa.clears++;super.clearSpeechGesture();}
setExpressionCue(emotion,intensity){window.__qa.faces.push({emotion,intensity});super.setExpressionCue(emotion,intensity);}
applyCommand(command){window.__qa.commands.push({...command});super.applyCommand(command);}
}`,
};
const setup = `
window.__qa={boot:{url:'http://fixture.invalid',token:'fixture',role:'pet'},voiceEnabled:true,service:new Set(),desktop:new Set(),params:{},face:{},pose:{},audio:[],audioActive:false,deferStops:false,requests:[],commands:[],motions:[],samples:[],faces:[],clears:0,stops:0,errors:[]};
const q=window.__qa;
window.companion={bootstrap:async()=>q.boot,control:async()=>({dragMode:false}),onEvent:callback=>{q.desktop.add(callback);return()=>q.desktop.delete(callback);}};
q.emit=event=>{for(const callback of q.service)callback(event);};
q.start=(index,duration=8)=>{const row=q.audio[index];row.duration=duration;q.audioActive=true;row.start?.();row.progress?.({elapsed:0,duration,ratio:0});};
q.progress=(index,elapsed,duration=q.audio[index].duration)=>{q.audio[index].progress?.({elapsed,duration,ratio:elapsed/duration});};
q.finish=index=>{const row=q.audio[index];q.audioActive=false;if(q.player.current===row)q.player.current=null;row.progress?.({elapsed:row.duration,duration:row.duration,ratio:1});row.resolve();};
window.addEventListener('error',event=>{q.errors.push(event.message);event.preventDefault();});
window.fetch=()=>{throw new Error('Unexpected network request in isolated speech fixture');};
`;

async function evaluate(code) { return win.webContents.executeJavaScript(code); }
async function until(code, timeout = 2500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(code)) return; await delay(15); }
  throw Error('Expected renderer state: ' + code + '\nState: ' + JSON.stringify(await evaluate('({faces:__qa.faces,samples:__qa.samples.slice(-3),state:__qa.behavior.state,errors:__qa.errors})')));
}
async function fresh() {
  await win.loadFile(path.join(directory, 'index.html'));
  await until('!!window.__qa.behavior && !document.querySelector(".model-status")');
}
async function check(name, task) {
  await fresh();
  try { await task(); assert.deepEqual(await evaluate('__qa.errors'), []); report.cases.push({ name, ok: true }); }
  catch (error) { report.cases.push({ name, ok: false, error: String(error.stack || error), browserErrors: await evaluate('__qa.errors') }); }
}
const segment = (extra = {}) => ({ text: '我们先把这个问题分开，再仔细看一看其中的重点。', intent: 'explain', gesture: 'pointer', emotion: 'puzzled',
  expressionCues: [{ at: 0, emotion: 'puzzled', intensity: .6 }, { at: .5, emotion: 'happy', intensity: .7 }], ...extra });
async function reply(id, segments = [segment()]) { await evaluate(`__qa.emit(${JSON.stringify({ type: 'chat', reply: { id, segments } })})`); }
async function command(value) { await evaluate(`__qa.emit(${JSON.stringify({ type: 'command', command: value })})`); }

(async () => {
  await build({ entryPoints: [path.join(root, 'src/renderer/main.tsx')], bundle: true, format: 'iife', platform: 'browser', outfile: path.join(directory, 'app.js'),
    define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
    plugins: [{ name: 'speech-boundaries', setup(builder) {
      builder.onResolve({ filter: /^\.\/(api|live2d|audio|basin-audio|behavior)$/ }, args =>
        args.resolveDir === path.join(root, 'src/renderer') ? { path: args.path, namespace: 'speech-stub' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'speech-stub' }, args => ({ contents: stubs[args.path], loader: 'js', resolveDir: root }));
    } }],
  });
  await fs.writeFile(path.join(directory, 'index.html'), `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script>${setup}</script><script src="app.js"></script>`);
  await app.whenReady();
  win = new BrowserWindow({ width: 800, height: 650, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  report.windowVisible = win.isVisible();

  await check('voice begins the body score only at audio playback and paused progress stays still', async () => {
    await reply('audio-clock'); await until('__qa.audio.length===1');
    assert.equal(await evaluate('__qa.samples.length'), 0, 'network/decoding delay must not begin a gesture');
    await evaluate('__qa.start(0,8);__qa.advance(20)');
    assert.equal(await evaluate('__qa.behavior.state'), 'speaking');
    assert.equal(await evaluate('__qa.behavior.expressionCue.emotion'), 'puzzled');
    await evaluate('__qa.progress(0,1,8);__qa.advance(30)');
    const before = await evaluate('({key:__qa.behavior.speechGesture.key,progress:__qa.behavior.speechGesture.progress,samples:__qa.samples.length})');
    await evaluate('__qa.advance(120)');
    assert.deepEqual(await evaluate('({key:__qa.behavior.speechGesture.key,progress:__qa.behavior.speechGesture.progress,samples:__qa.samples.length})'), before);
    await evaluate('__qa.progress(0,4,8);__qa.advance(20)');
    assert.equal(await evaluate('__qa.behavior.expressionCue.emotion'), 'happy');
    assert.ok(await evaluate('__qa.params.ParamMouthOpenY>0'), 'real behavior still uses the audio mouth lane');
    assert.equal(await evaluate('__qa.commands.some(c=>c.type==="perform")'), false, 'speech must not restart legacy compound performances');
  });

  await check('short actual audio keeps the face but skips a full hand animation', async () => {
    await reply('short-audio'); await until('__qa.audio.length===1');
    await evaluate('__qa.start(0,1.5);__qa.progress(0,.5,1.5);__qa.advance(20)');
    assert.equal(await evaluate('__qa.samples.length'), 0);
    assert.equal(await evaluate('__qa.motions.length'), 0);
    assert.equal(await evaluate('__qa.behavior.expressionCue.emotion'), 'puzzled');
    await evaluate('__qa.finish(0)'); await until('__qa.behavior.state==="idle"');
    assert.equal(await evaluate('__qa.behavior.speechGesture'), null);
  });

  await check('silent reading advances body and face without contacting an audio device', async () => {
    await evaluate('__qa.voiceEnabled=false');
    await reply('silent', [segment({ text: '我们先把这里的情况完整地看一遍，然后再决定下一步具体应该怎么调整。', gesture: 'none' })]);
    await until('__qa.samples.length>=2');
    assert.equal(await evaluate('__qa.audio.length'), 0);
    assert.equal(await evaluate('__qa.behavior.state'), 'idle');
    assert.ok(await evaluate('__qa.samples.at(-1).progress>0'));
    await until('__qa.faces.some(f=>f.emotion==="happy")', 4500);
    await until('__qa.behavior.speechGesture===null', 3500);
    assert.equal(await evaluate('__qa.requests.some(r=>r.path==="/api/tts")'), false);
  });

  await check('consecutive matching spoken gestures keep the raised arm across the segment boundary', async () => {
    await reply('two-segments', [segment(), segment({ text: '所以接下来我们把这一步处理好，就能继续往下做了。' })]);
    await until('__qa.audio.length===1');
    await evaluate('__qa.start(0,8);__qa.progress(0,2,8);__qa.advance(30);__qa.progress(0,7.9,8)');
    const clears = await evaluate('__qa.clears');
    assert.equal(await evaluate('__qa.behavior.speechGesture.progress'), .72);
    await evaluate('__qa.finish(0)'); await until('__qa.audio.length===2');
    assert.equal(await evaluate('__qa.clears'), clears, 'normal boundary must not clear the held gesture');
    await evaluate('__qa.start(1,8);__qa.advance(20)');
    assert.equal(await evaluate('__qa.behavior.speechGesture.progress'), .28);
    assert.deepEqual(await evaluate('__qa.motions'), ['竖手指切出来动画']);
    await evaluate('__qa.finish(1)'); await until('__qa.behavior.speechGesture===null');
    assert.equal(await evaluate('__qa.motions.filter(m=>m==="竖手指切回默认").length'), 1);
  });

  await check('a stopped old audio promise and its late progress cannot clear a new reply', async () => {
    await evaluate('__qa.deferStops=true');
    await reply('old'); await until('__qa.audio.length===1'); await evaluate('__qa.start(0,8);__qa.progress(0,1,8)');
    await reply('new', [segment({ intent: 'reassure', gesture: 'chest', emotion: 'gentle', expressionCues: [{ at: 0, emotion: 'gentle', intensity: .6 }] })]);
    await until('__qa.audio.length===2'); await evaluate('__qa.start(1,8);__qa.progress(1,1,8)');
    const state = await evaluate('({key:__qa.behavior.speechGesture.key,id:__qa.behavior.speechGesture.id,clears:__qa.clears,faces:__qa.faces.length,samples:__qa.samples.length})');
    await evaluate('__qa.progress(0,7,8);__qa.audio[0].resolve()'); await delay(40);
    assert.deepEqual(await evaluate('({key:__qa.behavior.speechGesture.key,id:__qa.behavior.speechGesture.id,clears:__qa.clears,faces:__qa.faces.length,samples:__qa.samples.length})'), state);
    assert.equal(await evaluate('__qa.behavior.expressionCue.emotion'), 'gentle');
    await command({ type: 'stop' });
    assert.equal(await evaluate('__qa.behavior.speechGesture'), null);
    const afterStop = await evaluate('__qa.samples.length');
    await evaluate('__qa.progress(1,2,8);__qa.audio[1].resolve()'); await delay(25);
    assert.equal(await evaluate('__qa.samples.length'), afterStop);
  });

  await check('independent expression commands neither start nor cancel a body preview', async () => {
    await command({ type: 'expression', emotion: 'happy', durationMs: 20000 });
    await evaluate('__qa.advance(20)');
    assert.equal(await evaluate('__qa.motions.length'), 0);
    await command({ type: 'body', animation: 'reassure', durationMs: 5000 });
    await evaluate('__qa.advance(20)');
    const body = await evaluate('({...__qa.behavior.bodyPreview})');
    const motions = await evaluate('__qa.motions.length');
    assert.equal(await evaluate('__qa.behavior.expressionPreview.emotion'), 'happy');
    await command({ type: 'expression', emotion: 'puzzled', durationMs: 20000 });
    assert.deepEqual(await evaluate('({...__qa.behavior.bodyPreview})'), body);
    assert.equal(await evaluate('__qa.motions.length'), motions);
    await command({ type: 'expression', active: false });
    assert.equal(await evaluate('__qa.behavior.expressionPreview'), null);
    assert.deepEqual(await evaluate('({...__qa.behavior.bodyPreview})'), body);
  });

  await check('a new reply releases an old expression preview before its spoken face begins', async () => {
    await command({ type: 'expression', emotion: 'angry', durationMs: 20000 });
    assert.equal(await evaluate('__qa.behavior.expressionPreview.emotion'), 'angry');
    await reply('after-face-preview', [segment({ emotion: 'gentle', expressionCues: [{ at: 0, emotion: 'gentle', intensity: .6 }] })]);
    await until('__qa.audio.length===1');
    assert.equal(await evaluate('__qa.behavior.expressionPreview'), null, 'pending audio must not leave the previous preview stuck on the face');
    await evaluate('__qa.start(0,8);__qa.advance(20)');
    assert.equal(await evaluate('__qa.behavior.expressionCue.emotion'), 'gentle');
    assert.equal(await evaluate('__qa.behavior.expressionPreview'), null);
  });

  await check('thinking completion hands off only its automatic idea, preserving later manual performances', async () => {
    await evaluate('__qa.emit({type:"state",state:"thinking",requestId:"thinking-test"})');
    assert.equal(await evaluate('__qa.behavior.state'), 'thinking');
    await reply('thinking-result');
    await until('__qa.behavior.action?.intent==="idea"');
    assert.equal(await evaluate('__qa.behavior.action.replyIntro'), true, 'the reply introduction must be explicitly marked internal');
    assert.equal(await evaluate('__qa.audio.length'), 0);
    await evaluate('__qa.advance(30)');
    await delay(200);
    assert.equal(await evaluate('__qa.audio.length'), 0, 'audio waits for the fixed idea lead-in');
    await until('__qa.audio.length===1', 3000);
    assert.equal(await evaluate('__qa.behavior.action?.intent'), 'idea');
    await evaluate('__qa.start(0,8);__qa.advance(5)');
    assert.equal(await evaluate('__qa.behavior.action'), null, 'first spoken cue may take over the automatic introduction');
    assert.equal(await evaluate('__qa.behavior.speechGesture.id'), 'explain');
    for (const [index, intent] of ['idea', 'reassure'].entries()) {
      const gesture = intent === 'idea' ? 'pointer' : 'chest';
      await command({ type: 'perform', intent, gesture, emotion: 'happy', durationMs: 6000 });
      await evaluate(`__qa.progress(0,${1 + index},8);__qa.advance(12)`);
      assert.equal(await evaluate('__qa.behavior.action.intent'), intent, `manual ${intent} must survive incoming speech progress`);
      assert.equal(await evaluate('__qa.behavior.action.replyIntro'), false);
      assert.equal(await evaluate('__qa.behavior.action.gesture'), gesture);
      assert.equal(await evaluate('__qa.behavior._bodyPerformance()'), null, 'automatic body score yields while a manual action owns the body');
    }
  });

  await fs.writeFile(output, JSON.stringify(report, null, 2));
  win.destroy(); app.exit(0);
})().catch(async error => {
  await fs.writeFile(output, JSON.stringify({ ...report, fatal: String(error.stack || error) }, null, 2));
  win?.destroy(); app.exit(1);
});
