import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createService } from '../server/service.mjs';
import { normalizeReply, needsSpeechRepair, responseBudget } from '../server/protocol.mjs';

test('persistent DSH chat neither replays local history nor creates visible repair turns', async t=>{
  const root=await mkdtemp(join(tmpdir(),'l2d-dsh-service-turns-'));
  const calls=[];
  const longText='这是一段已经生成的完整回答，需要原样留在当前会话里。'.repeat(12);
  const reply=normalizeReply({segments:[{text:longText}],details:'完整说明',sources:[]});
  assert.equal(needsSpeechRepair(reply,responseBudget('第二句','brief')),true);
  const service=await createService({port:0,dataDir:root,chatAdapters:{dsh:async input=>{
    calls.push({text:input.request.text,history:input.history});return {...reply,nativeMode:true};
  }}});
  const ws=new WebSocket(service.url.replace(/^http/,'ws')+'/events');
  t.after(async()=>{ws.close();await service.close();await rm(root,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('DSH test bridge did not register')),3000);
    ws.once('error',reject);ws.on('open',()=>ws.send(JSON.stringify({type:'auth',token:service.token})));
    ws.on('message',raw=>{const message=JSON.parse(raw);if(message.type==='auth'&&message.ok)ws.send(JSON.stringify({type:'bridge-register',name:'dsh',chat:true,sessionControllerAvailable:true,promptProtocol:2,nativeMode:true}));if(message.type==='bridge-ready'){clearTimeout(timer);resolve();}});
  });
  const request=(path,body,method='POST')=>fetch(service.url+path,{method,headers:{Authorization:'Bearer '+service.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await request('/api/settings',{provider:'dsh',verbosity:'brief'},'PUT')).status,200);
  for(const text of ['第一句','第二句']){
    const response=await request('/api/chat',{text});assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.segments[0].text,longText);
  }
  assert.deepEqual(calls,[{text:'第一句',history:[]},{text:'第二句',history:[]}]);
});
