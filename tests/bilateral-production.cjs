// Hidden, isolated real-model calibration. Never uses the user's app/profile.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'vendor', 'bilateral-production');
fs.mkdirSync(output, { recursive: true });
let source = fs.readFileSync(path.join(__dirname, 'live2d-actions.cjs'), 'utf8');
source = source.replace("const root = path.resolve(__dirname, '..');", 'const root = '+JSON.stringify(root)+';')
  .replace(/const output = path\.join\(root, 'vendor', .*?\);/, 'const output = '+JSON.stringify(output)+';')
  .replace('(nativeInputOnly||effectsOnly||v5Only||physicsOnly||cuddleOnly||tuningOnly||expressionsOnly)?2048:4096', '2048')
  .replace('const qaRigIdentity=physics?._physicsRig;', '(window as any).qaHandsProbe=()=>({state:gestureHands, left:leftArmDrawables.size,right:replacedArmDrawables.size,pointer:pointerArmDrawables.size,chest:chestArmDrawables.size});const qaRigIdentity=physics?._physicsRig;');
const anchor = source.indexOf('  if(expressionsOnly){');
if (anchor < 0) throw Error('Production QA setup anchor changed');
source = source.slice(0, anchor);
source += String.raw`
  const assert = require('node:assert/strict');
  const js = code => win.webContents.executeJavaScript(code);
  const save = async name => {
    const data=await js('new Promise(resolve=>requestAnimationFrame(()=>resolve(document.querySelector("canvas").toDataURL("image/png"))))');
    const capture=nativeImage.createFromDataURL(data),bitmap=capture.toBitmap(),size=capture.getSize();let visible=0;
    for(let i=3;i<bitmap.length;i+=4)if(bitmap[i]>20)visible++;
    assert.ok(visible>10000,'Model disappeared: '+name);
    const visibleRegion=([x1,y1,x2,y2])=>{let count=0;for(let y=Math.floor(size.height*y1);y<size.height*y2;y++)for(let x=Math.floor(size.width*x1);x<size.width*x2;x++){const i=(y*size.width+x)*4;if(bitmap[i+3]>20&&Math.max(bitmap[i],bitmap[i+1],bitmap[i+2])>30)count++;}return count;};
    const regions={skirt:visibleRegion([.36,.46,.53,.55]),legs:visibleRegion([.34,.7,.55,.92])};
    assert.ok(regions.skirt>size.width*size.height*.007,'Skirt was lost in the arm render pass: '+name);
    assert.ok(regions.legs>size.width*size.height*.015,'Legs were lost in the arm render pass: '+name);
    await fs.writeFile(path.join(output,name+'.png'),Buffer.from(data.split(',')[1],'base64'));
    const state=await js('({probe:qaHandsProbe(),params:Object.fromEntries(qaRuntime.getParameters().filter(p=>/^(Param(36|39|40|41|42|43|59|60|61|62)|Movement[123])$/.test(p.id)).map(p=>[p.id,p.value])),invalid:qaRuntime.getParameters().filter(p=>!Number.isFinite(p.value)||p.value<p.min-.001||p.value>p.max+.001)})');
    assert.deepEqual(state.invalid,[]);return {name,regions,...state};
  };
  report.cases=[];
  const performanceOnly=process.argv.includes('--performance-only');
  if(!performanceOnly)for(const kind of ['chest','pointer'])for(const side of ['left','right','both']){
    await request('/api/command',{type:'reset'});await delay(500);
    await js('qaDirect=true;qaRuntime.setGestureHands('+JSON.stringify(kind)+','+JSON.stringify(side)+',true);qaRuntime.playMotion('+JSON.stringify(kind==='chest'?'默认手切举手':'竖手指切出来动画')+',{loop:false,holdLastFrame:true});void 0;');
    const pose=kind==='chest'?{Movement2:1,Param62:.034,Param59:.476,Param60:.82,Param61:.002}:{Movement3:1,Param40:1,Param36:.12,Param39:.322,Param41:.68,Param42:0,Param43:0};
    await delay(1400);await js('qaRuntime.setPoseOverlay('+JSON.stringify(pose)+',1)');await delay(400);
    report.cases.push(await save(kind+'-'+side));
    await js('qaRuntime.setPoseOverlay({},0);qaRuntime.setGestureHands(null,"left",false);qaRuntime.playMotion('+JSON.stringify(kind==='chest'?'举手切默认手':'竖手指切回默认')+',{loop:false,holdLastFrame:false});void 0;');
    await delay(600);report.cases.push(await save(kind+'-'+side+'-closing'));
    await delay(1300);report.cases.push(await save(kind+'-'+side+'-closed'));
    assert.equal((await js('qaHandsProbe()')).state,null);
  }
  // Small authored finger input candidates, inspected separately before use.
  if(!performanceOnly){await request('/api/command',{type:'reset'});await delay(400);
  await js('qaDirect=true;qaRuntime.playMotion("竖手指切出来动画",{loop:false,holdLastFrame:true});void 0;');await delay(1500);
  for(const value of [-.12,0,.08,.16]){
    await js('qaRuntime.setPoseOverlay({Movement3:1,Param40:1,Param36:.12,Param39:.322,Param41:.68,Param42:0,Param43:'+value+'},1)');await delay(180);
    report.cases.push(await save('finger-'+value));
  }
  }
  // Compare fixed wall-time samples, not clamped animation time, without another
  // QA renderer running concurrently. Hidden/offscreen FPS is diagnostic only.
  report.performance=[];
  for(const side of ['right','left','both']){
    await request('/api/command',{type:'reset'});await delay(200);
    await js('qaDirect=true;qaRuntime.setGestureHands("pointer",'+JSON.stringify(side)+',true);qaRuntime.playMotion("竖手指切出来动画",{loop:false,holdLastFrame:true});void 0;');await delay(1500);
    const sample=await js('new Promise(resolve=>{const times=[],start=performance.now();let previous=start;function frame(now){times.push(now-previous);previous=now;if(now-start>2000){times.sort((a,b)=>a-b);resolve({frames:times.length,mean:times.reduce((a,b)=>a+b,0)/times.length,p95:times[Math.floor(times.length*.95)],max:times.at(-1)});}else requestAnimationFrame(frame);}requestAnimationFrame(frame);})');
    report.performance.push({side,...sample});
  }
  await request('/api/command',{type:'reset'});
  assert.deepEqual(report.errors,[]);report.ok=true;
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:true,cases:report.cases.length,performance:report.performance,output}));
  win.destroy();await service.close();app.exit(0);
})().catch(async error=>{report.failure=String(error.stack||error);await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2)).catch(()=>{});console.error(error);try{win?.destroy();await service?.close();}finally{app.exit(1);}});
`;
const harness = path.join(output, 'harness.cjs'); fs.writeFileSync(harness, source); require(harness);
