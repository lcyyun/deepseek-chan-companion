import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { edgeToken } from '../server/edge-tts-token.mjs';
import { createEdgeSpeech } from '../server/edge-tts.mjs';

function frame(audio=Buffer.from([0xff,0xf3,0x44,0xc0]), type='audio/mpeg') {
  const header=Buffer.from(`Path:audio\r\n${type?`Content-Type:${type}\r\n`:''}`);
  const length=Buffer.alloc(2);length.writeUInt16BE(header.length);
  return Buffer.concat([length,header,audio]);
}
const end=socket=>socket.emit('message',Buffer.from('Path:turn.end\r\n\r\n'),false);
const code=expected=>error=>error.code===expected;
function transport(onRequest,options={}) {
  const sockets=[];
  class Socket extends EventEmitter {
    constructor(url,opts){super();this.url=url;this.opts=opts;this.sent=[];this.terminated=false;sockets.push(this);queueMicrotask(()=>this.emit('open'));}
    send(value,callback){this.sent.push(value);callback?.();if(this.sent.length===2)queueMicrotask(()=>onRequest?.(this,sockets.length));}
    terminate(){this.terminated=true;}
  }
  return {sockets,speak:createEdgeSpeech({WebSocketImpl:Socket,...options})};
}
test('v2 protocol token agrees with upstream reference vectors',()=>{
  assert.equal(edgeToken(0),'52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6');
  assert.equal(edgeToken(1700000000),'2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2');
  assert.equal(edgeToken(1793491200),'7B4CE9D537A0C0C7-F040DBE252E495196E8C0E60525F20AF087248354D0C94DEEBA0E0BEE7D95F56');
  assert.equal(edgeToken(1700000000),edgeToken(1700000001));
});
test('default uses the audition voice and prosody, escapes SSML, collects audio until turn end',async()=>{
  const {speak,sockets}=transport(socket=>{
    socket.emit('message',frame(Buffer.from([1,2,3])),true);
    socket.emit('message',frame(Buffer.from([4,5])),true);
    socket.emit('message',frame(Buffer.alloc(0),null),true);
    end(socket);
  });
  const result=await speak({text:"你好 <voice> & '鱼'\u0001"});
  assert.deepEqual(result,{buffer:Buffer.from([1,2,3,4,5]),contentType:'audio/mpeg'});
  assert.match(sockets[0].sent[1],/zh-CN, XiaoyiNeural/);
  assert.match(sockets[0].sent[1],/pitch='\+8Hz' rate='\+3%' volume='\+0%'/);
  assert.match(sockets[0].sent[1],/&lt;voice&gt; &amp; &apos;鱼&apos; /);
  assert.equal(new URL(sockets[0].url).hostname,'speech.platform.bing.com');
  assert.equal(sockets[0].terminated,true);
});
test('rejects invalid text or options before connecting',async()=>{
  const {speak,sockets}=transport();
  for(const text of ['', ' ', '字'.repeat(6001), null])await assert.rejects(speak({text}),code('INVALID_TEXT'));
  for(const override of [{voice:"zh-CN-XiaoyiNeural'><x>"},{rate:'+999%'},{pitch:'8Hz'},{volume:'+101%'}])await assert.rejects(speak({text:'你好',...override}),code('INVALID_TTS_OPTION'));
  assert.equal(sockets.length,0);
});
test('malformed binary and non-audio responses are rejected without partial output',async()=>{
  for(const data of [Buffer.from([0]),Buffer.from([255,255,1]),frame(Buffer.from([1]),'text/html')]) {
    const {speak,sockets}=transport(socket=>socket.emit('message',data,true));
    await assert.rejects(speak({text:'你好'}),code('EDGE_TTS_PROTOCOL'));
    assert.equal(sockets[0].terminated,true);
  }
});
test('empty completion and truncated audio are errors, never successful speech',async()=>{
  const empty=transport(end);await assert.rejects(empty.speak({text:'你好'}),code('EDGE_TTS_EMPTY'));
  const partial=transport(socket=>{socket.emit('message',frame(),true);socket.emit('close');});
  await assert.rejects(partial.speak({text:'你好'}),code('EDGE_TTS_INCOMPLETE'));
});
test('audio output limit terminates the connection',async()=>{
  const {speak,sockets}=transport(socket=>socket.emit('message',frame(),true),{maxBytes:3});
  await assert.rejects(speak({text:'你好'}),code('TTS_OUTPUT_LIMIT'));assert.ok(sockets[0].terminated);
});
test('cancellation before and during synthesis rejects promptly and releases capacity',async()=>{
  const {speak,sockets}=transport(null,{maxConcurrent:1});
  const first=new AbortController();first.abort();
  await assert.rejects(speak({text:'你好',signal:first.signal}),code('CANCELLED'));assert.equal(sockets.length,0);
  const second=new AbortController();const pending=speak({text:'你好',signal:second.signal});second.abort();
  await assert.rejects(pending,code('CANCELLED'));assert.ok(sockets[0].terminated);
  sockets[0].emit('error',new Error('late network error'));
  const third=new AbortController();const next=speak({text:'又见面了',signal:third.signal});third.abort();
  await assert.rejects(next,code('CANCELLED'));assert.equal(sockets.length,2);
});
test('timeout closes stalled transport and concurrency is bounded',async()=>{
  const {speak,sockets}=transport(null,{timeoutMs:25,maxConcurrent:1});
  const first=speak({text:'你好'});
  await assert.rejects(speak({text:'另一个请求'}),code('TTS_BUSY'));
  await assert.rejects(first,code('TTS_TIMEOUT'));assert.ok(sockets[0].terminated);
});
test('clock mismatch uses one server-date correction and a fresh connection',async()=>{
  let resumed=false;const clock=1700000000000;
  const {speak,sockets}=transport((socket,attempt)=>{
    if(attempt===1)socket.emit('unexpected-response',{}, {statusCode:403,headers:{date:new Date(clock+600000).toUTCString()},resume(){resumed=true;}});
    else {socket.emit('message',frame(),true);end(socket);}
  },{now:()=>clock});
  await speak({text:'你好'});
  assert.equal(sockets.length,2);assert.ok(resumed);
  assert.notEqual(new URL(sockets[0].url).searchParams.get('Sec-MS-GEC'),new URL(sockets[1].url).searchParams.get('Sec-MS-GEC'));
});
test('repeated HTTP rejection does not loop or expose synthesis text',async()=>{
  const {speak,sockets}=transport(socket=>socket.emit('unexpected-response',{}, {statusCode:403,headers:{date:new Date().toUTCString()},resume(){}}));
  await assert.rejects(speak({text:'私人的一句话'}),error=>error.code==='EDGE_TTS_HTTP'&&!error.message.includes('私人的一句话'));
  assert.equal(sockets.length,2);
});
