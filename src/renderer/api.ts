import type { Bootstrap } from '../shared/contracts';
let boot: Bootstrap;
export async function initialize() {
  if (window.companion) boot = await window.companion.bootstrap();
  else boot = {url: location.origin, token: sessionStorage.getItem('companion-token') || '', role: (new URLSearchParams(location.search).get('view') || 'chat') as any};
  return boot;
}
export function credentials() { return boot; }
export async function api(path: string, data?: unknown, method?: string, signal?: AbortSignal) {
  const response = await fetch(boot.url + path, {method: method || (data === undefined ? 'GET' : 'POST'), headers: {'Authorization':`Bearer ${boot.token}`, ...(data===undefined?{}:{'Content-Type':'application/json'})}, body:data===undefined?undefined:JSON.stringify(data), signal});
  if(!response.ok){let message=`请求失败 (${response.status})`,code='REQUEST_FAILED';try{const e=await response.json();message=e.error?.message||e.error||e.message||message;code=String(e.code||code);}catch{};throw Object.assign(new Error(String(message)),{code,status:response.status});}
  if(response.status===204)return null;
  return response.json();
}
export function events(callback: (event: any) => void) {
  let closed=false, socket: WebSocket, timer: ReturnType<typeof setTimeout>;
  function connect(){socket=new WebSocket(boot.url.replace(/^http/,'ws')+'/events');socket.onopen=()=>socket.send(JSON.stringify({type:'auth',token:boot.token}));socket.onmessage=e=>{try{callback(JSON.parse(e.data));}catch(error){console.error('事件处理失败',error);}};socket.onclose=()=>{if(!closed)timer=setTimeout(connect,2000);};}
  connect();return()=>{closed=true;clearTimeout(timer);socket?.close();};
}
