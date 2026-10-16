import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';

const root=process.cwd().replaceAll('\\','/'),baseline=process.argv.includes('--baseline'),port=9442;
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--no-first-run','--no-default-browser-check','--no-proxy-server',
  '--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling',
  '--remote-allow-origins=http://localhost:'+port,'--remote-debugging-port='+port,
  '--user-data-dir='+root+'/work/chrome-v9','--window-size=1440,960','about:blank'
],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let ws,seq=0,fault=false;const pending=new Map(),errors=[],expectedErrors=[];
function send(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try {
  let pages;for(let i=0;i<50;i++){try{pages=await(await fetch('http://localhost:'+port+'/json/list')).json();break;}catch{await delay(200);}}
  if(!pages)throw Error('Chrome CDP unavailable');ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
    if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')
      (fault&&m.params.entry.source==='network'&&m.params.entry.text.includes('503')?expectedErrors:errors).push(m.params.entry);
    if(m.method==='Browser.downloadProgress'&&m.params.state==='completed')console.log('DOWNLOAD_COMPLETE',m.params.receivedBytes);
    if(m.method==='Fetch.requestPaused')void send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from('{}').toString('base64')});};
  await send('Page.enable');await send('Runtime.enable');await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await send('Page.navigate',{url:process.env.HUXI_PREVIEW_URL??'http://localhost:5188/'});
  let ready=false;for(let i=0;i<100;i++){await delay(250);ready=await evaluate('!!window.__huxi && document.querySelector("#hud-stats").textContent.startsWith("楼栋")');if(ready)break;}
  assert.ok(ready,'map should load');await mkdir(root+'/work/qa',{recursive:true});
  async function waitReady(){for(let i=0;i<120;i++){await delay(250);if(await evaluate('!!window.__huxi && document.querySelector("#hud-stats").textContent.startsWith("楼栋") && document.querySelector("#boot").hidden'))return;}throw Error('map did not recover');}
  const checks={};
  const prefix=baseline?'v9-before':'v9';
  async function capture(name){await delay(900);const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(root+'/work/qa/'+prefix+'-'+name+'.png',Buffer.from(r.data,'base64'));}
  await capture('campus');
  if(process.argv.includes('--performance')) {
    const staticShadow=await evaluate(`new Promise(resolve=>{const h=window.__huxi,gl=h.renderer.getContext(),old=gl.bindFramebuffer;let binds=0,rafFrames=0,alive=true;const tick=()=>{rafFrames++;if(alive)requestAnimationFrame(tick)};requestAnimationFrame(tick);gl.bindFramebuffer=function(target,framebuffer){if(framebuffer)binds++;return old.call(this,target,framebuffer)};const t=performance.now(),frames=h.renderer.info.render.frame;setTimeout(()=>{alive=false;gl.bindFramebuffer=old;const elapsed=performance.now()-t;resolve({framebufferBinds:binds,fps:(h.renderer.info.render.frame-frames)*1000/elapsed,rafFPS:rafFrames*1000/elapsed})},2200)})`);
    console.log('STATIC_SHADOW',JSON.stringify(staticShadow));
    checks.staticShadow=staticShadow;
    assert.equal(staticShadow.framebufferBinds,0,'a stationary campus must reuse its shadow map');
    assert.ok(staticShadow.fps>=Math.min(55,staticShadow.rafFPS*.9),'frame cap must not discard half the available browser frames');
  }
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
  checks.sports=await evaluate(`(()=>{const h=window.__huxi;let root;h.scene.traverse(o=>{if(o.userData.sports)root=o;});return {metrics:root?.userData.sports,calls:h.renderer.info.render.calls,triangles:h.renderer.info.render.triangles};})()`);
  if(!baseline){assert.ok(checks.sports.metrics,'sports metrics');assert.equal(checks.sports.metrics.counts.soccer,5);assert.ok(checks.sports.metrics.drawCalls<=24&&checks.sports.metrics.triangles<65000);}
  await pose(285,0,568,40,75,80);await capture('basketball');
  await pose(461,0,524,100,105,135);await capture('football');
  for(const [name,label]of [['library','图书馆'],['zonghe','综合楼'],['teaching1','第一教学楼'],['info','信息技术科研楼']]) {
    await evaluate(`document.querySelector('#pd-back').click();[...document.querySelectorAll('.place')].find(e=>e.querySelector('.nm').textContent===${JSON.stringify(label)}).click();`);
    await capture(name);
  }
  if(process.argv.includes('--profile')) {
    for(const q of ['high','low']) {
      await evaluate(`document.querySelector('#pd-back').click();document.querySelector('#tl-home').click();document.querySelector('#quality-seg [data-q=${q}]').click()`);
      await delay(1500);
      checks[q]=await evaluate(`new Promise(resolve=>{const h=window.__huxi,gl=h.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info'),old=h.renderer.render;let ms=0,n=0;h.renderer.render=function(...args){const t=performance.now();const v=old.apply(this,args);ms+=performance.now()-t;n++;return v};const t=performance.now();setTimeout(()=>{h.renderer.render=old;resolve({fps:n*1000/(performance.now()-t),renderMs:ms/n,triangles:h.renderer.info.render.triangles,calls:h.renderer.info.render.calls,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',lost:gl.isContextLost()})},3000)})`);
      console.log('PROFILE',q,JSON.stringify(checks[q]));
    }
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
  if(process.argv.includes('--release')) {
    await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedURL=text}}});document.querySelector('#tl-share').click()`);
    const share=await evaluate('window.__copiedURL');
    assert.equal(new URLSearchParams(new URL(share).hash.slice(1)).get('place'),'田径场','shared view must retain the selected sports place');
    assert.ok(new URLSearchParams(new URL(share).hash.slice(1)).has('o'),'shared view must retain projection offset');
    const before=await evaluate(`({position:window.__huxi.camera.position.toArray(),target:window.__huxi.controls.target.toArray(),offset:[window.__huxi.camera.view.offsetX,window.__huxi.camera.view.offsetY]})`);
    await send('Page.navigate',{url:share});await waitReady();
    const restored=await evaluate(`({position:window.__huxi.camera.position.toArray(),target:window.__huxi.controls.target.toArray(),offset:[window.__huxi.camera.view.offsetX,window.__huxi.camera.view.offsetY],place:document.querySelector('#pd-name').textContent})`);
    assert.equal(restored.place,'田径场');
    for(const key of ['position','target'])assert.ok(before[key].every((v,i)=>Math.abs(v-restored[key][i])<.001),'shared '+key+' changed');
    assert.ok(before.offset.every((v,i)=>Math.abs(v-restored.offset[i])<.1),'shared projection offset changed');checks.shareRestore=true;
    const downloadPath=root+'/work/exports-'+Date.now();await mkdir(downloadPath,{recursive:true});
    await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadPath.replaceAll('/','\\'),eventsEnabled:true});
    await evaluate(`document.querySelector('#tl-more').click()`);
    const exportButton=await evaluate(`(()=>{const r=document.querySelector('#tl-export').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...exportButton});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...exportButton});
    let exported;for(let i=0;i<80;i++){await delay(100);exported=(await readdir(downloadPath)).find(p=>p.endsWith('.png'));if(exported)break;}
    assert.ok(exported,'PNG export must download: '+await evaluate(`document.querySelector('#toast').textContent`));const png=await readFile(downloadPath+'/'+exported);
    assert.equal(png.subarray(1,4).toString(),'PNG');assert.ok(png.length>30000,'export should contain the rendered map');
    checks.export={bytes:png.length,width:png.readUInt32BE(16),height:png.readUInt32BE(20)};
    fault=true;await send('Fetch.enable',{patterns:[{urlPattern:'*data/scene.json*'}]});
    await send('Page.navigate',{url:process.env.HUXI_PREVIEW_URL??'http://localhost:5188/'});
    let failed=false;for(let i=0;i<100;i++){await delay(150);failed=await evaluate(`document.querySelector('#boot-title')?.textContent==='校园数据加载失败'&&!document.querySelector('#boot-retry').hidden`);if(failed)break;}
    assert.ok(failed,'failed scene data must show a retry action');
    await capture('load-error');await send('Fetch.disable');await evaluate(`document.querySelector('#boot-retry').click()`);await waitReady();
    checks.sceneFailureRecovery=true;
    await send('Fetch.enable',{patterns:[{urlPattern:'*models/info.far.glb*'}]});
    await send('Page.reload',{ignoreCache:true});await waitReady();
    assert.ok(await evaluate(`!document.querySelector('#asset-status').hidden&&window.__huxi.detailAssets.length===7`),'failed landmark must keep the map usable with a visible fallback notice');
    await evaluate(`document.querySelector('#pd-back').click();[...document.querySelectorAll('.place')].find(p=>p.querySelector('.nm').textContent==='信息技术科研楼').click()`);
    assert.equal(await evaluate(`document.querySelector('#pd-name').textContent`),'信息技术科研楼');
    checks.modelFallback=true;await send('Fetch.disable');
    await send('Page.reload',{ignoreCache:true});await waitReady();await delay(300);fault=false;
    checks.expectedFaultErrors=expectedErrors.length;
    const base=process.env.HUXI_PREVIEW_URL??'http://localhost:5188/';
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:base});await waitReady();
    await evaluate(`document.querySelector('#tl-home').click()`);
    checks.crossDeviceShare=[];
    for(const [width,height] of [[390,844],[1440,960]]) {
      await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedURL=text}}});document.querySelector('#tl-share').click()`);
      const url=await evaluate('window.__copiedURL');
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<640});
      await send('Page.navigate',{url});await waitReady();
      const projected=await evaluate(`(async()=>{const h=window.__huxi,data=await(await fetch('data/scene.json')).json(),V=h.camera.position.constructor,w=innerWidth,height=innerHeight,panel=document.querySelector('#hud').getBoundingClientRect(),brand=document.querySelector('#brand').getBoundingClientRect();const r=w>640?{left:document.querySelector('#hud').classList.contains('collapsed')?24:panel.right+20,right:w-72,top:brand.bottom+18,bottom:height-24}:{left:12,right:w-12,top:Math.max(brand.bottom+16,72),bottom:Math.min(height-24,panel.top-16)};const points=data.boundary.pts.map(([x,y])=>new V(x,0,-y));for(const b of data.buildings.filter(b=>b.inside))for(const [x,y]of b.polygon)points.push(new V(x,b.height,-y));return {width:w,height,inside:points.every(p=>{p.project(h.camera);const x=(p.x+1)*w/2,y=(1-p.y)*height/2;return x>=r.left-1&&x<=r.right+1&&y>=r.top-1&&y<=r.bottom+1})};})()`);
      assert.ok(projected.inside,'cross-device share must retain the full campus');checks.crossDeviceShare.push(projected);
    }
  }
  assert.equal(errors.length,0,'browser exceptions');
  await writeFile(root+'/work/qa/'+prefix+'-showcase-check.json',JSON.stringify({ready,errors,checks},null,2));
  console.log(JSON.stringify({ready,errors,checks}));
} finally {if(ws){try{await send('Browser.close');}catch{}ws.close();}browser.kill();}
