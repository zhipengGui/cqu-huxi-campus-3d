import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.cwd().replaceAll('\\','/'),port=9446,delay=ms=>new Promise(r=>setTimeout(r,ms));
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--no-proxy-server','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--remote-allow-origins=http://localhost:'+port,'--remote-debugging-port='+port,'--user-data-dir='+root+'/work/chrome-v10-nav','--window-size=1440,960','about:blank'],{windowsHide:true,stdio:'ignore'});
let ws,seq=0;const pending=new Map(),errors=[],checks={};
function send(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function shot(name){await delay(500);const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(root+'/work/qa/'+name+'.png',Buffer.from(r.data,'base64'));}
try{
  let pages;for(let i=0;i<60;i++){try{pages=await(await fetch('http://localhost:'+port+'/json/list')).json();break;}catch{await delay(200);}}
  ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')errors.push(m.params.entry);};
  await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await send('Page.navigate',{url:process.env.HUXI_PREVIEW_URL??'http://localhost:5192/'});await mkdir(root+'/work/qa',{recursive:true});
  let ready=false;for(let i=0;i<120;i++){await delay(250);if(await evaluate(`!!window.__huxi&&document.querySelector('#hud-stats').textContent.startsWith('楼栋')&&document.querySelector('#boot').hidden`)){ready=true;break;}}assert.ok(ready,'map must load');
  assert.ok(await evaluate(`!!document.querySelector('#nav-start')&&!!document.querySelector('#nav-end')&&!!document.querySelector('#pd-nav')`),'navigation needs start/end selectors and a detail-card navigation action');
  await evaluate(`document.querySelector('#tb-nav').click();document.querySelector('#nav-start').value='综合楼';document.querySelector('#nav-start').dispatchEvent(new Event('change'));document.querySelector('#nav-end').value='图书馆';document.querySelector('#nav-end').dispatchEvent(new Event('change'));document.querySelector('#nav-go').click()`);
  checks.route=await evaluate(`({status:document.querySelector('#nav-status').textContent,note:document.querySelector('#nav-note').textContent,distance:window.__huxi.navigation.result?.distanceMeters,points:window.__huxi.navigation.result?.points.length})`);
  assert.ok(checks.route.distance>100);assert.match(checks.route.note,/附近道路/);assert.match(checks.route.status,/路线.*m/);assert.ok(checks.route.points>2);await shot('v10-navigation-desktop');
  await evaluate(`document.querySelector('#nav-swap').click()`);
  assert.ok(await evaluate(`document.querySelector('#nav-start').value==='图书馆'&&document.querySelector('#nav-end').value==='综合楼'`),'swap must update both selectors');
  const swapped=await evaluate(`window.__huxi.navigation.result.distanceMeters`);assert.ok(Math.abs(swapped-checks.route.distance)<.001);
  await evaluate(`document.querySelector('#nav-clear').click()`);assert.ok(await evaluate(`!window.__huxi.navigation.result&&!window.__huxi.navigation.start&&!window.__huxi.navigation.end`));
  await evaluate(`document.querySelector('#nav-go').click()`);assert.match(await evaluate(`document.querySelector('#nav-status').textContent`),/起点|终点/);
  await evaluate(`document.querySelector('#nav-exit').click();[...document.querySelectorAll('.place')].find(e=>e.querySelector('.nm').textContent==='第一教学楼').click();document.querySelector('#pd-nav').click()`);
  assert.ok(await evaluate(`document.querySelector('#nav-panel').classList.contains('open')&&document.querySelector('#nav-end').value==='第一教学楼'`),'detail navigation must retain the chosen destination');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.querySelector('#nav-start').value='北门';document.querySelector('#nav-start').dispatchEvent(new Event('change'));document.querySelector('#nav-go').click()`);
  checks.mobile=await evaluate(`(()=>{const r=document.querySelector('#nav-panel').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,hiddenHud:getComputedStyle(document.querySelector('#hud')).display==='none',goVisible:document.querySelector('#nav-go').getBoundingClientRect().bottom<=innerHeight-12}})()`);
  assert.ok(checks.mobile.left>=0&&checks.mobile.right<=390&&checks.mobile.bottom<=832&&checks.mobile.hiddenHud&&checks.mobile.goVisible);await shot('v10-navigation-mobile');
  await evaluate(`document.querySelector('#nav-exit').click()`);assert.ok(await evaluate(`getComputedStyle(document.querySelector('#hud')).display!=='none'`));
  checks.selectors=true;checks.detailNavigation=true;checks.swap=true;
  assert.equal(errors.length,0,JSON.stringify(errors));await writeFile(root+'/work/qa/v10-navigation-check.json',JSON.stringify({errors,checks},null,2));console.log(JSON.stringify({errors,checks}));
}finally{if(ws){try{await send('Browser.close');}catch{}ws.close();}browser.kill();}
