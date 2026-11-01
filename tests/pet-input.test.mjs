import test from 'node:test';
import assert from 'node:assert/strict';
import input from '../desktop/pet-input.cjs';
const {normalizeRegions,subtractRegions,buildInputShape,computePetZoom,createPetPlacement,restorePetPlacement,constrainPosition,referenceBody,transformRegion,clipRegion,layoutToolBounds,createToolAnchor,petTopmostForFocus}=input;

test('pet stays topmost only while it owns focus, so another app can paint above it',()=>{
  assert.equal(petTopmostForFocus('pet'),true);
  for(const role of ['chat','toggle',undefined,null])assert.equal(petTopmostForFocus(role),false);
});
test('independent control position survives layout, clamps to either display, and recovers removed monitors',()=>{
  const areas=[{x:0,y:0,width:1280,height:720},{x:-1920,y:-200,width:1920,height:1080}];
  const ball={x:-1100,y:230,width:58,height:58};
  assert.deepEqual(input.constrainToolBounds(ball,areas),ball);
  assert.deepEqual(input.constrainToolBounds({...ball,x:-1950,y:-220},areas),{...ball,x:-1920,y:-200});
  assert.deepEqual(input.constrainToolBounds({...ball,x:9999,y:9999},areas),{...ball,x:1222,y:662});
  assert.deepEqual(input.constrainToolBounds(ball,[areas[0]]),{...ball,x:0});
  assert.throws(()=>input.constrainToolBounds({...ball,x:NaN},areas),/Invalid/);
  assert.throws(()=>input.constrainToolBounds(ball,[]),/work area/);
  for(const fullWindow of [false,true]){
    const moved={x:400,y:250,width:58,height:58};
    const shape=buildInputShape({regions:[{x:200,y:100,width:500,height:500}],width:1280,height:720,fullWindow,exclusions:[moved]});
    assert.equal(shape.some(r=>429>=r.x&&429<r.x+r.width&&279>=r.y&&279<r.y+r.height),false,'moved ball retains its hole even during pet capture');
    assert.ok(shape.some(r=>390>=r.x&&390<r.x+r.width&&279>=r.y&&279<r.y+r.height),'adjacent model stays protected');
  }
});
test('native hit region pads the character and remains inside the window',()=>{
  assert.deepEqual(normalizeRegions([{x:100,y:100,width:100,height:200}],370,680),[{x:82,y:82,width:136,height:236}]);
  assert.deepEqual(normalizeRegions([{x:-10,y:600,width:400,height:200}],370,680),[{x:0,y:582,width:370,height:98}]);
});
test('malformed renderer regions cannot create an invalid native window region',()=>{
  assert.deepEqual(normalizeRegions([{x:NaN,y:0,width:10,height:10},null,{x:5,y:5,width:-10,height:20},{x:1000,y:1000,width:2,height:2}],370,680),[]);
  assert.equal(normalizeRegions(Array(30).fill({x:1,y:1,width:5,height:5}),370,680).length,8);
});

const contains=(rects,x,y)=>rects.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);
test('visible controls remain clickable through padded protection and full pointer capture regions',()=>{
  const exclusions=[{x:112,y:102,width:58,height:58},{x:130,y:20,width:110,height:115}];
  for(const fullWindow of [false,true]){
    const shape=buildInputShape({regions:[{x:30,y:30,width:140,height:130}],width:220,height:180,fullWindow,exclusions});
    const protectedShape=fullWindow?[{x:0,y:0,width:220,height:180}]:normalizeRegions([{x:30,y:30,width:140,height:130}],220,180);
    for(let y=0;y<180;y++)for(let x=0;x<220;x++){
      assert.equal(contains(shape,x+.5,y+.5),contains(protectedShape,x+.5,y+.5)&&!contains(exclusions,x+.5,y+.5),`full=${fullWindow}, point ${x},${y}`);
    }
    assert.ok(contains(shape,60,60),'pet pixels outside the controls stay protected');
  }
});

test('moving/hiding controls restores protection and complete overlap produces an empty shape',()=>{
  const bounds={x:0,y:0,width:100,height:100};
  assert.deepEqual(subtractRegions([bounds],[bounds]),[]);
  const options={regions:[],width:100,height:100,fullWindow:true};
  assert.equal(contains(buildInputShape({...options,exclusions:[{x:20,y:20,width:58,height:58}]}),30,30),false);
  assert.equal(contains(buildInputShape({...options,exclusions:[{x:120,y:20,width:58,height:58}]}),30,30),true);
  assert.equal(contains(buildInputShape({...options,exclusions:[]}),30,30),true);
  assert.deepEqual(buildInputShape({...options,exclusions:[{x:-10,y:-10,width:120,height:120}]}),[]);
});


function assertAnchor(before,after,anchor){
  const world={x:before.bounds.x+anchor.x,y:before.bounds.y+anchor.y};
  for(const axis of ['x','y'])assert.ok(Math.abs(after.position[axis]+(world[axis]-before.position[axis])*after.scale/before.scale-world[axis])<1e-8);
}
const area={x:0,y:0,width:1920,height:1080};
const initial=createPetPlacement({area,scale:1,position:{x:1000,y:600}});
test('all zoom levels share a display-sized canvas and preserve the pointer anchor',()=>{
  const anchor={x:980,y:570};
  const enlarged=computePetZoom({...initial,currentScale:1,area,scale:4,anchor});
  assert.deepEqual(enlarged.bounds,area);assert.equal(enlarged.placement.scale,4);assert.equal(enlarged.placement.referenceHeight,575);
  assertAnchor(initial,enlarged,anchor);
  const reduced=computePetZoom({...enlarged,currentScale:4,scale:.5,anchor});
  assert.deepEqual(reduced.bounds,area);assertAnchor(enlarged,reduced,anchor);assert.equal(referenceBody(reduced).height,575*.5);
});
test('drag mode protects the character while empty desktop stays usable',()=>{
  const body={x:700,y:300,width:220,height:500};
  const shape=buildInputShape({regions:[body],width:1920,height:1080,fullWindow:false,fallbackRegions:[]});
  assert.equal(contains(shape,800,500),true);assert.equal(contains(shape,100,100),false);
  assert.deepEqual(buildInputShape({regions:[],width:1920,height:1080,fallbackRegions:[]}),[]);
});
test('negative monitor origins do not change screen-space placement or accumulate offsets',()=>{
  const area={x:-1280,y:-200,width:1280,height:720};
  const before=createPetPlacement({area,scale:1,position:{x:-650,y:170}}),anchor={x:620,y:350};
  const zoomed=computePetZoom({...before,currentScale:1,area,scale:2.5,anchor});
  assert.deepEqual(zoomed.bounds,area);assertAnchor(before,zoomed,anchor);
  const back=computePetZoom({...zoomed,currentScale:2.5,area,scale:1,anchor});assert.deepEqual(back.position,before.position);
});
test('zoom range and persisted absolute position survive restart without offset drift',()=>{
  assert.equal(computePetZoom({...initial,area,scale:-1}).scale,.5);assert.equal(computePetZoom({...initial,area,scale:10}).scale,4);
  const enlarged=computePetZoom({...initial,area,scale:3.2,anchor:{x:980,y:570}});
  const saved=JSON.parse(JSON.stringify({petLayoutVersion:2,petPosition:enlarged.position,petScale:enlarged.scale}));
  assert.deepEqual(restorePetPlacement(saved,area),enlarged);
  assert.throws(()=>computePetZoom({...initial,area:{...area,width:NaN},scale:2}),/Invalid zoom geometry/);
});
test('high zoom permits bringing the head back and shrinking retains a reachable offscreen layout',()=>{
  const screen={x:0,y:0,width:1280,height:720};
  const position=constrainPosition({x:640,y:1500},screen,4);assert.ok(position.y>screen.height);
  const big=createPetPlacement({area:screen,scale:4,position});assert.ok(clipRegion(referenceBody(big),1280,720));
  const small=computePetZoom({...big,area:screen,currentScale:4,scale:1}),body=referenceBody(small);
  assert.ok(body.y+body.height>720);assert.ok(clipRegion(body,1280,720).height>=80);
});
test('unclipped body prediction reveals the head when shrinking a previously cropped model',()=>{
  const big=createPetPlacement({area,scale:4,position:{x:1000,y:600}}),full=referenceBody(big),visible=clipRegion(full,area.width,area.height);
  assert.ok(full.height>visible.height);
  const small=computePetZoom({...big,currentScale:4,scale:1});assert.deepEqual(transformRegion(full,big,small),referenceBody(small));
  assert.ok(transformRegion(visible,big,small).height<referenceBody(small).height);
});
test('legacy config discards corrupt NDC offsets and restores a visible model',()=>{
  const restored=restorePetPlacement({petScale:1,petBounds:{x:1300,y:500,width:370,height:680},petView:{scale:4,offsetX:50,offsetY:-200}},area);
  assert.deepEqual(restored.bounds,area);assert.equal(restored.view,undefined);
  const body=referenceBody(restored);assert.ok(clipRegion(body,1920,1080));
});
test('toggle and chat follow the body after moving or shrinking instead of canvas corners',()=>{
  const body={x:700,y:300,width:200,height:400},first=layoutToolBounds(body,area),moved=layoutToolBounds({...body,x:740,y:330},area);
  assert.equal(moved.toggle.x-first.toggle.x,40);assert.equal(moved.toggle.y-first.toggle.y,30);
  const shrunk=layoutToolBounds({...body,width:100,height:200},area);assert.ok(shrunk.toggle.x<first.toggle.x&&shrunk.toggle.y<first.toggle.y);
  for(const tool of Object.values(shrunk))assert.ok(tool.x>=0&&tool.y>=0&&tool.x+tool.width<=area.width&&tool.y+tool.height<=area.height);
});
test('movement limits use a narrow real body rather than letting a wide reference box hide it',()=>{
  const screen={x:0,y:0,width:1280,height:720},footprint={x:-200,y:-1100,width:400,height:2200};
  const position=constrainPosition({x:-3000,y:3000},screen,4,footprint);
  assert.ok(position.x+footprint.x+footprint.width>=screen.x+80);
  assert.ok(position.y+footprint.y<=screen.height-80);
  assert.ok(position.y+footprint.y+footprint.height>=80);
});
test('tools freeze animation-driven bounds until the next placement revision',()=>{
  const anchor=createToolAnchor(),body={x:700,y:300,width:200,height:400};
  const first=layoutToolBounds(anchor.update(body,0),area);
  for(let n=1;n<=20;n++)assert.deepEqual(layoutToolBounds(anchor.update({...body,x:body.x+n,width:body.width+n*3},0),area),first);
  const after=createPetPlacement({area,scale:2,position:{x:1100,y:650}});
  anchor.predict(initial,after);
  assert.notDeepEqual(layoutToolBounds(anchor.body,area),first);
  const actual={x:800,y:200,width:350,height:700};
  assert.deepEqual(anchor.update(actual,1),actual);
  assert.deepEqual(anchor.update({...actual,width:500},1),actual);
  anchor.clear();assert.equal(anchor.body,null);
});
test('half-body corner layouts remain partially offscreen at every scale and tools stay visible',()=>{
  const screen={x:-1280,y:0,width:1280,height:720};
  for(const scale of [.5,1,2,4])for(const side of ['left','right']){
    const center={x:side==='left'?screen.x:screen.x+screen.width,y:screen.y+screen.height};
    const position=constrainPosition(center,screen,scale);
    assert.deepEqual(position,center);
    const state=createPetPlacement({area:screen,scale,position}),body=referenceBody(state);
    const clipped=clipRegion(body,screen.width,screen.height);assert.ok(clipped.width>0&&clipped.height>0);
    const tools=layoutToolBounds({...clipped,x:clipped.x+screen.x,y:clipped.y+screen.y},screen);
    for(const bounds of Object.values(tools))assert.ok(bounds.x>=screen.x&&bounds.y>=screen.y&&bounds.x+bounds.width<=screen.x+screen.width&&bounds.y+bounds.height<=screen.y+screen.height);
    const saved={petLayoutVersion:2,petPosition:position,petScale:scale};assert.deepEqual(restorePetPlacement(saved,screen).position,position);
  }
});
test('shrinking around an offscreen corner does not push the model back inside',()=>{
  const screen={x:0,y:0,width:1280,height:720},position={x:1280,y:720};
  const large=createPetPlacement({area:screen,scale:4,position});
  const small=computePetZoom({...large,currentScale:4,scale:.5});
  assert.deepEqual(small.position,position);
  const visible=clipRegion(referenceBody(small),1280,720);
  assert.ok(visible.width>=80&&visible.height>=80);
});
test('restoring a valid asymmetric body at a corner does not snap to the smaller reference box',()=>{
  const screen={x:0,y:0,width:1280,height:720};
  const footprint={x:-300,y:-287.5,width:500,height:575,scale:1,modelRoot:'fixture-model'};
  const position=constrainPosition({x:5000,y:720},screen,1,footprint);
  assert.equal(position.x,1500);
  const config={petLayoutVersion:2,petScale:1,petPosition:position,petFootprint:footprint,modelRoot:'fixture-model'};
  assert.deepEqual(restorePetPlacement(config,screen).position,position);
  const changedModel=restorePetPlacement({...config,modelRoot:'different-model'},screen);
  assert.ok(clipRegion(referenceBody(changedModel),1280,720),'old model footprint must not make a replacement model inaccessible');
});
