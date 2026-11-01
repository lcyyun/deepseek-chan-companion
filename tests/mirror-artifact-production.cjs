// Isolated real-model drawable/placement audit. No normal desktop app is used.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'vendor', 'mirror-artifact-production');
fs.mkdirSync(output, { recursive: true });
let source = fs.readFileSync(path.join(__dirname, 'live2d-actions.cjs'), 'utf8');
source = source.replace("const root = path.resolve(__dirname, '..');", 'const root = '+JSON.stringify(root)+';')
  .replace(/const output = path\.join\(root, 'vendor', .*?\);/, 'const output = '+JSON.stringify(output)+';')
  .replace('(nativeInputOnly||effectsOnly||v5Only||physicsOnly||cuddleOnly||tuningOnly||expressionsOnly)?2048:4096', '2048')
  .replace('const qaRigIdentity=physics?._physicsRig;', '(window as any).qaModel=model;(window as any).qaMatrix=matrix;(window as any).qaShoulderParts={left:[...leftArmDrawables],right:[...replacedArmDrawables]};const qaRigIdentity=physics?._physicsRig;')
  .replace(".replace('const handle: Live2DHandle = {'", ".replace('      mirroredInteractionVertices = [];', '      mirroredInteractionVertices = [];(window as any).qaPainted=[];').replace('drawMirror.call(mirrorRenderer, model, row.index);', '(window as any).qaPainted.push({source:\"mirror\",index:row.index,opacity:opacities[row.index],vertices:Array.from(row.reflected)});if((window as any).qaOnlyMesh==null||(window as any).qaOnlyMesh===row.index)drawMirror.call(mirrorRenderer, model, row.index);').replace('drawNative.call(renderer, m, index);', 'if(!renderer.isGeneratingMask()&&opacities[index]>.001)(window as any).qaPainted.push({source:\"native\",index,opacity:opacities[index],vertices:Array.from(model.getDrawableVertices(index))});if(renderer.isGeneratingMask()||(window as any).qaOnlyMesh==null||(window as any).qaOnlyMesh===index)drawNative.call(renderer,m,index);').replace('const handle: Live2DHandle = {'");
const anchor = source.indexOf('  if(expressionsOnly){');
if (anchor < 0) throw Error('Production QA setup anchor changed');
source = source.slice(0, anchor);
source += String.raw`
  const assert=require('node:assert/strict');
  const js=code=>win.webContents.executeJavaScript(code);
  const captureArtifact=async name=>{
    const snapshot=await js('new Promise(resolve=>requestAnimationFrame(()=>{const canvas=document.querySelector("canvas"),m=qaMatrix.getArray(),w=canvas.width,h=canvas.height;const visible=(window.qaPainted?.length?window.qaPainted:Array.from({length:qaModel.getDrawableCount()},(_,index)=>({source:"native",index,opacity:qaModel.getDrawableOpacity(index),vertices:Array.from(qaModel.getDrawableVertices(index))})).filter(row=>row.opacity>.001&&qaModel.getDrawableDynamicFlagIsVisible(row.index)));const painted=visible.map(row=>{const points=[];for(let i=0;i<row.vertices.length;i+=2)points.push({x:(row.vertices[i]*m[0]+m[12]+1)*w/2,y:(1-row.vertices[i+1]*m[5]-m[13])*h/2});let p=qaModel.getDrawableParentPartIndex(row.index),parts=[];while(p>=0){parts.push(qaModel.getPartId(p).getString().s);p=qaModel.getPartParentPartIndices()[p];}return{source:row.source,index:row.index,id:qaModel.getDrawableId(row.index).getString().s,opacity:row.opacity,parts,masks:Array.from(qaModel.getDrawableMasks()[row.index]),bounds:{x1:Math.min(...points.map(p=>p.x)),y1:Math.min(...points.map(p=>p.y)),x2:Math.max(...points.map(p=>p.x)),y2:Math.max(...points.map(p=>p.y))}};});const review=document.createElement("canvas");review.width=w;review.height=h;const c=review.getContext("2d");c.fillStyle="#f4f6fa";c.fillRect(0,0,w,h);c.drawImage(canvas,0,0);resolve({painted,data:canvas.toDataURL("image/png"),review:review.toDataURL("image/png"),params:qaRuntime.getParameters()});}))');
    await fs.writeFile(path.join(output,name+'.png'),Buffer.from(snapshot.data.split(',')[1],'base64'));
    await fs.writeFile(path.join(output,name+'.review.png'),Buffer.from(snapshot.review.split(',')[1],'base64'));
    delete snapshot.data;delete snapshot.review;return{name,...snapshot};
  };
  report.frames=[];
  for(const [kind,side] of [['pointer','right'],['pointer','left'],['chest','right'],['chest','both']]){
    await request('/api/command',{type:'reset'});await delay(300);
    await js('qaDirect=true;qaRuntime.setView(1);qaRuntime.setGestureHands('+JSON.stringify(kind)+','+JSON.stringify(side)+',true);qaRuntime.playMotion('+JSON.stringify(kind==='pointer'?'竖手指切出来动画':'默认手切举手')+',{loop:false,holdLastFrame:true});void 0;');await delay(1400);
    const pose=kind==='pointer'?{Movement3:1,Param40:1,Param36:.12,Param39:.322,Param41:.68,Param42:0,Param43:0}:{Movement2:1,Param62:.034,Param59:.476,Param60:.82,Param61:.002};
    await js('qaRuntime.setPoseOverlay('+JSON.stringify(pose)+',1);');await delay(200);
    report.frames.push(await captureArtifact(kind+'-'+side));
    if(kind==='pointer'&&side==='left'){
      const candidates=report.frames.at(-1).painted.filter(row=>row.bounds.x1<530&&row.bounds.x2>390&&row.bounds.y1<450&&row.bounds.y2>290);
      report.shoulderCandidates=candidates;
      for(const row of candidates.filter(row=>row.source==='mirror'||row.parts.some(p=>['Part128','Part129','Part68','Part94'].includes(p)))){
        await js('qaOnlyMesh='+row.index);await delay(40);report.frames.push(await captureArtifact('mesh-'+row.index+'-'+row.id));
      }
      await js('qaOnlyMesh=null;');
      for(const [name,values] of [['turn-left',{AngleX:-20,AngleY:10,AngleZ:-10,PositionX:-5,LeanInput:8}],['turn-right',{AngleX:20,AngleY:10,AngleZ:10,PositionX:5,LeanInput:-8}],['down',{AngleY:-20}]]){
        await js('qaRuntime.setParameters('+JSON.stringify(values)+');');await delay(300);report.frames.push(await captureArtifact(name));
      }
      await js('qaRuntime.clearParameters();');
      for(const scale of [2,4]){
        await js('qaRuntime.setPlacement({scale:'+scale+',centerX:250,centerY:Math.round(800*'+scale+'*.47),referenceWidth:500,referenceHeight:800});');await delay(150);report.frames.push(await captureArtifact('scale-'+scale));
      }
    }
  }
  // Regression: all eight shoulder meshes must belong to the same authored
  // side as their upper arm. In 0.13 the right cuff/arm was mirrored while the
  // four Part68 puff-sleeve meshes still followed the raised native right arm.
  for(const frame of report.frames.filter(frame=>!frame.name.startsWith('mesh-'))){
    const shoulder=frame.painted.filter(row=>row.parts.includes('Part68')||row.parts.includes('Part94'));
    assert.equal(shoulder.length,8,'Lost a shoulder or its three trims: '+frame.name);
    for(const row of shoulder){
      assert.ok(Object.values(row.bounds).every(Number.isFinite),'Invalid shoulder geometry: '+frame.name);
      assert.deepEqual(row.masks,[397],'Shoulder lost the shared authored mask');
    }
    const native=shoulder.filter(row=>row.source==='native');
    if(frame.name==='pointer-right')assert.equal(native.length,8,'The native pose changed shoulder ownership');
    else if(frame.name==='chest-both'){
      assert.equal(native.length,4);assert.ok(shoulder.every(row=>row.parts.includes('Part94')),'Cuddle mixed shoulders from different arm poses');
    } else assert.equal(native.length,0,'Mirrored forearm retained an unmirrored shoulder: '+frame.name);
  }
  assert.deepEqual(report.errors,[]);
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({frames:report.frames.length,candidates:report.shoulderCandidates.filter(row=>row.parts.some(p=>['Part68','Part94'].includes(p))).map(row=>({id:row.id,index:row.index,source:row.source,parts:row.parts,bounds:row.bounds})),output}));
  win.destroy();await service.close();app.exit(0);
})().catch(async error=>{report.failure=String(error.stack||error);await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2)).catch(()=>{});console.error(error);try{win?.destroy();await service?.close();}finally{app.exit(1);}});
`;
const harness=path.join(output,'harness.cjs');fs.writeFileSync(harness,source);require(harness);
