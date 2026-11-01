import { randomBytes, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { edgeToken, EDGE_CLIENT_TOKEN } from './edge-tts-token.mjs';

// Direct Microsoft Edge read-aloud protocol; no relay, Python, or saved speech.
// Wire format reference: https://github.com/rany2/edge-tts (2026-11-01).
export const DEFAULT_EDGE_VOICE = Object.freeze({ voice: 'zh-CN-XiaoyiNeural', rate: '+3%', pitch: '+8Hz', volume: '+0%' });
const VERSION = '143.0.3650.75';
const ENDPOINT = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const failure = (message, code, status=502) => Object.assign(new Error(message), { code, status });
const cancelled = () => failure('语音已取消。', 'CANCELLED', 499);
const protocolError = () => failure('默认语音返回了无效音频，请稍后重试。', 'EDGE_TTS_PROTOCOL');
const escapeXml = text => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function headers(text) {
  const result = {};
  for (const line of text.split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) result[line.slice(0,i).toLowerCase()] = line.slice(i+1).trim();
  }
  return result;
}
function timestamp(ms) {
  const d=new Date(ms); const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pad=n=>String(n).padStart(2,'0');
  return `${weekdays[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}
function prosody(value, suffix, min, max) {
  if (typeof value !== 'string' || !new RegExp(`^[+-]\\d+${suffix}$`).test(value) || Number.parseInt(value)<min || Number.parseInt(value)>max) throw failure('默认语音的语速、音调或音量设置无效。', 'INVALID_TTS_OPTION',400);
  return value;
}
function requestBody({text,voice,rate,pitch,volume}) {
  if (typeof text!=='string' || !text.trim() || text.length>6000) throw failure('朗读文本无效或过长。','INVALID_TEXT',400);
  if (typeof voice!=='string' || !/^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9-]{1,64}Neural$/.test(voice)) throw failure('默认语音音色无效。','INVALID_TTS_OPTION',400);
  prosody(rate,'%',-50,100);prosody(pitch,'Hz',-50,50);prosody(volume,'%',-100,100);
  const match=voice.match(/^([a-z]{2,3}-[A-Z]{2})-(.+)$/);
  const display=`Microsoft Server Speech Text to Speech Voice (${match[1]}, ${match[2]})`;
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${display}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${escapeXml(text)}</prosody></voice></speak>`;
}

/** Separate factory enables deterministic transport tests without live requests. */
export function createEdgeSpeech({ WebSocketImpl=WebSocket, now=Date.now, timeoutMs=45000, maxBytes=30*1024*1024, maxConcurrent=4 }={}) {
  let clockOffset=0, active=0;
  function attempt(ssml,signal,deadline) {
    return new Promise((resolve,reject)=>{
      if(signal?.aborted) return reject(cancelled());
      if(deadline<=now()) return reject(failure('默认语音合成超时，请检查网络。','TTS_TIMEOUT',504));
      let socket,done=false,total=0; const chunks=[];
      const finish=(error,value)=>{
        if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
        // terminate also tears down an unfinished TLS handshake; late errors are consumed below.
        socket?.terminate();error?reject(error):resolve(value);
      };
      const abort=()=>finish(cancelled());
      const timer=setTimeout(()=>finish(failure('默认语音合成超时，请检查网络。','TTS_TIMEOUT',504)),Math.max(1,deadline-now()));
      signal?.addEventListener('abort',abort,{once:true});
      try {
        const url=new URL(ENDPOINT);
        url.searchParams.set('TrustedClientToken',EDGE_CLIENT_TOKEN);
        url.searchParams.set('ConnectionId',randomUUID().replaceAll('-',''));
        url.searchParams.set('Sec-MS-GEC',edgeToken((now()+clockOffset)/1000));
        url.searchParams.set('Sec-MS-GEC-Version',`2-${VERSION}`);
        socket=new WebSocketImpl(url.toString(),{
          handshakeTimeout:Math.min(10000,deadline-now()),maxPayload:1024*1024,perMessageDeflate:true,
          headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0','Accept-Language':'en-US,en;q=0.9',Pragma:'no-cache','Cache-Control':'no-cache',Origin:'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',Cookie:`muid=${randomBytes(16).toString('hex').toUpperCase()};`}
        });
        socket.on('error',()=>{if(!done)finish(failure('默认语音暂时无法连接，请检查网络或切换语音服务。','EDGE_TTS_UNAVAILABLE'));});
        socket.on('unexpected-response',(_request,response)=>{
          response.resume();
          const error=failure(`默认语音服务返回 HTTP ${response.statusCode}，请稍后重试或切换语音服务。`,'EDGE_TTS_HTTP');
          if(response.statusCode===403)error.serverDate=Date.parse(response.headers.date);
          finish(error);
        });
        socket.on('open',()=>{
          if(done)return;
          const date=timestamp(now()+clockOffset);
          const config={context:{synthesis:{audio:{metadataoptions:{sentenceBoundaryEnabled:'false',wordBoundaryEnabled:'false'},outputFormat:'audio-24khz-48kbitrate-mono-mp3'}}}};
          const onSend=err=>{if(err)finish(failure('默认语音请求未能发送。','EDGE_TTS_UNAVAILABLE'));};
          socket.send(`X-Timestamp:${date}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(config)}\r\n`,onSend);
          if(!done)socket.send(`X-RequestId:${randomUUID().replaceAll('-','')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${date}Z\r\nPath:ssml\r\n\r\n${ssml}`,onSend);
        });
        socket.on('message',(data,isBinary)=>{
          if(done)return;
          try {
            const buffer=Buffer.isBuffer(data)?data:Buffer.from(data);
            if(!isBinary) {
              const separator=buffer.indexOf('\r\n\r\n');
              if(separator<0)throw protocolError();
              const path=headers(buffer.subarray(0,separator).toString('utf8')).path;
              if(path==='turn.end') {
                if(!total)throw failure('默认语音没有生成音频，请稍后重试。','EDGE_TTS_EMPTY');
                finish(null,{buffer:Buffer.concat(chunks,total),contentType:'audio/mpeg'});
              } else if(!['turn.start','response','audio.metadata'].includes(path))throw protocolError();
              return;
            }
            if(buffer.length<2)throw protocolError();
            const length=buffer.readUInt16BE(0);
            if(length<1 || length+2>buffer.length)throw protocolError();
            const info=headers(buffer.subarray(2,length+2).toString('utf8'));
            const audio=buffer.subarray(length+2);
            if(info.path!=='audio')throw protocolError();
            if(!info['content-type']&&!audio.length)return;
            if(info['content-type']!=='audio/mpeg'||!audio.length)throw protocolError();
            total+=audio.length;
            if(total>maxBytes)throw failure('语音响应过大。','TTS_OUTPUT_LIMIT');
            chunks.push(audio);
          }catch(error){finish(error);}
        });
        socket.on('close',()=>{if(!done)finish(failure('默认语音连接提前中断，请稍后重试。','EDGE_TTS_INCOMPLETE'));});
        // Covers cancellation racing synchronously with construction.
        if(signal?.aborted)abort();
      }catch{finish(failure('默认语音暂时无法连接，请检查网络。','EDGE_TTS_UNAVAILABLE'));}
    });
  }
  return async function speak({text,signal,voice=DEFAULT_EDGE_VOICE.voice,rate=DEFAULT_EDGE_VOICE.rate,pitch=DEFAULT_EDGE_VOICE.pitch,volume=DEFAULT_EDGE_VOICE.volume}) {
    const ssml=requestBody({text,voice,rate,pitch,volume});
    if(signal?.aborted)throw cancelled();
    if(active>=maxConcurrent)throw failure('正在合成语音，请稍后再试。','TTS_BUSY',429);
    active++;const deadline=now()+timeoutMs;
    try {
      try{return await attempt(ssml,signal,deadline);}
      catch(error){
        // A single server-date correction handles a device clock mismatch. No relay retry.
        if(error.code!=='EDGE_TTS_HTTP'||!Number.isFinite(error.serverDate)||signal?.aborted)throw error;
        clockOffset=error.serverDate-now();return await attempt(ssml,signal,deadline);
      }
    }finally{active--;}
  };
}
export const edgeSpeech=createEdgeSpeech();
