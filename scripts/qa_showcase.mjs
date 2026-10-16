import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const root=process.cwd().replaceAll('\\','/'),baseline=process.argv.includes('--baseline'),port=9442;
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--no-first-run','--no-default-browser-check','--no-proxy-server',
  '--remote-allow-origins=http://localhost:'+port,'--remote-debugging-port='+port,
  '--user-data-dir='+root+'/work/chrome-v9','--window-size=1440,960','about:blank'
],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let ws,seq=0;const pending=new Map(),errors=[];
function send(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try {
  let pages;for(let i=0;i<50;i++){try{pages=await(await fetch('http://localhost:'+port+'/json/list')).json();break;}catch{await delay(200);}}
  if(!pages)throw Error('Chrome CDP unavailable');ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
    if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')errors.push(m.params.entry);};
  await send('Page.enable');await send('Runtime.enable');await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await send('Page.navigate',{url:process.env.HUXI_PREVIEW_URL??'http://localhost:5188/'});
  let ready=false;for(let i=0;i<100;i++){await delay(250);ready=await evaluate('!!window.__huxi && document.querySelector("#hud-stats").textContent.startsWith("楼栋")');if(ready)break;}
  assert.ok(ready,'map should load');await mkdir(root+'/work/qa',{recursive:true});
  const prefix=baseline?'v9-before':'v9';
  async function capture(name){await delay(900);const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(root+'/work/qa/'+prefix+'-'+name+'.png',Buffer.from(r.data,'base64'));}
  await capture('campus');
  if(process.argv.includes('--ui')) {
    assert.ok(await evaluate(`!!document.querySelector('#brand')&&document.querySelector('#brand').textContent.includes('虎溪')`),'showcase needs a visible campus identity');
    await evaluate(`document.querySelector('[data-shortcut="田径场"]').click()`);
    assert.equal(await evaluate(`document.querySelector('#pd-name').textContent`),'田径场');
    assert.match(await evaluate(`document.querySelector('#pd-meta').textContent`),/运动/);
    assert.ok(await evaluate(`getComputedStyle(document.querySelector('.building-views')).display==='none'`),'sports details must not expose building-only views');
    const before=await evaluate('window.__huxi.controls.target.toArray()');
    await evaluate(`document.querySelector('#pd-fly').click()`);
    assert.deepEqual(await evaluate('window.__huxi.controls.target.toArray()'),before,'fly action must return to the selected sports place');
    await evaluate(`document.querySelector('#pd-back').click();document.querySelector('#tl-home').click()`);
  }
  async function pose(x,y,north,dx,dy,dz){
    await evaluate(`(()=>{const h=window.__huxi;h.camera.setViewOffset(innerWidth,innerHeight,-130,0,innerWidth,innerHeight);h.controls.target.set(${x},${y},${-north});h.camera.position.copy(h.controls.target).add({x:${dx},y:${dy},z:${dz}});h.controls.update();})()`);
  }
  await pose(350,0,525,230,320,350);await capture('sports');
  const checks={sports:await evaluate(`(()=>{const h=window.__huxi;let root;h.scene.traverse(o=>{if(o.userData.sports)root=o;});return {metrics:root?.userData.sports,calls:h.renderer.info.render.calls,triangles:h.renderer.info.render.triangles};})()`)};
  if(!baseline){assert.ok(checks.sports.metrics,'sports metrics');assert.equal(checks.sports.metrics.counts.soccer,5);assert.ok(checks.sports.metrics.drawCalls<=24&&checks.sports.metrics.triangles<65000);}
  await pose(285,0,568,40,75,80);await capture('basketball');
  await pose(461,0,524,100,105,135);await capture('football');
  for(const [name,label]of [['library','图书馆'],['zonghe','综合楼'],['teaching1','第一教学楼'],['info','信息技术科研楼']]) {
    await evaluate(`document.querySelector('#pd-back').click();[...document.querySelectorAll('.place')].find(e=>e.querySelector('.nm').textContent===${JSON.stringify(label)}).click();`);
    await capture(name);
  }
  if(process.argv.includes('--ui')) {
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await send('Page.reload',{ignoreCache:true});
    for(let i=0;i<100;i++){await delay(250);if(await evaluate('!!window.__huxi && document.querySelector("#hud-stats").textContent.startsWith("楼栋")'))break;}
    assert.ok(await evaluate(`document.querySelector('#hud').classList.contains('collapsed')&&document.querySelector('#hud').getBoundingClientRect().height<100`),'phone should start with a compact browser bar');
    await capture('mobile');
    await evaluate(`document.querySelector('#tl-more').click()`);
    assert.ok(await evaluate(`document.querySelector('#tl-more').getAttribute('aria-expanded')==='true'&&document.querySelector('#tl-share').getBoundingClientRect().width>0`),'phone secondary tools must be reachable');
    await evaluate(`document.querySelector('#tl-more').click();document.querySelector('#hud-fold').click();document.querySelector('[data-shortcut="田径场"]').click()`);
    assert.equal(await evaluate(`document.querySelector('#pd-name').textContent`),'田径场');
    assert.ok(await evaluate(`!document.querySelector('#hud').classList.contains('collapsed')`),'place selection must reveal its details');
    await capture('mobile-sports');checks.mobileUI=true;
  }
  assert.equal(errors.length,0,'browser exceptions');
  await writeFile(root+'/work/qa/'+prefix+'-showcase-check.json',JSON.stringify({ready,errors,checks},null,2));
  console.log(JSON.stringify({ready,errors,checks}));
} finally {if(ws){try{await send('Browser.close');}catch{}ws.close();}browser.kill();}
