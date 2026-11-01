// Hidden, isolated real-model calibration. Never uses the user's app/profile.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'vendor', 'bilateral-production');
fs.mkdirSync(output, { recursive: true });
let source = fs.readFileSync(path.join(__dirname, 'live2d-actions.cjs'), 'utf8');
source = source.replace("const root = path.resolve(__dirname, '..');", 'const root = '+JSON.stringify(root)+';')
  .replace(/const output = path\.join\(root, 'vendor', .*?\);/, 'const output = '+JSON.stringify(output)+';')
  .replace('(nativeInputOnly||effectsOnly||v5Only||physicsOnly||cuddleOnly||tuningOnly||expressionsOnly)?2048:4096', '2048')
  .replace(".replace('const handle: Live2DHandle = {'", ".replace('      mirroredInteractionVertices = [];', '      mirroredInteractionVertices = [];(window as any).qaCompositeFrame=null;').replace('for (const row of hidden) opacities[row.index] = 0;', 'for (const row of hidden) opacities[row.index] = 0;(window as any).qaCompositeFrame={owner:{...owner},hiddenLeaks:hidden.filter(row=>opacities[row.index]!==0).length,draws:[]};').replace('drawMirror.call(mirrorRenderer, model, row.index);', '(window as any).qaCompositeFrame?.draws.push({source:\"mirror\",index:row.index,opacity:opacities[row.index],order:orders[row.index]});drawMirror.call(mirrorRenderer, model, row.index);').replace('drawNative.call(renderer, m, index);', 'if(!renderer.isGeneratingMask() && opacities[index]>.001)(window as any).qaCompositeFrame?.draws.push({source:\"native\",index,opacity:opacities[index],order:orders[index]});drawNative.call(renderer, m, index);').replace('const handle: Live2DHandle = {'")
  .replace('const qaRigIdentity=physics?._physicsRig;', '(window as any).qaHandsProbe=()=>({state:gestureHands, left:leftArmDrawables.size,right:replacedArmDrawables.size,pointer:pointerArmDrawables.size,chest:chestArmDrawables.size});const qaRigIdentity=physics?._physicsRig;');
const anchor = source.indexOf('  if(expressionsOnly){');
if (anchor < 0) throw Error('Production QA setup anchor changed');
source = source.slice(0, anchor);
source += String.raw`
  const assert = require('node:assert/strict');
  const js = code => win.webContents.executeJavaScript(code);
  await js('window.qaCapture=()=>{const source=document.querySelector("canvas"),review=document.createElement("canvas");review.width=source.width;review.height=source.height;const context=review.getContext("2d");context.fillStyle="#f4f6fa";context.fillRect(0,0,review.width,review.height);context.drawImage(source,0,0);return{data:source.toDataURL("image/png"),review:review.toDataURL("image/png")};};void 0;');
  const save = async name => {
    const {data,review}=await js('new Promise(resolve=>requestAnimationFrame(()=>resolve(qaCapture())))');
    const capture=nativeImage.createFromDataURL(data),bitmap=capture.toBitmap(),size=capture.getSize();let visible=0;
    for(let i=3;i<bitmap.length;i+=4)if(bitmap[i]>20)visible++;
    assert.ok(visible>10000,'Model disappeared: '+name);
    const visibleRegion=([x1,y1,x2,y2])=>{let count=0;for(let y=Math.floor(size.height*y1);y<size.height*y2;y++)for(let x=Math.floor(size.width*x1);x<size.width*x2;x++){const i=(y*size.width+x)*4;if(bitmap[i+3]>20&&Math.max(bitmap[i],bitmap[i+1],bitmap[i+2])>30)count++;}return count;};
    const regions={skirt:visibleRegion([.36,.46,.53,.55]),legs:visibleRegion([.34,.7,.55,.92])};
    assert.ok(regions.skirt>size.width*size.height*.007,'Skirt was lost in the arm render pass: '+name);
    assert.ok(regions.legs>size.width*size.height*.015,'Legs were lost in the arm render pass: '+name);
    // Calibrated sleeve middles: the 0.12 all-behind pass left only 15-17%
    // dark cloth here because bright back hair covered the forearm. Correct
    // authored layering retains over 55%, including the elbow-to-cuff bridge.
    if(name==='chest-right'||name==='pointer-left'){
      const box=name==='chest-right'?[.30,.33,.38,.44]:[.59,.33,.67,.44];let cloth=0,total=0;
      for(let y=Math.floor(size.height*box[1]);y<size.height*box[3];y++)for(let x=Math.floor(size.width*box[0]);x<size.width*box[2];x++){
        const i=(y*size.width+x)*4,b=bitmap[i],g=bitmap[i+1],r=bitmap[i+2];total++;
        if(bitmap[i+3]>200&&b>r*1.05&&r<90&&g<100&&b<170)cloth++;
      }
      regions.restingSleeve={cloth,total,fraction:cloth/total};
      assert.ok(cloth/total>.4,'Default forearm is hidden behind the hair: '+name+' '+cloth+'/'+total);
    }
    await fs.writeFile(path.join(output,name+'.png'),Buffer.from(data.split(',')[1],'base64'));await fs.writeFile(path.join(output,name+'.review.png'),Buffer.from(review.split(',')[1],'base64'));
    const state=await js('({probe:qaHandsProbe(),params:Object.fromEntries(qaRuntime.getParameters().filter(p=>/^(Param(36|39|40|41|42|43|59|60|61|62)|Movement[123])$/.test(p.id)).map(p=>[p.id,p.value])),invalid:qaRuntime.getParameters().filter(p=>!Number.isFinite(p.value)||p.value<p.min-.001||p.value>p.max+.001)})');
    assert.deepEqual(state.invalid,[]);return {name,regions,...state};
  };
  report.cases=[];
  const performanceOnly=process.argv.includes('--performance-only');
  if(!performanceOnly)for(const kind of ['chest','pointer'])for(const side of (kind==='chest'?['left','right','both']:['left','right'])){
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
  if(!performanceOnly){
    // Use actual BehaviorController touch ownership, not direct pose setters.
    // Capture and audit every rendered layer during body -> sustained petting
    // -> release -> mirrored pointer, including rapid head-touch renewal.
    await js('qaDirect=false');await request('/api/command',{type:'reset'});await delay(300);
    await request('/api/command',{type:'body',animation:'chest-right',durationMs:12000,intensity:.8});await delay(1600);
    await js('qaBehavior.setPetting(true,{intensity:.85,x:0,y:0,newContact:true})');
    const transitions=await js('new Promise(resolve=>{const start=performance.now(),frames=[],images=[];let released=false,restarted=false,secondReleased=false,pointed=false,last=-Infinity;function frame(now){const age=(now-start)/1000;if(age>3.6&&!released){released=true;qaBehavior.setPetting(false);}if(age>3.8&&!restarted){restarted=true;qaBehavior.setPetting(true,{intensity:.85,newContact:true});}if(age>6.5&&!secondReleased){secondReleased=true;qaBehavior.setPetting(false);}if(age>7.8&&!pointed){pointed=true;qaBehavior.previewBodyAnimation("pointer-left",{durationMs:5000,intensity:.8});}const c=window.qaCompositeFrame;frames.push({age,gesture:qaBehavior.gesture,cuddle:qaArmProbe().presence,composite:c?{owner:c.owner,hiddenLeaks:c.hiddenLeaks,order:c.draws.map(d=>d.order),draws:c.draws}:null,parameters:Object.fromEntries(qaRuntime.getParameters().filter(p=>/^Movement[23]$/.test(p.id)).map(p=>[p.id,p.value]))});if(age-last>.3){last=age;images.push({age,...qaCapture()});}if(age>=11)resolve({frames,images});else requestAnimationFrame(frame);}requestAnimationFrame(frame);})');
    for(const frame of transitions.frames){
      if(frame.composite){
        assert.equal(frame.composite.hiddenLeaks,0,'A replaced native arm remained visible during touch handoff');
        assert.ok(frame.composite.order.every((order,i,array)=>!i||order>=array[i-1]),'Mirror paint broke authored layer order');
      }
      assert.ok(!(frame.cuddle>.01&&frame.parameters.Movement3>.5),'Cuddle and pointer hands overlapped');
    }
    assert.ok(transitions.frames.at(-1).parameters.Movement3>.9,'The post-touch mirrored pointer never opened');
    for(const image of transitions.images){const file='handoff-'+Math.round(image.age*1000)+'.png';await fs.writeFile(path.join(output,file),Buffer.from(image.data.split(',')[1],'base64'));await fs.writeFile(path.join(output,file.replace('.png','.review.png')),Buffer.from(image.review.split(',')[1],'base64'));image.file=file;delete image.data;delete image.review;}
    report.transitions=transitions;
    await request('/api/command',{type:'reset'});await delay(700);
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
  for(const side of ['right','left']){
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
