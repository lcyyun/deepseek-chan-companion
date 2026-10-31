import test from 'node:test';
import assert from 'node:assert/strict';
import pointer from '../desktop/pet-pointer-session.cjs';

function fixture(){
  let time=0;const changes=[],releases=[];
  const session=pointer.createPetPointerSession({now:()=>time,onChange:state=>changes.push(state),onRelease:event=>releases.push(event)});
  return {session,changes,releases,at:value=>{time=value;}};
}

test('cached down and queued old edges cannot release a newly locked session',()=>{
  const f=fixture();f.session.sample({down:true,seq:0});
  f.session.control({locked:true,id:'new'});
  f.at(10);f.session.sample({down:false,seq:1});
  f.at(20);f.session.sample({down:true,seq:2});
  f.at(40);f.session.sample({down:false,seq:3});
  assert.equal(f.session.state().locked,true);assert.equal(f.session.state().nativeConfirmed,false);assert.equal(f.releases.length,0);
  f.at(70);f.session.sample({down:true,seq:4});assert.equal(f.session.state().nativeConfirmed,true);
  f.at(100);f.session.sample({down:false,seq:5});
  assert.deepEqual(f.releases,[{id:'new'}]);assert.equal(f.changes.at(-1).locked,false);
  f.session.sample({down:false,seq:6});assert.equal(f.releases.length,1);
});

test('a replaced session and legacy unlock cannot end the new hold',()=>{
  const f=fixture();f.session.control({locked:true,id:'first'});
  f.at(80);f.session.sample({down:true,seq:0});
  f.session.control({locked:true,id:'second'});
  f.session.control({locked:false,id:'first'});f.session.control(false);
  f.at(90);f.session.sample({down:false,seq:1});
  assert.deepEqual(f.session.state(),{locked:true,id:'second',nativeConfirmed:false});
  assert.equal(f.releases.length,0);
  f.session.control({locked:false,id:'second'});assert.equal(f.session.state().locked,false);
});

test('short clicks stay DOM-owned; duplicate lock is idempotent and malformed input cannot unlock',()=>{
  const f=fixture();f.session.control({locked:true,id:'short'});
  f.at(10);f.session.sample({down:true,seq:0});f.at(30);f.session.sample({down:false,seq:1});
  f.session.control({locked:false,id:'short'});assert.equal(f.releases.length,0);
  f.session.control(true);assert.equal(f.session.state().locked,true);f.session.control(false);assert.equal(f.session.state().locked,false);
  f.session.control({locked:true,id:'same'});f.at(60);f.session.control({locked:true,id:'same'});
  f.at(100);f.session.sample({down:true,seq:2});assert.equal(f.session.state().nativeConfirmed,true);
  for(const value of [null,{},'true',{locked:true,id:3},{locked:false,id:''}])assert.throws(()=>f.session.control(value),/会话无效/);
  assert.equal(f.session.state().id,'same');
});

test('hide or unavailable cancels without a completed tap, and ignores stale native sequence',()=>{
  const f=fixture();f.session.control({locked:true,id:'hold'});f.at(80);f.session.sample({down:true,seq:8});
  f.session.sample({down:false,seq:7});assert.equal(f.session.state().locked,true);
  f.session.clear();f.session.sample({down:false,seq:9});
  assert.equal(f.releases.length,0);assert.equal(f.session.state().locked,false);
  f.session.control({locked:true,id:'dom-only'});f.at(400);assert.equal(f.session.state().locked,true);
  f.session.control({locked:false,id:'dom-only'});assert.equal(f.session.state().locked,false);
});

test('native release restores shape before completion and cannot complete a replaced session',()=>{
  let time=0,session,replace=false;const order=[];
  session=pointer.createPetPointerSession({now:()=>time,onChange:state=>{
    order.push(state.locked?'lock':'unlock');if(!state.locked&&replace)session.control({locked:true,id:'replacement'});
  },onRelease:()=>order.push('release')});
  session.control({locked:true,id:'a'});time=80;session.sample({down:true,seq:0});session.sample({down:false,seq:1});
  assert.deepEqual(order,['lock','unlock','release']);
  session.control({locked:true,id:'b'});time=160;session.sample({down:true,seq:2});replace=true;session.sample({down:false,seq:3});
  assert.equal(session.state().id,'replacement');assert.equal(order.filter(x=>x==='release').length,1);
});
