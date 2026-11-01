// Real model QA, using the isolated production React/service harness. No user
// profile, active desktop windows, network provider, or native input is used.
// $env:L2D_MODEL_ROOT='E:\l2d project\DeepSeek免费公皮\DeepSeek'
// npx electron tests/body-production.cjs
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'vendor', 'body-production');
fs.mkdirSync(output, { recursive: true });
let source = fs.readFileSync(path.join(__dirname, 'live2d-actions.cjs'), 'utf8');
source = source.replace("const root = path.resolve(__dirname, '..');", 'const root = ' + JSON.stringify(root) + ';')
  .replace(/const output = path\.join\(root, 'vendor', .*?\);/, 'const output = ' + JSON.stringify(output) + ';')
  .replace('(nativeInputOnly||effectsOnly||v5Only||physicsOnly||cuddleOnly||tuningOnly||expressionsOnly)?2048:4096', '2048');
const anchor = source.indexOf('  if(expressionsOnly){');
if (anchor < 0) throw new Error('Isolated production harness setup anchor changed');
source = source.slice(0, anchor);
source += String.raw`
  const assert = require('node:assert/strict');
  const { BODY_ANIMATION_PRESETS } = await import(pathToFileURL(path.join(root, 'src/shared/behavior.mjs')).href);
  for (const id of ['explain','think','reassure','happy','shy','listen','chest-left','chest-right','chest-both','pointer-left','pointer-right','talk']) {
    assert.ok(BODY_ANIMATION_PRESETS.some(preset => preset.id === id), 'Missing production body preset: '+id);
  }
  await delay(350);
  const selectParams = /^(Angle[XYZ]|Position[XYZ]|LeanInput|ParamEyeBall[XY]|ParamBreath|Movement[123]|Param(36|39|40|41|42|43|59|60|61|62)|key[34567]|ParamMouthForm|ParamMouthOpenY|ParamBrow[LR]Y)$/;
  await win.webContents.executeJavaScript('window.qaMotionCalls=[];for(const method of ["playMotion","stopMotion"]){const original=qaRuntime[method].bind(qaRuntime);qaRuntime[method]=(...args)=>{qaMotionCalls.push({method,args,at:qaBehavior.time});return original(...args);};}void 0;');
  const inspect = () => win.webContents.executeJavaScript('({time:qaBehavior.time,gesture:qaBehavior.gesture,bodyPreview:qaBehavior.bodyPreview,poseWeight:qaBehavior.poseWeight,motionCalls:qaMotionCalls.length,parameters:Object.fromEntries(qaRuntime.getParameters().filter(p=>'+selectParams+'.test(p.id)).map(p=>[p.id,p.value]))})');
  const saveFrame = async name => {
    const data = await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>resolve(document.querySelector("canvas").toDataURL("image/png"))))');
    const image = nativeImage.createFromDataURL(data), bitmap = image.toBitmap();
    let visiblePixels = 0;
    for(let i=3;i<bitmap.length;i+=4)if(bitmap[i]>20)visiblePixels++;
    assert.ok(visiblePixels>10000, 'The model must remain visible: '+name);
    await fs.writeFile(path.join(output,name+'.png'), Buffer.from(data.split(',')[1], 'base64'));
    return {name,visiblePixels,size:image.getSize()};
  };
  const sample = seconds => win.webContents.executeJavaScript('new Promise(resolve=>{const start=qaBehavior.time,rows=[],images=[],invalid=[];let last=-Infinity;const targets=[.25,1.4,2.8,4.6,6.8];function frame(){const age=qaBehavior.time-start,all=qaRuntime.getParameters();if(age-last>=.075){last=age;const values=Object.fromEntries(all.filter(p=>'+selectParams+'.test(p.id)).map(p=>[p.id,p.value]));rows.push({age,values,gesture:qaBehavior.gesture,poseWeight:qaBehavior.poseWeight});for(const p of all)if(!Number.isFinite(p.value)||p.value<p.min-.001||p.value>p.max+.001){if(invalid.length<10)invalid.push({age,...p});}}if(images.length<targets.length&&age>=targets[images.length])images.push({age,data:document.querySelector("canvas").toDataURL("image/png")});if(age>='+seconds+')resolve({rows,images,invalid});else requestAnimationFrame(frame);}requestAnimationFrame(frame);})');
  const spread = (rows, key) => Math.max(...rows.map(row=>row.values[key]||0))-Math.min(...rows.map(row=>row.values[key]||0));
  report.body=[];
  for(const preset of BODY_ANIMATION_PRESETS){
    await request('/api/command',{type:'reset'});await delay(900);
    await request('/api/command',{type:'body',animation:preset.id,intensity:.8,durationMs:5600});
    const record=await sample(7.6);
    for(const [index,image] of record.images.entries()){
      const name=preset.id+'-'+index+'-'+Math.round(image.age*1000)+'.png';
      const capture=nativeImage.createFromDataURL(image.data),bitmap=capture.toBitmap(),size=capture.getSize();let visiblePixels=0;
      for(let pixel=3;pixel<bitmap.length;pixel+=4)if(bitmap[pixel]>20)visiblePixels++;
      assert.ok(visiblePixels>10000,preset.id+' disappeared during the animation');
      // A rendered arm or tail alone can pass the total-pixel check. Keep a
      // separate lower-body ROI so an accidental mask/pass leak cannot do so.
      let legPixels=0;
      for(let y=Math.floor(size.height*.7);y<size.height*.92;y++)for(let x=Math.floor(size.width*.34);x<size.width*.55;x++){
        const offset=(y*size.width+x)*4;
        if(bitmap[offset+3]>20&&Math.max(bitmap[offset],bitmap[offset+1],bitmap[offset+2])>30)legPixels++;
      }
      assert.ok(legPixels>size.width*size.height*.01,preset.id+' lost the legs during the arm pass');
      if(index===2&&(preset.id==='chest-right'||preset.id==='pointer-left')){
        const box=preset.id==='chest-right'?[.30,.33,.38,.44]:[.59,.33,.67,.44];let cloth=0,total=0;
        for(let y=Math.floor(size.height*box[1]);y<size.height*box[3];y++)for(let x=Math.floor(size.width*box[0]);x<size.width*box[2];x++){
          const offset=(y*size.width+x)*4,b=bitmap[offset],g=bitmap[offset+1],r=bitmap[offset+2];total++;
          if(bitmap[offset+3]>200&&b>r*1.05&&r<90&&g<100&&b<170)cloth++;
        }
        assert.ok(cloth/total>.35,preset.id+' lost the resting forearm behind the hair');
        image.restingForearmFraction=cloth/total;
      }
      await fs.writeFile(path.join(output,name),Buffer.from(image.data.split(',')[1],'base64'));
      image.file=name;image.visiblePixels=visiblePixels;delete image.data;
    }
    assert.deepEqual(record.invalid,[],preset.id+' exceeded real model parameter bounds');
    const motion={head:Math.max(...['AngleX','AngleY','AngleZ'].map(id=>spread(record.rows,id))),body:Math.max(...['PositionX','PositionY','PositionZ','LeanInput'].map(id=>spread(record.rows,id))),arm:Math.max(...['Param36','Param39','Param41','Param42','Param59','Param60','Param61','Param62'].map(id=>spread(record.rows,id)))};
    assert.ok(motion.head>.35 || motion.body>.25,preset.id+' did not produce visible body intent');
    assert.ok(record.rows.every(row=>Math.abs(row.values.ParamMouthForm)<.03&&Math.abs(row.values.key7)<.03&&Math.abs(row.values.ParamBrowLY)<.03),preset.id+' body-only preview changed the face');
    const final=await inspect();assert.equal(final.gesture,'none',preset.id+' kept a hand after ending');
    assert.ok(final.poseWeight<.02,preset.id+' left an arm overlay after ending');
    report.body.push({id:preset.id,motion,...record,final});
    console.log(JSON.stringify({body:preset.id,motion,frames:record.images.length}));
  }
  // Changing from the mirrored cuddle rig must complete its authored handoff
  // before a pointer hand enters; otherwise two right hands become visible.
  await request('/api/command',{type:'reset'});await delay(600);
  await request('/api/command',{type:'perform',intent:'cuddle',emotion:'happy',intensity:.85,durationMs:6000});await delay(1700);
  assert.ok(await win.webContents.executeJavaScript('qaArmProbe().presence>.9'),'Cuddle handoff fixture did not raise both arms');
  await request('/api/command',{type:'body',animation:'explain',intensity:.8,durationMs:6000});
  report.cuddleHandoff=await win.webContents.executeJavaScript('new Promise(resolve=>{const start=qaBehavior.time,rows=[];function frame(){const age=qaBehavior.time-start;rows.push({age,mirror:qaArmProbe().presence,pointer:qaRuntime.getParameters().find(p=>p.id==="Movement3").value});if(age>=3.2)resolve(rows);else requestAnimationFrame(frame);}requestAnimationFrame(frame);})');
  assert.ok(report.cuddleHandoff.every(row=>row.pointer<=.5||row.mirror<=.01),'Cuddle mirror overlapped the new pointer arm');
  assert.ok(report.cuddleHandoff.at(-1).pointer>.9,'Cuddle handoff did not reach the body animation');
  await saveFrame('cuddle-to-explain');
  // A face command must not stop/restart an already playing body animation.
  await request('/api/command',{type:'reset'});await delay(650);
  await request('/api/command',{type:'body',animation:'explain',intensity:.8,durationMs:10000});await delay(1600);
  await win.webContents.executeJavaScript('window.qaOriginalBody=qaBehavior.bodyPreview;void 0;');
  const before=await inspect();
  await request('/api/command',{type:'expression',emotion:'happy',intensity:1,durationMs:20000});await delay(700);
  const after=await inspect();
  assert.equal(await win.webContents.executeJavaScript('qaOriginalBody===qaBehavior.bodyPreview'),true,'Face preview replaced the body performance');
  assert.equal(after.motionCalls,before.motionCalls,'Face preview started or stopped an arm motion');
  assert.equal(after.gesture,before.gesture,'Face preview changed the current hand');
  assert.ok(after.parameters.ParamMouthForm>.3,'Happy face was not visible during the body animation');
  report.faceWhileBody={before,after,image:await saveFrame('face-during-explain')};
  // Exercise the actual expression card, not just a direct command.
  fixtureChat=new BrowserWindow({width:460,height:820,show:false,webPreferences:{preload,offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true}});
  await fixtureChat.loadURL(service.url+'/?view=chat');await delay(350);
  await fixtureChat.webContents.executeJavaScript('Array.from(document.querySelectorAll(".tabs button")).find(button=>button.textContent==="小表情").click()');await delay(100);
  const beforeCard=await inspect();
  await fixtureChat.webContents.executeJavaScript('document.querySelector("[data-expression=shy]").click()');await delay(650);
  const afterCard=await inspect();
  assert.equal(afterCard.motionCalls,beforeCard.motionCalls,'Expression card controls the arms');
  assert.equal(await win.webContents.executeJavaScript('qaOriginalBody===qaBehavior.bodyPreview'),true,'Expression card interrupted body playback');
  assert.ok(afterCard.parameters.key7>.4,'Shy expression card did not reach the face');
  report.faceCard={before:beforeCard,after:afterCard,image:await saveFrame('face-card-during-explain')};
  await request('/api/stop',{});await delay(2200);
  const stopped=await inspect();assert.equal(stopped.gesture,'none');assert.ok(stopped.poseWeight<.01);
  report.stopped=stopped;
  // All GUI surfaces are hidden. Their destruction is local to this test.
  assert.deepEqual(report.errors,[]);
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({bodyPresets:report.body.length,faceIsolation:true,faceCardIsolation:true,stop:true,output}));
  fixtureChat.destroy();win.destroy();await service.close();app.exit(0);
})().catch(async error=>{report.failure=String(error.stack||error);await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2)).catch(()=>{});console.error(error);try{win?.destroy();await service?.close();}finally{app.exit(1);}});
`;
const harness = path.join(output, 'harness.cjs');
fs.writeFileSync(harness, source);
require(harness);
