// Isolated production renderer QA for the continuous talk arm. Never touches
// the user's profile/window; screenshots and parameter traces stay in vendor/.
// npx electron tests/talk-production.cjs [--baseline|--calibrate|--high-only]
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'vendor', 'talk-production', process.argv.includes('--baseline') ? 'baseline' : process.argv.includes('--calibrate') ? 'calibration' : process.argv.includes('--high-only') ? 'high-only' : 'candidate');
fs.mkdirSync(output, { recursive: true });
let source = fs.readFileSync(path.join(__dirname, 'live2d-actions.cjs'), 'utf8');
source = source.replace("const root = path.resolve(__dirname, '..');", 'const root = ' + JSON.stringify(root) + ';')
  .replace(/const output = path\.join\(root, 'vendor', .*?\);/, 'const output = ' + JSON.stringify(output) + ';')
  .replace('(nativeInputOnly||effectsOnly||v5Only||physicsOnly||cuddleOnly||tuningOnly||expressionsOnly)?2048:4096', '2048');
const anchor = source.indexOf('  if(expressionsOnly){');
if (anchor < 0) throw new Error('Production QA setup anchor changed');
source = source.slice(0, anchor);
source += String.raw`
  const assert = require('node:assert/strict');
  const js = code => win.webContents.executeJavaScript(code);
  const writeImage = async (name,data) => {
    const decoded=nativeImage.createFromDataURL(data), bitmap=decoded.toBitmap();
    let visible=0;for(let i=3;i<bitmap.length;i+=4)if(bitmap[i]>20)visible++;
    assert.ok(visible>10000,'The full model must remain visible: '+name);
    await fs.writeFile(path.join(output,name+'.png'),Buffer.from(data.split(',')[1],'base64'));
  };
  if(process.argv.includes('--calibrate')){
    const {sampleBodyAnimation}=await import(pathToFileURL(path.join(root,'src/shared/body-animation.mjs')).href);
    const offsets=sampleBodyAnimation('talk',1.1/12,1,{durationSeconds:12,elapsedSeconds:1.1}).armOffsets;
    const pose={Movement3:1,Param40:1,Param36:.12,Param39:.322,Param41:.68,Param42:0,Param43:0};
    const high=Object.fromEntries(Object.entries(pose).map(([id,value])=>[id,value+(offsets[id]||0)*1.5]));
    await request('/api/command',{type:'reset'});await delay(300);
    await js('qaDirect=true;qaRuntime.playMotion("竖手指切出来动画",{loop:false,holdLastFrame:true});void 0;');await delay(1400);
    for(const [name,change] of [['candidate',{}],['lower',{Param41:.775}],['less-wrist',{Param42:.03}],['outward-wrist',{Param42:-.03}],['less-finger',{Param43:-.055}],['balanced',{Param41:.775,Param42:.04,Param43:-.055}]]){
      await js('qaRuntime.setPoseOverlay('+JSON.stringify({...high,...change})+',1)');await delay(350);
      const data=await js('new Promise(resolve=>requestAnimationFrame(()=>{const c=document.querySelector("canvas"),review=document.createElement("canvas");review.width=800;review.height=800;const ctx=review.getContext("2d");ctx.fillStyle="#dce6f1";ctx.fillRect(0,0,800,800);ctx.drawImage(c,c.width*.22,c.height*.03,c.width*.68,c.height*.55,0,0,800,800);resolve(review.toDataURL("image/png"));}))');
      await writeImage(name,data);
    }
    win.destroy();await service.close();app.exit(0);return;
  }
  report.scenarios=[];
  for(const [name,amplitude] of (process.argv.includes('--high-only')?[['high',1.5]]:[['default',1],['high',1.5]])){
    await request('/api/command',{type:'reset'});await delay(900);
    await js('qaBehavior.setTuning({gestureAmplitude:'+amplitude+',bodyMotion:1.6,bodyFollow:1.5,idleActivity:0});void 0;');
    const record=await js('new Promise(resolve=>{const start=performance.now(),rows=[],images=[],invalid=[];const targets=[.7,1.1,1.45,1.85,2.25,2.6,2.95,3.2,4.35,5.85,8.15,10.1,11.6];function frame(now){const elapsed=Math.min(12,(now-start)/1000);qaBehavior.setSpeechGesture({id:"talk",gesture:"pointer",key:"talk-qa",durationMs:12000,progress:elapsed/12,elapsedSeconds:elapsed,continuous:true,intensity:1});const all=qaRuntime.getParameters(),selected=Object.fromEntries(all.filter(p=>/^(Param(36|39|40|41|42|43)|Movement[123]|Angle[XYZ]|Position[XYZ]|LeanInput)$/.test(p.id)).map(p=>[p.id,p.value]));rows.push({elapsed,values:selected});for(const p of all)if(!Number.isFinite(p.value)||p.value<p.min-.001||p.value>p.max+.001){if(invalid.length<10)invalid.push({elapsed,...p});}if(images.length<targets.length&&elapsed>=targets[images.length]){const c=document.querySelector("canvas"),review=document.createElement("canvas");review.width=800;review.height=800;const context=review.getContext("2d");context.fillStyle="#dce6f1";context.fillRect(0,0,800,800);context.drawImage(c,c.width*.22,c.height*.03,c.width*.68,c.height*.55,0,0,800,800);images.push({elapsed,data:c.toDataURL("image/png"),review:review.toDataURL("image/png")});}if(elapsed>=12){qaBehavior.clearSpeechGesture();resolve({rows,images,invalid});}else requestAnimationFrame(frame);}requestAnimationFrame(frame);})');
    assert.deepEqual(record.invalid,[],name+' parameter bounds');
    const spread=id=>Math.max(...record.rows.map(row=>row.values[id]))-Math.min(...record.rows.map(row=>row.values[id]));
    assert.ok(spread('Param41')>.04,name+' forearm must keep moving');
    for(const row of record.rows)assert.ok(row.values.Param43>=-.121&&row.values.Param43<=.161,'Finger left the visually calibrated interval');
    for(const [index,image] of record.images.entries()){
      const file=name+'-'+index+'-'+Math.round(image.elapsed*1000);
      await writeImage(file,image.data);await writeImage(file+'-review',image.review);
      image.file=file+'.png';delete image.data;delete image.review;
    }
    await delay(2200);
    assert.equal(await js('qaBehavior.gesture'),'none');
    assert.ok(await js('qaBehavior.poseWeight<.01'),'The talk overlay must finish releasing');
    await writeImage(name+'-released',await js('new Promise(resolve=>requestAnimationFrame(()=>resolve(document.querySelector("canvas").toDataURL("image/png"))))'));
    record.spread=Object.fromEntries(['Param36','Param39','Param41','Param42','Param43'].map(id=>[id,spread(id)]));
    const settled=record.rows.filter(row=>row.elapsed>2.5&&row.elapsed<11);
    record.settledRange=Object.fromEntries(['Param36','Param39','Param41','Param42','Param43'].map(id=>[id,{min:Math.min(...settled.map(row=>row.values[id])),max:Math.max(...settled.map(row=>row.values[id]))}]));
    report.scenarios.push({name,amplitude,...record});console.log(JSON.stringify({name,spread:record.spread}));
  }
  report.stress=[];
  for(const [name,x,y] of [['left-up',-1,-1],['right-up',1,-1],['left-down',-1,1],['right-down',1,1]]){
    await js('qaBehavior.setSpeechGesture({id:"talk",gesture:"pointer",key:"talk-stress",durationMs:12000,progress:1.1/12,elapsedSeconds:1.1,continuous:true,intensity:1});qaBehavior.setPointerTracking(true,{x:'+x+',y:'+y+',speed:0,travel:1});void 0;');
    await delay(1800);
    const image=await js('new Promise(resolve=>requestAnimationFrame(()=>{const c=document.querySelector("canvas"),review=document.createElement("canvas");review.width=800;review.height=800;const ctx=review.getContext("2d");ctx.fillStyle="#dce6f1";ctx.fillRect(0,0,800,800);ctx.drawImage(c,c.width*.22,c.height*.03,c.width*.68,c.height*.55,0,0,800,800);resolve(review.toDataURL("image/png"));}))');
    await writeImage('stress-'+name,image);
    report.stress.push({name,parameters:await js('Object.fromEntries(qaRuntime.getParameters().filter(p=>/^(Param(36|39|41|42|43)|Angle[XYZ])$/.test(p.id)).map(p=>[p.id,p.value]))')});
  }
  await js('qaBehavior.setPointerTracking(false);qaBehavior.clearSpeechGesture();void 0;');await delay(2000);
  assert.deepEqual(report.errors,[]);report.ok=true;
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:true,output}));
  win.destroy();await service.close();app.exit(0);
})().catch(async error=>{report.failure=String(error.stack||error);await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2)).catch(()=>{});console.error(error);try{win?.destroy();await service?.close();}finally{app.exit(1);}});
`;
const harness=path.join(output,'harness.cjs');fs.writeFileSync(harness,source);require(harness);
