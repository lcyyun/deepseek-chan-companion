import test from 'node:test';
import assert from 'node:assert/strict';
import stable from '../desktop/stable-pet-shape.cjs';
import input from '../desktop/pet-input.cjs';
const {createStablePetShape}=stable;
const viewport={width:800,height:700,padding:18,revision:1,scale:1,contextKey:'monitor-a/model-a'};
const body={x:200,y:100,width:180,height:400};
const region=(rect=body,key='body')=>({key,rect});
const contains=(outer,inner)=>outer.x<=inner.x&&outer.y<=inner.y&&outer.x+outer.width>=inner.x+inner.width&&outer.y+outer.height>=inner.y+inner.height;
const hits=(rects,x,y)=>rects.some(r=>x>=r.x&&y>=r.y&&x<r.x+r.width&&y<r.y+r.height);
function assertBounded(shape,rect,options=viewport){
  const budget=input.normalizeRegions([rect],options.width,options.height,options.padding*2)[0];
  const required=input.normalizeRegions([rect],options.width,options.height,options.padding)[0];
  assert.ok(contains(budget,shape),'extra protection never exceeds one original padding per edge');
  if(required)assert.ok(contains(shape,required),'original clipping/input safety margin remains intact');
}

test('small pose movement shares a stable envelope while retaining the full original guard',()=>{
  const cache=createStablePetShape(),update=(rect,now)=>cache.update({...viewport,regions:[region(rect)],now});
  const first=update(body,0);
  for(let i=1;i<=60;i++){
    const rect={...body,x:body.x+Math.sin(i/8)*5,y:body.y+Math.cos(i/9)*4};
    const next=update(rect,i*100);
    assert.deepEqual(next,first,'no native shape change for mild swaying');assertBounded(next[0],rect);
  }
});

test('growth protects new model pixels immediately and settles back after 600ms',()=>{
  const cache=createStablePetShape();
  const run=(rect,now)=>cache.update({...viewport,regions:[region(rect)],now})[0];
  run(body,0);
  const larger={...body,width:body.width+13};
  const expanded=run(larger,100);assertBounded(expanded,larger);
  // A slight contraction can retain the useful envelope briefly, without
  // exceeding the original margin or keeping an old pose indefinitely.
  const reduced={...body,width:body.width+9};
  const held=run(reduced,200);assertBounded(held,reduced);assert.deepEqual(held,expanded);
  assert.deepEqual(run(reduced,799),held);
  const settled=run(reduced,800);assert.ok(settled.width<held.width);assertBounded(settled,reduced);
});

test('continuously changing poses cannot retain an oversized envelope past one second',()=>{
  const cache=createStablePetShape();
  const run=(rect,now)=>cache.update({...viewport,regions:[region(rect)],now})[0];
  run(body,0);const grown=run({...body,width:body.width+13},100);
  let latest;
  for(let i=2;i<=11;i++){
    const rect={...body,width:body.width+9+(i%2)};
    latest=run(rect,i*100);assertBounded(latest,rect);
  }
  assert.ok(latest.width<grown.width,'max hold expires despite ongoing small changes');
});

test('large movement and pose contraction immediately discard stale distant protection',()=>{
  const cache=createStablePetShape();
  const run=(rect,now)=>cache.update({...viewport,regions:[region(rect)],now})[0];
  run(body,0);const moved={...body,x:500};
  const next=run(moved,10);assertBounded(next,moved);assert.equal(hits([next],250,250),false);
  const small={...moved,width:40,height:60};
  const shrunk=run(small,20);assertBounded(shrunk,small);assert.equal(hits([shrunk],650,450),false);
});

test('a fast hand extension expands immediately at every scale with the complete old safety margin',()=>{
  for(const scale of [.5,1,2,4]){
    const options={...viewport,padding:18*Math.max(1,scale),scale};
    const cache=createStablePetShape();cache.update({...options,regions:[region()],now:0});
    const extended={...body,x:80,width:500};
    const next=cache.update({...options,regions:[region(extended)],now:100})[0];
    assertBounded(next,extended,options);
    const back=cache.update({...options,regions:[region()],now:200})[0];
    assertBounded(back,body,options);
    assert.ok(back.width<next.width,'a large completed gesture cannot leave its wide capture region');
  }
});

test('revision scale viewport display and explicit clear reset without waiting',()=>{
  for(const change of [{revision:2},{scale:2},{width:799},{height:699},{contextKey:'monitor-b/model-a'},{padding:20}]){
    const cache=createStablePetShape();cache.update({...viewport,regions:[region(body)],now:0});
    const rect={...body,x:body.x+3};
    const fresh=createStablePetShape().update({...viewport,...change,regions:[region(rect)],now:1});
    assert.deepEqual(cache.update({...viewport,...change,regions:[region(rect)],now:1}),fresh);
  }
  const cache=createStablePetShape();cache.update({...viewport,regions:[region(body)],now:0});cache.clear();
  const rect={...body,x:body.x+3};
  assert.deepEqual(cache.update({...viewport,regions:[region(rect)],now:1}),createStablePetShape().update({...viewport,regions:[region(rect)],now:1}));
});

test('caption and loading protection remains independent and is removed immediately',()=>{
  const cache=createStablePetShape();
  const caption={x:350,y:30,width:300,height:70};
  const initial=cache.update({...viewport,regions:[region(),region(caption,'caption')],now:0});
  assert.equal(initial.length,2);assertBounded(initial[1],caption);
  const movedCaption={...caption,x:400};
  const next=cache.update({...viewport,regions:[region({...body,x:202}),region(movedCaption,'caption')],now:100});
  assert.deepEqual(next[0],initial[0]);assertBounded(next[1],movedCaption);
  const removed=cache.update({...viewport,regions:[region()],now:200});assert.equal(removed.length,1);
  assert.equal(hits(removed,600,50),false);
});

test('current control exclusions cut stable envelopes immediately, including pointer capture',()=>{
  const cache=createStablePetShape();
  const compose=(exclusions,fullWindow=false)=>input.buildInputShape({
    ...viewport,padding:0,fallbackRegions:[],exclusions,
    regions:cache.update({...viewport,regions:[region()],now:0,fullWindow}),
  });
  const hole={x:210,y:200,width:50,height:50};
  const secondHole={x:290,y:330,width:65,height:90};
  assert.equal(hits(compose([hole,secondHole]),220,220),false);
  assert.equal(hits(compose([hole,secondHole]),320,350),false);
  assert.equal(hits(compose([{...hole,x:400}]),220,220),true);
  assert.equal(hits(compose([hole],true),220,220),false);
  assert.equal(hits(compose([],true),20,20),true);
  assert.equal(hits(compose([]),20,20),false,'leaving capture does not reuse full-window protection');
});

test('offscreen fractional regions, invalid input and clock rollback stay bounded',()=>{
  const cache=createStablePetShape();
  const rect={x:-20.4,y:650.2,width:200.8,height:180};
  const shape=cache.update({...viewport,regions:[region(rect)],now:500})[0];assertBounded(shape,rect);
  assert.deepEqual(cache.update({...viewport,regions:[{key:'bad',rect:{...body,x:NaN}}],now:600}),[]);
  const capped=cache.update({...viewport,regions:Array.from({length:100},(_,i)=>region(body,String(i))),now:700});assert.equal(capped.length,8);
  const fresh=createStablePetShape().update({...viewport,regions:[region()],now:1});
  assert.deepEqual(cache.update({...viewport,regions:[region()],now:1}),fresh);
  assert.deepEqual(cache.update({...viewport,width:NaN,regions:[region()],now:2}),[]);
  assert.deepEqual(cache.update({...viewport,width:.1,fullWindow:true,now:3}),[]);
});

test('repeated resizing and screen-edge movement always satisfies the minimum and maximum margins',()=>{
  const cache=createStablePetShape();
  for(let i=0;i<1000;i++){
    const rect={x:Math.sin(i*.041)*430+220,y:Math.cos(i*.063)*450+250,
      width:180+Math.sin(i*.17)*100,height:200+Math.cos(i*.11)*150};
    const shape=cache.update({...viewport,regions:[region(rect)],now:i*50});
    const budget=input.normalizeRegions([rect],viewport.width,viewport.height,viewport.padding*2);
    if(!budget.length)assert.equal(shape.length,0);
    else{assert.equal(shape.length,1);assertBounded(shape[0],rect);}
  }
});
