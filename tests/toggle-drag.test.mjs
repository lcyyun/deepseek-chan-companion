import test from 'node:test';
import assert from 'node:assert/strict';
import drag from '../desktop/toggle-drag.cjs';

function fixture({cursor={x:120,y:130},pressed=false}={}) {
  let tick,cleared=0,released=0,error;
  const moves=[];
  const state={cursor,pressed};
  const session=drag.createToggleDragSession({start:{x:120,y:130},bounds:{x:100,y:100,width:58,height:58},
    getCursor:()=>state.cursor,isPressed:()=>state.pressed,onMove:bounds=>moves.push(bounds),
    onRelease:()=>released++,onError:value=>{error=value;},schedule:fn=>{tick=fn;return 1;},unschedule:()=>cleared++});
  return {session,state,moves,tick:()=>tick(),get cleared(){return cleared;},get released(){return released;},get error(){return error;}};
}

test('native cursor follows without renderer move events and preserves grab offset',()=>{
  const f=fixture();f.tick();assert.equal(f.session.native,false);
  // Physical button observer can arrive after pointerdown.
  f.state.pressed=true;f.state.cursor={x:122,y:132};f.tick();assert.equal(f.moves.length,0);
  f.state.cursor={x:650,y:-160};f.tick();
  assert.deepEqual(f.moves.at(-1),{x:630,y:-190,width:58,height:58});
  // A delayed Chromium event must not move the native window backwards.
  f.session.move({x:130,y:140});assert.equal(f.moves.at(-1).x,630);
  f.state.cursor={x:680,y:-150};f.state.pressed=false;f.tick();
  assert.deepEqual(f.moves.at(-1),{x:660,y:-180,width:58,height:58});
  assert.equal(f.released,1);assert.equal(f.cleared,1);assert.equal(f.session.active,false);
  f.tick();f.session.stop();assert.equal(f.released,1);assert.equal(f.cleared,1);
});

test('synthetic events do not jump to unrelated physical cursor, even with another press',()=>{
  const f=fixture({cursor:{x:900,y:800},pressed:true});
  f.tick();assert.equal(f.session.native,false);assert.equal(f.moves.length,0);
  f.session.move({x:140,y:160});assert.deepEqual(f.moves.at(-1),{x:120,y:130,width:58,height:58});
  f.tick();assert.equal(f.moves.length,1);
  f.session.stop('cancel');assert.equal(f.cleared,1);
});

test('late matching physical cursor can take over and explicit cancellation stops all polling',()=>{
  const f=fixture({cursor:{x:900,y:800},pressed:false});
  f.state.cursor={x:200,y:220};f.state.pressed=true;f.session.move({x:200,y:220});
  assert.equal(f.session.native,true);assert.equal(f.moves.at(-1).x,180);
  f.session.stop('cancel');f.state.cursor={x:900,y:900};f.tick();
  assert.equal(f.moves.at(-1).x,180);assert.equal(f.released,0);assert.equal(f.cleared,1);
});

test('native short tap remains a click and unavailable input safely ends sampling',()=>{
  const f=fixture({pressed:true});f.tick();f.state.cursor={x:123,y:132};f.tick();
  f.state.pressed=false;f.tick();assert.equal(f.session.moved,false);assert.equal(f.released,1);
  const g=fixture({pressed:true});g.tick();
  Object.defineProperty(g.state,'cursor',{get(){throw Error('cursor gone');}});
  g.tick();assert.equal(g.session.active,false);assert.equal(g.cleared,1);assert.match(g.error.message,/cursor gone/);
});
