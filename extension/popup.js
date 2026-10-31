const status=document.getElementById('status');
async function call(message){const result=await chrome.runtime.sendMessage(message);if(!result?.ok)throw new Error(result?.error||'无法连接桌宠');return result;}
function task(button,fn){button.addEventListener('click',async()=>{button.disabled=true;try{await fn();}catch(e){status.textContent=e.message;}finally{button.disabled=false;}});}
task(document.getElementById('connect'),async()=>{await call({type:'connect',token:document.getElementById('token').value});document.getElementById('token').value='';document.getElementById('pairing').hidden=true;status.textContent='已连接。在桌宠中开启“一起看”后分享页面。';});
document.getElementById('pair-again').addEventListener('click',()=>{document.getElementById('pairing').hidden=false;document.getElementById('token').focus();status.textContent='填写新的配对码；验证成功后才会替换现有连接。';});
task(document.getElementById('share'),async()=>{const r=await call({type:'share'});status.textContent='已分享：'+r.title;});
task(document.getElementById('selection'),async()=>{const r=await call({type:'share',selectionOnly:true});status.textContent='已分享选中文字：'+r.title;});
task(document.getElementById('follow'),async()=>{const granted=await chrome.permissions.request({origins:['http://*/*','https://*/*']});if(!granted)throw new Error('未开启网页权限，仍然可以单次分享。');const r=await call({type:'follow'});status.textContent='正在跟随当前活动标签：'+r.title;});
task(document.getElementById('stop'),async()=>{await call({type:'stop'});status.textContent='已停止分享，并清除桌宠的页面上下文。';});
call({type:'status'}).then(r=>{document.getElementById('pairing').hidden=!!(r.paired&&r.connected);if(r.lastError)status.textContent=r.lastError;else if(r.following)status.textContent='正在跟随当前浏览标签。';}).catch(()=>{});
